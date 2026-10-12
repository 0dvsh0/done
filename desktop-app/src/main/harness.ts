import { app } from 'electron'
import { Store } from './agent'
import { tracing } from './integrations'
import { hydrateEnv } from './env'
import { TOOLS } from './tools'
import { llmStatus, discoverModels } from './llm'

/* ==========================================================================
   The harness.

   Runs a real goal through the real agent — the same Store, the same model,
   the same tools — with no window in the way, and prints the trace. It is how
   the loop gets tested: not by mocking the tools or the model, but by pointing
   the agent at real work and reading back what it actually did.

     electron out/main/harness.js "find out what the current Node LTS is"
     DONE_LIMITS='{"spend":5}' electron out/main/harness.js "write a haiku to ~/Desktop/x.txt"
     DONE_AUTO=yes electron out/main/harness.js "..."

   Approvals are answered by DONE_ANSWERS, a comma-separated list consumed in
   order. Left unanswered, the run hangs — which is itself the product's
   promise, so the harness refuses to paper over it.
   ========================================================================== */

const log = (...args: unknown[]): void => {
  process.stdout.write(`${args.join(' ')}\n`)
}

hydrateEnv()

const goal = process.argv
  .slice(2)
  .filter((a) => !a.startsWith('--'))
  .join(' ')
if (!goal) {
  log('usage: electron out/main/harness.js "<goal>"')
  app.exit(1)
}

const answers = (process.env.DONE_ANSWERS ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)
const budget = Number(process.env.DONE_CADENCE ?? 1) // pacing multiplier, unused here
void budget

let turn = 0
const answered = new Set<string>()

async function main(): Promise<void> {
  // Settle the brain pool against this key's real catalogue before the first
  // call, so the line below names a model that can actually serve.
  await discoverModels()

  const status = llmStatus()
  log(`\n  model   ${status.model}${status.connected ? '' : '   (NOT CONNECTED)'}`)
  log(`  guard   ${status.guard}`)
  log(`  pool    ${status.brains.map((b) => `${b.id}${b.ready ? '' : ` (${b.reason})`}`).join(' → ')}`)
  log(`  tools   ${TOOLS.length} real tools`)
  log(`  goal    ${goal}\n`)

  if (!status.connected) {
    log(`  ERROR: ${status.error}`)
    app.exit(2)
    return
  }

  const store = new Store()

  const trace = await tracing.init()
  log(
    `  trace   ${trace.connected ? 'neatlogs connected' : `local only — ${trace.error ?? 'no key'}`}`
  )

  // Mirror the real app: a spend cap, and answers fed to the ask cards.
  try {
    const limits = JSON.parse(process.env.DONE_LIMITS ?? '{}') as {
      spend?: number
      messages?: boolean
    }
    store.limits = { ...store.limits, ...limits }
  } catch {
    /* defaults are fine */
  }
  log(`  budget  ${store.limits.spend === 0 ? 'ask me every time' : `$${store.limits.spend}`}\n`)

  const task = store.createTask(goal)

  let lastLine = ''
  store.onChange(() => {
    const current = store.byId(task.id)
    if (!current) return

    if (current.line && current.line !== lastLine) {
      lastLine = current.line
      log(`  LINE   ${current.line}`)
    }

    // Each ask is answered exactly once, keyed by its id. Without this the
    // handler fires again on the very bump that the answer caused, sees the
    // same card, and answers it again — forever.
    if (current.ask && current.state === 'needs' && !answered.has(current.ask.id)) {
      const askId = current.ask.id
      answered.add(askId)

      // A run that keeps knocking is a bug, not a long task. Stop and say so
      // rather than burning the quota on it.
      if (turn >= 12) {
        log(`  ASK    ${current.ask.q}`)
        log('  -- too many approvals in one run; stopping')
        store.control(task.id, 'stop')
        return
      }

      const answer = answers[turn++] ?? (process.env.DONE_AUTO === 'yes' ? 'yes' : null)
      const q = current.ask.q
      if (answer === null) {
        log(`  ASK    ${q}`)
        log(`  -- no answer given; stopping here (set DONE_AUTO=yes or DONE_ANSWERS)`)
        store.control(task.id, 'stop')
        return
      }
      log(`  ASK    ${q}`)
      log(`  -->    ${answer}`)
      store.answer(task.id, answer)
    }
  })

  // Long, because a delegated coding agent is allowed its own budget on top of
  // the free-tier token quota. The heartbeat matters more than the limit: a
  // delegated run can be quiet for minutes, and silence otherwise looks
  // exactly like a hang.
  let lastBeat = Date.now()
  const beat = setInterval(() => {
    if (Date.now() - lastBeat < 20_000) return
    lastBeat = Date.now()
    const live = store.runner(task.id)
    const spans = store.spans[task.id] ?? []
    const cost = spans.reduce((a, s) => a + (s.cost ?? 0), 0)
    log(
      `  ..     ${live ? 'running' : 'stopped'} · ${spans.length} spans · $${cost.toFixed(4)} · ${task.state}`
    )
  }, 5000)

  await waitFor(() => Boolean(task.finishedAt) || !store.runner(task.id), 1_800_000)
  clearInterval(beat)

  /* ------------------------------------------------------------- report */

  const spans = store.spans[task.id] ?? []
  const tokens = spans.reduce(
    (acc, s) => ({
      input: acc.input + (s.tokens?.input ?? 0),
      output: acc.output + (s.tokens?.output ?? 0)
    }),
    { input: 0, output: 0 }
  )
  const cost = spans.reduce((a, s) => a + (s.cost ?? 0), 0)
  const failures = spans.filter((s) => s.status === 'error')
  const blocked = spans.filter((s) => /blocked:/.test(s.output))

  log(`\n  -- the trace ----------------------------------------------`)
  for (const s of spans) {
    const flag = s.status === 'error' ? '!' : blocked.some((b) => b.id === s.id) ? '#' : '-'
    log(
      `  ${flag} ${String(s.kind).padEnd(10)} ${s.name.padEnd(16)} ${String(s.durationMs).padStart(6)}ms  ${s.output.slice(0, 70)}`
    )
    if (s.tokens) log(`      +- ${s.tokens.input} in / ${s.tokens.output} out`)
  }

  log(`\n  -- what it said -------------------------------------------`)
  for (const line of task.story) log(`  ${line.tone.padEnd(4)} ${line.text}`)

  log(`\n  -- result ------------------------------------------------`)
  log(`  state      ${task.state}`)
  log(
    `  spans      ${spans.length} (${failures.length} failed, ${blocked.length} injection-blocked)`
  )
  log(`  tokens     ${tokens.input} in / ${tokens.output} out`)
  log(`  cost       $${cost.toFixed(4)} at Groq list price`)
  log(
    `  verified   ${task.receipt ? `yes - ${task.receipt.lines.map((l) => `${l[0]}: ${l[1]}`).join('; ')}` : 'no'}`
  )
  log(`  proof      ${task.receipt?.proof.join(', ') || '-'}`)
  log('')

  const ok = task.state === 'done'
  await tracing.shutdown()
  app.exit(ok ? 0 : 1)
}

function waitFor(predicate: () => boolean, timeoutMs: number): Promise<void> {
  return new Promise((resolve) => {
    const started = Date.now()
    const tick = (): void => {
      if (predicate() || Date.now() - started > timeoutMs) resolve()
      else setTimeout(tick, 250)
    }
    tick()
  })
}

void app.whenReady().then(main)
