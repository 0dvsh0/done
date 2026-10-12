import { randomUUID } from 'node:crypto'
import { app } from 'electron'
import type {
  AppState,
  Ask,
  ControlAction,
  CreateOptions,
  Integrations,
  Ledger,
  Limits,
  Receipt,
  SpanRecord,
  Task,
  TaskState
} from '../shared/types'
import { entire, tracing, type Step } from './integrations'
import { llmStatus, shortModel, withRetry, zeroUsage, type Usage } from './llm'
import { describeArgs, TOOLS_BY_NAME, type Tool, type ToolContext } from './tools'
import { shutdownBrowser } from './tools/browser'
import type { Agent } from '@earendil-works/pi-agent-core'
import {
  getConnector,
  getConnectorList,
  routeTask,
  setConnectorConfig,
  type ConnectorContext
} from './connectors'
import type { ConnectorId } from '../shared/types'

/* ==========================================================================
   The agent.

   There is no script here. A task is a goal handed to a real model, and the
   model decides what to do with it: which tool, with what arguments, or
   whether it is finished. Every sentence the agent says is that model's own
   words. Every span is a real call with real latency, real tokens and a real
   result. If a tool fails, the trace says it failed, and the model gets to
   decide what to try next.

   Four rules, in the order they matter:

     1. Nothing irreversible runs without the user saying yes.
     2. Nothing is claimed done until a separate pass has checked it.
     3. The cost of a run is real and is shown, and it can be capped.
     4. Anything read off the web is screened for prompt injection first.
   ========================================================================== */

/** Roughly what the next model call costs, used for the spend guard. */
const ESTIMATE_NEXT_CALL = 0.004

/** How much of a tool result the next decision gets to see. */
const DETAIL_BUDGET = 1600

/** How many recent results stay in the context. */
const HISTORY_WINDOW = 6

const clone = <T>(o: T): T => JSON.parse(JSON.stringify(o)) as T

export const money = (n: number): string =>
  `$${(Math.round(n * 100) / 100).toFixed(Number.isInteger(n) ? 0 : 2)}`

/* ==========================================================================
   Gate — pause / resume / take over / stop, without losing the thread.
   ========================================================================== */

class Gate {
  private paused = false
  private stopped = false
  private waiters: (() => void)[] = []

  get isPaused(): boolean {
    return this.paused
  }
  get isStopped(): boolean {
    return this.stopped
  }

  setPaused(on: boolean): void {
    if (this.paused === on) return
    this.paused = on
    this.release()
  }

  stop(): void {
    this.stopped = true
    this.paused = false
    this.release()
  }

  private release(): void {
    const w = this.waiters
    this.waiters = []
    for (const fn of w) fn()
  }

  async hold(): Promise<void> {
    while (this.paused && !this.stopped) {
      await new Promise<void>((r) => this.waiters.push(r))
    }
  }

  /** A sleep that freezes while paused and ends early when stopped. */
  async wait(ms: number): Promise<void> {
    const end = Date.now() + ms
    while (!this.stopped) {
      await this.hold()
      const left = end - Date.now()
      if (left <= 0) return
      await new Promise<void>((r) => setTimeout(r, Math.min(left, 90)))
    }
  }
}

interface Deferred {
  promise: Promise<void>
  resolve: () => void
}

