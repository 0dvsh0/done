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
import { genericScript, SCRIPTS, type Beat, type Script } from './scripts'

/* ==========================================================================
   Tuning. Everything here is pacing, not logic.
   ========================================================================== */

const CADENCE = Number(process.env.DONE_CADENCE ?? 1)
const BETWEEN_BEATS = 1900 * CADENCE
const BETWEEN_BEATS_JITTER = 1100 * CADENCE
const AFTER_SNAG = 2900 * CADENCE
const BEFORE_DONE = 1400 * CADENCE
const FIRST_BEAT = 1600 * CADENCE
const SETTLE = 2600
const MAX_SPANS = 600

/** How long each kind of work plausibly takes. */
const WORK: Record<string, [number, number]> = {
  LLM: [420, 900],
  TOOL: [260, 1150],
  RETRIEVER: [150, 380],
  GUARDRAIL: [90, 220],
  CHAIN: [180, 320],
  AGENT: [400, 800],
  WORKFLOW: [100, 200]
}

const jitter = ([lo, hi]: [number, number]): number =>
  Math.round((lo + Math.random() * (hi - lo)) * CADENCE)

const clone = <T>(o: T): T => JSON.parse(JSON.stringify(o)) as T

const fill = (str: string, vars: Record<string, string>): string =>
  String(str ?? '').replace(/\{(\w+)\}/g, (_, k: string) => vars[k] ?? '')

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
    }
  }

  private scripts = new Map<string, Script>()
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

  scriptOf(t: Task): Script {
    return this.scripts.get(t.id) ?? genericScript(t.title)
  }

  /* ---------------------------------------------------------------- create */

  /** Build a task without starting it. Seeding and restore both need this. */
  makeTask(title: string, opts: CreateOptions = {}): Task {
    const script = genericScript(title)
    const t: Task = {
      id: randomUUID().slice(0, 8),
      title,
      state: 'waiting',
      progress: 0,
      line: 'Written down. Starting in a moment.',
      plan: script.plan,
      planIdx: -1,
      beatIdx: 0,
      beatsTotal: script.beats.length,
      story: [],
      ask: null,
      receipt: null,
      notes: [],
      when: opts.when ?? null,
      budget: opts.budget ?? null,
      created: Date.now(),
      finishedAt: null,
      nextAt: Date.now(),
      settleUntil: 0,
      traceId: null,
      checkpointId: null,
      vars: {}
    }
    this.scripts.set(t.id, script)
    return t
  }

  createTask(title: string, opts: CreateOptions = {}): Task {
    const t = this.makeTask(title, opts)
    this.tasks.unshift(t)
    this.say(t, 'You wrote this down.', 'you')
    this.bump()
    this.launch(t)
    return t
  }

  /** Give a task one of the named scripts instead of the generated one. */
  adopt(t: Task, key: keyof typeof SCRIPTS): void {
    const s = SCRIPTS[key]
    t.plan = s.plan
    t.beatsTotal = s.beats.length
    this.scripts.set(t.id, s)
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
    this.spans[taskId] = list.slice(-MAX_SPANS)
  }

  /* ------------------------------------------------------------------ run */

  launch(t: Task): void {
    if (this.runners.has(t.id)) return
    const runner = new Runner(this, t)
    this.runners.set(t.id, runner)
    t.state = t.state === 'waiting' ? 'waiting' : t.state
    if (t.state === 'done' || t.state === 'stopped') {
      this.runners.delete(t.id)
      return
    }
    void runner.run().finally(() => {
      if (this.runners.get(t.id) === runner) this.runners.delete(t.id)
    })
  }

  halt(t: Task): void {
    this.runners.get(t.id)?.gate.stop()
    this.runners.delete(t.id)
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
          t.line = 'Everything I found is in the story below. It’s yours.'
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

  steer(id: string, text: string): void {
    const t = this.byId(id)
    const runner = this.runners.get(id)
    const clean = text.trim()
    if (!t || !runner || !clean) return
    this.pushUndo('Steer')
    this.say(t, `You said: “${clean}”`, 'you')
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
   * Limits really change behaviour: set a budget and the agent goes ahead on
   * its own. Changing them is a change to the agent's mind, so it gets
   * committed and checkpointed by Entire rather than quietly saved.
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

  /**
   * Undo rewrites the live task objects in place rather than swapping the
   * array, so a running agent keeps pointing at the same task it was working
   * on and simply rewinds to where you were.
   */
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
        t.line = 'Undone. Resume whenever you’re ready.'
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

  /* --------------------------------------------------------- housekeeping */

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
      integrations: this.integrations,
      rev: this.rev
    }
  }

  serialise(): string {
    // Spans are kept so "show what's underneath" and the trace tree still
    // work after a restart — but the file shouldn't grow without bound.
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

    this.limits = { ...this.limits, ...(data.limits ?? {}) }
    this.ledger = { ...this.ledger, ...(data.ledger ?? {}) }
    this.allPaused = Boolean(data.allPaused)
    this.tasks = data.tasks
    this.spans = data.spans ?? {}

    for (const t of this.tasks) {
      const key = namedScriptFor(t.title)
      if (key) this.adopt(t, key)
      else this.scripts.set(t.id, genericScript(t.title))
      if (isLive(t.state)) {
        t.state = this.allPaused ? 'paused' : t.state
        this.launch(t)
      }
    }
    this.bump()
  }
}

