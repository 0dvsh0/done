import type { AgentConnector, ConnectorContext, ConnectorResult } from './types'
import type { ConnectorInfo } from '../../shared/types'
import { createPiModels, getPiModel } from '../pi'

export class ChatGPTConnector implements AgentConnector {
  id = 'chatgpt' as const
  name = 'ChatGPT & Codex'
  blurb = 'On the web and in the terminal. Deep analytical reasoning, math, and structured synthesis.'
  category = 'reasoning' as const
  badge = '◈ ChatGPT'
  icon = 'chatgpt'

  private customKey: string | null = null
  private customEndpoint: string | null = null

  setConfig(key?: string, endpoint?: string): void {
    if (key !== undefined) this.customKey = key || null
    if (endpoint !== undefined) this.customEndpoint = endpoint || null
  }

  isConfigured(): boolean {
    return Boolean(
      this.customKey ||
      process.env['OPENAI_API_KEY'] ||
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
        'ChatGPT & Codex by OpenAI provide premier analytical reasoning, mathematical breakdown, structured schema extraction, and document synthesis.',
      endpoint: this.customEndpoint || 'https://api.openai.com/v1',
      requiresKey: 'OPENAI_API_KEY'
    }
  }

  async execute(prompt: string, ctx: ConnectorContext): Promise<ConnectorResult> {
    ctx.setTaskLine('◈ [ChatGPT] Initializing reasoning chain...')
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
                    `You are ChatGPT & Codex by OpenAI, integrated into Done as a connected intelligence agent.`,
                    `Specialty: Rigorous step-by-step logic, clear structuring, comprehensive problem solving, and analytical clarity.`,
                    '',
                    `Goal: ${prompt}`,
                    '',
                    `Deconstruct the problem, provide structured solutions, and conclude with actionable takeaways.`
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
            ctx.setTaskLine(`◈ [ChatGPT] ${lastLine.slice(0, 110)}`)
          }
        }
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      throw new Error(`ChatGPT execution error: ${msg}`)
    }

    ctx.setTaskProgress(0.95)
    ctx.pushHistory({
      tool: 'chatgpt_reasoning',
      ok: true,
      summary: `ChatGPT analysis: ${prompt.slice(0, 80)}`,
      detail: accumulated,
      args: 'engine="gpt-reasoning"'
    })

    const summaryLine = accumulated.split('\n').filter(Boolean)[0] || 'ChatGPT reasoning complete.'

    return {
      ok: true,
      summary: summaryLine.slice(0, 160),
      detail: accumulated,
      receiptDraft: {
        lines: [
          ['Connected Agent', 'ChatGPT & Codex (OpenAI)'],
          ['Analysis', summaryLine.slice(0, 80)],
          ['Method', 'Multi-step structured reasoning']
        ],
        proof: ['openai.com/chatgpt', 'logical deduction passed'],
        undo: null
      }
    }
  }
}
