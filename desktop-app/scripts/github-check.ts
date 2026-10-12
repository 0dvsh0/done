/**
 * GitHub engine check.
 *
 * Hits the real API. Nothing here is mocked, because the whole claim this
 * engine makes is that it returns what GitHub returned.
 *
 * Run: npx tsx scripts/github-check.ts
 */
import { GitHubConnector, parseRepo } from '../src/main/connectors/github'
import type { ConnectorContext } from '../src/main/connectors/types'
import type { Task } from '../src/shared/types'

const task = (title: string): Task =>
  ({
    id: 'test',
    title,
    state: 'working',
    progress: 0,
    line: '',
    plan: [],
    planIdx: -1,
    beatIdx: 0,
    beatsTotal: 0,
    story: [],
    ask: null,
    receipt: null,
    notes: [],
    when: null,
    budget: null,
    group: null,
    created: Date.now(),
    finishedAt: null,
    nextAt: 0,
    settleUntil: 0,
    traceId: null,
    checkpointId: null,
    vars: {}
  }) as Task

const history: string[] = []

function ctx(t: Task): ConnectorContext {
  return {
    task: t,
    step: (async (m: unknown, w: () => Promise<unknown>) => {
      const r = await w()
      return {
        id: 'x',
        parentId: null,
        kind: 'TOOL',
        name: 'x',
        input: '',
        output: String(r),
        start: 0,
        end: 0,
        durationMs: 0,
        status: 'ok',
        tokens: null,
        cost: null,
        exported: false
      }
    }) as never,
    store: {} as never,
    isStopped: () => false,
    holdIfPaused: async () => {},
    checkSpend: async () => true,
    askPermission: async () => ({ approved: true }),
    charge: () => {},
    pushHistory: (e) => history.push(`${e.tool}: ${e.summary}`),
    executeLocalTool: async () => ({ ok: true, output: '' }),
    setTaskLine: () => {},
    setTaskProgress: () => {},
    setLiveAgent: () => {}
  }
}

let failures = 0
const ok = (cond: boolean, msg: string): void => {
  if (!cond) failures++
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`)
}

/* --- repo extraction, no network ---------------------------------------- */

for (const [title, want] of [
  ['give me latest five issue in vercel/next.js', 'vercel/next.js'],
  ['latest pull requests in facebook/react', 'facebook/react'],
  ['issues on github.com/nodejs/node', 'nodejs/node'],
  ['open issues in the repo', null],
  ['buy milk', null]
] as [string, string | null][]) {
  const got = parseRepo(title)
  ok(got === want, `parseRepo(${JSON.stringify(title)}) → ${got} (want ${want})`)
}

/* --- the real thing ----------------------------------------------------- */

async function main(): Promise<void> {
  const engine = new GitHubConnector()

  const issues = await engine.execute('x', ctx(task('give me latest five issue in vercel/next.js')))
  ok(issues.ok, `issues: ${issues.summary}`)
  ok(
    /#\d+/.test(issues.detail),
    `issues: returned real numbered rows${issues.detail ? ` — first line "${issues.detail.split('\n')[0]}"` : ''}`
  )
  ok(
    !/\bMerge pull request\b/.test(issues.detail ?? ''),
    'issues: pull requests were filtered out of an issues answer'
  )
  ok(Boolean(issues.receiptDraft?.proof?.length), 'issues: proof carries real issue URLs')

  const prs = await engine.execute('x', ctx(task('latest pull requests in facebook/react')))
  ok(prs.ok && /pull request/i.test(prs.summary), `pull requests: ${prs.summary}`)

  const bad = await engine.execute(
    'x',
    ctx(task('latest issues in definitely-not-a-real-org-xyz/nope'))
  )
  ok(!bad.ok, `a repo that does not exist fails honestly: ${bad.summary}`)

  const noRepo = await engine.execute('x', ctx(task('tell me a joke')))
  ok(!noRepo.ok, `no repo named: ${noRepo.summary}`)

  console.log('\nhistory:')
  for (const h of history) console.log(`  ${h}`)

  console.log(failures ? `\n${failures} failing` : '\nall passing')
  process.exit(failures ? 1 : 0)
}

void main()