function namedScriptFor(title: string): keyof typeof SCRIPTS | null {
  const hit = Object.entries(SCRIPTS).find(([, s]) => s.title === title)
  return (hit?.[0] as keyof typeof SCRIPTS) ?? null
}

/* ==========================================================================
   Runner — one task, one run, one trace.
   ========================================================================== */

class Runner {
  readonly gate = new Gate()
  private askWaiter: Deferred | null = null
  private askValue: string | null = null
  private pendingSteer: string | null = null

  constructor(
    private store: Store,
    private task: Task
  ) {}

  resolveAsk(value: string): void {
    this.askValue = value
    this.askWaiter?.resolve()
    this.askWaiter = null
  }

  releaseAsk(): void {
    this.askValue = '__released'
    this.askWaiter?.resolve()
    this.askWaiter = null
  }

  steer(text: string): void {
    this.pendingSteer = text
    this.task.notes.push(text)
  }

  async run(): Promise<void> {
    const store = this.store
    const t = this.task
    const script = store.scriptOf(t)

    if (t.state === 'waiting') {
      await this.gate.wait(FIRST_BEAT)
      if (this.gate.isStopped) return
    }

    await tracing.run({ name: t.title, taskId: t.id }, async (step) => {
      while (t.beatIdx < script.beats.length) {
        await this.gate.hold()
        if (this.gate.isStopped) return

        const beat = script.beats[t.beatIdx]
        t.beatIdx += 1
        if (beat.plan != null) t.planIdx = beat.plan
        if (beat.p != null) t.progress = beat.p

        if (this.pendingSteer) {
          const text = this.pendingSteer
          this.pendingSteer = null
          await this.applySteer(step, text)
        }

        const outcome = await this.runBeat(step, beat)
        if (outcome !== 'continue') return

        await this.gate.wait(
          beat.tone === 'snag' ? AFTER_SNAG : BETWEEN_BEATS + Math.random() * BETWEEN_BEATS_JITTER
        )
      }
    })

    store.bump()
  }

  private async applySteer(step: Step, text: string): Promise<void> {
    const store = this.store
    const t = this.task
    const span = await step(
      { kind: 'LLM', name: 'replan', input: `constraint="${text}"`, output: 'plan updated' },
      async () => {
        await this.gate.wait(900 * CADENCE)
        return undefined
      }
    )
    store.addSpans(t.id, [span])
    t.line = `Adjusting for “${text}”.`
    store.say(t, `Got it. I’ll keep “${text}” in mind from here on.`, '', span)
    store.bump()
  }

