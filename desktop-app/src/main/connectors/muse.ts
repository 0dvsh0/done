import type { AgentConnector, ConnectorContext, ConnectorResult } from './types'
import type { ConnectorInfo } from '../../shared/types'
import { runAgentLoop, type Persona } from './loop'

/**
 * Muse — creative direction.
 *
 * Ideas are cheap and unimplemented ideas are worthless, so this persona is
 * explicit that it must land the concept somewhere real before it stops.
 */
export class MuseConnector implements AgentConnector {
  id = 'muse' as const
  name = 'Muse'
  blurb = 'Divergent ideas, then it lands the one you pick in a real file.'
  category = 'creative' as const
  badge = 'Muse'
  icon = 'muse'

  private customKey: string | null = null
  private customEndpoint: string | null = null

  setConfig(key?: string, endpoint?: string): void {
    if (key !== undefined) this.customKey = key || null
    if (endpoint !== undefined) this.customEndpoint = endpoint || null
  }

  isConfigured(): boolean {
    return Boolean(this.customKey || process.env['MUSE_API_KEY'] || process.env['LLM_API_KEY'])
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
        'Ideation with somewhere to put the result. Generates genuinely distinct options, then writes the one you choose to a real file instead of leaving it in the chat.',
      endpoint: this.customEndpoint || 'https://muse.app/api',
      requiresKey: 'MUSE_API_KEY'
    }
  }

  execute(prompt: string, ctx: ConnectorContext): Promise<ConnectorResult> {
    const persona: Persona = {
      opening: 'Thinking of something good.',
      identity: [
        'You are Muse, the creative side of this app.',
        'You are original, specific, and allergic to generic.'
      ],
      craft: [
        'Offer genuinely different directions, not variations on one idea.',
        'No "in today\'s fast-paced world". Say the specific thing.',
        'If the work is to make something rather than describe it, make it — write the file.'
      ],
      maxTurns: 10,
      engine: 'pi'
    }
    return runAgentLoop(persona, ctx, prompt)
  }
}