function deferred(): Deferred {
  let resolve!: () => void
  const promise = new Promise<void>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

const isLive = (s: TaskState): boolean => s === 'working' || s === 'snag' || s === 'waiting'

/**
 * Group names are whatever the user typed, tidied rather than policed.
 */
function cleanGroup(name: string | null | undefined): string | null {
  const tidy = String(name ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 32)
  return tidy || null
}

const sameGroup = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase()

/* ==========================================================================
   Store — the whole world, and the only copy of it.
   ========================================================================== */

interface UndoEntry {
  label: string
  tasks: Task[]
  ledger: Ledger
  allPaused: boolean
}

export class Store {
  tasks: Task[] = []
  spans: Record<string, SpanRecord[]> = {}
  limits: Limits = { spend: 0, messages: true, quiet: false }
  ledger: Ledger = { spent: 0, minutes: 0, done: 0 }
  allPaused = false
  integrations: Integrations = {
    neatlogs: {
      installed: false,
      connected: false,
      workflow: 'done-desktop',
      spansExported: 0,
      lastExportAt: null,
      error: null
    },
    entire: {
      installed: false,
      version: null,
      enabled: false,
      checkpoints: 0,
      lastCheckpointId: null,
      lastCheckpointAt: null,
      repoPath: null,
      error: null
    },
    model: llmStatus(),
    connectors: getConnectorList()
  }

  private runners = new Map<string, Runner>()
  private undoStack: UndoEntry[] = []
  private rev = 0
  private listeners = new Set<() => void>()
  private revListeners = new Set<(rev: number) => void>()

  onChange(cb: () => void): () => void {
    this.listeners.add(cb)
    return () => void this.listeners.delete(cb)
  }

  onRev(cb: (rev: number) => void): () => void {
    this.revListeners.add(cb)
    return () => void this.revListeners.delete(cb)
  }

  bump(): void {
    this.rev += 1
    for (const cb of this.revListeners) cb(this.rev)
    for (const cb of this.listeners) cb()
  }

  /* ---------------------------------------------------------------- lookup */

  byId(id: string): Task | undefined {
    return this.tasks.find((t) => t.id === id)
  }

  runner(id: string): Runner | undefined {
    return this.runners.get(id)
  }

  /* ---------------------------------------------------------------- create */

  makeTask(title: string, opts: CreateOptions = {}): Task {
    const t: Task = {
      id: randomUUID().slice(0, 8),
      title,
      state: 'waiting',
      progress: 0,
      line: 'Written down. Starting in a moment.',
      plan: [],
      planIdx: -1,
      beatIdx: 0,
      beatsTotal: 0,
      story: [],
      ask: null,
      receipt: null,
      notes: [],
      when: opts.when ?? null,
      budget: opts.budget ?? null,
      group: cleanGroup(opts.group),
      connector: opts.connector ?? 'auto',
      routedConnector: undefined,
      routingReason: undefined,
      created: Date.now(),
      finishedAt: null,
      nextAt: Date.now(),
      settleUntil: 0,
      traceId: null,
      checkpointId: null,
      vars: {}
    }
    return t
  }

  createTask(title: string, opts: CreateOptions = {}): Task {
    const clean = String(title ?? '')
      .trim()
      .slice(0, 200)
    if (!clean) throw new Error('A task needs a title.')
    const t = this.makeTask(clean, opts)
    this.tasks.unshift(t)
    this.say(t, 'You wrote this down.', 'you')
    this.bump()
    this.launch(t)
    return t
  }

  /* --------------------------------------------------------------- saying */

  say(t: Task, text: string, tone: Task['story'][number]['tone'], span?: SpanRecord): void {
    t.story.push({
      id: randomUUID().slice(0, 8),
      at: Date.now(),
      text,
      tone,
      spanId: span?.id ?? null,
      code: span ? describeSpan(span) : ''
    })
  }

  addSpans(taskId: string, spans: SpanRecord[]): void {
    if (!spans.length) return
    const list = [...(this.spans[taskId] ?? []), ...spans]
    this.spans[taskId] = list.slice(-600)
  }

  /* ------------------------------------------------------------------ run */

  launch(t: Task): void {
    if (this.runners.has(t.id)) return
    const runner = new Runner(this, t)
    this.runners.set(t.id, runner)
    if (t.state === 'done' || t.state === 'stopped') {
      this.runners.delete(t.id)
      return
    }
    void runner.run().finally(() => {
      if (this.runners.get(t.id) === runner) this.runners.delete(t.id)
    })
  }

  halt(t: Task): void {
    const runner = this.runners.get(t.id)
    if (runner) {
      runner.gate.stop()
      runner.dispose()
      this.runners.delete(t.id)
    }
  }

  /* -------------------------------------------------------------- control */

  control(id: string, action: ControlAction): void {
    const t = this.byId(id)
    const runner = this.runners.get(id)
    if (!t || !runner) return

    switch (action) {
      case 'pause': {
        this.pushUndo('Pause')
        if (t.state === 'paused') {
          t.state = t.prevState && t.prevState !== 'paused' ? t.prevState : 'working'
          t.prevState = null
          t.line = 'Picking up where I left off.'
          this.say(t, 'You resumed it. Picking up where I left off.', 'you')
          runner.gate.setPaused(false)
        } else if (isLive(t.state)) {
          t.prevState = t.state
          t.state = 'paused'
          t.line = 'Paused. Nothing will happen until you resume.'
          this.say(t, 'You paused it. Holding exactly here.', 'you')
          runner.gate.setPaused(true)
        }
        break
      }

      case 'take': {
        this.pushUndo('Take over')
        if (t.state === 'you') {
          t.state = t.prevState && t.prevState !== 'you' ? t.prevState : 'working'
          t.prevState = null
          t.line = 'Back to me. Continuing from where you left off.'
          this.say(t, 'You handed it back. Continuing from where you left off.', 'you')
          runner.gate.setPaused(false)
        } else if (!t.finishedAt) {
          if (t.ask) runner.releaseAsk()
          t.prevState = t.state
          t.state = 'you'
          t.line = "Everything I found is in the story below. It's yours."
          this.say(t, 'You took over. I stopped and left you everything I found.', 'you')
          runner.gate.setPaused(true)
        }
        break
      }

      case 'stop': {
        if (t.finishedAt) return
        this.pushUndo('Stop')
        runner.releaseAsk()
        runner.gate.stop()
        runner.dispose()
        this.runners.delete(id)
        t.ask = null
        t.state = 'stopped'
        t.line = 'Stopped. Nothing was changed.'
        t.finishedAt = Date.now()
        this.say(t, 'You stopped it. Nothing was changed.', 'you')
        break
      }

      case 'reverse': {
        if (t.state !== 'done' || !t.receipt?.undo) return
        this.pushUndo('Reverse')
        t.state = 'stopped'
        t.line = 'Reversed. Everything is back how it was.'
        t.finishedAt = Date.now()
        this.say(t, 'You reversed it. Everything is back how it was.', 'you')
        break
      }
    }
    this.bump()
  }

  answer(id: string, value: string): void {
    const runner = this.runners.get(id)
    if (!runner) return
    this.pushUndo('Your answer')
    runner.resolveAsk(value)
    this.bump()
  }

  /**
   * Adding an instruction mid-run. If the run has already stopped — because the
   * agent got stuck, or you stopped it at the budget — this revives it. A task
   * that says "I need you" and then gives you no way to answer is just stuck.
   */
  steer(id: string, text: string): void {
    const t = this.byId(id)
    const clean = text.trim()
    if (!t || !clean) return
    this.pushUndo('Steer')

    const runner = this.runners.get(id)
    if (!runner) {
      if (t.finishedAt) return
      t.story.push({
        id: randomUUID().slice(0, 8),
        at: Date.now(),
        text: `You said: "${clean}"`,
        tone: 'you',
        spanId: null,
        code: ''
      })
      // Start again from the top, carrying the instruction as context.
      t.beatIdx = 0
      t.planIdx = -1
      t.progress = 0
      t.state = 'waiting'
      t.ask = null
      this.launch(t)
      this.bump()
      return
    }

    this.say(t, `You said: "${clean}"`, 'you')
    runner.steer(clean)
    this.bump()
  }

  setAllPaused(on: boolean): void {
    if (this.allPaused === on) return
    this.pushUndo(on ? 'Pause all' : 'Resume all')
    this.allPaused = on
    for (const t of this.tasks) {
      const runner = this.runners.get(t.id)
      if (!runner) continue
      if (on && isLive(t.state)) {
        t.prevState = t.state
        t.state = 'paused'
        t.line = 'Paused with everything else.'
        this.say(t, 'You paused everything.', 'you')
        runner.gate.setPaused(true)
      } else if (!on && t.state === 'paused') {
        t.state = t.prevState && t.prevState !== 'paused' ? t.prevState : 'working'
        t.prevState = null
        t.line = 'Picking up where I left off.'
        this.say(t, 'You resumed everything.', 'you')
        runner.gate.setPaused(false)
      }
    }
    this.bump()
  }

  /**
   * Limits really change behaviour: raise the spend cap and the agent stops
   * interrupting you; lower it and it starts asking. Changing them is a change
   * to the agent's mind, so it gets committed and checkpointed by Entire
   * rather than quietly saved.
   */
  async setLimits(patch: Partial<Limits>): Promise<void> {
    const before = clone(this.limits)
    this.limits = { ...this.limits, ...patch }
    this.bump()
    const changed = (Object.keys(patch) as (keyof Limits)[]).filter(
      (k) => this.limits[k] !== before[k]
    )
    if (changed.length) {
      await this.recordBehaviour(
        `limits: ${changed.join(', ')}`,
        `Changed what the agent may do on its own — ${changed.join(', ')}.`,
        { before, after: this.limits }
      )
    }
  }

  /* ----------------------------------------------------------------- undo */

  private pushUndo(label: string): void {
    this.undoStack.push({
      label,
      tasks: clone(this.tasks),
      ledger: clone(this.ledger),
      allPaused: this.allPaused
    })
    if (this.undoStack.length > 40) this.undoStack.shift()
  }

  undo(): void {
    const entry = this.undoStack.pop()
    if (!entry) return

    const wanted = new Map(entry.tasks.map((t) => [t.id, t]))

    for (const t of this.tasks) {
      const back = wanted.get(t.id)
      if (!back) {
        this.halt(t)
        continue
      }
      wanted.delete(t.id)
      const running = this.runners.has(t.id)
      Object.assign(t, back)
      if (running && isLive(t.state)) {
        t.prevState = t.state
        t.state = 'paused'
        t.line = 'Undone. Resume whenever you are ready.'
        this.runners.get(t.id)?.gate.setPaused(true)
      }
    }

    for (const [id, back] of wanted) {
      this.tasks.push(back as Task)
      if (isLive(back.state) && !this.allPaused) {
        back.state = 'paused'
        back.prevState = null
        this.launch(back as Task)
        this.runners.get(id)?.gate.setPaused(true)
      }
    }

    this.ledger = entry.ledger
    this.allPaused = entry.allPaused
    if (!this.allPaused) {
      for (const t of this.tasks) {
        if (t.state === 'paused' && t.prevState) {
          t.state = t.prevState
          t.prevState = null
          this.runners.get(t.id)?.gate.setPaused(false)
        }
      }
    }
    this.bump()
  }

  /* --------------------------------------------------------------- groups */

  setGroup(id: string, name: string | null): void {
    const t = this.byId(id)
    if (!t) return
    const next = cleanGroup(name)
    const was = cleanGroup(t.group)
    if (was === next || (was && next && sameGroup(was, next))) return
    this.pushUndo('Move')
    t.group = next
    this.say(t, next ? `You filed this under ${next}.` : 'You took it out of its group.', 'you')
    this.bump()
  }

  renameGroup(from: string, to: string): void {
    const next = cleanGroup(to)
    const was = cleanGroup(from)
    if (!next || !was || sameGroup(was, next)) return
    this.pushUndo('Rename group')
    for (const t of this.tasks) if (t.group && sameGroup(t.group, was)) t.group = next
    this.bump()
  }

  removeGroup(name: string): void {
    const was = cleanGroup(name)
    if (!was) return
    const inIt = this.tasks.filter((t) => t.group && sameGroup(t.group, was)).length
    if (!inIt) return
    this.pushUndo('Remove group')
    for (const t of this.tasks) if (t.group && sameGroup(t.group, was)) t.group = null
    this.bump()
  }

  dismiss(id: string): void {
    const t = this.byId(id)
    if (t) this.halt(t)
    this.tasks = this.tasks.filter((x) => x.id !== id)
    delete this.spans[id]
    this.bump()
  }

  clearFinished(): void {
    for (const t of this.tasks) if (t.finishedAt) delete this.spans[t.id]
    this.tasks = this.tasks.filter((t) => !t.finishedAt)
    this.bump()
  }

  /* -------------------------------------------------------- Entire hook */

  async recordBehaviour(
    title: string,
    summary: string,
    behaviour: Record<string, unknown>
  ): Promise<{ ok: boolean; id: string | null; message: string }> {
    const result = await entire.checkpoint({ title, summary, behaviour })
    this.integrations.entire = await entire.detect(entire.repoRoot ?? process.cwd())
    this.bump()
    return result
  }

  /* ------------------------------------------------------------- snapshot */

  snapshot(): AppState {
    return {
      tasks: this.tasks,
      spans: this.spans,
      limits: this.limits,
      ledger: this.ledger,
      allPaused: this.allPaused,
      integrations: {
        ...this.integrations,
        model: llmStatus(),
        connectors: getConnectorList()
      },
      rev: this.rev
    }
  }

  setConnectorConfig(
    id: ConnectorId,
    config: { apiKey?: string; endpoint?: string }
  ): { ok: boolean; message: string } {
    const res = setConnectorConfig(id, config)
    this.integrations.connectors = getConnectorList()
    this.bump()
    return res
  }

  serialise(): string {
    const spans: Record<string, SpanRecord[]> = {}
    for (const [id, list] of Object.entries(this.spans)) {
      spans[id] = list.slice(-120)
    }
    return JSON.stringify({
      tasks: this.tasks,
      spans,
      limits: this.limits,
      ledger: this.ledger,
      allPaused: this.allPaused
    })
  }

  restore(raw: string): void {
    let data: {
      tasks?: Task[]
      spans?: Record<string, SpanRecord[]>
      limits?: Limits
      ledger?: Ledger
      allPaused?: boolean
    }
    try {
      data = JSON.parse(raw) as typeof data
    } catch {
      return
    }
    if (!Array.isArray(data.tasks)) return

    const LEGACY_DUMMY_TITLES = new Set([
      'Find a plumber for the kitchen sink',
      "Cancel the gym membership I don't use",
      'Get a refund for the cracked phone case',
      'Pay the electricity bill',
      'Renew the car insurance',
      'Plan Saturday dinner for six, one vegetarian',
      'fasdfs'
    ])

    const realTasks = data.tasks.filter((t) => {
      if (!t || typeof t !== 'object') return false
      if (t.id && String(t.id).startsWith('seed')) return false
      if (LEGACY_DUMMY_TITLES.has(t.title)) return false
      if (Array.isArray(t.story) && t.story.some((s) => String(s?.id).startsWith('seed')))
        return false
      return true
    })

    this.limits = { ...this.limits, ...(data.limits ?? {}) }
    this.ledger = { ...this.ledger, ...(data.ledger ?? {}) }
    this.allPaused = Boolean(data.allPaused)
    this.tasks = realTasks
    const validIds = new Set(this.tasks.map((t) => t.id))
    this.spans = Object.fromEntries(
      Object.entries(data.spans ?? {}).filter(([k]) => validIds.has(k))
    )

    if (this.tasks.length === 0) {
      this.ledger = { spent: 0, minutes: 0, done: 0 }
    }

    for (const t of this.tasks) {
      t.group = cleanGroup(t.group)

      // A task can be waiting on you, or it can only look like it is.
      //
      // "Needs you" without a question attached is not a task waiting for an
      // answer — there is nothing to click. Runs used to end up in exactly
      // that state, and on restart they stayed there forever, because the only
      // way out was the button that was not being shown. Rather than restore
      // the deadlock, these go back in the queue and actually run.
      if (t.state === 'needs' && !t.ask) {
        t.state = 'waiting'
        t.progress = 0
        t.beatIdx = 0
        t.planIdx = -1
        t.ask = null
        t.line = 'Picking this back up.'
        this.say(t, 'This one got stuck last time. Starting it again.', '')
      }

      // A finished task whose line is a raw provider error is a historical
      // record of something that went wrong, not a sentence anyone wrote. Left
      // as-is it puts four hundred characters of JSON into a list row, which
      // is most of what makes a saved list look broken. The meaning is
      // preserved; only the shape changes.
      //
      // The line is matched on the error inside it, not on its own shape —
      // the worst of these read `Agent stopped: 429: {"message":…`, which does
      // not begin with a brace.
      if (t.finishedAt && t.line && hasProviderError(t.line)) {
        const cleaned = explain(t.line)
        if (cleaned && cleaned !== t.line) {
          t.line = cleaned
          const last = t.story[t.story.length - 1]
          if (last?.text === t.line) last.text = cleaned
        }
      }

      if (isLive(t.state)) {
        t.state = this.allPaused ? 'paused' : t.state
        this.launch(t)
      }
    }
    this.bump()
  }
}

/* ==========================================================================
   The agent's draft schemas.
   ========================================================================== */

interface ReceiptDraft {
  verified: boolean
  verification: string
  headline: string
  lines: { label: string; value: string }[]
  proof: string[]
  undo: string
}

interface AskDraft {
  question: string
  consequence: string
  facts: { label: string; value: string }[]
  /** Two or three concrete options, when the user's decision is a pick. */
  options: { value: string; label: string; note: string }[]
}

interface Observed {
  tool: string
  ok: boolean
  summary: string
  detail: string
  /** The rendered call, so repeats can be spotted. */
  args: string
}

/* ==========================================================================
   Runner — one task, one run, one trace.
   ========================================================================== */

class Runner {
  readonly gate = new Gate()
  private askWaiter: Deferred | null = null
  private askValue: string | null = null
  private history: Observed[] = []
  private spent = 0
  private spendAsked = false
  /** The engine currently running, so a steer can reach it mid-flight. */
  private liveAgent: Agent | null = null
  private signal = new AbortController()
  private stopReason: string | null = null
  /** The model that actually ran, so the receipt can name it rather than assume. */
  private engineModel: string | null = null
  private customReceiptDraft: {
    lines: [string, string][]
    proof: string[]
    undo: string | null
  } | null = null

  constructor(
    private store: Store,
    private task: Task
  ) {}

  get context(): ToolContext {
    return { signal: this.signal.signal, aborted: this.signal.signal.aborted }
  }

  /**
   * Arms the answer waiter and publishes the question.
   *
   * The order matters and was the cause of a real hang. `bump()` notifies
   * listeners *synchronously*, and a listener that answers immediately — an
   * auto-approve in tests, or anything else reacting in the same tick — did so
   * before the waiter existed, and the answer was silently dropped. The waiter
   * is therefore armed first, then the question is published.
   *
   * Returns the promise the caller awaits.
   */
  private publishAsk(ask: Ask, line: string): Promise<string> {
    const answer = this.waitForAnswer()
    this.task.ask = ask
    this.task.state = 'needs'
    this.task.line = line
    this.store.say(this.task, line, 'needs')
    this.store.bump()
    return answer
  }

  /**
   * Answers are consumed once. Clearing `task.ask` here rather than after the
   * await means the card disappears the instant you click, and a double-click
   * — or a renderer that re-renders before the runner resumes — cannot answer
   * the same question twice.
   */
  resolveAsk(value: string): void {
    this.task.ask = null
    // An answer that beat the waiter is kept, not dropped.
    this.askValue = value
    this.askWaiter?.resolve()
    this.askWaiter = null
  }

  releaseAsk(): void {
    this.task.ask = null
    this.askValue = '__released'
    this.askWaiter?.resolve()
    this.askWaiter = null
  }

  steer(text: string): void {
    this.task.notes.push(text)
    this.liveAgent?.steer({
      role: 'user',
      content: [{ type: 'text', text }],
      timestamp: Date.now()
    })
  }

  /* ------------------------------------------------------------------- run */

  async run(): Promise<void> {
    const store = this.store
    const t = this.task

    if (!llmStatus().connected) {
      t.state = 'needs'
      t.line = 'I have no model key, so I cannot think. Set LLM_API_KEY and start me again.'
      store.say(t, t.line, 'needs')
      store.bump()
      return
    }

    await tracing.run({ name: t.title, taskId: t.id }, async (step) => {
      await this.gate.wait(300)
      if (this.gate.isStopped) return

      t.state = 'working'
      t.line = 'Starting on it.'
      store.say(t, t.line, '')
      store.bump()

      // 1. Pick the engine. This is bookkeeping: it happens here, instantly,
      //    rather than as a model call that could fail before any work began.
      const routeDecision = routeTask(t, step, rootPath())

      t.routedConnector = routeDecision.connector
      t.routingReason = routeDecision.reason
      t.plan = routeDecision.plan
      t.beatsTotal = routeDecision.plan.length
      t.planIdx = 0

      const connector = getConnector(routeDecision.connector)

      const routeSpan = await step(
        {
          kind: 'CHAIN',
          name: 'dispatch',
          input: clip(t.title, 80),
          output: `${connector.name} · ${routeDecision.reason}`
        },
        async () => routeDecision.connector
      )
      store.addSpans(t.id, [routeSpan])

      t.line = routeDecision.reason
      store.say(t, t.line, '', routeSpan)
      store.bump()

      await this.gate.hold()
      if (this.gate.isStopped) return

      // 2. Hand it to the engine, which carries the real tools.
      const connectorCtx: ConnectorContext = {
        task: t,
        step,
        store,
        isStopped: () => this.gate.isStopped,
        holdIfPaused: () => this.gate.hold(),
        checkSpend: () => this.checkSpend(),
        askPermission: (tool, args) => this.askPermission(step, tool, args),
        charge: (u) => this.charge(u, store),
        pushHistory: (entry) => this.history.push(entry),
        addSpans: (spans) => store.addSpans(t.id, spans),
        executeLocalTool: async (toolName, args) => {
          const tool = TOOLS_BY_NAME.get(toolName)
          if (!tool) throw new Error(`Tool ${toolName} not found`)
          const res = await this.execute(step, tool, args)
          return { ok: res.ok, output: res.output, data: res.data }
        },
        setTaskLine: (line) => {
          t.line = line
          store.bump()
        },
        setTaskProgress: (p) => {
          t.progress = p
          store.bump()
        },
        onHandover: (from, to, detail) => {
          void this.handover(step, store, from, to, detail)
        },
        setLiveAgent: (agent) => {
          this.liveAgent = agent
        }
      }

      let res: Awaited<ReturnType<typeof connector.execute>>
      try {
        res = await connector.execute(routeDecision.enrichedPrompt, connectorCtx)
      } catch (err: unknown) {
        if (this.gate.isStopped) return
        await this.handBack(store, messageOf(err))
        return
      }

      if (this.gate.isStopped) return

      if (!res.ok) {
        await this.handBack(store, res.summary)
        return
      }

      // The engine ran to the end of its turns. Whether that met the goal is a
      // separate question, answered by the verification pass below — the
      // engine's own say-so is not evidence.
      this.pendingFinish = true
      this.engineModel = res.model ?? null
      if (res.receiptDraft) this.customReceiptDraft = res.receiptDraft
      await this.finish(step)
    })

    store.bump()
  }

  /**
   * Honest failure path: say what is missing rather than pretending.
   *
   * The message is cleaned before it is shown. A provider quota error arrives
   * as a paragraph of raw JSON, and dropping that onto a task card as though a
   * person had written it is both ugly and unreadable.
   */
  private async handBack(store: Store, raw?: string): Promise<void> {
    const t = this.task
    const line = explain(raw) || 'It could not finish this one.'
    t.state = 'stopped'
    t.finishedAt = Date.now()
    t.line = line
    store.say(t, line, 'snag')
    store.bump()
  }

  /**
   * Whether the engine ran to the end of its turns.
   *
   * This used to be set inside a second, hand-rolled agent loop that the
   * connector work had orphaned but never deleted. Nothing ever reached that
   * loop, so this stayed false forever, and the verification pass below read
   * it as "the agent got stuck" and parked every single task on "needs you" —
   * with no question attached, and nothing that would ever clear it. The loop
   * is gone and this is now set where the work actually happens.
   */
  private pendingFinish = false
  /* ------------------------------------------------------------ guardrail */

  /**
   * Builds the question the user answers. The content of the question is
   * generated from the actual call about to be made, so it names the real
   * arguments rather than a generic warning.
   */
  private async askPermission(
    step: Step,
    tool: Tool,
    args: Record<string, unknown>
  ): Promise<{ approved: boolean; picked: string | null }> {
    const store = this.store
    const t = this.task
    const call = describeArgs(tool, args)

    let draft: AskDraft = {
      question: `I want to run ${tool.name}.`,
      consequence: call,
      facts: [],
      options: []
    }

    try {
      const result = await this.ask<AskDraft>(
        step,
        'explain_risk',
        {
          type: 'object',
          properties: {
            question: {
              type: 'string',
              description: 'The one question to put to the user, in plain words. Ask it directly.'
            },
            consequence: {
              type: 'string',
              description: 'One sentence on what happens in the world if this runs.'
            },
            facts: {
              type: 'array',
              description: 'Two or three short label/value pairs that let them judge it.',
              items: {
                type: 'object',
                properties: {
                  label: { type: 'string' },
                  value: { type: 'string' }
                },
                required: ['label', 'value'],
                additionalProperties: false
              }
            },
            options: {
              type: 'array',
              description:
                'Empty, unless the user has to choose between concrete alternatives. If they do, give two or three here and the question becomes a pick.',
              items: {
                type: 'object',
                properties: {
                  value: {
                    type: 'string',
                    description: 'Short machine value, e.g. "strict" or "loose".'
                  },
                  label: { type: 'string', description: 'What this option is, in a few words.' },
                  note: { type: 'string', description: 'The detail that tells them apart.' }
                },
                required: ['value', 'label', 'note'],
                additionalProperties: false
              }
            }
          },
          required: ['question', 'consequence', 'facts', 'options'],
          additionalProperties: false
        },
        [
          `Goal: ${t.title}`,
          '',
          `The agent is about to run this tool: ${tool.name}`,
          `Arguments: ${call}`,
          '',
          'This cannot be undone, so it always asks the user first. Write the question the',
          'user should be asked. Be specific about what will actually change. No warnings',
          'you would not say to a friend.',
          '',
          'Use options only if the user genuinely has to pick between alternatives. For a plain',
          'yes/no, leave options empty.'
        ].join('\n')
      )
      draft = result.value
      this.charge(result.usage, store)
    } catch {
      // If we cannot explain the risk, we still do not run it. The fallback
      // question names the tool and its arguments, which is honest.
    }

    const options = (draft.options ?? []).slice(0, 3).filter((o) => o && o.label)
    const question = draft.question || `I want to run ${tool.name}.`

    const ask: Ask =
      options.length >= 2
        ? {
            kind: 'choice',
            id: randomUUID().slice(0, 8),
            q: question,
            choices: options.map((o, i) => ({
              value: o.value || `option-${i}`,
              label: o.label,
              note: o.note || ''
            })),
            none: 'Neither — find another way'
          }
        : {
            kind: 'approve',
            id: randomUUID().slice(0, 8),
            q: question,
            category: 'action',
            facts: [
              ['What runs', `${tool.name}(${call})`],
              ...draft.facts.slice(0, 2).map((f) => [f.label, f.value] as [string, string])
            ],
            yes: 'Go ahead',
            no: 'Not yet'
          }

    const value = await this.publishAsk(ask, question)
    // The card is gone; the task is moving again. Leaving it on "needs you"
    // while a ten-minute command runs reads as though nothing is happening.
    if (t.state === 'needs') t.state = 'working'

    if (this.gate.isStopped || value === '__released') return { approved: false, picked: null }

    if (ask.kind === 'choice') {
      const pick = ask.choices.find((c) => c.value === value)
      if (pick) {
        store.say(t, `You picked ${pick.label}.`, 'you')
        store.bump()
        return { approved: true, picked: pick.value }
      }
      store.say(t, 'Neither. Looking for another way.', 'you')
      store.bump()
      return { approved: false, picked: null }
    }

    if (value === 'yes') {
      store.say(t, 'You said yes.', 'you')
      store.bump()
    }
    return { approved: value === 'yes', picked: null }
  }

  /**
   * The spend cap. Every model call reports its real token count and real
   * cost; once a run has spent more than the user allows, it stops and asks
   * once rather than quietly continuing.
   */
  private async checkSpend(): Promise<boolean> {
    const store = this.store
    const t = this.task
    const limit = store.limits.spend

    // At $0 the agent asks the first time it costs anything, then runs.
    const threshold = limit === 0 ? ESTIMATE_NEXT_CALL : limit
    if (this.spendAsked || this.spent < threshold) return true

    this.spendAsked = true
    const ask: Ask = {
      kind: 'approve',
      id: randomUUID().slice(0, 8),
      q: `This run has cost ${money(this.spent)} so far. Your limit is ${money(limit)}.`,
      category: 'spend',
      facts: [
        ['Spent on this run', money(this.spent)],
        ['Your limit', limit === 0 ? 'ask me every time' : money(limit)],
        ['Left in the budget', money(Math.max(0, limit - this.spent))]
      ],
      yes: 'Keep going',
      no: 'Stop here'
    }

    const line = `This has cost ${money(this.spent)} so far. Stopping to check with you.`
    const value = await this.publishAsk(ask, line)
    if (t.state === 'needs') t.state = 'working'
    if (this.gate.isStopped || value === '__released') return false
    if (value === 'no') {
      this.stopReason = `Stopped at ${money(this.spent)} — that is your limit.`
      return false
    }
    return true
  }

  /**
   * The run moved to another model mid-flight.
   *
   * This is the one moment in the app where the thing doing the thinking
   * changes underneath you, so it gets the same treatment as anything else
   * irreversible: a real span, a real sentence, and the run carries on. The
   * alternative — carrying on quietly — would mean a receipt naming weights
   * that did not finish the work.
   */
  private async handover(
    step: Step,
    store: Store,
    from: string,
    to: string,
    detail: string
  ): Promise<void> {
    const t = this.task
    const line = `${shortModel(from)} ran out of tokens for the day. Carrying on with ${shortModel(to)}.`
    const span = await step(
      {
        kind: 'CHAIN',
        name: 'model_handover',
        input: `${shortModel(from)} → ${shortModel(to)}`,
        output: line,
        status: 'recovered'
      },
      // The callback's return value replaces `output`, so it returns the
      // sentence rather than a status word — otherwise the span in the trace
      // sheet reads "carried on" and the reason lives nowhere.
      async () => line
    )
    store.addSpans(t.id, [span])
    this.engineModel = to
    t.line = line
    store.say(t, line, '', span)
    store.bump()
    if (process.env.DONE_DEBUG) {
      process.stderr.write(`──── handover → ${shortModel(to)} (${detail.slice(0, 120)})\n`)
    }
  }

  /* -------------------------------------------------------------- execute */

  private async execute(
    step: Step,
    tool: Tool,
    args: Record<string, unknown>
  ): Promise<{ ok: boolean; summary: string; span: SpanRecord; output: string; data?: unknown }> {
    const store = this.store
    const t = this.task
    const input = describeArgs(tool, args)
    // A holder, not a bare variable: the value is written inside the traced
    // callback and read after it, which the compiler cannot narrow.
    const captured: {
      result?: {
        ok: boolean
        output: string
        data: unknown
        guard?: { safe: boolean; score: number; reason: string }
      }
    } = {}

    const span = await step(
      {
        kind: tool.kind,
        name: tool.name,
        input,
        output: 'running'
      },
      async () => {
        const result = await tool.run(args, this.context)
        captured.result = result
        return result.output
      }
    )

    store.addSpans(t.id, [span])

    // The line under the sentence is the real call. The sentence above it is
    // the model's, on the next turn — there is no narration here, because the
    // agent has not yet decided what the result means.
    const line = plainLine(tool, span.output, span.status === 'error')

    // What the next decision gets to see is the actual payload, not a summary
    // of it. "5 results" tells the agent nothing; the five titles do.
    this.history.push({
      tool: tool.name,
      ok: span.status !== 'error',
      summary: clip(span.output, 160),
      detail: renderEvidence(captured.result?.data, captured.result?.guard),
      args: input
    })

    // The plan is what the agent did, not what it meant to do. A placeholder
    // written before the work started ("Work out what this needs / Do it /
    // Check it") says nothing once the run is over, and it sits in the detail
    // pane looking authoritative the whole time. Repeats of the same call
    // collapse into one line, so the list stays a list.
    if (t.plan.at(-1) !== line) {
      t.plan.push(line)
      t.beatsTotal = t.plan.length
    }
    t.planIdx = t.plan.length

    store.say(t, line, span.status === 'error' ? 'snag' : '', span)
    t.state = span.status === 'error' ? 'snag' : 'working'
    store.bump()

    return {
      ok: span.status !== 'error',
      summary: line,
      span,
      output: captured.result?.output ?? span.output,
      data: captured.result?.data
    }
  }

  /* --------------------------------------------------------------- finish */

  private async finish(step: Step): Promise<void> {
    const store = this.store
    const t = this.task

    await this.gate.hold()
    if (this.gate.isStopped) return

    if (!this.pendingFinish) {
      // The agent said it is blocked, or the run hit its ceiling, or you told
      // it to stop at the budget. That is a real outcome, not a failure to
      // hide — say what it needs and leave the card on screen.
      const span = await step(
        {
          kind: 'CHAIN',
          name: 'blocked',
          input: `goal="${clip(t.title, 60)}"`,
          output: 'needs the user'
        },
        async () => 'needs the user'
      )
      store.addSpans(t.id, [span])
      t.state = 'needs'
      t.line = this.stopReason ?? t.line ?? 'I need you before I can go on.'
      t.progress = Math.min(0.97, t.progress)
      store.say(t, t.line, 'needs', span)
      store.bump()
      this.pendingFinish = true
      return
    }

    t.state = 'working'
    t.line = 'Checking it actually worked before I call it done.'
    store.say(t, t.line, '')
    store.bump()

    let draft: ReceiptDraft
    try {
      const result = await this.ask<ReceiptDraft>(
        step,
        'verify',
        {
          type: 'object',
          properties: {
            verified: {
              type: 'boolean',
              description:
                'True only if the evidence above shows the goal was actually achieved. Be strict.'
            },
            verification: {
              type: 'string',
              description: 'One sentence on what you checked and what you found.'
            },
            headline: { type: 'string', description: 'The sentence the task finishes with.' },
            lines: {
              type: 'array',
              description: 'Two to four label/value pairs for the receipt.',
              items: {
                type: 'object',
                properties: { label: { type: 'string' }, value: { type: 'string' } },
                required: ['label', 'value'],
                additionalProperties: false
              }
            },
            proof: {
              type: 'array',
              description: 'Concrete artefacts that back this up: file paths, URLs, exact outputs.',
              items: { type: 'string' }
            },
            undo: {
              type: 'string',
              description: 'How to undo it, or an empty string if there is no way back.'
            }
          },
          required: ['verified', 'verification', 'headline', 'lines', 'proof', 'undo'],
          additionalProperties: false
        },
        [
          `Goal: ${t.title}`,
          '',
          this.history.length
            ? 'What actually happened:'
            : 'What actually happened: nothing. No tool was run in this task.',
          ...(this.history.length
            ? [
                this.history
                  .slice(-HISTORY_WINDOW)
                  .map(
                    (h) => `${h.tool}(${h.args}) → ${h.ok ? 'ok' : 'FAILED'}\n${indent(h.detail)}`
                  )
                  .join('\n\n')
              ]
            : []),
          '',
          `This run cost ${money(this.spent)}.`,
          '',
          'Check the evidence against the goal. If it is not met, say verified=false and',
          'explain honestly in the verification field what is missing. Do not soften a failure.',
          'Every proof entry must be a real artefact from the evidence above — not a description',
          'of one.',
          '',
          'A goal that only ever needed thinking, with no action to take, is met when the',
          'answer itself is the deliverable. A goal that asked for something to change on this',
          'machine or the web is not met unless a tool result above shows it changed.'
        ].join('\n')
      )
      draft = result.value
      this.charge(result.usage, store)
    } catch (err) {
      // The check itself failed — the provider is down, or the quota ran out
      // mid-verification. That is not the task failing, so it does not go
      // through the "blocked" branch or call itself again: it says what
      // happened and stops.
      const line = explain(messageOf(err)) || 'I could not check my own work.'
      const span = await step(
        {
          kind: 'GUARDRAIL',
          name: 'verify',
          input: `check="${clip(t.title, 50)}"`,
          output: 'the check could not run',
          status: 'error',
          error: line
        },
        async () => line
      )
      store.addSpans(t.id, [span])
      t.state = 'snag'
      t.finishedAt = Date.now()
      t.line = line
      store.say(t, line, 'snag', span)
      store.bump()
      return
    }

    const span = await step(
      {
        kind: 'GUARDRAIL',
        name: 'verify',
        input: `check="${clip(t.title, 50)}"`,
        output: draft.verified ? clip(draft.verification, 120) : 'not verified',
        status: draft.verified ? 'ok' : 'error',
        error: draft.verified ? undefined : clip(draft.verification, 200)
      },
      async () => draft.verification
    )
    store.addSpans(t.id, [span])

    if (!draft.verified) {
      // Not done. Report that honestly and stop, rather than claiming success.
      t.state = 'snag'
      t.finishedAt = Date.now()
      t.line = plainSentence(draft.verification) || 'I could not confirm this worked.'
      store.say(t, t.line, 'snag', span)
      store.bump()
      return
    }

    const finalLines: [string, string][] = this.customReceiptDraft
      ? [
          ...this.customReceiptDraft.lines,
          ...draft.lines.slice(0, 2).map((l) => [l.label, l.value] as [string, string])
        ].slice(0, 4)
      : draft.lines.slice(0, 4).map((l) => [l.label, l.value] as [string, string])

    // The receipt says which model did the work. It is the one claim in here
    // the user cannot check from the row above it, and it is the one that
    // matters when a task lands on an engine other than the one named.
    if (this.engineModel && !finalLines.some(([k]) => /ran on|model/i.test(k))) {
      finalLines.unshift(['Ran on', this.engineModel])
    }

    const receipt: Receipt = {
      lines: finalLines,
      proof: (this.customReceiptDraft?.proof ?? draft.proof).slice(0, 5),
      undo: this.customReceiptDraft?.undo ?? (draft.undo?.trim() ? draft.undo.trim() : null),
      tookMinutes: Math.max(1, Math.round((Date.now() - t.created) / 60000))
    }

    const doneSpan = await step(
      {
        kind: 'CHAIN',
        name: 'task_complete',
        input: `goal="${clip(t.title, 60)}"`,
        output: `verified · ${money(this.spent)}`,
        cost: this.spent
      },
      async () => 'verified'
    )
    store.addSpans(t.id, [doneSpan])

    t.state = 'done'
    t.progress = 1
    t.planIdx = t.plan.length
    t.line = plainSentence(draft.headline, 140) || 'Done.'
    t.receipt = receipt
    t.finishedAt = Date.now()
    t.settleUntil = Date.now() + 2400
    t.justDone = true
    store.ledger.minutes += receipt.tookMinutes
    store.ledger.done += 1
    store.say(t, t.line, 'done', doneSpan)
    store.bump()
  }

  /* ----------------------------------------------------------------- spans */

  /**
   * One model call, recorded as one span with its real tokens, real cost and
   * real latency. This is the only place the agent talks to the model, so
   * every word it ever says is inside a trace.
   */
  private async ask<T>(
    step: Step,
    name: string,
    schema: Parameters<typeof withRetry>[0]['schema'],
    prompt: string,
    maxTokens = 1800
  ): Promise<{ value: T; span: SpanRecord; usage: Usage }> {
    if (process.env.DONE_DEBUG) {
      process.stderr.write(`\n──── ${name} ────\n${prompt}\n`)
    }

    // Filling in arguments is not a reasoning problem. Saying so keeps the
    // token budget for the decisions that actually need thinking — and stops
    // the model drifting into writing prose instead of the object.
    const result = await withRetry<T>({
      schema: schema as never,
      system:
        name === 'call'
          ? 'You fill in tool arguments. You output the argument object and nothing else — no explanation, no prose, no code fences. You never wrap the object in words.'
          : 'You are the reasoning engine of Done., a desktop agent. You are precise, you never invent facts, and you only ever claim something happened if it is in the evidence you were given.',
      user: prompt,
      maxTokens: name === 'call' ? 1200 : maxTokens,
      temperature: name === 'call' ? 0.1 : 0.5,
      reasoningEffort: name === 'call' ? 'low' : 'medium'
    })

    const span = await step(
      {
        kind: 'LLM',
        name,
        input: clip(prompt.replace(/\n+/g, ' ').slice(-160), 120),
        output: clip(JSON.stringify(result.value), 140),
        tokens: [result.usage.input, result.usage.output],
        cost: result.usage.cost
      },
      async () => clip(JSON.stringify(result.value), 140)
    )

    this.store.addSpans(this.task.id, [span])
    if (process.env.DONE_DEBUG) {
      process.stderr.write(`──── ${name} → ${clip(JSON.stringify(result.value), 400)}\n`)
    }
    return { value: result.value, span, usage: result.usage }
  }

  /** Adds a call's real cost to the day's ledger and to this run's total. */
  private charge(usage: Usage, store: Store): void {
    if (!usage.cost) return
    this.spent += usage.cost
    store.ledger.spent += usage.cost
  }

  private waitForAnswer(): Promise<string> {
    this.askWaiter = deferred()
    return this.askWaiter.promise.then(() => this.askValue ?? '__released')
  }

  dispose(): void {
    this.liveAgent?.abort()
    this.liveAgent = null
    this.signal.abort()
  }
}

/* ==========================================================================
   Helpers
   ========================================================================== */

const messageOf = (err: unknown): string => (err instanceof Error ? err.message : String(err))

/** Where the agent works, so "the current project" means something concrete. */
function rootPath(): string {
  try {
    return app.getAppPath()
  } catch {
    return process.cwd()
  }
}

/* ==========================================================================
   Provider errors, said in a sentence.

   A rate limit does not arrive as "rate limit". It arrives as four hundred
   characters of JSON with a quota number buried in it. Dropping that onto a
   task card — as the previous version did, verbatim, under a row somebody is
   trying to read — makes the app look broken at exactly the moment it most
   needs to look calm.

   What this must never do is invent a cause. A message it cannot recognise is
   passed through on one line, not rewritten into something tidier-sounding
   and wrong.
   ========================================================================== */

function explain(raw?: string | null): string {
  const text = String(raw ?? '').trim()
  if (!text) return ''

  if (/rate[_ ]limit|too many requests|\b429\b/i.test(text)) {
    if (/tokens per day|\bTPD\b/i.test(text)) {
      const until = prettyDuration(/try again in ([\d.hms ]+)/i.exec(text)?.[1])
      return until
        ? `I hit the model's daily token limit. It resets in about ${until} — nothing was left half-finished.`
        : "I hit the model's daily token limit. Nothing was left half-finished; it will pick up once the limit resets."
    }
    if (/tokens per minute|\bTPM\b/i.test(text)) {
      return 'I sent the model more than it takes in one minute. Worth retrying in a moment.'
    }
    return 'The model is rate-limiting me right now. Nothing was changed.'
  }

  if (/context[_ ]length|too many tokens|maximum context|\b413\b/i.test(text)) {
    return 'This needed more context than the model takes in one go. Worth splitting into smaller pieces.'
  }

  const parsed = safeJson(text)
  const message = parsed?.message ?? (typeof parsed?.error === 'string' ? parsed.error : undefined)
  if (typeof message === 'string' && message.length < 240) return clip(message, 200)

  // Nothing recognised — say what came back, on one line.
  return clip(text, 200)
}

/**
 * Groq writes durations as "30m29.088s". Shown to a person that is a puzzle,
 * and this string ends up on a task card, so it is turned into words.
 */
function prettyDuration(raw?: string): string {
  const t = String(raw ?? '').trim()
  if (!t) return ''
  const h = /(\d+(?:\.\d+)?)h/.exec(t)?.[1]
  const m = /(\d+(?:\.\d+)?)m/.exec(t)?.[1]
  const s = /(\d+(?:\.\d+)?)s/.exec(t)?.[1]
  const parts: string[] = []
  if (h) parts.push(`${Math.round(Number(h))} hour${Math.round(Number(h)) === 1 ? '' : 's'}`)
  if (m) parts.push(`${Math.round(Number(m))} min`)
  if (!h && !m && s) parts.push(`${Math.max(1, Math.round(Number(s)))} sec`)
  return parts.join(' ')
}

/** True when a line is a provider's raw complaint rather than a sentence. */
function hasProviderError(text: string): boolean {
  const t = String(text ?? '')
  return (
    /rate[_ ]limit|too many requests|\b429\b|context[_ ]length exceeded|maximum context|\b413\b/i.test(
      t
    ) &&
    (t.includes('{') || t.length > 160)
  )
}

function safeJson(text: string): { message?: string; error?: unknown } | null {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start === -1 || end <= start) return null
  try {
    return JSON.parse(text.slice(start, end + 1)) as { message?: string }
  } catch {
    return null
  }
}

