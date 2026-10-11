import type { ConnectorId, Task } from '../../shared/types'
import type { Step } from '../integrations'
import { createPiModels, getPiModel } from '../pi'

export interface RouteDecision {
  connector: ConnectorId
  reason: string
  plan: string[]
  enrichedPrompt: string
}

/**
 * The Intelligent Dispatcher Brain.
 *
 * Rather than forcing every task through a single generic tool loop, our LLM
 * assesses the user's intent, enriches the prompt with context (workspace,
 * budget, constraints), and routes to the best connected agent — while
 * maintaining a calm, clean, transparent UI.
 */
export async function routeTask(
  task: Task,
  _step: Step,
  rootPath: string
): Promise<RouteDecision> {
  // If the user explicitly designated a connector, honor it directly
  if (task.connector && task.connector !== 'auto') {
    const userChoice = task.connector
    const plan = [
      `Dispatch task to ${userChoice}`,
      `Execute steps with enriched context`,
      `Verify output and generate receipt`
    ]
    return {
      connector: userChoice,
      reason: `User explicitly selected ${userChoice} connector`,
      plan,
      enrichedPrompt: buildEnrichedPrompt(task, rootPath)
    }
  }

  // Fast heuristic classification fallback if offline or prompt is clear-cut
  const titleLower = task.title.toLowerCase()
  const isCode =
    /\b(code|python|script|function|typescript|javascript|rust|refactor|debug|github|git|npm|repo|class|api|fix|bug|test)\b/.test(
      titleLower
    )
  const isRealtime =
    /\b(news|latest|current|today|sentiment|twitter|trends?|x\.com|live|recent|who is|what is|search|check now)\b/.test(
      titleLower
    )
  const isCreative =
    /\b(brainstorm|idea|name|slogan|tagline|design|pitch|concept|creative|story|spark)\b/.test(
      titleLower
    )
  const isMathOrLogic =
    /\b(calculate|math|analyze|compare|evaluate|logic|deduce|deduction|essay|breakdown|trade-off|proof)\b/.test(
      titleLower
    )
  const isWholeRepo =
    /\b(entire repo|entire repository|whole codebase|entire codebase|all \d+ packages|massive context|large repo)\b/.test(
      titleLower
    )
  const isLocalSystem =
    /\b(clipboard|ram|cpu|disk|system info|local file|screenshot|battery|chromium|browser)\b/.test(
      titleLower
    )
  const isRomaSync = /\b(roma|mcp|sync tasks?|to-do list)\b/.test(titleLower)

  let defaultConnector: ConnectorId = 'pi'
  let defaultReason = 'Dispatched to Pi Agent Core for native desktop execution'

  if (isWholeRepo) {
    defaultConnector = 'gemini'
    defaultReason = 'Dispatched to Gemini CLI for large-context whole-codebase comprehension'
  } else if (isCode) {
    defaultConnector = 'claude'
    defaultReason = 'Dispatched to Claude Code for software engineering and precision codebase changes'
  } else if (isRealtime) {
    defaultConnector = 'grok'
    defaultReason = 'Dispatched to xAI Grok for real-time web intelligence and fast live search'
  } else if (isCreative) {
    defaultConnector = 'muse'
    defaultReason = 'Dispatched to Muse Spark for divergent creative ideation and design'
  } else if (isMathOrLogic) {
    defaultConnector = 'chatgpt'
    defaultReason = 'Dispatched to ChatGPT for structured multi-step analytical reasoning'
  } else if (isRomaSync) {
    defaultConnector = 'roma'
    defaultReason = 'Dispatched to Roma MCP for cross-agent task synchronization'
  } else if (isLocalSystem) {
    defaultConnector = 'pi'
    defaultReason = 'Dispatched to Pi Agent Core for native local desktop tools'
  }

  // Next, run LLM classification pass for context enrichment & nuanced routing
  try {
    const models = createPiModels()
    const model = getPiModel()

    const classifyPrompt = [
      `You are the Intelligent Router Brain in Done, an agentic desktop app inspired by Roma, Grok Bot, and Muse Spark.`,
      `You do NOT execute tasks yourself. Your role is to determine which connected agent should receive this task:`,
      `- "claude": Best for programming, scripts, debugging, terminal, refactoring, files.`,
      `- "grok": Best for real-time search, news, live trends, Twitter/X, fast unfiltered analysis.`,
      `- "chatgpt": Best for deep multi-step reasoning, math, essays, structured analysis.`,
      `- "muse": Best for creative brainstorming, design sparks, product naming, slogans.`,
      `- "gemini": Best for huge-context whole-codebase analysis.`,
      `- "roma": Best for external to-do list sync via Model Context Protocol.`,
      `- "pi": Best for direct local OS actions (clipboard, system info, local browser).`,
      '',
      `Task: ${task.title}`,
      task.notes && task.notes.length ? `Notes: ${task.notes.join('; ')}` : '',
      '',
      `Respond with strict JSON ONLY in this format:`,
      `{"connector": "claude"|"grok"|"chatgpt"|"muse"|"gemini"|"roma"|"pi", "reason": "concise explanation", "steps": ["Step 1", "Step 2", "Step 3"]}`
    ].join('\n')

    const response = await models.streamSimple(
      model,
      {
        messages: [
          {
            role: 'user',
            content: [{ type: 'text', text: classifyPrompt }],
            timestamp: Date.now()
          }
        ]
      },
      { maxRetries: 2 }
    )

    let raw = ''
    for await (const chunk of response) {
      if (chunk.type === 'text_delta') raw += chunk.delta
    }

    const jsonMatch = raw.match(/\{[\s\S]*\}/)
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]) as {
        connector?: ConnectorId
        reason?: string
        steps?: string[]
      }
      if (parsed.connector) {
        defaultConnector = parsed.connector
      }
      if (parsed.reason) {
        defaultReason = parsed.reason
      }
      const steps = (parsed.steps ?? []).slice(0, 5)
      return {
        connector: defaultConnector,
        reason: defaultReason,
        plan: steps.length ? steps : [`Dispatch to ${defaultConnector}`, 'Execute task', 'Verify & report'],
        enrichedPrompt: buildEnrichedPrompt(task, rootPath)
      }
    }
  } catch {
    // Graceful fallback to heuristic classification
  }

  return {
    connector: defaultConnector,
    reason: defaultReason,
    plan: [
      `Route task to ${defaultConnector}`,
      `Execute steps with context`,
      `Verify result and generate receipt`
    ],
    enrichedPrompt: buildEnrichedPrompt(task, rootPath)
  }
}

function buildEnrichedPrompt(task: Task, rootPath: string): string {
  const parts = [
    `Task Goal: ${task.title}`,
    task.when ? `Deadline: ${task.when}` : '',
    task.budget ? `Budget: ${task.budget}` : '',
    `Workspace Directory: ${rootPath}`,
    task.notes && task.notes.length
      ? `User Instructions:\n${task.notes.map((n) => `- ${n}`).join('\n')}`
      : ''
  ]
  return parts.filter(Boolean).join('\n')
}
