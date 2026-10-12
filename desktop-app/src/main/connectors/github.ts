import type { AgentConnector, ConnectorContext, ConnectorResult } from './types'
import type { ConnectorInfo } from '../../shared/types'
import { envKey } from '../env'

/* ==========================================================================
   GitHub — the one engine that talks to a service instead of guessing.

   Everything else here reaches the world through a browser and a search
   engine: it opens a URL, reads what rendered, and clicks. That works, and it
   is slow, and it is wrong in a specific way — a repository's issues, pull
   requests and releases are a *query*, and there is an API that answers it in
   one request with structured data.

   So "give me the latest five issues in vercel/next.js" used to mean opening a
   browser, waiting for GitHub's client-side router to hydrate, scrolling, and
   reading the DOM — the local model doing by hand what one `fetch` does
   exactly. This engine does the `fetch`, and hands the real rows back. It
   claims nothing it did not receive, and when the request fails it says which
   request failed.
   ========================================================================== */

const API = 'https://api.github.com'

/** `owner/repo`, a github.com URL, or an empty string when there isn't one. */
export function parseRepo(text: string): string | null {
  const url = /github\.com\/([\w.-]+)\/([\w.-]+)/i.exec(text)
  if (url) return `${url[1]}/${url[2]}`.replace(/\.git$/, '')
  const slug = /(?:^|\s)([a-z0-9][\w.-]*\/[a-z0-9][\w.-]*)(?=$|[\s,.]|$)/i.exec(text)
  return slug ? slug[1].replace(/\.git$/, '') : null
}

/**
 * What the sentence asked for. Default is open issues, newest first.
 *
 * The singular form is carried alongside the plural rather than derived from it
 * at print time: `"open issues".replace(/s$/,'')` gives `"open issue"`, which
 * is right, but there is no such trick that is also right for `"pull requests"`,
 * and getting it wrong produces "1 open open issue" in a sentence the user reads.
 */
function parseKind(text: string): { kind: string; label: string; one: string } {
  const t = text.toLowerCase()
  if (/\b(pull ?requests?|prs?|merged)\b/.test(t)) {
    return { kind: 'prs', label: 'pull requests', one: 'pull request' }
  }
  if (/\b(release|releases|tag|tags|changelog)\b/.test(t)) {
    return { kind: 'releases', label: 'releases', one: 'release' }
  }
  if (/\b(commit|commits|history)\b/.test(t)) {
    return { kind: 'commits', label: 'commits', one: 'commit' }
  }
  if (/\b(closed)\b/.test(t)) {
    return { kind: 'closed', label: 'closed issues', one: 'closed issue' }
  }
  return { kind: 'issues', label: 'open issues', one: 'open issue' }
}

/** "1 open issue" / "3 open issues", from the number and the two forms. */
function count1(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`
}

function parseCount(text: string, max = 10): number {
  const words: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5 }
  const digit = /\b(\d{1,2})\b/.exec(text)
  if (digit) return Math.min(max, Math.max(1, Number(digit[1])))
  const word = new RegExp(`\\b(${Object.keys(words).join('|')})\\b`, 'i').exec(text)
  return word ? words[word[1].toLowerCase()] : 5
}

interface Row {
  number: number
  title: string
  state: string
  author: string
  when: string
  url: string
  labels: string[]
}

function row(raw: Record<string, unknown>, fallbackUrl: string): Row {
  const user = raw['user'] as { login?: string } | undefined
  return {
    number: Number(raw['number'] ?? 0),
    title: String(raw['title'] ?? raw['message'] ?? raw['name'] ?? '(untitled)'),
    state: String(raw['state'] ?? (raw['draft'] ? 'draft' : 'open')),
    author: user?.login ?? String(raw['author'] ?? raw['sha'] ?? ''),
    when: String(raw['created_at'] ?? raw['published_at'] ?? raw['committed_date'] ?? ''),
    url: String(raw['html_url'] ?? fallbackUrl),
    labels: ((raw['labels'] as unknown[]) ?? [])
      .map((l) => String((l as { name?: string }).name ?? l))
      .slice(0, 4)
  }
}

function render(repo: string, label: string, rows: Row[]): string {
  const lines = rows.map((r, i) => {
    const bits = [`${i + 1}. #${r.number} ${r.title}`]
    const meta = [r.state, r.author && `@${r.author}`, r.when.slice(0, 10)]
      .filter(Boolean)
      .join(' · ')
    if (meta) bits.push(`   (${meta})`)
    if (r.labels.length) bits.push(`   labels: ${r.labels.join(', ')}`)
    bits.push(`   ${r.url}`)
    return bits.join('\n')
  })
  return [`${repo} — ${label} (${rows.length})`, '', ...lines].join('\n')
}

