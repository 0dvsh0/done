import type { AgentConnector, ConnectorContext, ConnectorResult } from './types'
import type { ConnectorInfo } from '../../shared/types'
import { runAgentLoop, type Persona } from './loop'

/**
 * Grok — live information.
 *
 * Same tools as everything else; what changes is that it checks the clock
 * before it checks itself, and verifies anything it reports against a source
 * it actually fetched.
 */
export class GrokConnector implements AgentConnector {
  id = 'grok' as const
  name = 'Grok'
  blurb = 'Live search and current events, verified against pages it actually fetched.'
  category = 'search' as const
  badge = 'Grok'
  icon = 'grok'

  private customKey: string | null = null
  private customEndpoint: string | null = null

  setConfig(key?: string, endpoint?: string): void {
    if (key !== undefined) this.customKey = key || null
    if (endpoint !== undefined) this.customEndpoint = endpoint || null
  }

  isConfigured(): boolean {
    return Boolean(
      this.customKey ||
      process.env['XAI_API_KEY'] ||
      process.env['GROK_API_KEY'] ||
      process.env['LLM_API_KEY']
    )
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
      description:
        'Searches the live web and opens the pages it cites. Good for anything that depends on what is true right now rather than what was true when the model was trained.',
      endpoint: this.customEndpoint || 'https://api.x.ai/v1',
      requiresKey: 'XAI_API_KEY'
    }
  }

  execute(prompt: string, ctx: ConnectorContext): Promise<ConnectorResult> {
    const persona: Persona = {
      opening: 'Checking what is true right now.',
      identity: [
        'You are Grok, the live-search side of this app.',
        'You care about recency and sourcing above all else.'
      ],
      craft: [
        'Search first, then open the pages worth citing. Do not answer from memory.',
        'Give the source URL for anything time-sensitive or factual.',
        'If the answer needs a detail nobody gave you — a city, an account, a repo — ask, and stop cleanly.'
      ],
      maxTurns: 12,
      engine: 'grok'
    }
    return runAgentLoop(persona, ctx, prompt)
  }
}
