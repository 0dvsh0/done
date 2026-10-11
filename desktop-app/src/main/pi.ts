import type { AgentTool } from '@earendil-works/pi-agent-core'
import { createModels, createProvider, envApiKeyAuth, type Model } from '@earendil-works/pi-ai'
import { openAICompletionsApi } from '@earendil-works/pi-ai/api/openai-completions.lazy'
import { BRAIN, MODEL_PRICES } from './llm'
import type { Tool, ToolContext } from './tools'

/* ==========================================================================
   Pi Agent — Autonomous Agent Engine
   
   Powered by @earendil-works/pi-agent-core & @earendil-works/pi-ai.
   Designed for persistent, always-on autonomous agent workflows matching
   Grok Bot, Muse Spark, and GPT Dots.
   ========================================================================== */

export function getPiModel(): Model<'openai-completions'> {
  const modelId = BRAIN
  const price = MODEL_PRICES[modelId] ?? { input: 0.15, output: 0.6 }

  return {
    id: modelId,
    name: `Groq (${modelId})`,
    api: 'openai-completions',
    provider: 'groq',
    baseUrl: 'https://api.groq.com/openai/v1',
    reasoning: false,
    input: ['text'],
    cost: { input: price.input, output: price.output, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128000,
    maxTokens: 4096
  }
}

export function createPiModels(): ReturnType<typeof createModels> {
  const groqModel = getPiModel()
  const groqProvider = createProvider({
    id: 'groq',
    name: 'Groq',
    baseUrl: 'https://api.groq.com/openai/v1',
    auth: { apiKey: envApiKeyAuth('Groq API Key', ['LLM_API_KEY', 'GROQ_API_KEY']) },
    models: [groqModel],
    api: openAICompletionsApi()
  })

  const models = createModels()
  models.setProvider(groqProvider)
  return models
}

export interface AdaptedToolCallbacks {
  onStart?: (tool: Tool, args: Record<string, unknown>) => void
  onEnd?: (tool: Tool, args: Record<string, unknown>, output: string, ok: boolean) => void
  executeOverride?: (
    tool: Tool,
    args: Record<string, unknown>,
    signal?: AbortSignal
  ) => Promise<{ ok: boolean; output: string; data?: unknown }>
}

/**
 * Converts internal tool definitions to Pi Agent tools.
 */
export function adaptToolToPi(
  tool: Tool,
  getContext: () => ToolContext,
  callbacks?: AdaptedToolCallbacks
): AgentTool {
  return {
    name: tool.name,
    label: tool.name.replace(/_/g, ' '),
    description: tool.description,
    parameters: tool.params as unknown as AgentTool['parameters'],
    execute: async (_toolCallId, params, signal) => {
      const args = (params ?? {}) as Record<string, unknown>
      callbacks?.onStart?.(tool, args)

      const ctx: ToolContext = {
        signal: signal ?? getContext().signal,
        aborted: (signal?.aborted || getContext().aborted) ?? false
      }

      try {
        let res: { ok: boolean; output: string; data?: unknown }
        if (callbacks?.executeOverride) {
          res = await callbacks.executeOverride(tool, args, signal)
        } else {
          res = await tool.run(args, ctx)
        }
        callbacks?.onEnd?.(tool, args, res.output, res.ok)

        const dataStr = res.data
          ? typeof res.data === 'string'
            ? res.data
            : JSON.stringify(res.data, null, 2)
          : ''
        const fullContent = dataStr ? `${res.output}\n\n${dataStr}` : res.output

        return {
          content: [{ type: 'text', text: fullContent }],
          details: res,
          isError: !res.ok
        }
      } catch (err) {
        const errText = err instanceof Error ? err.message : String(err)
        callbacks?.onEnd?.(tool, args, errText, false)
        return {
          content: [{ type: 'text', text: `Tool error: ${errText}` }],
          details: { error: errText },
          isError: true
        }
      }
    }
  }
}
