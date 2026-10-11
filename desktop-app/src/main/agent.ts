import { randomUUID } from 'node:crypto'
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
import { llmStatus, withRetry, zeroUsage, type Usage } from './llm'
import {
  catalogueText,
  describeArgs,
  TOOLS,
  TOOLS_BY_NAME,
  type Tool,
  type ToolContext
} from './tools'
import { shutdownBrowser } from './tools/browser'
import { Agent } from '@earendil-works/pi-agent-core'
import { createPiModels, getPiModel, adaptToolToPi } from './pi'
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

/** Longest the agent will chase a single goal before handing back control. */
const MAX_TURNS = 10

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
      if (Array.isArray(t.story) && t.story.some((s) => String(s?.id).startsWith('seed'))) return false
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
  private piAgent: Agent | null = null
  private history: Observed[] = []
  private spent = 0
  private spendAsked = false
  private signal = new AbortController()
  private stopReason: string | null = null
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
    if (this.piAgent) {
      this.piAgent.steer({
        role: 'user',
        content: [{ type: 'text', text }],
        timestamp: Date.now()
      })
    }
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
      t.line = 'Assessing task context & selecting optimal connector...'
      store.say(t, t.line, '')
      store.bump()

      // 1. ROUTING PHASE (Our LLM acts as the intelligent router & dispatcher)
      const rootPath = (store as unknown as { context?: { root?: string } }).context?.root || process.cwd()
      const routeDecision = await routeTask(t, step, rootPath)

      t.routedConnector = routeDecision.connector
      t.routingReason = routeDecision.reason
      t.plan = routeDecision.plan
      t.beatsTotal = routeDecision.plan.length
      t.planIdx = 0

      const connector = getConnector(routeDecision.connector)

      // Record dispatch span to neatlogs
      const routeSpan = await step(
        {
          kind: 'LLM',
          name: 'router.dispatch',
          input: clip(t.title, 80),
          output: `Routed to ${connector.name}: ${routeDecision.reason}`
        },
        async () => 'ok'
      )
      store.addSpans(t.id, [routeSpan])

      t.line = `${connector.badge}: ${routeDecision.reason}`
      store.say(t, t.line, '', routeSpan)
      store.bump()

      await this.gate.hold()
      if (this.gate.isStopped) return

      // 2. CONNECTOR EXECUTION (Delegated to specialized agent connector)
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
        }
      }

      let res
      try {
        res = await connector.execute(routeDecision.enrichedPrompt, connectorCtx)
      } catch (err: unknown) {
        if (this.gate.isStopped) return
        this.stopReason = `Connector stopped: ${messageOf(err)}`
        await this.handBack(store)
        return
      }

      if (this.gate.isStopped) return

      if (res.ok) {
        if (res.receiptDraft) {
          this.customReceiptDraft = res.receiptDraft
        }
        await this.finish(step)
      } else {
        this.stopReason = res.summary || 'Task could not be completed.'
        await this.handBack(store)
      }
    })

    store.bump()
  }

  /** Honest failure path: say what is missing rather than pretending. */
  private async handBack(store: Store): Promise<void> {
    const t = this.task
    t.state = 'stopped'
    t.finishedAt = Date.now()
    t.line = this.stopReason ?? 'I could not finish this one.'
    store.say(t, t.line, 'snag')
    store.bump()
  }

  /* ----------------------------------------------------------------- plan */

  protected async _plan(step: Step): Promise<string[] | null> {
    const store = this.store
    const t = this.task

    t.state = 'working'
    t.line = 'Working out what this actually needs.'
    store.say(t, t.line, '')
    store.bump()

    let result
    try {
      result = await this.ask<{ summary: string; steps: string[] }>(
        step,
        'plan',
        {
          type: 'object',
          properties: {
            summary: {
              type: 'string',
              description: 'One plain sentence: what you are about to do.'
            },
            steps: {
              type: 'array',
              description: 'Three to six concrete steps, each starting with a verb.',
              items: { type: 'string' }
            }
          },
          required: ['summary', 'steps'],
          additionalProperties: false
        },
        [
          `You are the agent inside Done., a desktop to-do app. You will be given a goal and you will finish it yourself using tools.`,
          '',
          `Your goal: ${t.title}`,
          t.when ? `It is needed by: ${t.when}` : '',
          t.budget ? `Budget: ${t.budget}` : '',
          // Everything the user has added along the way, including from a run
          // that was revived after getting stuck.
          t.notes.length
            ? `What the user has told you so far:\n${t.notes.map((n) => `- ${n}`).join('\n')}`
            : '',
          '',
          'The tools you can use:',
          catalogueText(TOOLS),
          '',
          'Write the shortest honest plan. Use tools for everything — you cannot do anything',
          'yourself. If the goal needs a decision only the user can make, say so in the summary',
          'and plan to bring them options rather than guessing.'
        ]
          .filter(Boolean)
          .join('\n')
      )
    } catch (err) {
      this.stopReason = `I could not plan this: ${messageOf(err)}`
      return null
    }

    const steps = (result.value.steps ?? [])
      .slice(0, 6)
      .map((s) => String(s).trim())
      .filter(Boolean)
    if (!steps.length) return ['Get started']

    t.plan = steps
    t.planIdx = 0
    t.beatsTotal = steps.length
    t.line = result.value.summary || steps[0]
    store.say(t, t.line, '', result.span)
    this.charge(result.usage, store)
    store.bump()

    return steps
  }

  private pendingFinish = false

  /* ----------------------------------------------------------------- loop */

  protected async _loop(step: Step): Promise<'finished' | 'stopped'> {
    const store = this.store
    const t = this.task

    const models = createPiModels()
    const model = getPiModel()

    const piTools = TOOLS.map((tool) =>
      adaptToolToPi(tool, () => this.context, {
        executeOverride: async (tl, args) => {
          await this.gate.hold()
          if (this.gate.isStopped) throw new Error('Task stopped by user')
          const outcome = await this.execute(step, tl, args)
          return { ok: outcome.ok, output: outcome.output, data: outcome.data }
        }
      })
    )

    let turnCount = 0

    this.piAgent = new Agent({
      streamFn: (m, ctx, opts) =>
        models.streamSimple(m, ctx, {
          ...opts,
          maxRetries: 5,
          maxRetryDelayMs: 60000
        }),
      maxRetryDelayMs: 60000,
      initialState: {
        model,
        systemPrompt: [
          `You are Pi Agent inside Done., an autonomous desktop AI assistant inspired by Grok Bot, Muse Spark, and GPT Dots.`,
          `You have 19 real local tools (web search, headless browser, filesystem, shell execution, clipboard, system info, code delegation).`,
          `RULE: Whenever a task requires taking action, searching, reading, writing files, or checking the system, YOU MUST CALL YOUR TOOLS directly.`,
          `Do NOT merely reply with text describing what you would do. Execute the necessary tool calls (e.g. web_search, file_write, shell_run, system_info) to perform the real work.`,
          `Be concise, direct, and completely honest. Never fabricate results.`
        ].join('\n'),
        tools: piTools
      },
      finishTurn: () => {
        turnCount++
        if (turnCount >= MAX_TURNS) {
          this.stopReason = `Reached maximum turns limit (${MAX_TURNS}).`
          return { action: 'end' }
        }
        return undefined
      },
      beforeToolCall: async ({ toolCall, args }) => {
        await this.gate.hold()
        if (this.gate.isStopped) {
          return { block: true, terminate: true, reason: 'Task stopped by user' }
        }

        const tool = TOOLS_BY_NAME.get(toolCall.name)
        if (tool && tool.irreversible) {
          const verdict = await this.askPermission(step, tool, (args ?? {}) as Record<string, unknown>)
          if (this.gate.isStopped || !verdict.approved) {
            return { block: true, reason: 'User declined permission for this action.' }
          }
        }

        if (!(await this.checkSpend())) {
          if (this.gate.isStopped) {
            return { block: true, terminate: true, reason: 'Task stopped by user' }
          }
          return { block: true, terminate: true, reason: 'Spend budget reached; stopped per user limit.' }
        }

        return undefined
      }
    })

    let accumulatedThinking = ''
    let accumulatedText = ''

    this.piAgent.subscribe(async (event) => {
      if (event.type === 'message_update') {
        const assistantEvt = event.assistantMessageEvent
        if (assistantEvt.type === 'thinking_delta') {
          accumulatedThinking += assistantEvt.delta
          const latestThought = accumulatedThinking.trim().split('\n').filter(Boolean).pop() ?? ''
          if (latestThought) {
            t.line = `Thinking: ${clip(latestThought, 110)}`
            store.bump()
          }
        } else if (assistantEvt.type === 'text_delta') {
          accumulatedText += assistantEvt.delta
          const latestLine = accumulatedText.trim().split('\n').filter(Boolean).pop() ?? ''
          if (latestLine) {
            t.line = clip(latestLine, 120)
            store.bump()
          }
        }
      } else if (event.type === 'tool_execution_start') {
        t.state = 'working'
        t.line = `Running ${event.toolName}...`
        store.bump()
      } else if (event.type === 'tool_execution_end') {
        accumulatedThinking = ''
        accumulatedText = ''
        t.progress = Math.min(0.95, t.progress + 0.1)
        store.bump()
      } else if (event.type === 'turn_end') {
        const msg = event.message as {
          content?: Array<{ type?: string; text?: string }>
          usage?: { input?: number; output?: number; reasoning?: number; cost?: number | { total?: number } }
        }
        if (msg?.content && Array.isArray(msg.content)) {
          const textItem = msg.content.find((c) => c.type === 'text')
          const hasToolCalls = msg.content.some((c) => c.type === 'toolCall')
          if (textItem?.text && !hasToolCalls) {
            store.say(t, clip(textItem.text, 160), '')
          }
        }
        if (msg?.usage) {
          const costVal = typeof msg.usage.cost === 'number' ? msg.usage.cost : (msg.usage.cost?.total ?? 0)
          const u: Usage = {
            input: msg.usage.input ?? 0,
            output: msg.usage.output ?? 0,
            reasoning: msg.usage.reasoning ?? 0,
            cost: costVal
          }
          this.charge(u, store)
          const llmSpan = await step(
            {
              kind: 'LLM',
              name: 'pi_turn',
              input: clip(t.title, 60),
              output: `Tokens: ${u.input} in, ${u.output} out`,
              cost: u.cost,
              tokens: [u.input, u.output]
            },
            async () => 'ok'
          )
          store.addSpans(t.id, [llmSpan])
          store.bump()
        }
      }
    })

    const promptText = [
      `Task Goal: ${t.title}`,
      t.when ? `Deadline: ${t.when}` : '',
      t.budget ? `Budget: ${t.budget}` : '',
      t.notes.length ? `User Notes:\n${t.notes.map((n) => `- ${n}`).join('\n')}` : '',
      '',
      `Execute the necessary tools now to accomplish this goal.`
    ]
      .filter(Boolean)
      .join('\n')

    try {
      await this.piAgent.prompt(promptText)
    } catch (err) {
      if (this.gate.isStopped) return 'stopped'
      this.stopReason = `Agent stopped: ${messageOf(err)}`
      return 'stopped'
    }

    if (this.gate.isStopped) return 'stopped'

    if (this.piAgent.state.errorMessage) {
      this.stopReason = `Agent stopped: ${this.piAgent.state.errorMessage}`
      return 'stopped'
    }

    // Capture the final assistant message into history if no tools were called
    const lastAssistant = this.piAgent.state.messages
      .filter((m) => m.role === 'assistant')
      .pop() as { content?: Array<{ type?: string; text?: string }> } | undefined
    if (lastAssistant?.content) {
      const textBlock = lastAssistant.content.find((c) => c.type === 'text')
      if (textBlock?.text && !this.history.length) {
        this.history.push({
          tool: 'pi_agent',
          ok: true,
          summary: clip(textBlock.text, 160),
          detail: textBlock.text,
          args: ''
        })
      }
    }

    this.pendingFinish = true
    return 'finished'
  }

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
      result?: { ok: boolean; output: string; data: unknown; guard?: { safe: boolean; score: number; reason: string } }
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
          `Plan:`,
          t.plan.map((s, i) => `  ${i + 1}. ${s}`).join('\n'),
          '',
          'What actually happened:',
          this.history
            .slice(-HISTORY_WINDOW)
            .map((h) => `${h.tool}(${h.args}) → ${h.ok ? 'ok' : 'FAILED'}\n${indent(h.detail)}`)
            .join('\n\n'),
          '',
          `This run cost ${money(this.spent)}.`,
          '',
          'Check the evidence against the goal. If it is not met, say verified=false and',
          'explain honestly in the verification field what is missing. Do not soften a failure.',
          'Every proof entry must be a real artefact from the evidence above — not a description',
          'of one.'
        ].join('\n')
      )
      draft = result.value
      this.charge(result.usage, store)
    } catch (err) {
      this.stopReason = `I could not check my own work: ${messageOf(err)}`
      this.pendingFinish = false
      await this.finish(step)
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
      t.line = clip(draft.verification, 180) || 'I could not confirm this worked.'
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
    t.line = draft.headline || 'Done.'
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
    this.piAgent?.abort()
    this.signal.abort()
  }
}

/* ==========================================================================
   Helpers
   ========================================================================== */

const messageOf = (err: unknown): string => (err instanceof Error ? err.message : String(err))


/** Collapses to one line — for labels, headlines, anything drawn in a row. */
const clip = (s: string, n: number): string => {
  const t = String(s ?? '')
    .replace(/\s+/g, ' ')
    .trim()
  return t.length > n ? `${t.slice(0, n - 1)}…` : t
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
function renderEvidence(data: unknown, guard?: { score: number; reason: string }): string {
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