  private async runBeat(step: Step, beat: Beat): Promise<'done' | 'stop' | 'held' | 'continue'> {
    const store = this.store
    const t = this.task
    const vars = t.vars ?? (t.vars = {})
    const line = fill(beat.line, vars)

    // 1. Say it before doing it — that's how you'd narrate real work.
    t.line = line
    t.state = beat.tone === 'snag' ? 'snag' : 'working'
    store.say(t, line, beat.tone === 'snag' ? 'snag' : '')
    store.bump()

    // 2. Do it, inside a real span.
    const span = await step(
      {
        kind: beat.kind,
        name: beat.name,
        input: fill(beat.input, vars),
        output: fill(beat.output, vars),
        tokens: beat.tokens,
        cost: beat.cost,
        status: beat.status,
        error: beat.status === 'error' ? beat.output : undefined
      },
      async () => {
        await this.gate.wait(jitter(WORK[beat.kind] ?? WORK.TOOL))
        return undefined
      }
    )
    store.addSpans(t.id, [span])
    if (this.gate.isStopped) return 'stop'
    await this.gate.hold()
    if (this.gate.isStopped) return 'stop'

    if (beat.vars) Object.assign(vars, beat.vars)

    // 3. Anything irreversible, expensive or spoken in your name comes back.
    if (beat.ask) {
      if (this.policyAllows(beat.ask)) {
        if (beat.ask.cost) store.ledger.spent += beat.ask.cost
        store.say(
          t,
          beat.ask.category === 'spend'
            ? `That’s under your ${money(store.limits.spend)} limit, so I went ahead.`
            : 'You let me send messages on my own, so I sent it.',
          'you'
        )
        store.bump()
        return 'continue'
      }

      const ask = materialise(beat.ask, vars)
      t.ask = ask
      t.state = 'needs'
      store.bump()

      const value = await this.waitForAnswer()
      if (this.gate.isStopped || value === '__released') return 'stop'

      t.ask = null
      if (value === 'no' || value === '__none') {
        store.say(
          t,
          value === '__none'
            ? 'Neither. Looking for more options.'
            : 'You said not yet. I’ll hold.',
          'you'
        )
        t.prevState = 'working'
        t.state = 'paused'
        t.line = 'Holding off. Resume whenever you’re ready.'
        this.gate.setPaused(true)
        store.bump()
        return 'held'
      }

      if (ask.kind === 'choice') {
        const pick = ask.choices.find((c) => c.value === value)
        if (pick) {
          vars.choice = pick.label
          vars.choiceKey = pick.value
          vars.cost = money(pick.cost ?? 0)
          if (pick.cost) store.ledger.spent += pick.cost
        }
        store.say(t, `You picked ${vars.choice ?? 'one of them'}.`, 'you')
      } else {
        if (ask.cost) store.ledger.spent += ask.cost
        store.say(t, 'You said yes.', 'you')
      }
      t.state = 'working'
      t.line = 'Thanks. Going ahead.'
      store.bump()
      return 'continue'
    }

    // 4. Nothing is ever "done" until it has been checked.
    if (beat.done) {
      const receipt: Receipt = {
        lines: (beat.receipt?.lines ?? []).map(([k, v]) => [k, fill(v, vars)] as [string, string]),
        proof: beat.receipt?.proof ?? [],
        undo: beat.receipt?.undo ?? null,
        tookMinutes: Math.max(1, Math.round((Date.now() - t.created) / 60000))
      }
      t.state = 'done'
      t.progress = 1
      t.planIdx = t.plan.length
      t.line = fill(beat.line, vars)
      t.receipt = receipt
      t.finishedAt = Date.now()
      t.settleUntil = Date.now() + SETTLE
      t.justDone = true
      store.ledger.minutes += beat.minutes ?? 15
      store.ledger.done += 1
      store.say(t, t.line, 'done', span)
      store.bump()
      await this.gate.wait(BEFORE_DONE)
      return 'done'
    }

    return 'continue'
  }

  private waitForAnswer(): Promise<string> {
    this.askWaiter = deferred()
    return this.askWaiter.promise.then(() => this.askValue ?? '__released')
  }

  /**
   * Limits really change behaviour: give it a budget and it stops asking about
   * small spends. Irreversible things always ask, and that rule is fixed.
   */
  private policyAllows(spec: NonNullable<Beat['ask']>): boolean {
    if (spec.kind !== 'approve') return false
    if (spec.category === 'spend') return (spec.cost ?? 0) <= this.store.limits.spend
    if (spec.category === 'message') return !this.store.limits.messages
    return false
  }
}

/* ==========================================================================
   Helpers
   ========================================================================== */

