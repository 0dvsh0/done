/**
 * Is the search actually working?
 *
 * The agent failed real, answerable tasks because every search backend it had
 * was silently returning nothing: DuckDuckGo's HTML endpoint answers HTTP 202
 * with an anti-bot page, Brave's HTML front-end 429s, and no public SearXNG
 * instance serves JSON to an anonymous caller. A run of this check is how that
 * gets caught the next time it happens — a search that returns nothing looks
 * exactly like a task that cannot be done.
 */
import { webSearch } from '../src/main/tools/web'
import { hydrateEnv } from '../src/main/env'

hydrateEnv()

const QUERIES = ['nodejs lts version', 'what is rust', 'weather in tokyo', 'ada lovelace']

const run = async (): Promise<void> => {
  let failed = 0

  for (const query of QUERIES) {
    const res = await webSearch.run({ query, limit: 5 }, { signal: undefined, aborted: false })
    const rows = Array.isArray(res.data) ? res.data : []
    const ok = res.ok && rows.length > 0
    if (!ok) failed++
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${res.output}`)
    if (ok) {
      const first = rows[0] as { title?: string; url?: string; via?: string }
      console.log(`      top: ${first.title} — ${first.url}`)
    }
  }

  // A query with no results must say what to do next, not just "no results",
  // or the agent searches the same thing again and again.
  const empty = await webSearch.run(
    { query: 'zzzqxnkqwxnoexistentsubjectmatter', limit: 5 },
    { signal: undefined, aborted: false }
  )
  const guides = /fetch it directly|do not search again/i.test(String(empty.output))
  if (!guides) failed++
  console.log(
    `${guides ? 'PASS' : 'FAIL'}  empty result tells the agent what to do instead: ` +
      `"${String(empty.output).slice(0, 90)}…"`
  )

  console.log(failed ? `\n${failed} failing` : '\nsearch is working')
  process.exit(failed ? 1 : 0)
}

void run()
