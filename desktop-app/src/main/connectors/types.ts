import type { ConnectorCategory, ConnectorId, ConnectorInfo, Task } from '../../shared/types'
import type { Tool } from '../tools/types'
import type { Usage } from '../llm'
import type { Step } from '../integrations'
import type { Store } from '../agent'

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
  executeLocalTool: (toolName: string, args: Record<string, unknown>) => Promise<{ ok: boolean; output: string; data?: unknown }>
  setTaskLine: (line: string) => void
  setTaskProgress: (progress: number) => void
}

export interface ConnectorResult {
  ok: boolean
  summary: string
  detail: string
  outputFiles?: string[]
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
