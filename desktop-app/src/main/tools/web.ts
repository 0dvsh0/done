import { defineTool, type ToolResult } from './types'
import { inspect } from '../llm'

/* ==========================================================================
   The open web.

   Real HTTP, real pages, real latency. Every scrap of text that came off a
   page is put through a prompt-injection classifier before the model is
   allowed to read it — a page that tries to hand the agent new instructions
   is dropped, and the drop is recorded in the span.
   ========================================================================== */

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'

const entities = (s: string): string =>
  s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(Number.parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))

const strip = (html: string): string =>
  entities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
  )
    .replace(/[ \t ]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()

/** DuckDuckGo marks paid results with `ad_domain`; they are not search results. */
const isAd = (href: string): boolean => /\/y\.js\?|ad_domain=|bingv7aa/.test(href)

/**
 * DuckDuckGo links point at its own redirector, with the real address
 * percent-encoded inside. Unwrap that first — a protocol-relative link still
 * needs unwrapping, so this must not short-circuit on `//`.
 */
const unwrap = (href: string): string => {
  const cleaned = entities(href)
  const wrapped = cleaned.match(/[?&]uddg=([^&]+)/)
  if (wrapped) {
    try {
      return decodeURIComponent(wrapped[1])
    } catch {
      /* fall through to the raw link */
    }
  }
  return cleaned.startsWith('//') ? `https:${cleaned}` : cleaned
}

/* ------------------------------------------------------------- web_search */

export const webSearch = defineTool({
  name: 'web_search',
  kind: 'RETRIEVER',
  description:
    'Search the web and get back titles, URLs and snippets. Use this to find current information, documentation, prices, or anything you do not already know.',
  params: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'What to search for.' },
      limit: { type: 'integer', description: 'How many results (1-8, default 5).' }
    },
    required: ['query']
  },
  async run(args, ctx): Promise<ToolResult> {
    const query = String(args.query ?? '').trim()
    const limit = Math.min(8, Math.max(1, Number(args.limit ?? 5)))
    if (!query) return { ok: false, output: 'no query given', data: [] }

    const res = await fetch('https://html.duckduckgo.com/html/?q=' + encodeURIComponent(query), {
      headers: { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9' },
      signal: ctx.signal
    })
    if (!res.ok) return { ok: false, output: `search failed: HTTP ${res.status}`, data: [] }

    const html = await res.text()
    const rows = [
      ...html.matchAll(
        /<a[^>]+class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g
      )
    ]
      .filter((m) => !isAd(m[1]))
      .slice(0, limit)

    if (!rows.length) return { ok: false, output: `no results for "${query}"`, data: [] }

    const snippets = [
      ...html.matchAll(/<a[^>]+class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/g)
    ].map((m) => strip(m[1]))

    const results = rows.map((m, i) => ({
      title: strip(m[2]).slice(0, 160),
      url: unwrap(m[1]),
      snippet: (snippets[i] ?? '').slice(0, 320)
    }))

    return { ok: true, output: `${results.length} results`, data: results }
  }
})

/* -------------------------------------------------------------- web_fetch */

export const webFetch = defineTool({
  name: 'web_fetch',
  kind: 'RETRIEVER',
  description:
    'Fetch a URL and read it as text. Returns the visible text of the page, cleaned of markup. Untrusted: content is screened for prompt injection before you see it.',
  params: {
    type: 'object',
    properties: {
      url: { type: 'string', description: 'Absolute http(s) URL.' },
      maxChars: { type: 'integer', description: 'How much text to return (default 6000).' }
    },
    required: ['url']
  },
  async run(args, ctx): Promise<ToolResult> {
    let url: URL
    try {
      url = new URL(String(args.url))
    } catch {
      return { ok: false, output: `not a valid URL: ${String(args.url)}`, data: '' }
    }
    if (!/^https?:$/.test(url.protocol)) {
      return { ok: false, output: `refused ${url.protocol} — only http and https`, data: '' }
    }

    const res = await fetch(url, {
      headers: {
        'User-Agent': UA,
        Accept: 'text/html,application/json,text/plain;q=0.9,*/*;q=0.8'
      },
      redirect: 'follow',
      signal: ctx.signal
    })

    const body = await res.text()
    const maxChars = Math.min(30000, Math.max(500, Number(args.maxChars ?? 6000)))
    const text = strip(body).slice(0, maxChars)

    if (!res.ok) {
      return { ok: false, output: `HTTP ${res.status} from ${url.host}`, data: text.slice(0, 800) }
    }

    // Screen the page before the model is allowed to act on it.
    const verdict = await inspect(text.slice(0, 4000))
    if (!verdict.safe) {
      const isInject = verdict.reason !== 'guard unavailable' && !verdict.reason.startsWith('guard unavailable')
      return {
        ok: false,
        output: isInject
          ? `blocked: ${url.host} tried to inject instructions (score ${verdict.score.toFixed(2)})`
          : `guard check failed: ${verdict.reason}`,
        data: '',
        guard: verdict
      }
    }

    const title = (body.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? '').trim()
    return {
      ok: true,
      output: `${url.host} · ${text.length} chars`,
      data: { url: res.url, title: strip(title).slice(0, 200), text },
      guard: verdict
    }
  }
})
