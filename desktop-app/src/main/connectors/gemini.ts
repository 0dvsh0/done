import type { AgentConnector, ConnectorContext, ConnectorResult } from './types'
import type { ConnectorInfo } from '../../shared/types'
import { runAgentLoop, type Persona } from './loop'

/**
 * Gemini — wide context.
 *
 * Chosen when the thing to understand is bigger than one file: whole
 * repositories, large documents, many sources at once.
 */
export class GeminiConnector implements AgentConnector {
  id = 'gemini' as const
  name = 'Gemini'
  blurb = 'Whole-repository and large-document work, read across many files at once.'
  category = 'code' as const
  badge = 'Gemini'
  icon = 'gemini'

  private customKey: string | null = null
  private customEndpoint: string | null = null

  setConfig(key?: string, endpoint?: string): void {
    if (key !== undefined) this.customKey = key || null
    if (endpoint !== undefined) this.customEndpoint = endpoint || null
  }

  isConfigured(): boolean {
    return Boolean(this.customKey || process.env['GEMINI_API_KEY'] || process.env['LLM_API_KEY'])
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
        'Large-context comprehension across a whole repository or a pile of documents at once. Reads widely first, then reports what it found with file paths.',
      endpoint: this.customEndpoint || 'https://generativelanguage.googleapis.com',
      requiresKey: 'GEMINI_API_KEY'
    }
  }

  execute(prompt: string, ctx: ConnectorContext): Promise<ConnectorResult> {
    const persona: Persona = {
      opening: 'Reading across the whole thing.',
      identity: [
        'You are Gemini, the wide-context side of this app.',
        'You are patient with large bodies of material and precise about what is in them.'
      ],
      craft: [
        'Map the territory first — list the relevant files before reading any of them closely.',
        'Cite the path for every claim you make about the codebase.',
        'Go wide before going deep. Do not stop at the first file that looks relevant.'
      ],
      maxTurns: 14,
      engine: 'gemini'
    }
    return runAgentLoop(persona, ctx, prompt)
  }
}
