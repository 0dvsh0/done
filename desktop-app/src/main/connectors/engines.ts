import {
  createModels,
  createProvider,
  envApiKeyAuth,
  type MutableModels,
  type Model,
  type ProviderStreams
} from '@earendil-works/pi-ai'
import { openAICompletionsApi } from '@earendil-works/pi-ai/api/openai-completions.lazy'
import { anthropicMessagesApi } from '@earendil-works/pi-ai/api/anthropic-messages.lazy'
import { googleGenerativeAIApi } from '@earendil-works/pi-ai/api/google-generative-ai.lazy'
import { ANTHROPIC_MODELS } from '@earendil-works/pi-ai/providers/anthropic.models'
import { GOOGLE_MODELS } from '@earendil-works/pi-ai/providers/google.models'
import { XAI_MODELS } from '@earendil-works/pi-ai/providers/xai.models'
import { OPENAI_MODELS } from '@earendil-works/pi-ai/providers/openai.models'
import type { ConnectorId } from '../../shared/types'
import { envKey } from '../env'
import { BRAIN, availableBrains, shortModel } from '../llm'
import { getPiModel, getPiModels, getPiProvider } from '../pi'

/* ==========================================================================
   Which model actually thinks.

   Every connector used to be a *persona* — a paragraph of instructions handed
   to one and the same local model. "Gemini" was the local model asked to
   imagine it was Gemini, and "Claude" was the local model asked to imagine it
   was Claude. Dispatching a task to an engine therefore changed the tone of
   the answer and nothing else: the same weights did the same work, reached for
   the same tools, and got the same things wrong. Naming an engine in the UI
   was a claim the run did not honour.

   So an engine is now two things: a provider we can actually reach, and a
   persona. When the provider's key is configured the task genuinely runs on
   that provider's model. When it is not, the task falls back to the local
   model and *says so*, in the task line and in Connections, rather than
   borrowing a name it has not earned.

   The models themselves come from pi's own catalogue, so their context
   windows and per-token rates are the provider's published numbers rather
   than numbers typed into this file.
   ========================================================================== */

/** What an engine resolves to, right now, for this machine. */
export interface Engine {
  models: MutableModels
  model: Model<string>
  /** The model id exactly as the provider names it. */
  modelId: string
  /** 'Anthropic', 'Google', 'xAI', 'OpenAI', 'Groq'. */
  providerName: string
  /**
   * False when this engine's own provider is not configured and the local
   * model is standing in for it.
   */
  native: boolean
}

type Catalog = readonly Model<string>[]

interface EngineSpec {
  /** The provider id pi will dispatch to. */
  provider: string
  providerName: string
  /** Prefers this model id; falls back to the first one the catalogue has. */
  preferred: string[]
  keys: string[]
  catalogue: Catalog
  api: () => ProviderStreams
}

const SPECS: Partial<Record<Exclude<ConnectorId, 'auto' | 'github' | 'muse' | 'pi'>, EngineSpec>> =
  {
    claude: {
      provider: 'anthropic',
      providerName: 'Anthropic',
      preferred: ['claude-sonnet-5', 'claude-sonnet-4-6', 'claude-opus-4-8'],
      keys: ['ANTHROPIC_API_KEY', 'CLAUDE_API_KEY'],
      catalogue: Object.values(ANTHROPIC_MODELS) as Catalog,
      api: anthropicMessagesApi
    },
    gemini: {
      provider: 'google',
      providerName: 'Google',
      preferred: ['gemini-2.5-pro', 'gemini-2.5-flash'],
      keys: ['GEMINI_API_KEY', 'GOOGLE_API_KEY'],
      catalogue: Object.values(GOOGLE_MODELS) as Catalog,
      api: googleGenerativeAIApi
    },
    grok: {
      provider: 'xai',
      providerName: 'xAI',
      preferred: ['grok-4.5', 'grok-4.7'],
      keys: ['XAI_API_KEY', 'GROK_API_KEY'],
      catalogue: Object.values(XAI_MODELS) as Catalog,
      api: openAICompletionsApi
    },
    chatgpt: {
      provider: 'openai',
      providerName: 'OpenAI',
      preferred: ['gpt-5.4-mini', 'gpt-5.4', 'gpt-5.2'],
      keys: ['OPENAI_API_KEY'],
      catalogue: Object.values(OPENAI_MODELS) as Catalog,
      api: openAICompletionsApi
    }
  }

