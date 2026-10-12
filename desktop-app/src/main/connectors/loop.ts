import { Agent } from '@earendil-works/pi-agent-core'
import {
  createAssistantMessageEventStream,
  type Api,
  type AssistantMessageEvent,
  type AssistantMessageEventStream,
  type Model,
  type MutableModels,
  type SimpleStreamOptions,
  type TranscriptContext
} from '@earendil-works/pi-ai'
import type { ConnectorId } from '../../shared/types'
import type { ConnectorContext, ConnectorResult } from './types'
import { adaptToolToPi } from '../pi'
import { getEngine, localPool, type Engine } from './engines'
import { TOOLS, TOOLS_BY_NAME, catalogueText } from '../tools'
import {
  isQuotaError,
  isSpentOut,
  isUnknownModel,
  isWithdrawn,
  parseReset,
  quarantine,
  shortModel,
  withdraw
} from '../llm'
import { clip } from '../lib'

/**
 * What the agent says, as the task line wants it.
 *
 * A model writes for a terminal. The row under a task title is a sentence, and
 * it arrives carrying bold markers and list numbering that mean nothing there
 * — at 12px on a dark surface they read as a pasted document rather than as
 * something the app chose to say.
 */
function sayable(text: string, n: number): string {
  const t = String(text ?? '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/(^|[\s(])\*([^*\n]+)\*/g, '$1$2')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/^\s*\d+[.)]\s+/gm, '')
    .replace(/^\s*>\s?/gm, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return clip(t, n)
}

/* ==========================================================================
   The one loop every connector runs.

   A connector is not a different agent. It is the same agent — the same 19
   real tools, the same guardrails, the same spend cap, the same trace —
   wearing a different set of instructions about how to think.

   That distinction matters more than it sounds. Before this file, most
   connectors were a single `streamSimple` call with no tools attached: they
   could read a prompt and write prose, and nothing else. Handed "what is the
   weather", one of them searched the web, then asked the user which city they
   meant, and stopped. It could not open a browser, write a file, or run a
   command, no matter what it was asked to do.

   Here, every connector can actually do the job it was routed for, because
   every connector gets the same tools. The persona changes how the agent
   approaches the work and what it reaches for first. It never changes what it
   is able to do.
   ========================================================================== */

export interface Persona {
  /** Short line shown while the agent boots — never a whole sentence. */
  opening: string
  /** System-prompt identity and specialty. */
  identity: string[]
  /** Appended to the goal. How this persona likes to work. */
  craft: string[]
  /** Hard ceiling on turns, so a confused run still ends. */
  maxTurns: number
  /**
   * Which engine runs this persona. The id decides the model: with a key
   * configured it is that engine's own provider, and without one it is the
   * local model — which the task line then says out loud.
   */
  engine?: ConnectorId
}

/** How much of a live thought is allowed onto the task line. */
const THOUGHT_CHARS = 96

/* ==========================================================================
   Surviving the quota, mid-sentence.

   A free key runs out of daily tokens on a rolling window, and the strongest
   model here is the first to go. When it does, the run used to stop and say
   so — halfway through, with the work already done and nothing to show for it.

   This wrapper is the difference. It sits between the agent loop and the
   provider, and if a turn comes back refused for quota it starts the *same*
   turn again on the next model in the pool.

   Two details make it honest rather than a trick:

   • The opening `start` event is held back until the turn is known to be real.
     Announcing a message that then never arrives leaves the transcript holding
     an empty assistant turn, and every later turn reads as though the agent had
     decided to say nothing.

   • The handover leaves the stream entirely. It does not become a `text_delta`,
     because that would put "switching models" into the transcript as though the
     agent had written it. It is reported upward instead, and becomes a real span
     and a real sentence — so the thing you see on screen is a fact about the
     run rather than a line the agent chose to say.
   ========================================================================== */

interface StreamAttempt {
  models: MutableModels
  context: TranscriptContext
  options: SimpleStreamOptions | undefined
  /** Where to start. The model the loop asked for, by id. */
  startId: string
  pool: Model<Api>[]
  onHandover: (from: string, to: string, detail: string) => void
}

function failoverStream(attempt: StreamAttempt): AssistantMessageEventStream {
  const out = createAssistantMessageEventStream()

  const run = async (): Promise<void> => {
    // Re-read the pool on every turn rather than once at the start of the run.
    // The whole point is that it changes *during* the run, and a snapshot taken
    // before the first handover is a snapshot that still points at the model
    // that is already exhausted — so every later turn walks the same dead
    // ground before reaching the one that works.
    const live = (): Model<Api>[] =>
      attempt.pool.filter((m) => !isSpentOut(m.id) && !isWithdrawn(m.id))

    let started = false
    let queue = live()

    // Nothing left to try is a real outcome, not a crash: report it once.
    if (!queue.length) queue = attempt.pool.slice(0, 1)

    let retries = 0
    while (queue.length) {
      const model = queue[0]
      const source = attempt.models.streamSimple(model, attempt.context, {
        ...attempt.options,
        // The wrapper is the retry policy. Leaving pi's own in place means a
        // daily quota is re-attempted, and slept on, before it ever reaches
        // here — which is the exact behaviour this replaces.
        maxRetries: 0
      })

      // Held, not forwarded. See the note above.
      let pending: AssistantMessageEvent | null = null
      let refused: string | null = null
      let unknown = false
      let retrySame = false
      let final: Awaited<ReturnType<typeof source.result>> | null = null

      try {
        for await (const event of source) {
          if (event.type === 'start') {
            pending = event
            continue
          }
          if (event.type === 'error') {
            final = event.error
            const message = event.error?.errorMessage ?? ''
            if (isUnknownModel(message)) {
              unknown = true
              continue
            }
            const resetMatch = /try again in ([\d.a-z]+)/i.exec(message)?.[1]
            const wait = resetMatch ? parseReset(resetMatch) : 0
            if (wait > 0 && wait <= 10_000 && retries < 3) {
              retries++
              await new Promise((r) => setTimeout(r, wait + 300))
              retrySame = true
              break
            }
            // A refusal that a different model could answer is not an error yet.
            if (isQuotaError(message) && queue.length > 1) {
              refused = message
              continue
            }
            if (pending) out.push(pending)
            out.push(event)
            out.end(event.error)
            return
          }
          if (pending) {
            out.push(pending)
            pending = null
          }
          out.push(event)
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err)
        const resetMatch = /try again in ([\d.a-z]+)/i.exec(message)?.[1]
        const wait = resetMatch ? parseReset(resetMatch) : 0
        if (wait > 0 && wait <= 10_000 && retries < 3) {
          retries++
          await new Promise((r) => setTimeout(r, wait + 300))
          retrySame = true
        } else if (isQuotaError(message) && queue.length > 1) {
          refused = message
        } else if (isUnknownModel(message)) {
          unknown = true
        } else {
          if (pending) out.push(pending)
          out.end()
          return
        }
      }

      if (retrySame) {
        continue
      }
      retries = 0

      if (unknown) {
        // The provider has never heard of this id. It leaves the pool for the
        // rest of the session, so nothing walks into it again.
        withdraw(model.id)
        queue = live()
        continue
      }

      if (!refused) {
        const result = final ?? (await source.result())
        if (pending) out.push(pending)
        out.end(result)
        return
      }

      // Quarantined before the announcement, so anything reading the pool
      // during the callback sees the same world the retry does.
      const next = queue[1]
      quarantine(model.id, refused)
      attempt.onHandover(model.id, next.id, refused)
      started = true
      queue = live()
      if (!queue.length) break
      // Start the retry from the model we just chose, not from the top.
      queue = [next, ...queue.filter((m) => m.id !== next.id)]
    }

    void started
    out.end()
  }

  void run().catch(() => out.end())
  return out
}

/**
 * Runs one goal to completion with real tools and returns real evidence.
 *
 * Everything the caller can observe — the task line, the spans, the spend,
 * the history — comes from work that actually happened. There is no path
 * through this function that returns a result the tools did not produce.
 */
export async function runAgentLoop(
  persona: Persona,
  ctx: ConnectorContext,
  goal: string
): Promise<ConnectorResult> {
  const engine: Engine = getEngine(persona.engine ?? 'pi')
  const models = engine.models
  const model = engine.model
  const t = ctx.task

  /* The models this run may use, strongest first.
     A provider that answered for its own key — Anthropic, Google — is not
     rotated into the local pool when it runs out. That provider's quota is
     this provider's problem to solve, and quietly finishing a "Claude" task on
     a local model is precisely the claim the engine cards say this app does
     not make. */
  const pool: Model<Api>[] = engine.native
    ? [model as Model<Api>]
    : (localPool() as Model<Api>[]).filter((m) => !isSpentOut(m.id) || m.id === model.id)

  // An engine whose own provider is not configured runs on the local model.
  // The persona above says "You are Claude"; without this line the task would
  // read as though Anthropic had done the work. It is one sentence, it is
  // true, and it is the difference between a name and a claim.
  if (!engine.native) {
    ctx.setTaskLine(`${persona.opening} (No key for that provider — running locally.)`)
  } else {
    ctx.setTaskLine(persona.opening)
  }
  ctx.setTaskProgress(0.1)

  const piTools = TOOLS.map((tool) =>
    adaptToolToPi(
      tool,
      () => ({ signal: new AbortController().signal, aborted: ctx.isStopped() }),
      {
        executeOverride: async (_tool, args) => {
          await ctx.holdIfPaused()
          if (ctx.isStopped()) throw new Error('Stopped by you.')
          const outcome = await ctx.executeLocalTool(tool.name, args as Record<string, unknown>)
          return { ok: outcome.ok, output: outcome.output, data: outcome.data }
        }
      }
    )
  )

  let turns = 0
  /** The model that served the most recent turn, for the receipt and the span. */
  let live = model.id

  const agent = new Agent({
    streamFn: (m, c, opts) =>
      failoverStream({
        models,
        context: c,
        options: opts,
        startId: m.id,
        pool,
        onHandover: (from, to, detail) => {
          live = to
          ctx.onHandover?.(from, to, detail)
        }
      }),
    maxRetryDelayMs: 15_000,
    initialState: {
      model,
      systemPrompt: [
        ...persona.identity,
        '',
        'You are running inside Done., a desktop app. You have real tools: a real',
        'browser, a real shell, and the real filesystem.',
        '',
        'RULES',
        '1. If a task needs action, searching, reading, writing or checking, call a',
        '   tool. Talking about what you would do is not doing it.',
        '2. Never claim something happened unless a tool result in this conversation',
        '   says it did.',
        '3. Keep going until the goal is met. If you genuinely cannot finish, say',
        '   plainly what is missing rather than describing a plan.',
        '4. Be concise. Short sentences. No preamble.'
      ].join('\n'),
      tools: piTools
    },
    finishTurn: () => {
      turns += 1
      if (turns >= persona.maxTurns) return { action: 'end' }
      return undefined
    },
    beforeToolCall: async ({ toolCall, args }) => {
      await ctx.holdIfPaused()
      if (ctx.isStopped()) {
        return { block: true, terminate: true, reason: 'Stopped by you.' }
      }

      const tool = TOOLS_BY_NAME.get(toolCall.name)
      if (tool?.irreversible) {
        const verdict = await ctx.askPermission(tool, (args ?? {}) as Record<string, unknown>)
        if (ctx.isStopped() || !verdict.approved) {
          return { block: true, reason: 'You declined this one, so it was not run.' }
        }
      }

      if (!(await ctx.checkSpend())) {
        return { block: true, terminate: true, reason: 'Spend budget reached.' }
      }
      return undefined
    }
  })

  /* The task line is the calmest sentence in the app. It gets the agent's own
     current thought, but only once a word is finished — half a token reads as
     a glitch rather than as progress, and a line that rewrites itself twenty
     times a second stops being readable at all. */
  let buffer = ''

  const onDelta = (delta: string): void => {
    buffer += delta
    const cut = buffer.lastIndexOf(' ')
    if (cut === -1) return
    const complete = buffer.slice(0, cut).trim()
    buffer = buffer.slice(cut + 1)
    if (complete) ctx.setTaskLine(sayable(complete, THOUGHT_CHARS))
  }

  agent.subscribe((event) => {
    if (event.type === 'message_update') {
      const inner = event.assistantMessageEvent
      if (inner.type === 'thinking_delta' || inner.type === 'text_delta') onDelta(inner.delta)
      return
    }

    if (event.type === 'tool_execution_start') {
      buffer = ''
      ctx.setTaskLine(`Running ${event.toolName.replace(/_/g, ' ')}…`)
      return
    }

    if (event.type === 'tool_execution_end') {
      buffer = ''
      ctx.setTaskProgress(Math.min(0.92, t.progress + 0.1))
      return
    }

    if (event.type === 'turn_end') {
      const msg = event.message as {
        usage?: {
          input?: number
          output?: number
          reasoning?: number
          cost?: number | { total?: number }
        }
      }
      if (!msg?.usage) return
      const cost =
        typeof msg.usage.cost === 'number' ? msg.usage.cost : (msg.usage.cost?.total ?? 0)
      ctx.charge({
        input: msg.usage.input ?? 0,
        output: msg.usage.output ?? 0,
        reasoning: msg.usage.reasoning ?? 0,
        cost
      })
      // Recorded, not just traced. A span that only reaches the tracer is a
      // span the trace sheet, the receipt's token count and the economics
      // sheet never see — the turn happened and the app has no record of it.
      void ctx
        .step(
          {
            kind: 'LLM',
            name: 'agent_turn',
            input: clip(goal, 60),
            // The weights that actually ran, not the ones the run started on.
            // These are the same string the receipt will carry, read from the
            // same variable, so the two can never drift.
            output: `${shortModel(live)} · ${msg.usage.input ?? 0} in · ${msg.usage.output ?? 0} out`,
            cost,
            tokens: [msg.usage.input ?? 0, msg.usage.output ?? 0]
          },
          async () => 'turn complete'
        )
        .then((span) => ctx.addSpans([span]))
    }
  })

  const prompt = [
    `Goal: ${goal}`,
    '',
    ...(persona.craft.length ? ['How to approach it:', ...persona.craft] : []),
    '',
    'The tools you can use:',
    catalogueText(TOOLS),
    '',
    'Start now. Use the tools.'
  ]
    .filter(Boolean)
    .join('\n')

  ctx.setLiveAgent(agent)
  try {
    await agent.prompt(prompt)
  } catch (err: unknown) {
    ctx.setLiveAgent(null)
    if (ctx.isStopped()) return { ok: false, summary: 'Stopped by you.', detail: '' }
    throw new Error(err instanceof Error ? err.message : String(err))
  }
  ctx.setLiveAgent(null)

  if (ctx.isStopped()) return { ok: false, summary: 'Stopped by you.', detail: '' }

  const last = agent.state.messages.filter((m) => m.role === 'assistant').pop() as
    { content?: Array<{ type?: string; text?: string }> } | undefined
  const said = last?.content?.find((c) => c.type === 'text')?.text?.trim() ?? ''

  ctx.setTaskProgress(0.95)

  return {
    ok: true,
    summary: sayable(said, 200) || 'Done.',
    detail: said,
    model: live
  }
}

/** Shared tail so every connector reports the same thing the same way. */
export function personaUsage(): string {
  return `${TOOLS.length} native tools`
}
