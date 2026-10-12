/**
 * Routing check.
 *
 * The three things that actually broke, in the order they matter:
 *   1. a simple task must reach an engine that can act, not a prose generator
 *   2. routing must be instant — no model call before the work starts
 *   3. the reason shown to the user must be a sentence, not machinery
 *
 * Run: npx tsx scripts/route-check.ts
 */
import { routeTask } from '../src/main/connectors/router'
import type { Task } from '../src/shared/types'

const task = (title: string, connector: Task['connector'] = 'auto'): Task =>
  ({
    id: 'test',
    title,
    state: 'waiting',
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
    created: 0,
    finishedAt: null,
    nextAt: 0,
    settleUntil: 0,
    traceId: null,
    checkpointId: null,
    vars: {},
    connector
  }) as Task

/**
 * These two used to assert the old behaviour, which was the bug. Both were
 * routed to a prose-only engine, which is why they ended as paragraphs and a
 * "needs you" card nobody could answer. They now go to the local engine,
 * which has the browser and will actually go and look.
 *
 * The GitHub rows are the newer assertion. A question about a repository's
 * issues is a *query*, and the local model was answering it by opening a
 * browser, waiting for a client-side router to hydrate and reading the DOM —
 * doing by hand what one API request returns. Routing it to the engine that
 * holds the API is the difference between delegating and improvising.
 */
const CASES = [
  // the task that was stuck on "needs you" forever
  ['give me today weather', 'grok'],
  ['i want to change my privacy policy url in play store.', 'pi'],
  ['tell me that my pr in cognee-comunity have merged or not', 'pi'],
  ['fix the failing test in src/auth.test.ts', 'claude'],
  ['write a python script that prints fibonacci', 'claude'],
  ['brainstorm some names for a coffee app', 'muse'],
  ['compare postgres and sqlite for our use case', 'chatgpt'],
  ['audit the whole repo for security issues', 'gemini'],
  // a repository question is delegated, not scraped
  ['give me latest five issue in vercel/next.js', 'github'],
  ['what are the open issues on facebook/react', 'github'],
  ['latest pull requests in vercel/next.js', 'github'],
  ['what is the latest release of vercel/next.js', 'github'],
  ['github.com/vercel/next.js issues', 'github'],
  // local work about a repo stays local — the words overlap on purpose
  ['fix the latest issue in the repo', 'claude'],
  ['review the open issues in this repo and fix them', 'claude'],
  // unrecognised -> the local engine, which can act
  ['call my mum', 'pi'],
  ['buy milk', 'pi'],
  ['', 'pi']
]

let failures = 0

for (const [title, expected] of CASES) {
  const started = Date.now()
  const got = routeTask(task(title), async () => ({}) as never, 'C:/work')
  const ms = Date.now() - started

  const ok = got.connector === expected && ms < 50
  if (!ok) failures++
  console.log(
    `${ok ? 'PASS' : 'FAIL'}  ${String(ms).padStart(3)}ms  ${got.connector.padEnd(8)} ${title || '(empty)'}`
  )
  if (!ok) console.log(`      expected ${expected}`)
  // Every reason must read as a sentence, not as a status code or a stack.
  if (!/[.!?]$/.test(got.reason)) {
    failures++
    console.log(`      reason is not a sentence: "${got.reason}"`)
  }
}

// A pinned engine is never second-guessed.
const pinned = routeTask(task('fix the failing test', 'muse'), async () => ({}) as never, 'C:/work')
console.log(`${pinned.connector === 'muse' ? 'PASS' : 'FAIL'}  pinned engine honoured`)
if (pinned.connector !== 'muse') failures++

console.log(failures ? `\n${failures} failing` : '\nall passing')
process.exit(failures ? 1 : 0)
