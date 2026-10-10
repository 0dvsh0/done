import type { AppState, SpanRecord, Task } from '../../../shared/types'
import { cx, duration, tiny } from '../lib/format'
import { useUI } from '../store'
import * as I from './Icons'
import { Button, Sheet } from './primitives'

const KIND_COLOUR: Record<string, string> = {
  WORKFLOW: 'text-fg',
  AGENT: 'text-fg-2',
  LLM: 'text-needs/90',
  TOOL: 'text-fg-2',
  RETRIEVER: 'text-fg-2',
  GUARDRAIL: 'text-calm',
  CHAIN: 'text-fg-3'
}

/**
 * The same spans the sentences were rendered from, laid out as a tree.
 * This is the "underneath" layer with the lid off.
 */
export function TraceSheet({
  task,
  state,
  onClose
}: {
  task: Task
  state: AppState
  onClose: () => void
}): React.JSX.Element {
  const spans = state.spans[task.id] ?? []
  const max = Math.max(1, ...spans.map((s) => s.durationMs))
  const total = spans.reduce((a, s) => a + s.durationMs, 0)
  const tokens = spans.reduce((a, s) => a + (s.tokens ? s.tokens.input + s.tokens.output : 0), 0)
  const cost = spans.reduce((a, s) => a + (s.cost ?? 0), 0)
  const connected = state.integrations.neatlogs.connected
  // A task carried over from an earlier session keeps its story but not its
  // spans. Say so rather than quietly showing a shorter tree.
  const carried = Math.max(0, task.story.length - spans.length)

  return (
    <Sheet
      open
      onClose={onClose}
      title={task.title}
      subtitle={`One run, ${spans.length} ${spans.length === 1 ? 'span' : 'spans'}. Every sentence above came from one of these.`}
      width={660}
      footer={
        <div className="flex items-center gap-3">
          <span className="num text-[11.5px] text-fg-4">
            {spans.length} {spans.length === 1 ? 'span' : 'spans'} · {duration(total)} ·{' '}
            {tokens ? `${(tokens / 1000).toFixed(1)}k tokens` : 'no model tokens'} · {tiny(cost)}
          </span>
          <div className="ml-auto flex items-center gap-2">
            <Button
              size="sm"
              variant="quiet"
              onClick={() => {
                void navigator.clipboard?.writeText(
                  JSON.stringify({ workflow: task.title, spans }, null, 2)
                )
              }}
            >
              Copy JSON
            </Button>
            <Button
              size="sm"
              onClick={() => void window.done.openExternal('https://app.neatlogs.com')}
            >
              {connected ? 'Open in neatlogs' : 'neatlogs'}
              <I.External className="[&_svg]:h-[12px] [&_svg]:w-[12px]" />
            </Button>
          </div>
        </div>
      }
    >
      <div className="pb-4">
        <div className="mb-3 flex items-center gap-2 rounded-[9px] border border-line bg-ink-0/60 px-3 py-2">
          <span className="text-[11px] text-fg-4">workflow</span>
          <span className="truncate font-mono text-[11.5px] text-fg-2">{task.title}</span>
          <span
            className={cx(
              'num ml-auto shrink-0 text-[11px]',
              connected ? 'text-calm' : 'text-fg-5'
            )}
          >
            {connected ? 'exported' : 'local only'}
          </span>
        </div>

        {spans.length === 0 ? (
          <p className="py-8 text-center text-[13px] text-fg-4">
            This task hasn’t run a step in this session yet.
          </p>
        ) : (
          <ul className="space-y-px">
            {spans.map((s) => (
              <SpanRow key={s.id} span={s} max={max} />
            ))}
          </ul>
        )}

        {carried > 0 && (
          <p className="mt-3 border-t border-line pt-3 text-[11.5px] leading-relaxed text-fg-5">
            {carried} earlier {carried === 1 ? 'step was' : 'steps were'} carried over from your
            last session, so {carried === 1 ? 'it is' : 'they are'} in the story but not in this
            trace.
          </p>
        )}
      </div>
    </Sheet>
  )
}

function SpanRow({ span, max }: { span: SpanRecord; max: number }): React.JSX.Element {
  const showTrace = useUI((s) => s.showTrace)
  const width = Math.max(2, (span.durationMs / max) * 100)

  return (
    <li
      className="group grid grid-cols-[52px_1fr_auto] items-start gap-x-3 rounded-[7px] px-2 py-[7px] transition-colors hover:bg-white/[0.03]"
      title="Click to highlight this step in the story"
      onClick={() => {
        useUI.setState({ under: true })
        showTrace(null)
      }}
    >
      <span className={cx('num pt-[1px] text-[10px] tracking-[0.04em]', KIND_COLOUR[span.kind])}>
        {span.kind}
      </span>

      <div className="min-w-0">
        <div className="flex items-baseline gap-2">
          <span className="font-mono text-[12px] text-fg">{span.name}</span>
          {span.input && (
            <span className="truncate font-mono text-[11px] text-fg-5">({span.input})</span>
          )}
        </div>
        <div className="mt-1 h-[2px] w-full overflow-hidden rounded-full bg-white/[0.05]">
          <div
            className={cx(
              'h-full rounded-full',
              span.status === 'error'
                ? 'bg-snag/70'
                : span.status === 'recovered'
                  ? 'bg-calm/70'
                  : 'bg-fg-4'
            )}
            style={{ width: `${width}%` }}
          />
        </div>
        <div className="mt-1 flex items-baseline gap-2 text-[11px]">
          <span className="truncate text-fg-3">{span.output}</span>
          {span.tokens && (
            <span className="num shrink-0 text-fg-5">
              {span.tokens.input + span.tokens.output} tok
            </span>
          )}
          {span.cost != null && <span className="num shrink-0 text-fg-5">{tiny(span.cost)}</span>}
        </div>
      </div>

      <div className="flex flex-col items-end gap-1 pt-[1px]">
        <span className="num text-[11px] text-fg-3">{duration(span.durationMs)}</span>
        {span.status !== 'ok' && (
          <span
            className={cx(
              'rounded-[4px] px-1 py-[1px] text-[9.5px] tracking-[0.04em] uppercase',
              span.status === 'error' ? 'bg-snag/12 text-snag' : 'bg-calm/12 text-calm'
            )}
          >
            {span.status}
          </span>
        )}
      </div>
    </li>
  )
}
