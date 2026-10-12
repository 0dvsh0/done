/**
 * The contract between the main process (where the agent runs) and the
 * renderer (which only draws it). Everything the UI shows is derived from
 * these shapes — there is no second, "display-only" copy of the truth.
 */

/* ------------------------------------------------------------------ the dot */

export type TaskState =
  'waiting' | 'working' | 'snag' | 'needs' | 'paused' | 'you' | 'done' | 'stopped'

export const STATE_WORDS: Record<TaskState, string> = {
  waiting: 'Waiting to start',
  working: 'On it',
  needs: 'Needs you',
  snag: 'Hit a snag · trying another way',
  paused: 'Paused',
  you: "You're doing this one",
  done: 'Done',
  stopped: 'Stopped'
}

/* ------------------------------------------------------------------ traces */

export type SpanKind = 'WORKFLOW' | 'AGENT' | 'LLM' | 'TOOL' | 'RETRIEVER' | 'GUARDRAIL' | 'CHAIN'

export type SpanStatus = 'ok' | 'error' | 'recovered'

/**
 * One trace span, in the shape neatlogs understands. The sentence the agent
 * says and the `code` line under "show what's underneath" are both rendered
 * from this object — the UI has no other source for either.
 */
export interface SpanRecord {
  id: string
  parentId: string | null
  kind: SpanKind
  name: string
  /** e.g. `q="plumber", radius=5km` */
  input: string
  /** e.g. `14 results` */
  output: string
  start: number
  end: number
  durationMs: number
  status: SpanStatus
  tokens: { input: number; output: number } | null
  cost: number | null
  error?: string
  /** True once neatlogs has accepted the span. */
  exported: boolean
}

export type StoryTone = '' | 'snag' | 'needs' | 'done' | 'you'

export interface StoryEntry {
  id: string
  at: number
  /** The plain sentence the agent says. */
  text: string
  tone: StoryTone
  spanId: string | null
  /** The machine record, derived from the span. Empty before the span lands. */
  code: string
}

/* ------------------------------------------------------------------- asks */

export interface AskChoice {
  value: string
  label: string
  note: string
  cost?: number
}

export type Ask =
  | {
      kind: 'approve'
      id: string
      q: string
      category: 'spend' | 'message' | 'action'
      cost?: number
      draft?: string
      facts: [string, string][]
      yes: string
      no: string
    }
  | {
      kind: 'choice'
      id: string
      q: string
      choices: AskChoice[]
      none: string
    }

/* ---------------------------------------------------------------- receipts */

export interface Receipt {
  lines: [string, string][]
  proof: string[]
  /** null means "this cannot be undone — which is why it asked first" */
  undo: string | null
  tookMinutes: number
}

/* ------------------------------------------------------------------ tasks */

export interface Task {
  id: string
  title: string
  state: TaskState
  progress: number
  /** What the agent is doing right now, in one sentence. */
  line: string
  plan: string[]
  planIdx: number
  beatIdx: number
  beatsTotal: number
  story: StoryEntry[]
  ask: Ask | null
  receipt: Receipt | null
  notes: string[]
  when: string | null
  budget: string | null
  /** The group this task was filed under, e.g. "Errands". null = ungrouped. */
  group: string | null
  created: number
  finishedAt: number | null
  nextAt: number
  settleUntil: number
  justDone?: boolean
  /** neatlogs trace id for this run, once it exists. */
  traceId: string | null
  /** Entire checkpoint attached to this task's behaviour change. */
  checkpointId: string | null
  /** Set when the user dismisses a finished task. */
  dismissed?: boolean
  /** What the state was before pause / take over, so we can go back. */
  prevState?: TaskState | null
  /** Values filled in as the run progresses, e.g. the option that was chosen. */
  vars?: Record<string, string>
  /** User-selected connector ('auto' or specific agent) */
  connector?: ConnectorId
  /** The connector chosen by our LLM router */
  routedConnector?: ConnectorId
  /** Explanation of why our LLM dispatched this task to this connector */
  routingReason?: string
}

/* ------------------------------------------------------------- app state */

export interface Limits {
  /**
   * Dollars one run may spend before the agent stops and asks. Real money:
   * every model call reports its token count, and cost is computed from the
   * provider's published rates. At $0 it asks the first time anything costs.
   */
  spend: number
  /** If false, irreversible tools the user has approved run without asking again. */
  messages: boolean
  /** Hold questions overnight. */
  quiet: boolean
}

export interface Ledger {
  spent: number
  minutes: number
  done: number
}

export interface NeatlogsStatus {
  installed: boolean
  connected: boolean
  workflow: string
  spansExported: number
  lastExportAt: number | null
  error: string | null
}

export interface EntireStatus {
  installed: boolean
  version: string | null
  enabled: boolean
  checkpoints: number
  lastCheckpointId: string | null
  lastCheckpointAt: number | null
  repoPath: string | null
  error: string | null
}

