/**
 * Prints one GitHub engine result, verbatim.
 *
 * Run: npx tsx scripts/github-sample.ts
 *
 * This exists so the copy on the landing page can be pasted from a real
 * response rather than written from memory and left to rot.
 */
import { GitHubConnector } from '../src/main/connectors/github'
import type { ConnectorContext } from '../src/main/connectors/types'
import type { Task } from '../src/shared/types'

const title = process.argv.slice(2).join(' ') || 'give me latest five open issues in vercel/next.js'

const task = {
  id: 'sample',
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
} as Task

const ctx = {
  task,
  step: async () => ({}) as never,
  store: {} as never,
  isStopped: () => false,
  holdIfPaused: async () => {},
  checkSpend: async () => true,
  askPermission: async () => ({ approved: true }),
  charge: () => {},
  pushHistory: (e: { tool: string; summary: string; args: string; ok: boolean }) =>
    console.log(`tool   ${e.tool}\n       ${e.args}\n       → ${e.summary}`),
  executeLocalTool: async () => ({ ok: true, output: '' }),
  setTaskLine: () => {},
  setTaskProgress: () => {},
  setLiveAgent: () => {}
} as unknown as ConnectorContext

async function main(): Promise<void> {
  const res = await new GitHubConnector().execute(task.title, ctx)
  console.log(`\ngoal     ${task.title}`)
  console.log(`\nsummary  ${res.summary}\n`)
  console.log(`detail\n${res.detail}\n`)
  if (res.receiptDraft) {
    console.log('receipt')
    for (const [k, v] of res.receiptDraft.lines) console.log(`  ${k.padEnd(10)} ${v}`)
    console.log(`  ${'Proof'.padEnd(10)} ${res.receiptDraft.proof.join(', ')}`)
  }
}

void main()
