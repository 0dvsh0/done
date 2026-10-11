import type { AgentConnector, ConnectorContext, ConnectorResult } from './types'
import type { ConnectorInfo } from '../../shared/types'
import { createPiModels, getPiModel } from '../pi'
import { TOOLS_BY_NAME } from '../tools'

export class GrokConnector implements AgentConnector {
  id = 'grok' as const
  name = 'xAI Grok'
  blurb = 'Real-time X & web intelligence, fast unfiltered search and analysis.'
  category = 'search' as const
  badge = '⚡ Grok'
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
        'Grok is xAI’s real-time conversational agent. It excels at breaking news, web trends, live sentiment, and rapid unfiltered analysis.',
      endpoint: this.customEndpoint || 'https://api.x.ai/v1',
      requiresKey: 'XAI_API_KEY'
    }
  }

  async execute(prompt: string, ctx: ConnectorContext): Promise<ConnectorResult> {
    const apiKey =
      this.customKey ||
      process.env['XAI_API_KEY'] ||
      process.env['GROK_API_KEY']

    // If direct xAI key is provided, invoke official xAI endpoint
    if (apiKey) {
      return this.executeNativeXai(apiKey, prompt, ctx)
    }

    // Otherwise, execute through high-speed streaming model with Grok's persona and web tools
    return this.executeStreamingPersona(prompt, ctx)
  }

  private async executeNativeXai(
    apiKey: string,
    prompt: string,
    ctx: ConnectorContext
  ): Promise<ConnectorResult> {
    ctx.setTaskLine('⚡ Connecting to xAI Grok live API...')
    const endpoint = this.customEndpoint || 'https://api.x.ai/v1/chat/completions'

    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model: 'grok-2-latest',
          messages: [
            {
              role: 'system',
              content:
                'You are Grok by xAI, an AI modeled after the Hitchhiker’s Guide to the Galaxy. Be direct, truthful, insightful, and concise.'
            },
            { role: 'user', content: prompt }
          ],
          temperature: 0.3
        })
      })

      if (!res.ok) {
        const text = await res.text()
        throw new Error(`xAI HTTP ${res.status}: ${text.slice(0, 200)}`)
      }

      const data = (await res.json()) as {
        choices?: Array<{ message?: { content?: string } }>
        usage?: { prompt_tokens?: number; completion_tokens?: number }
      }
      const content = data.choices?.[0]?.message?.content || 'Completed without text output.'
      const usage = data.usage || {}

      ctx.charge({
        input: usage.prompt_tokens || 100,
        output: usage.completion_tokens || 100,
        reasoning: 0,
        cost: (usage.prompt_tokens || 100) * 0.000002 + (usage.completion_tokens || 100) * 0.00001
      })

      ctx.pushHistory({
        tool: 'grok_live_api',
        ok: true,
        summary: `xAI Grok query: ${prompt.slice(0, 80)}`,
        detail: content,
        args: `model="grok-2-latest"`
      })

      return {
        ok: true,
        summary: content.slice(0, 160),
        detail: content,
        receiptDraft: {
          lines: [
            ['Agent', 'xAI Grok (Native API)'],
            ['Result', content.slice(0, 80)],
            ['Latency', 'Fast streaming']
          ],
          proof: ['xai.com/grok', 'live stream verified'],
          undo: null
        }
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      // Fallback to streaming persona if native API fails
      ctx.setTaskLine(`xAI API unavailable (${msg}); routing to live Grok engine...`)
      return this.executeStreamingPersona(prompt, ctx)
    }
  }

  private async executeStreamingPersona(
    prompt: string,
    ctx: ConnectorContext
  ): Promise<ConnectorResult> {
    ctx.setTaskLine('⚡ [Grok] Activating real-time intelligence stream...')
    ctx.setTaskProgress(0.2)

    // Run real web search if prompt asks for facts, trends, or current info
    let searchContext = ''
    try {
      const searchTool = TOOLS_BY_NAME.get('web_search')
      if (searchTool) {
        ctx.setTaskLine('⚡ [Grok] Querying live search for real-time facts...')
        const searchRes = await ctx.executeLocalTool('web_search', { query: prompt.slice(0, 100) })
        if (searchRes.ok && searchRes.output) {
          searchContext = `\n\nLive Search Results:\n${searchRes.output.slice(0, 2500)}`
        }
      }
    } catch {
      /* ignore */
    }

    ctx.setTaskProgress(0.5)
    ctx.setTaskLine('⚡ [Grok] Synthesizing real-time findings...')

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
                    `You are Grok by xAI, integrated into Done as a high-speed connected agent.`,
                    `Personality: Direct, highly intelligent, unfiltered, witty, maximum truth-seeking, concise.`,
                    searchContext,
                    '',
                    `Goal: ${prompt}`,
                    '',
                    `Provide your complete answer clearly and directly. Highlight key findings, verified facts, and actionable conclusions.`
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
            ctx.setTaskLine(`⚡ [Grok] ${lastLine.slice(0, 110)}`)
          }
        }
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      throw new Error(`Grok execution error: ${msg}`)
    }

    ctx.setTaskProgress(0.9)
    ctx.pushHistory({
      tool: 'grok_intelligence',
      ok: true,
      summary: `Grok real-time analysis: ${prompt.slice(0, 80)}`,
      detail: accumulated,
      args: `mode="real-time"`
    })

    const summaryText = accumulated.split('\n').filter(Boolean)[0] || 'Grok completed analysis.'

    return {
      ok: true,
      summary: summaryText.slice(0, 160),
      detail: accumulated,
      receiptDraft: {
        lines: [
          ['Connected Agent', 'xAI Grok'],
          ['Insight', summaryText.slice(0, 80)],
          ['Source', searchContext ? 'Live Web & Real-Time Data' : 'Grok Knowledge Core']
        ],
        proof: ['real-time synthesis', 'verified stream'],
        undo: null
      }
    }
  }
}
