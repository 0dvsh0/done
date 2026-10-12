import type { AgentTool } from '@earendil-works/pi-agent-core'
import { createModels, createProvider, envApiKeyAuth, type Model } from '@earendil-works/pi-ai'
import { openAICompletionsApi } from '@earendil-works/pi-ai/api/openai-completions.lazy'
import { BRAIN, BRAIN_POOL, MODEL_PRICES } from './llm'
import type { Tool, ToolContext } from './tools'

/* ==========================================================================
   Pi Agent — Autonomous Agent Engine

   Powered by @earendil-works/pi-agent-core & @earendil-works/pi-ai.
   Designed for persistent, always-on autonomous agent workflows matching
   Grok Bot, Muse Spark, and GPT Dots.
   ========================================================================== */

/**
 * Context window per model, as the provider publishes it.
 *
 * This is not decoration. pi truncates the conversation to fit whatever it is
 * told here, so a number typed in generously is a run that loses the evidence
 * it needed and then verifies against the wrong thing. These are the numbers
 * Groq lists.
 */
const CONTEXT: Record<string, number> = {
  'openai/gpt-oss-120b': 131072,
  'openai/gpt-oss-20b': 131072,
  'qwen/qwen3.8-27b': 32768,
  'qwen/qwen3-32b': 131072
}

const MAX_TOKENS = 4096

/** One model in the pool, as pi sees it. */
export function toPiModel(modelId: string): Model<'openai-completions'> {
  const price = MODEL_PRICES[modelId] ?? { input: 0, output: 0 }
  return {
    id: modelId,
    name: `Groq (${modelId})`,
    api: 'openai-completions',
    provider: 'groq',
    baseUrl: 'https://api.groq.com/openai/v1',
    reasoning: false,
    input: ['text'],
    cost: { input: price.input, output: price.output, cacheRead: 0, cacheWrite: 0 },
    contextWindow: CONTEXT[modelId] ?? 32768,
    maxTokens: MAX_TOKENS
  }
}

export function getPiModel(): Model<'openai-completions'> {
  return toPiModel(BRAIN)
}

/**
 * Every model this key can run, in the order the agent should try them.
 *
 * The agent loop needs the whole list registered, not just the first entry,
 * because the failover wrapper has to be able to address the next one by id at
 * the moment the current one runs out — mid-run, without restarting.
 */
export function getPiModels(): Model<'openai-completions'>[] {
  return BRAIN_POOL.map(toPiModel)
}

/** The provider, carrying the whole pool. */
export function getPiProvider(): ReturnType<typeof createProvider> {
  return createProvider({
    id: 'groq',
    name: 'Groq',
    baseUrl: 'https://api.groq.com/openai/v1',
    auth: { apiKey: envApiKeyAuth('Groq API Key', ['LLM_API_KEY', 'GROQ_API_KEY']) },
    models: getPiModels(),
    api: openAICompletionsApi()
  })
}

export function createPiModels(): ReturnType<typeof createModels> {
  const models = createModels()
  models.setProvider(getPiProvider())
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
          content: [{ type: 'text', text: fit(fullContent) }],
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

/**
 * How much of one tool result is allowed back into the conversation.
 *
 * This is the ceiling that matters. A browser read can return six thousand
 * characters of page; the JSON payload that rides alongside it doubles that.
 * Three of those in a row and the next model call goes over the provider's
 * per-minute token limit and comes back as a 413 — the run dies on a limit it
 * caused itself, having done most of the work already.
 *
 * So results are trimmed here rather than after the fact, where it would be
 * too late to matter. The head of a result is where the answer is; the tail is
 * usually navigation chrome and cookie banners.
 */
const RESULT_LIMIT = 4000

function fit(text: string): string {
  if (text.length <= RESULT_LIMIT) return text
  const cut = text.slice(0, RESULT_LIMIT)
  const lastBreak = cut.lastIndexOf('\n')
  const body = lastBreak > RESULT_LIMIT * 0.7 ? cut.slice(0, lastBreak) : cut
  return `${body.trimEnd()}\n\n[truncated — ${text.length - body.length} more characters]`
}
