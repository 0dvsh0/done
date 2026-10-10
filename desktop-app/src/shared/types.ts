/**
 * The contract between the main process (where the agent runs) and the
 * renderer (which only draws it). Everything the UI shows is derived from
 * these shapes — there is no second, "display-only" copy of the truth.
 */

/* ------------------------------------------------------------------ the dot */

export type TaskState =
  | 'waiting'
  | 'working'
  | 'snag'
  | 'needs'
  | 'paused'
  | 'you'
  | 'done'
  | 'stopped'

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

export type SpanKind =
  | 'WORKFLOW'
  | 'AGENT'
  | 'LLM'
  | 'TOOL'
  | 'RETRIEVER'
  | 'GUARDRAIL'
  | 'CHAIN'

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
}

/* ------------------------------------------------------------- app state */

export interface Limits {
  /** Dollars the agent may spend without asking. */
  spend: number
  /** If false, messages go out unattended. */
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

export interface Integrations {
  neatlogs: NeatlogsStatus
  entire: EntireStatus
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
  checkpoint(taskId: string): Promise<{ ok: boolean; id: string | null; message: string }>
  revealData(): Promise<void>
  openExternal(url: string): Promise<void>
  windowAction(action: 'minimize' | 'maximize' | 'close'): Promise<void>
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
  scenarios: { name: string; customers: number; revenue: number; cost: number; gross: number; margin: number }[]
}