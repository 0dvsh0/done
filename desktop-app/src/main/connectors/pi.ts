import { Agent } from '@earendil-works/pi-agent-core'
import type { AgentConnector, ConnectorContext, ConnectorResult } from './types'
import type { ConnectorInfo } from '../../shared/types'
import { createPiModels, getPiModel, adaptToolToPi } from '../pi'
import { TOOLS, TOOLS_BY_NAME } from '../tools'
import { clip } from '../lib'

export class PiConnector implements AgentConnector {
  id = 'pi' as const
  name = 'Pi Agent Core'
  blurb = 'Local desktop engine with 19 native tools (browser, shell, files, clipboard, system info).'
  category = 'desktop' as const
  badge = '● Pi Agent'
  icon = 'pi'

  isConfigured(): boolean {
    return Boolean(process.env['LLM_API_KEY'] || process.env['GROQ_API_KEY'])
  }

  getInfo(): ConnectorInfo {
    return {
      id: this.id,
      name: this.name,
      blurb: this.blurb,
      category: this.category,
      badge: this.badge,
      icon: this.icon,
      connected: this.isConfigured(),
      isDefault: true,
      description:
        'Pi Agent Core runs locally on your machine with 19 native tools. It uses a real Chromium browser, a real shell, and direct filesystem access to complete tasks autonomously.',
      endpoint: 'local://pi-agent-core',
      requiresKey: 'LLM_API_KEY'
    }
  }

  async execute(prompt: string, ctx: ConnectorContext): Promise<ConnectorResult> {
    const models = createPiModels()
    const model = getPiModel()
    const t = ctx.task

    ctx.setTaskLine('● [Pi Agent] Booting native agent tools...')
    ctx.setTaskProgress(0.1)

    const piTools = TOOLS.map((tool) =>
      adaptToolToPi(
        tool,
        () => ({
          signal: new AbortController().signal,
          aborted: ctx.isStopped()
        }),
        {
        executeOverride: async (_tl, args) => {
          await ctx.holdIfPaused()
          if (ctx.isStopped()) throw new Error('Task stopped by user')
          const outcome = await ctx.executeLocalTool(tool.name, args as Record<string, unknown>)
          return { ok: outcome.ok, output: outcome.output, data: outcome.data }
        }
      })
    )

    let turnCount = 0
    const MAX_TURNS = 12

    const piAgent = new Agent({
      streamFn: (m, c, opts) =>
        models.streamSimple(m, c, {
          ...opts,
          maxRetries: 5,
          maxRetryDelayMs: 60000
        }),
      maxRetryDelayMs: 60000,
      initialState: {
        model,
        systemPrompt: [
          `You are Pi Agent Core inside Done., an autonomous desktop assistant.`,
          `You have 19 real local tools (web search, headless browser, filesystem, shell, clipboard, system info).`,
          `RULE: Whenever a task requires taking action, searching, reading, writing files, or checking the system, YOU MUST CALL YOUR TOOLS directly.`,
          `Be concise, direct, and completely honest. Never fabricate results.`
        ].join('\n'),
        tools: piTools
      },
      finishTurn: () => {
        turnCount++
        if (turnCount >= MAX_TURNS) return { action: 'end' }
        return undefined
      },
      beforeToolCall: async ({ toolCall, args }) => {
        await ctx.holdIfPaused()
        if (ctx.isStopped()) {
          return { block: true, terminate: true, reason: 'Task stopped by user' }
        }

        const tool = TOOLS_BY_NAME.get(toolCall.name)
        if (tool && tool.irreversible) {
          const verdict = await ctx.askPermission(tool, (args ?? {}) as Record<string, unknown>)
          if (ctx.isStopped() || !verdict.approved) {
            return { block: true, reason: 'User declined permission for this action.' }
          }
        }

        if (!(await ctx.checkSpend())) {
          return { block: true, terminate: true, reason: 'Spend budget reached; stopped per user limit.' }
        }

        return undefined
      }
    })

    let accumulatedThinking = ''
    let accumulatedText = ''

    piAgent.subscribe(async (event) => {
      if (event.type === 'message_update') {
        const assistantEvt = event.assistantMessageEvent
        if (assistantEvt.type === 'thinking_delta') {
          accumulatedThinking += assistantEvt.delta
          const latestThought = accumulatedThinking.trim().split('\n').filter(Boolean).pop() ?? ''
          if (latestThought) {
            ctx.setTaskLine(`● [Pi Agent] Thinking: ${clip(latestThought, 100)}`)
          }
        } else if (assistantEvt.type === 'text_delta') {
          accumulatedText += assistantEvt.delta
          const latestLine = accumulatedText.trim().split('\n').filter(Boolean).pop() ?? ''
          if (latestLine) {
            ctx.setTaskLine(`● [Pi Agent] ${clip(latestLine, 110)}`)
          }
        }
      } else if (event.type === 'tool_execution_start') {
        ctx.setTaskLine(`● [Pi Agent] Running ${event.toolName}...`)
      } else if (event.type === 'tool_execution_end') {
        accumulatedThinking = ''
        accumulatedText = ''
        ctx.setTaskProgress(Math.min(0.9, t.progress + 0.12))
      } else if (event.type === 'turn_end') {
        const msg = event.message as {
          usage?: { input?: number; output?: number; reasoning?: number; cost?: number | { total?: number } }
        }
        if (msg?.usage) {
          const costVal = typeof msg.usage.cost === 'number' ? msg.usage.cost : (msg.usage.cost?.total ?? 0)
          ctx.charge({
            input: msg.usage.input ?? 0,
            output: msg.usage.output ?? 0,
            reasoning: msg.usage.reasoning ?? 0,
            cost: costVal
          })
        }
      }
    })

    try {
      await piAgent.prompt(prompt)
    } catch (err: unknown) {
      if (ctx.isStopped()) {
        return { ok: false, summary: 'Task was stopped by user.', detail: '' }
      }
      const msg = err instanceof Error ? err.message : String(err)
      throw new Error(`Pi Agent stopped: ${msg}`)
    }

    ctx.setTaskProgress(0.95)

    const lastAssistant = piAgent.state.messages
      .filter((m) => m.role === 'assistant')
      .pop() as { content?: Array<{ type?: string; text?: string }> } | undefined
    const textBlock = lastAssistant?.content?.find((c) => c.type === 'text')
    const finalContent = textBlock?.text || 'Pi Agent execution completed successfully.'

    return {
      ok: true,
      summary: clip(finalContent, 160),
      detail: finalContent,
      receiptDraft: {
        lines: [
          ['Connected Agent', 'Pi Agent Core (v1.1.0)'],
          ['Execution', '19 native desktop tools'],
          ['Status', 'Verified authentic run']
        ],
        proof: ['real desktop tools', 'verified tokens'],
        undo: null
      }
    }
  }
}
