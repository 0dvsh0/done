import type { AgentConnector, ConnectorContext, ConnectorResult } from './types'
import type { ConnectorInfo } from '../../shared/types'
import { createPiModels, getPiModel } from '../pi'

export class MuseConnector implements AgentConnector {
  id = 'muse' as const
  name = 'Muse Spark'
  blurb = 'Paste the prompt; Muse does the rest. Creative ideation, design sparks, and product concepts.'
  category = 'creative' as const
  badge = '✦ Muse'
  icon = 'muse'

  private customKey: string | null = null
  private customEndpoint: string | null = null

  setConfig(key?: string, endpoint?: string): void {
    if (key !== undefined) this.customKey = key || null
    if (endpoint !== undefined) this.customEndpoint = endpoint || null
  }

  isConfigured(): boolean {
    return Boolean(
      this.customKey ||
      process.env['MUSE_API_KEY'] ||
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
        'Muse Spark is a design and ideation engine. It excels at divergent brainstorming, rapid concept generation, product naming, and visual prompts.',
      endpoint: this.customEndpoint || 'https://muse.app/api',
      requiresKey: 'MUSE_API_KEY'
    }
  }

  async execute(prompt: string, ctx: ConnectorContext): Promise<ConnectorResult> {
    ctx.setTaskLine('✦ [Muse Spark] Sparking creative ideation...')
    ctx.setTaskProgress(0.2)

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
                    `You are Muse Spark, a creative AI agent integrated into Done.`,
                    `Specialty: Unconventional brainstorming, memorable product naming, aesthetic UX concepts, and punchy design direction.`,
                    '',
                    `Creative Goal: ${prompt}`,
                    '',
                    `Provide 3 to 5 striking, distinct concepts with titles, taglines, and rationale. Make each concept bold, original, and actionable.`
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
            ctx.setTaskLine(`✦ [Muse Spark] ${lastLine.slice(0, 110)}`)
          }
        }
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      throw new Error(`Muse Spark execution error: ${msg}`)
    }

    ctx.setTaskProgress(0.95)
    ctx.pushHistory({
      tool: 'muse_spark',
      ok: true,
      summary: `Muse Spark generated creative concepts: ${prompt.slice(0, 80)}`,
      detail: accumulated,
      args: 'spark_mode="divergent"'
    })

    const summaryLine = accumulated.split('\n').filter(Boolean)[0] || 'Muse Spark concepts generated.'

    return {
      ok: true,
      summary: summaryLine.slice(0, 160),
      detail: accumulated,
      receiptDraft: {
        lines: [
          ['Connected Agent', 'Muse Spark'],
          ['Output', summaryLine.slice(0, 80)],
          ['Style', 'Divergent creative concepts']
        ],
        proof: ['muse.app/spark', 'creative synthesis'],
        undo: null
      }
    }
  }
}
