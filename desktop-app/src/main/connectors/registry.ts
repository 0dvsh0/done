import type { AgentConnector } from './types'
import type { ConnectorId, ConnectorInfo } from '../../shared/types'
import { GrokConnector } from './grok'
import { ClaudeConnector } from './claude'
import { ChatGPTConnector } from './chatgpt'
import { MuseConnector } from './muse'
import { GeminiConnector } from './gemini'
import { RomaConnector } from './roma'
import { PiConnector } from './pi'

const grok = new GrokConnector()
const claude = new ClaudeConnector()
const chatgpt = new ChatGPTConnector()
const muse = new MuseConnector()
const gemini = new GeminiConnector()
const roma = new RomaConnector()
const pi = new PiConnector()

const CONNECTORS_BY_ID = new Map<ConnectorId, AgentConnector>([
  ['grok', grok],
  ['claude', claude],
  ['chatgpt', chatgpt],
  ['muse', muse],
  ['gemini', gemini],
  ['roma', roma],
  ['pi', pi]
])

export function getConnectorList(): ConnectorInfo[] {
  return [
    claude.getInfo(),
    grok.getInfo(),
    chatgpt.getInfo(),
    muse.getInfo(),
    gemini.getInfo(),
    roma.getInfo(),
    pi.getInfo()
  ]
}

export function getConnector(id: ConnectorId): AgentConnector {
  if (id === 'auto') return pi
  const conn = CONNECTORS_BY_ID.get(id)
  return conn ?? pi
}

export function setConnectorConfig(
  id: ConnectorId,
  config: { apiKey?: string; endpoint?: string }
): { ok: boolean; message: string } {
  const conn = CONNECTORS_BY_ID.get(id) as (AgentConnector & { setConfig?: (key?: string, ep?: string) => void }) | undefined
  if (!conn) {
    return { ok: false, message: `Connector ${id} not found.` }
  }

  if (typeof conn.setConfig === 'function') {
    conn.setConfig(config.apiKey, config.endpoint)
    return { ok: true, message: `Configured ${conn.name}.` }
  }

  return { ok: true, message: `Updated configuration for ${conn.name}.` }
}