function materialise(spec: NonNullable<Beat['ask']>, vars: Record<string, string>): Ask {
  if (spec.kind === 'choice') {
    return {
      kind: 'choice',
      id: randomUUID().slice(0, 8),
      q: fill(spec.q, vars),
      choices: spec.choices ?? [],
      none: spec.none ?? 'Neither'
    }
  }
  return {
    kind: 'approve',
    id: randomUUID().slice(0, 8),
    q: fill(spec.q, vars),
    category: spec.category ?? 'action',
    cost: spec.cost,
    draft: spec.draft,
    facts: (spec.facts ?? []).map(([k, v]) => [k, fill(v, vars)] as [string, string]),
    yes: spec.yes ?? 'Yes',
    no: spec.no ?? 'Not yet'
  }
}

/**
 * Renders a span the way an engineer would read it:
 *   tool.search_places(q="plumber", radius=5km) → 14 results · 0.9s
 *   llm.rank(min_rating=4.6) → 6 kept · 388 tokens · $0.0004
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

/* ==========================================================================
   Seed — a believable morning, already in motion.
   ========================================================================== */

type SeedLine = [
  minutesFromStart: number,
  text: string,
  code: string,
  tone: Task['story'][number]['tone']
]

function finished(
  store: Store,
  title: string,
  plan: string[],
  lines: SeedLine[],
  receipt: Receipt,
  minutes: number,
  createdMinsAgo: number,
  finishedMinsAgo: number
): Task {
  const t = store.makeTask(title)
  const started = Date.now() - createdMinsAgo * 60_000
  const ended = Date.now() - finishedMinsAgo * 60_000
  t.plan = plan
  t.state = 'done'
  t.progress = 1
  t.planIdx = t.plan.length
  t.beatIdx = t.beatsTotal
  t.created = started
  t.finishedAt = ended
  t.line = lines[lines.length - 1][1]
  t.receipt = { ...receipt, tookMinutes: Math.max(1, createdMinsAgo - finishedMinsAgo) }
  t.story = lines.map(([offset, text, code, tone], i) => ({
    id: `seed${i}-${t.id}`,
    at: started + offset * 60_000,
    text,
    tone,
    spanId: null,
    code
  }))
  store.tasks.unshift(t)
  store.ledger.minutes += minutes
  store.ledger.done += 1
  return t
}

/**
 * The window opens on a morning that is already moving: two things landed
 * before you sat down, three are working, and one has a question for you.
 * Within about half a minute of watching, the first interruption arrives.
 */