/** One model in the brain pool, and whether it can serve right now. */
export interface BrainStatus {
  id: string
  /** False while the provider says this model is over its limit. */
  ready: boolean
  /** Ms until the provider says it can serve again. Null when it is ready. */
  resetsInMs: number | null
  /** The provider's own words, shortened. Null when it is ready. */
  reason: string | null
}

/** The model doing the thinking, and the classifier screening what it reads. */
export interface ModelStatus {
  connected: boolean
  /** The model that will serve the next call. */
  model: string
  guard: string
  error: string | null
  /** Every model this key can run, in the order the agent tries them. */
  brains: BrainStatus[]
  /** How many times the pool has moved this session. */
  handovers: number
}

/* ------------------------------------------------------------- connectors */

/**
 * The engines a task can be handed to.
 *
 * Every id here is a thing this app can actually reach. There is deliberately
 * no id for a competitor's service: an engine list that mixes providers in
 * with products that merely look like providers is a list that lies about what
 * will happen when a task is dispatched to it.
 */
export type ConnectorId =
  'auto' | 'pi' | 'claude' | 'grok' | 'chatgpt' | 'muse' | 'gemini' | 'github'

export type ConnectorCategory =
  'code' | 'search' | 'reasoning' | 'creative' | 'protocol' | 'desktop'

export interface ConnectorInfo {
  id: ConnectorId
  name: string
  blurb: string
  category: ConnectorCategory
  badge: string
  icon: string
  connected: boolean
  isDefault?: boolean
  description: string
  endpoint?: string
  requiresKey?: string
  /**
   * The model that will actually do the thinking for this engine, e.g.
   * `claude-sonnet-5` or `openai/gpt-oss-120b`. Shown wherever an engine is
   * picked, because "Claude" on its own does not tell you whether the work is
   * going to be done by Claude or by whatever model happens to be loaded.
   */
  model?: string
  /** The provider actually serving that model: Anthropic, Google, Groq, … */
  modelProvider?: string
  /**
   * False when the engine's own provider is not configured and the task will
   * run on the local model instead. The UI says so rather than implying the
   * request went somewhere it did not.
   */
  native?: boolean
}

export interface Integrations {
  neatlogs: NeatlogsStatus
  entire: EntireStatus
  model: ModelStatus
  connectors: ConnectorInfo[]
}

export interface AppState {
  tasks: Task[]
  /** Trace spans keyed by task id. */
  spans: Record<string, SpanRecord[]>
  limits: Limits
  ledger: Ledger
  allPaused: boolean
  integrations: Integrations
  /** Monotonic counter so the renderer can tell snapshots apart. */
  rev: number
}

/* --------------------------------------------------------------- commands */

export type ControlAction = 'pause' | 'take' | 'stop' | 'reverse'

export interface CreateOptions {
  when?: string | null
  budget?: string | null
  group?: string | null
  connector?: ConnectorId
}

export interface DoneApi {
  getState(): Promise<AppState>
  onState(cb: (state: AppState) => void): () => void
  createTask(title: string, opts?: CreateOptions): Promise<void>
  control(taskId: string, action: ControlAction): Promise<void>
  answer(taskId: string, value: string): Promise<void>
  steer(taskId: string, text: string): Promise<void>
  undo(): Promise<void>
  dismiss(taskId: string): Promise<void>
  clearFinished(): Promise<void>
  setLimits(patch: Partial<Limits>): Promise<void>
  setAllPaused(on: boolean): Promise<void>
  setGroup(taskId: string, group: string | null): Promise<void>
  renameGroup(from: string, to: string): Promise<void>
  removeGroup(name: string): Promise<void>
  checkpoint(taskId: string): Promise<{ ok: boolean; id: string | null; message: string }>
  revealData(): Promise<void>
  openExternal(url: string): Promise<void>
  setConnectorConfig(
    id: ConnectorId,
    config: { apiKey?: string; endpoint?: string }
  ): Promise<{ ok: boolean; message: string }>
  windowAction(action: 'minimize' | 'maximize' | 'close' | 'fullscreen'): Promise<void>
  /** Persisted in the main process; the renderer asks for it on every change. */
  setTheme(choice: 'dark' | 'light' | 'system', resolved: 'dark' | 'light'): Promise<void>
}

/* ---------------------------------------------------------------- commands */

/** cfo.ai-shaped unit economics, computed locally from real usage. */
export interface Economics {
  pricePerPeriod: number
  costPerPeriod: number
  marginPct: number
  periodsPerMonth: number
  monthlyRevenue: number
  monthlyInfra: number
  monthlyGross: number
  fixedMonthly: number
  runwayMonths: number
  /** How many runs have actually finished — the cost figure is real past three. */
  measuredRuns: number
  scenarios: {
    name: string
    customers: number
    revenue: number
    cost: number
    gross: number
    margin: number
  }[]
}
