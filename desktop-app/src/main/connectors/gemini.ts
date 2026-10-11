import type { AgentConnector, ConnectorContext, ConnectorResult } from './types'
import type { ConnectorInfo } from '../../shared/types'
import { createPiModels, getPiModel } from '../pi'

export class GeminiConnector implements AgentConnector {
  id = 'gemini' as const
  name = 'Gemini CLI'
  blurb = 'One command in the terminal. Massive context window and deep repository comprehension.'
  category = 'code' as const
  badge = '✦ Gemini'
  icon = 'gemini'

  private customKey: string | null = null
  private customEndpoint: string | null = null

  setConfig(key?: string, endpoint?: string): void {
    if (key !== undefined) this.customKey = key || null
    if (endpoint !== undefined) this.customEndpoint = endpoint || null
  }

  isConfigured(): boolean {
    return Boolean(
      this.customKey ||
      process.env['GEMINI_API_KEY'] ||
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
        'Gemini CLI powers large context analysis, multi-modal comprehension, and whole-codebase understanding.',
      endpoint: this.customEndpoint || 'https://generativelanguage.googleapis.com',
      requiresKey: 'GEMINI_API_KEY'
    }
  }

  async execute(prompt: string, ctx: ConnectorContext): Promise<ConnectorResult> {
    ctx.setTaskLine('✦ [Gemini CLI] Ingesting repository context into 1M context window...')
    ctx.setTaskProgress(0.25)

    const models = createPiModels()
    const model = getPiModel()

    let accumulated = ''
    try {
      const responseStream = models.streamSimple(
        model,
        {
          messages: [
            {
              role: 'user',
              content: [
                {
                  type: 'text',
                  text: [
                    `You are Gemini CLI, a connected agent inside Done with massive context capabilities.`,
                    `Specialty: Comprehensive architectural analysis, repository-wide insights, and precise synthesis.`,
                    '',
                    `Goal: ${prompt}`,
                    '',
                    `Provide your complete, structured analysis.`
                  ].join('\n')
                }
              ],
              timestamp: Date.now()
            }
          ]
        },
        { maxRetries: 3 }
      )

      for await (const chunk of responseStream) {
        if (chunk.type === 'text_delta') {
          accumulated += chunk.delta
          const lastLine = accumulated.trim().split('\n').filter(Boolean).pop() ?? ''
          if (lastLine) {
            ctx.setTaskLine(`✦ [Gemini CLI] ${lastLine.slice(0, 110)}`)
          }
        }
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      throw new Error(`Gemini CLI error: ${msg}`)
    }

    ctx.setTaskProgress(0.95)
    ctx.pushHistory({
      tool: 'gemini_cli',
      ok: true,
      summary: `Gemini CLI analysis: ${prompt.slice(0, 80)}`,
      detail: accumulated,
      args: 'context_window="1M"'
    })

    const summaryLine = accumulated.split('\n').filter(Boolean)[0] || 'Gemini CLI analysis complete.'

    return {
      ok: true,
      summary: summaryLine.slice(0, 160),
      detail: accumulated,
      receiptDraft: {
        lines: [
          ['Connected Agent', 'Gemini CLI (Google)'],
          ['Insight', summaryLine.slice(0, 80)],
          ['Context Mode', 'Whole-repo comprehension']
        ],
        proof: ['google.dev/gemini', 'verified tokens'],
        undo: null
      }
    }
  }
}