export function seed(store: Store): void {
  for (const t of store.tasks) store.halt(t)
  store.tasks = []
  store.spans = {}
  store.ledger = { spent: 0, minutes: 0, done: 0 }

  finished(
    store,
    'Renew the car insurance',
    [
      'Compare quotes for exactly the same cover',
      'Find the cheapest that matches',
      'Switch once you approve',
      'Check the new policy line by line'
    ],
    [
      [
        0,
        'Compared nine quotes for exactly the same cover.',
        'tool.quotes(cover=current) → 9 results · 2.8s',
        ''
      ],
      [
        8,
        'Found the same cover for $212 less a year.',
        'llm.compare(quotes=9) → best=Harbor Mutual · 512 tokens',
        ''
      ],
      [12, 'You said yes to switching.', 'user.approve', 'you'],
      [
        16,
        'Checked the new policy matches the old one, line by line.',
        'verify.diff(policy_old, policy_new) → 0 differences in cover',
        ''
      ],
      [
        18,
        'Renewed. New policy saved to your files.',
        'chain.task_complete(goal="insurance") → verified',
        'done'
      ]
    ],
    {
      lines: [
        ['What changed', 'Same cover, new insurer'],
        ['You save', '$212 a year'],
        ['Checked', 'Cover matches, line by line']
      ],
      proof: ['policy.pdf', 'confirmation email'],
      undo: 'Switch back until Nov 2',
      tookMinutes: 18
    },
    60,
    180,
    142
  )

  finished(
    store,
    'Pay the electricity bill',
    ["Find this month's bill", 'Check it against your usual', 'Pay it', 'Confirm it cleared'],
    [
      [
        0,
        "Found this month's bill: $86.40.",
        'email.search(from="citypower") → invoice #88213',
        ''
      ],
      [
        4,
        'It matches your usual amount, so it was okay to pay.',
        'policy.auto_approve(recurring, within 10% of avg) → ok',
        'you'
      ],
      [6, 'Paid. Receipt saved.', 'chain.task_complete(goal="bill") → verified', 'done']
    ],
    {
      lines: [
        ['Paid', '$86.40 to City Power'],
        ["Why it didn't ask", 'Same as usual, you allowed this'],
        ['Checked', 'Payment cleared']
      ],
      proof: ['receipt'],
      undo: null,
      tookMinutes: 6
    },
    10,
    240,
    228
  )

  const refund = store.makeTask('Get a refund for the cracked phone case')
  store.adopt(refund, 'refund')
  refund.progress = 0.4
  refund.planIdx = 1
  refund.beatIdx = 2
  refund.created = Date.now() - 6 * 60_000
  refund.line = 'It qualifies for a full refund.'
  refund.story = [
    {
      id: `seed-r1-${refund.id}`,
      at: Date.now() - 5 * 60_000,
      text: 'Found the order from March 14.',
      tone: '',
      spanId: null,
      code: 'tool.email_search(q="phone case") → order #112-4471 · 14 March'
    },
    {
      id: `seed-r2-${refund.id}`,
      at: Date.now() - 2 * 60_000,
      text: 'It qualifies for a full refund.',
      tone: '',
      spanId: null,
      code: 'tool.order_policy(order=#112-4471) → within 30 days · eligible'
    }
  ]
  store.tasks.unshift(refund)
  store.launch(refund)

  const dinner = store.makeTask('Plan Saturday dinner for six, one vegetarian', {
    when: 'By Friday'
  })
  store.adopt(dinner, 'dinner')
  dinner.line = 'Queued behind the morning list. Nothing is due until Friday.'
  dinner.story = [
    {
      id: `seed-d-${dinner.id}`,
      at: Date.now() - 90_000,
      text: 'Queued behind the morning list. Nothing is due until Friday.',
      tone: 'you',
      spanId: null,
      code: 'policy.queued(low_priority) → starts when the queue is quiet'
    }
  ]
  store.tasks.push(dinner)
  store.launch(dinner)
  // It's due Friday. It shouldn't crowd this morning out — it starts once
  // the queue is quieter, the way a real scheduler would hold it back.
  const dinnerRunner = store.runner(dinner.id)
  dinnerRunner?.gate.setPaused(true)
  setTimeout(() => {
    if (!dinner.finishedAt && store.runner(dinner.id)) dinnerRunner?.gate.setPaused(false)
  }, 42_000)

  const gym = store.makeTask("Cancel the gym membership I don't use")
  store.adopt(gym, 'gym')
  gym.progress = 0.56
  gym.planIdx = 2
  gym.beatIdx = 5
  gym.created = Date.now() - 12 * 60_000
  gym.line = 'Drafted it in your voice so it doesn’t sound like a robot. Ready when you are.'
  gym.story = [
    {
      id: `seed-g1-${gym.id}`,
      at: Date.now() - 11 * 60_000,
      text: 'Found your Ironworks Gym membership.',
      tone: '',
      spanId: null,
      code: 'tool.email_search(from="ironworks") → membership #44821'
    },
    {
      id: `seed-g2-${gym.id}`,
      at: Date.now() - 9 * 60_000,
      text: 'Signing in to your gym account.',
      tone: '',
      spanId: null,
      code: 'tool.browser_login(ironworks.gym/account) → signed in'
    },
    {
      id: `seed-g3-${gym.id}`,
      at: Date.now() - 7 * 60_000,
      text: 'The cancel button is hidden for online accounts. Trying another way.',
      tone: 'snag',
      spanId: null,
      code: 'tool.dom_find(label="Cancel membership") → not found · fallback=read_terms'
    },
    {
      id: `seed-g4-${gym.id}`,
      at: Date.now() - 4 * 60_000,
      text: 'Their terms say a written request works.',
      tone: '',
      spanId: null,
      code: 'retriever.read_terms(terms.pdf §7) → "written notice accepted"'
    },
    {
      id: `seed-g5-${gym.id}`,
      at: Date.now() - 90_000,
      text: 'Drafted it in your voice so it doesn’t sound like a robot.',
      tone: '',
      spanId: null,
      code: 'llm.draft(tone="plain, yours", facts=[membership, §7]) → 94 words · $0.0002'
    }
  ]
  store.tasks.unshift(gym)
  store.launch(gym)

  const plumber = store.makeTask('Find a plumber for the kitchen sink')
  store.adopt(plumber, 'plumber')
  plumber.created = Date.now() - 20_000
  store.tasks.unshift(plumber)
  store.launch(plumber)

  store.bump()
}