/** Per-connector key entered in Connections rather than the environment. */
const overrides = new Map<ConnectorId, string>()

export function setEngineKey(connector: ConnectorId, key: string | undefined): void {
  if (key === undefined) return
  const clean = key.trim()
  if (clean) overrides.set(connector, clean)
  else overrides.delete(connector)
}

function specFor(connector: ConnectorId): EngineSpec | null {
  const spec = SPECS[connector as keyof typeof SPECS]
  return spec ?? null
}

/** Whether this engine's own provider is reachable on this machine. */
export function isNative(connector: ConnectorId): boolean {
  const spec = specFor(connector)
  if (!spec) return true
  return Boolean(resolveKey(connector, spec))
}

function resolveKey(connector: ConnectorId, spec: EngineSpec): string | null {
  const manual = overrides.get(connector)
  if (manual) return manual
  for (const name of spec.keys) {
    const value = envKey(name as never)
    if (value) return value
  }
  return null
}

/** The model id and provider this engine will use, without building a runtime. */
export function describeEngine(connector: ConnectorId): {
  model: string
  provider: string
  native: boolean
} {
  const spec = specFor(connector)
  if (!spec) {
    return { model: shortModel(nextBrain()), provider: 'Groq', native: true }
  }
  const model = pickModel(spec)
  return { model, provider: spec.providerName, native: isNative(connector) }
}

/**
 * The brain that will serve the next call.
 *
 * Asked at call time rather than at startup, because "which model" is a
 * question whose answer changes during a session: the strongest one here can
 * exhaust its daily allowance partway through a run, and the run does not stop
 * for it.
 */
export function nextBrain(): string {
  const ready = availableBrains()
  return ready[0] ?? BRAIN
}

function pickModel(spec: EngineSpec): string {
  for (const id of spec.preferred) {
    if (spec.catalogue.some((m) => m.id === id)) return id
  }
  return spec.catalogue[0]?.id ?? spec.preferred[0]
}

function findModel(spec: EngineSpec): Model<string> | null {
  const wanted = pickModel(spec)
  return spec.catalogue.find((m) => m.id === wanted) ?? spec.catalogue[0] ?? null
}

/**
 * Builds the runtime for one engine.
 *
 * Every model is registered against the provider that owns it, so the same
 * agent loop serves all of them: the engine is the model plus the instructions,
 * and the tools are the tools.
 */
export function getEngine(connector: ConnectorId, manualKey?: string): Engine {
  const spec = specFor(connector)
  const localModel = getPiModel()

  // The whole brain pool is registered against the one Groq provider, not just
  // its head. The loop's failover wrapper addresses the next model by id at the
  // moment the current one is refused, and a model pi has never heard of cannot
  // be addressed.
  const models = createModels()
  models.setProvider(getPiProvider())

  const model = spec ? findModel(spec) : null
  const key = spec ? manualKey?.trim() || resolveKey(connector, spec) : null

  if (spec && model && key) {
    models.setProvider(
      createProvider({
        id: spec.provider,
        name: spec.providerName,
        auth: { apiKey: envApiKeyAuth(`${spec.providerName} API Key`, spec.keys) },
        models: [model],
        api: { [model.api]: spec.api() } as Partial<Record<string, ProviderStreams>>
      })
    )
    return {
      models,
      model,
      modelId: model.id,
      providerName: spec.providerName,
      native: true
    }
  }

  return { models, model: localModel, modelId: BRAIN, providerName: 'Groq', native: false }
}

/** Every model the local engine can reach, in failover order. */
export function localPool(): Model<string>[] {
  return getPiModels()
}
