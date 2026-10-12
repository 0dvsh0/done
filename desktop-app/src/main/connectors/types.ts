import type { ConnectorCategory, ConnectorId, ConnectorInfo, SpanRecord, Task } from '../../shared/types'
import type { Tool } from '../tools/types'
import type { Usage } from '../llm'
import type { Step } from '../integrations'
import type { Store } from '../agent'
import type { Agent } from '@earendil-works/pi-agent-core'

export interface RunHistoryItem {
  tool: string
  ok: boolean
  summary: string
  detail: string
  args: string
}

export interface ConnectorContext {
  task: Task
  step: Step
  store: Store
  isStopped: () => boolean
  holdIfPaused: () => Promise<void>
  checkSpend: () => Promise<boolean>
  askPermission: (tool: Tool, args: Record<string, unknown>) => Promise<{ approved: boolean }>
  charge: (u: Usage) => void
  pushHistory: (entry: RunHistoryItem) => void
  /**
   * Puts a span the connector made into the task's trace.
   *
   * Without this a connector's spans reach the tracer and nothing else, so the
   * trace sheet shows a run that has no model calls in it — and the token
   * counts behind every receipt in the app are quietly zero.
   */
  addSpans: (spans: SpanRecord[]) => void
  executeLocalTool: (
    toolName: string,
    args: Record<string, unknown>
  ) => Promise<{ ok: boolean; output: string; data?: unknown }>
  setTaskLine: (line: string) => void
  setTaskProgress: (progress: number) => void
  /**
   * The run moved to a different model because the one it was using ran out of
   * allowance. Recorded as a span and said out loud, because a run that quietly
   * changes the weights doing its thinking is the same class of lie as one that
   * quietly changes the tools.
   */
  onHandover?: (from: string, to: string, detail: string) => void
  /**
   * Hands the live agent upward, so a steer typed halfway through a run
   * actually reaches the loop that is doing the work. Without this the button
   * still took your words and nothing acted on them until the run ended.
   */
  setLiveAgent: (agent: Agent | null) => void
}

export interface ConnectorResult {
  ok: boolean
  summary: string
  detail: string
  outputFiles?: string[]
  /** The model that actually did the work, so the receipt can name it. */
  model?: string
  receiptDraft?: {
    lines: [string, string][]
    proof: string[]
    undo: string | null
  }
}

export interface AgentConnector {
  id: ConnectorId
  name: string
  blurb: string
  category: ConnectorCategory
  badge: string
  icon: string
  isConfigured: () => boolean
  getInfo: () => ConnectorInfo
  execute: (prompt: string, ctx: ConnectorContext) => Promise<ConnectorResult>
}
