import type { AgentConnector, ConnectorContext, ConnectorResult } from './types'
import type { ConnectorInfo } from '../../shared/types'
import { runAgentLoop, type Persona } from './loop'

/**
 * Pi — the desktop engine.
 *
 * This is the default and the benchmark: local-first, reaches for the machine
 * before the network, and only asks the user when the work genuinely cannot
 * proceed without them.
 */
export class PiConnector implements AgentConnector {
  id = 'pi' as const
  name = 'Pi'
  blurb = 'Local desktop engine with every tool: browser, shell, files, clipboard, system info.'
  category = 'desktop' as const
  badge = 'Pi'
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
        'The default engine. Runs on your machine with a real browser, a real shell and direct filesystem access. Everything it reports is a result a tool actually returned.',
      endpoint: 'local://pi-agent-core',
      requiresKey: 'LLM_API_KEY'
    }
  }

  execute(prompt: string, ctx: ConnectorContext): Promise<ConnectorResult> {
    const persona: Persona = {
      opening: 'Getting started.',
      identity: [
        'You are Pi, the agent that runs this desktop app.',
        'You are local-first: the machine in front of you is the thing you can actually change.'
      ],
      craft: [
        'Reach for the real machine before the network — files and shell before search.',
        'Do the whole job. If asked to write a file, write it, then read it back.'
      ],
      maxTurns: 12,
      engine: 'pi'
    }
    return runAgentLoop(persona, ctx, prompt)
  }
}
