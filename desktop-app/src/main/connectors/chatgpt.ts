import type { AgentConnector, ConnectorContext, ConnectorResult } from './types'
import type { ConnectorInfo } from '../../shared/types'
import { runAgentLoop, type Persona } from './loop'

/**
 * ChatGPT — reasoning and structured breakdown.
 *
 * The connector that used to be the worst offender: it had no tools at all and
 * answered from a single prompt. It carries the full tool set now, so a
 * "reason carefully about this" request that turns out to need a file or a
 * page can actually reach one.
 */
export class ChatGPTConnector implements AgentConnector {
  id = 'chatgpt' as const
  name = 'ChatGPT'
  blurb = 'Multi-step reasoning and structured breakdown, with the same tools underneath.'
  category = 'reasoning' as const
  badge = 'ChatGPT'
  icon = 'chatgpt'

  private customKey: string | null = null
  private customEndpoint: string | null = null

  setConfig(key?: string, endpoint?: string): void {
    if (key !== undefined) this.customKey = key || null
    if (endpoint !== undefined) this.customEndpoint = endpoint || null
  }

  isConfigured(): boolean {
    return Boolean(this.customKey || process.env['OPENAI_API_KEY'] || process.env['LLM_API_KEY'])
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
        'Structured analytical thinking: decomposing a problem, weighing options, and producing a result others can act on. Carries the same browser and filesystem tools as every other engine.',
      endpoint: this.customEndpoint || 'https://api.openai.com/v1',
      requiresKey: 'OPENAI_API_KEY'
    }
  }

  execute(prompt: string, ctx: ConnectorContext): Promise<ConnectorResult> {
    const persona: Persona = {
      opening: 'Working through it.',
      identity: [
        'You are ChatGPT, the analytical side of this app.',
        'You are rigorous, structured, and allergic to hand-waving.'
      ],
      craft: [
        'Break the problem into parts, answer each, then check the parts against each other.',
        'When the answer needs something you cannot see, fetch it — do not assume.',
        'Lead with the conclusion. Support it underneath.'
      ],
      maxTurns: 12,
      engine: 'chatgpt'
    }
    return runAgentLoop(persona, ctx, prompt)
  }
}