async function get<T>(path: string, key: string | null, signal?: AbortSignal): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    signal,
    headers: {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'done-desktop',
      ...(key ? { Authorization: `Bearer ${key}` } : {})
    }
  })
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(`GitHub ${res.status}${detail ? ` — ${detail.slice(0, 160)}` : ''}`)
  }
  return (await res.json()) as T
}

export class GitHubConnector implements AgentConnector {
  id = 'github' as const
  name = 'GitHub'
  blurb = 'Reads repositories directly from the API — issues, pull requests, releases, commits.'
  category = 'code' as const
  badge = 'GitHub'
  icon = 'github'

  private customKey: string | null = null

  setConfig(key?: string): void {
    if (key !== undefined) this.customKey = key.trim() || null
  }

  /** A token entered in Connections wins; otherwise look in the environment. */
  private token(): string | null {
    return this.customKey || envKey('GITHUB_API_KEY') || envKey('GH_TOKEN')
  }

  isConfigured(): boolean {
    return true
  }

  getInfo(): ConnectorInfo {
    return {
      id: this.id,
      name: this.name,
      blurb: this.blurb,
      category: this.category,
      badge: this.badge,
      icon: this.icon,
      // No key is needed to read a public repository, so this engine is always
      // reachable. A key only raises the rate limit and reaches private repos.
      connected: true,
      description:
        'Queries the GitHub API directly instead of scraping the website. Returns the real rows — number, title, author, labels, URL — in one request rather than a browser session.',
      endpoint: API,
      requiresKey: 'GITHUB_API_KEY'
    }
  }

  async execute(prompt: string, ctx: ConnectorContext): Promise<ConnectorResult> {
    const repo = parseRepo(ctx.task.title) ?? parseRepo(prompt)
    if (!repo) {
      return {
        ok: false,
        summary: 'There was no repository in that to look up — it needs an owner/name.',
        detail: 'Write it the way GitHub writes it, e.g. "vercel/next.js".'
      }
    }

    const { kind, label, one } = parseKind(ctx.task.title)
    const count = parseCount(ctx.task.title)

    ctx.setTaskLine(`Asking GitHub about ${repo}.`)
    ctx.setTaskProgress(0.3)

    const path =
      kind === 'releases'
        ? `/repos/${repo}/releases?per_page=${count}`
        : kind === 'commits'
          ? `/repos/${repo}/commits?per_page=${count}`
          : `/repos/${repo}/issues?state=${kind === 'closed' ? 'closed' : 'open'}&sort=created&direction=desc&per_page=${count}`

    try {
      const raw = await get<Record<string, unknown>[]>(path, this.token())
      // `/issues` returns pull requests too — they share the endpoint. A pull
      // request is not an issue, and quietly mixing them makes the count a lie.
      const issues = (raw ?? []).filter((r) =>
        kind === 'prs' ? Boolean(r['pull_request']) : !r['pull_request']
      )
      const rows = issues.slice(0, count).map((r) => row(r, `https://github.com/${repo}`))
      const output = render(repo, label, rows)

      ctx.setTaskProgress(0.9)
      ctx.pushHistory({
        tool: 'github_api',
        ok: true,
        summary: `${repo}: ${count1(rows.length, one, label)}`,
        detail: output,
        args: `GET ${path}`
      })

      if (rows.length === 0) {
        return {
          ok: true,
          summary: `GitHub has no ${label} on ${repo} right now.`,
          detail: output,
          model: 'github-api'
        }
      }

      /* When the repository has fewer than was asked for, say so in the summary
         rather than letting the number quietly be lower. The verification pass
         reads this evidence against the goal, and "you asked for five, there is
         one" is a goal that is met — which it can tell apart from "the run only
         managed one". */
      const short = rows.length < count
      const note = short ? ` — that is all it has open` : ''

      return {
        ok: true,
        summary: `GitHub returned ${count1(rows.length, one, label)} on ${repo}${note}.`,
        detail: output,
        model: 'github-api',
        receiptDraft: {
          lines: [
            ['Repository', repo],
            ['Asked for', count1(count, one, label)],
            ['Read from', `api.github.com${path.split('?')[0]}`]
          ],
          proof: rows.slice(0, 4).map((r) => r.url),
          undo: null
        }
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      ctx.pushHistory({
        tool: 'github_api',
        ok: false,
        summary: `GitHub did not answer for ${repo}.`,
        detail: message,
        args: `GET ${path}`
      })
      return {
        ok: false,
        summary: `GitHub did not answer for ${repo} — ${message}`,
        detail: message
      }
    }
  }
}
