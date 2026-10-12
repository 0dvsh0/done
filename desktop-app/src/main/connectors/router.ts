import type { ConnectorId, Task } from '../../shared/types'
import type { Step } from '../integrations'

export interface RouteDecision {
  connector: ConnectorId
  /** One short line. This is shown to the user, so it is written for them. */
  reason: string
  plan: string[]
  enrichedPrompt: string
}

/* ==========================================================================
   Choosing the engine.

   This used to open a model call of its own, before any work started, purely
   to pick a connector. That was a bad trade three times over: it cost a round
   trip and a few thousand tokens on every single task, it could fail or stall
   on a rate limit before the real work had even begun, and — worst — it was
   free to choose an engine that could not do the job. Handed "what is the
   weather", it would route to a connector with no tools, which would write
   four paragraphs about weather and accomplish nothing.

   So: no model call. The choice is made here, in a few comparisons, instantly
   and for free.

   The rule that matters is capability, not vibes. A question that a service
   can answer with one request — the open issues on a repository — goes to the
   engine that holds that service's API, rather than to the local model, which
   would otherwise open a browser, wait for a client-side router to hydrate and
   read the DOM to get a structured answer by hand. That is the difference
   between delegating and doing it yourself badly.
   ========================================================================== */

interface Shape {
  connector: ConnectorId
  reason: string
  /**
   * A predicate rather than one composed regex. A regex built by splicing
   * other regexes' `.source` together silently drops grouping on any pattern
   * that is a top-level alternation, so a lookahead quietly stops looking
   * ahead after its first branch — and every request that should have been
   * delegated quietly wasn't, with no error anywhere.
   */
  matches?: (title: string) => boolean
  test?: RegExp
}

/* --------------------------------------------------------------- the shape
   of the request, worked out before any of the individual wordings. */

const REMOTE_QUESTION =
  /\b(issue|issues|pr|pull ?requests?|release|releases|commit|commits|changelog|tag|tags|stars?|forks?)\b/i

/** `owner/repo`, a github.com URL, or the word "repo" in any spelling. */
const REPO_REFERENCE =
  /(?:\b[\w.-]+\/[\w.-]+\b)|(?:github\.com)|(?:\brepos?(?:sitory|s)?\b)|(?:\bcodebase\b)/i

/** Words that mean "change something", which is local work, not a lookup. */
const LOCAL_ACTION =
  /\b(fix|write|refactor|implement|debug|compile|build|run|test|install|create|add|remove|delete|update|audit|review|security|vulnerabilit|bug|patch|migrate|rename|port|deploy)\b/i

/**
 * Ordered most-specific first. The first match wins, so a request about a
 * codebase that also says "latest" is treated as code, not as news.
 */
const SHAPES: Shape[] = [
  {
    connector: 'github',
    reason: 'That is a question about a repository, so it goes to GitHub rather than a browser.',
    matches: (t) => REMOTE_QUESTION.test(t) && REPO_REFERENCE.test(t) && !LOCAL_ACTION.test(t)
  },
  {
    connector: 'gemini',
    reason: 'It spans a lot of files, so this reads widely first.',
    test: /\b(whole repo|entire repo\w*|all (the )?files|across the (repo|codebase)|audit the (repo|codebase)|every (file|package))\b/i
  },
  {
    connector: 'claude',
    reason: 'It needs real code, changed and run.',
    test: /\b(code|coding|python|javascript|typescript|script|function|class|api|refactor|debug|bug|test|npm|repo\w*|git\b|github|compile|build|error|stack ?trace|implement)\b/i
  },
  {
    connector: 'grok',
    reason: 'It depends on what is true right now.',
    test: /\b(latest|current|today|tonight|this (week|morning)|now\b|news|weather|price|stock|score|who won|release date|live|recent|right now|search for|look up|check (the )?(web|internet))\b/i
  },
  {
    connector: 'muse',
    reason: 'It wants ideas rather than a lookup.',
    test: /\b(brainstorm|ideas?|name (it|this|them)|slogan|tagline|concept|creative|design|pitch|copy|marketing|brand|story)\b/i
  },
  {
    connector: 'chatgpt',
    reason: 'It is a question that needs working through.',
    test: /\b(analyz|analys|compare|evaluat|explain|why\b|how does|how do|break ?down|pros and cons|trade-?off|think through|prospect|calculat|math|essay|summar|draft)\b/i
  }
]

/** Every shape agrees on a title, however it was written down. */
function accepts(shape: Shape, title: string): boolean {
  return shape.matches ? shape.matches(title) : Boolean(shape.test?.test(title))
}

/**
 * Choosing where to work does not decide what the work is, so this hands back
 * an empty plan. The steps in the detail pane are the calls the agent actually
 * made, recorded as it makes them — a plan written before the run starts is a
 * guess, and a guess presented as a list of steps is worse than no list.
 */
const PLAN: string[] = []

/**
 * Picks an engine for one task. Synchronous by design: choosing where to work
 * is bookkeeping, and it should never be the slowest part of a small job.
 */
export function routeTask(task: Task, _step: Step, rootPath: string): RouteDecision {
  // An engine the user picked by hand is not second-guessed.
  if (task.connector && task.connector !== 'auto') {
    return {
      connector: task.connector,
      reason: `Running on ${label(task.connector)}, as you chose.`,
      plan: PLAN,
      enrichedPrompt: buildEnrichedPrompt(task, rootPath)
    }
  }

  const title = task.title.trim()
  for (const shape of SHAPES) {
    if (!accepts(shape, title)) continue
    return {
      connector: shape.connector,
      reason: shape.reason,
      plan: PLAN,
      enrichedPrompt: buildEnrichedPrompt(task, rootPath)
    }
  }

  // Anything unrecognised goes to the local engine, which is the one that can
  // act on the machine without needing to know in advance what kind of task
  // this is.
  return {
    connector: 'pi',
    reason: 'Starting on this machine.',
    plan: PLAN,
    enrichedPrompt: buildEnrichedPrompt(task, rootPath)
  }
}

const LABELS: Record<ConnectorId, string> = {
  auto: 'automatic routing',
  pi: 'Pi',
  grok: 'Grok',
  claude: 'Claude',
  chatgpt: 'ChatGPT',
  muse: 'Muse',
  gemini: 'Gemini',
  github: 'GitHub'
}

export const connectorLabel = (id: ConnectorId): string => LABELS[id] ?? 'Pi'

const label = (id: ConnectorId): string => LABELS[id] ?? id

function buildEnrichedPrompt(task: Task, rootPath: string): string {
  const parts = [
    task.title.trim(),
    task.when ? `Needed by: ${task.when}` : '',
    task.budget ? `Budget: ${task.budget}` : '',
    task.notes.length
      ? `What the user has said so far:\n${task.notes.map((n) => `- ${n}`).join('\n')}`
      : '',
    `This machine's working directory is ${rootPath}. Files and commands are relative to it unless the user names a path.`
  ]
  return parts.filter(Boolean).join('\n\n')
}
