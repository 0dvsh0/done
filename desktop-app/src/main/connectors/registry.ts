import type { AgentConnector } from './types'
import type { ConnectorId, ConnectorInfo } from '../../shared/types'
import { GrokConnector } from './grok'
import { ClaudeConnector } from './claude'
import { ChatGPTConnector } from './chatgpt'
import { MuseConnector } from './muse'
import { GeminiConnector } from './gemini'
import { GitHubConnector } from './github'
import { PiConnector } from './pi'
import { describeEngine, setEngineKey } from './engines'

const grok = new GrokConnector()
const claude = new ClaudeConnector()
const chatgpt = new ChatGPTConnector()
const muse = new MuseConnector()
const gemini = new GeminiConnector()
const github = new GitHubConnector()
const pi = new PiConnector()

/**
 * The order engines are offered in. Pi first because it is the one that can
 * always act on this machine, and GitHub last because it answers one shape of
 * question rather than everything.
 */
const ALL: AgentConnector[] = [pi, claude, gemini, grok, chatgpt, muse, github]

const CONNECTORS_BY_ID = new Map<ConnectorId, AgentConnector>(ALL.map((c) => [c.id, c]))

/**
 * Every engine, with the model that will actually serve it named.
 *
 * `native: false` is the honest case: that engine's provider has no key on
 * this machine, so the task will run on the local model instead. The UI shows
 * it, because an engine list that reads as though work went to a provider it
 * never reached is the exact failure this app is built not to have.
 */
export function getConnectorList(): ConnectorInfo[] {
  return ALL.map((c) => {
    const info = c.getInfo()
    const engine = describeEngine(c.id)
    return {
      ...info,
      model: engine.model,
      modelProvider: engine.provider,
      native: c.id === 'github' ? true : engine.native
    }
  })
}

/**
 * Every id resolves to a real engine. 'auto' is not an engine — by the time a
 * task reaches here the router has already chosen one — so it falls through to
 * the default rather than pretending to be a seventh connector.
 */
export function getConnector(id: ConnectorId): AgentConnector {
  const conn = CONNECTORS_BY_ID.get(id)
  return conn ?? pi
}

export function setConnectorConfig(
  id: ConnectorId,
  config: { apiKey?: string; endpoint?: string }
): { ok: boolean; message: string } {
  const conn = CONNECTORS_BY_ID.get(id) as
    (AgentConnector & { setConfig?: (key?: string, ep?: string) => void }) | undefined
  if (!conn) {
    return { ok: false, message: `Engine ${id} not found.` }
  }

  // The model engine reads its own key from here too, so a key typed into
  // Connections changes what actually serves the next task rather than only
  // what the engine card says.
  setEngineKey(id, config.apiKey)

  if (typeof conn.setConfig === 'function') {
    conn.setConfig(config.apiKey, config.endpoint)
    const engine = describeEngine(id)
    return {
      ok: true,
      message: engine.native
        ? `Configured ${conn.name}. It will run on ${engine.model}.`
        : `Saved the key for ${conn.name}.`
    }
  }

  return { ok: true, message: `Updated configuration for ${conn.name}.` }
}
