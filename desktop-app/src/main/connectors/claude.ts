import type { AgentConnector, ConnectorContext, ConnectorResult } from './types'
import type { ConnectorInfo } from '../../shared/types'
import { runAgentLoop, type Persona } from './loop'

/**
 * Claude — engineering.
 *
 * Reads the codebase before editing it, edits for real, and re-reads what it
 * wrote. The persona is a discipline, not a costume: it is the one that
 * refuses to call code done until it has run.
 */
export class ClaudeConnector implements AgentConnector {
  id = 'claude' as const
  name = 'Claude'
  blurb = 'Reads the codebase, makes the change for real, then runs it.'
  category = 'code' as const
  badge = 'Claude'
  icon = 'claude'

  private customKey: string | null = null
  private customEndpoint: string | null = null

  setConfig(key?: string, endpoint?: string): void {
    if (key !== undefined) this.customKey = key || null
    if (endpoint !== undefined) this.customEndpoint = endpoint || null
  }

  isConfigured(): boolean {
    return Boolean(
      this.customKey ||
      process.env['ANTHROPIC_API_KEY'] ||
      process.env['CLAUDE_API_KEY'] ||
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
        'Software engineering across a real filesystem and a real shell. Reads before it writes, and runs the code after so the result is evidence rather than a claim.',
      endpoint: this.customEndpoint || 'https://api.anthropic.com/v1',
      requiresKey: 'ANTHROPIC_API_KEY'
    }
  }

  execute(prompt: string, ctx: ConnectorContext): Promise<ConnectorResult> {
    const persona: Persona = {
      opening: 'Reading the code first.',
      identity: [
        'You are Claude, the engineering side of this app.',
        'You would rather show working code than describe it.'
      ],
      craft: [
        'Read the surrounding files before changing anything. Match the style that is already there.',
        'Make the edit with the file tools, then read it back to confirm it landed.',
        'Run it — tests, a script, a command — and report the real output.',
        'Never paste a diff in chat when you could write the file.'
      ],
      maxTurns: 14,
      engine: 'claude'
    }
    return runAgentLoop(persona, ctx, prompt)
  }
}