/** Collapses to one line — for labels, headlines, anything drawn in a row. */
const clip = (s: string, n: number): string => {
  const t = String(s ?? '')
    .replace(/\s+/g, ' ')
    .trim()
  return t.length > n ? `${t.slice(0, n - 1)}…` : t
}

/**
 * Strips the formatting a model writes for a terminal, not for a list row.
 *
 * The story is set in small type on a dark surface, and it read like this:
 *
 *   **How to change the Privacy Policy URL** 1. **Open Play Console** - Go to
 *
 * Bold markers, list numbering, bullet glyphs and inline code fences are the
 * model's habits, not content. Left in, they turn a calm sentence into
 * something that looks like a scraped document — which is most of what made
 * this list stop looking like it belonged to the app around it.
 *
 * It also drops a leading heading, because the title is already right above
 * the sentence, and a second one is only a second thing to read.
 */
const plainSentence = (s: string, n = 180): string => {
  const text = String(s ?? '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/(^|[\s(])\*([^*\n]+)\*/g, '$1$2')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/^\s*\d+[.)]\s+/gm, '')
    .replace(/\s*[-–—]\s*>\s*/g, ' — ')
    .replace(/[ \t]+/g, ' ')

  // Drop a leading heading line, whatever shape it arrived in.
  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
  if (lines.length > 1) lines.shift()
  return clip(lines.join(' '), n)
}

/**
 * Keeps the line structure — for tool evidence, where the shape is the point.
 * Tries to end on a whole line rather than mid-word.
 */
const fold = (s: string, n: number): string => {
  const t = String(s ?? '').trim()
  if (t.length <= n) return t
  const cut = t.slice(0, n)
  const lastBreak = cut.lastIndexOf('\n')
  return `${(lastBreak > n * 0.6 ? cut.slice(0, lastBreak) : cut).trimEnd()}…`
}

const indent = (s: string): string =>
  String(s ?? '')
    .split('\n')
    .map((line) => `  ${line}`)
    .join('\n')

/**
 * What the model gets to see next. Tool results can be large; this keeps the
 * part that carries meaning — the titles, the file names, the actual page
 * text — and stops the context running away.
 */
function renderEvidence(
  data: unknown,
  guard?: { score: number; reason: string; suspect?: boolean }
): string {
  const lines: string[] = []

  if (Array.isArray(data)) {
    for (const item of data.slice(0, 8)) lines.push(`• ${oneLine(item)}`)
  } else if (data && typeof data === 'object') {
    const row = data as Record<string, unknown>
    for (const [key, value] of Object.entries(row)) {
      if (value === null || value === undefined || value === '') continue
      if (key === 'text' || key === 'report' || key === 'stdout') {
        lines.push(`${key}: ${fold(String(value), 900)}`)
      } else if (typeof value === 'string') {
        lines.push(`${key}: ${clip(value, 220)}`)
      } else if (typeof value === 'number' || typeof value === 'boolean') {
        lines.push(`${key}: ${value}`)
      } else if (Array.isArray(value)) {
        lines.push(`${key}:`)
        for (const item of value.slice(0, 8)) lines.push(`  • ${oneLine(item)}`)
      } else {
        lines.push(`${key}: ${clip(JSON.stringify(value), 160)}`)
      }
    }
  } else if (data !== null && data !== undefined) {
    lines.push(String(data))
  }

  if (guard) {
    lines.push(
      guard.reason === 'clean' || guard.reason.startsWith('clean')
        ? `injection check: passed (${guard.score.toFixed(2)})`
        : guard.suspect
          ? `injection check: read with caution (${guard.score.toFixed(2)}) — ${guard.reason}`
          : `injection check: ${guard.reason}`
    )
  }

  return fold(lines.join('\n'), DETAIL_BUDGET)
}

/** One record on one line: what it is, what it says, then where to get it. */
function oneLine(item: unknown): string {
  if (item === null || item === undefined) return '(nothing)'
  if (typeof item !== 'object') return clip(String(item), 180)
  const row = item as Record<string, unknown>
  const text = (k: string): string => {
    const v = row[k]
    return typeof v === 'string' ? v.trim() : ''
  }

  // What it is, then what it says, then where to fetch it. The snippet is
  // usually where the answer actually is, so it outranks the link.
  const head = text('title') || text('label') || text('name') || text('file') || text('path')
  const body = text('snippet') || text('note') || text('value') || text('text')
  const loc = text('url') || text('href') || text('path')

  const bits = [head, body, loc].filter(Boolean)
  return clip(bits.join(' — ') || JSON.stringify(item), 220)
}

/**
 * The sentence under a tool span, stated as fact rather than as narration.
 * The model's own words come on the next turn, once it knows what the result
 * means — this is only what happened.
 */
function plainLine(tool: Tool, output: string, failed: boolean): string {
  // A blocked page is not a failure to recover from quietly — it is the guard
  // doing its job, and the sentence should say so in as many words.
  if (/^blocked:/.test(output)) {
    return output.replace(
      /^blocked: (.*) tried to inject instructions \(score ([\d.]+)\)$/,
      'Refused $1 — that page tried to give me new instructions, and I will not read it.'
    )
  }

  const prefix: Record<string, string> = {
    web_search: 'Searched the web',
    web_fetch: 'Read a page',
    browser_open: 'Opened a page',
    browser_read: 'Read the open page',
    browser_click: 'Clicked',
    browser_type: 'Typed into a field',
    browser_submit: 'Submitted',
    browser_screenshot: 'Took a screenshot',
    browser_close: 'Closed the browser',
    file_read: 'Read a file',
    file_write: 'Wrote a file',
    file_list: 'Listed a folder',
    file_search: 'Searched the files',
    shell_run: 'Ran a command',
    system_info: 'Checked the machine',
    clipboard_read: 'Read the clipboard',
    clipboard_write: 'Wrote to the clipboard',
    open_url: 'Opened something',
    code_agent: 'Handed it to a coding agent'
  }
  const head = prefix[tool.name] ?? tool.name.replace(/_/g, ' ')
  return failed ? `${head} — that failed. ${output}` : `${head}: ${output}`
}

/**
 * Renders a span the way an engineer would read it:
 *   tool.search_places(q="plumber", radius=5km) → 14 results · 0.9s
 *   llm.decide(tool="web_search") → 6 kept · 388 tokens · $0.0004
 */
export function describeSpan(span: SpanRecord): string {
  const head = span.input
    ? `${span.kind.toLowerCase()}.${span.name}(${span.input})`
    : `${span.kind.toLowerCase()}.${span.name}()`
  const seconds = `${(span.durationMs / 1000).toFixed(2).replace(/0$/, '')}s`
  const parts: string[] = [span.output]
  if (span.tokens) parts.push(`${span.tokens.input + span.tokens.output} tokens`)
  if (span.cost != null) parts.push(money(span.cost))
  parts.push(seconds)
  const tail =
    span.status === 'error' ? ' · failed' : span.status === 'recovered' ? ' · recovered' : ''
  return `${head} → ${parts.filter(Boolean).join(' · ')}${tail}`
}

/** Close the hidden browser when the app goes away. */
export function shutdown(): void {
  shutdownBrowser()
}

export { zeroUsage }
