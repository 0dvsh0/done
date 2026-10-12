import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useRef, useState } from 'react'
import type { AppState, Ask, Task } from '../../../shared/types'
import { clock, connectorLabel, cx, minutes, money } from '../lib/format'
import { api, groupNames, toast, useUI } from '../store'
import { Dot } from './Dot'
import { GroupPicker } from './GroupPicker'
import * as I from './Icons'
import { Button, IconButton, SectionLabel, Switch } from './primitives'

const STATE_WORD: Record<Task['state'], string> = {
  waiting: 'Waiting to start',
  working: 'On it',
  needs: 'Needs you',
  snag: 'Hit a snag · trying another way',
  paused: 'Paused',
  you: "You're doing this one",
  done: 'Done',
  stopped: 'Stopped'
}

export function Detail({ task, state }: { task: Task; state: AppState }): React.JSX.Element {
  const closeTask = useUI((s) => s.closeTask)
  const under = useUI((s) => s.under)
  const toggleUnder = useUI((s) => s.toggleUnder)
  const showTrace = useUI((s) => s.showTrace)
  const [steering, setSteering] = useState(false)
  const [steerText, setSteerText] = useState('')
  const [steeredFor, setSteeredFor] = useState<string | null>(null)
  const steerRef = useRef<HTMLInputElement>(null)

  // The pane stays mounted as you move between tasks, so the steering field
  // resets by comparing ids during render rather than in an effect. (React's
  // documented "adjusting state when a prop changes" pattern.)
  if (steeredFor !== null && steeredFor !== task.id) {
    setSteeredFor(null)
    setSteering(false)
    setSteerText('')
  }

  useEffect(() => {
    if (steering) steerRef.current?.focus()
  }, [steering])

  const live = task.state === 'working' || task.state === 'snag' || task.state === 'waiting'
  const finished = task.state === 'done' || task.state === 'stopped'
  const spans = state.spans[task.id] ?? []

  /* One sentence was carrying four different kinds of fact at the same weight
     and the same grey: when it started, how far it has got, when it is due and
     what it may cost. Broken into a labelled grid each one is scannable on its
     own, and adding a fifth no longer means running the line off the pane. */
  const engine = task.routedConnector || task.connector
  const facts: [string, string][] = []
  if (finished) {
    facts.push(['Finished', task.finishedAt ? clock(task.finishedAt) : '—'])
    facts.push(['Took', minutes(task.receipt?.tookMinutes ?? 1)])
  } else {
    facts.push(['Started', clock(task.created)])
    // Only when there is something to count. "step 1 of 0" is exactly the kind
    // of thing that makes an app look like it has not finished loading.
    if (task.plan.length) {
      facts.push(['Step', `${task.planIdx || task.plan.length} of ${task.plan.length}`])
    }
    if (task.when) facts.push(['Needed by', task.when])
    if (task.budget) facts.push(['Ceiling', task.budget])
  }
  if (engine && engine !== 'auto') facts.push(['Engine', connectorLabel(engine)])

  return (
    <motion.aside
      initial={{ x: 24, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      exit={{ x: 18, opacity: 0 }}
      transition={{ duration: 0.32, ease: [0.16, 1, 0.3, 1] }}
      className="flex h-full w-[452px] shrink-0 flex-col border-l border-line bg-ink-0"
      aria-label={`${task.title} — details`}
    >
      {/* header */}
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-line px-3">
        <span
          className={cx(
            'text-[11px] font-medium tracking-[0.05em] uppercase',
            task.state === 'needs'
              ? 'text-needs'
              : task.state === 'snag'
                ? 'text-snag'
                : 'text-fg-3'
          )}
        >
          {STATE_WORD[task.state]}
        </span>
        <button
          type="button"
          onClick={() => showTrace(task.id)}
          className="num no-drag rounded-[5px] px-1 py-[1px] text-[10.5px] text-fg-4 transition-colors hover:bg-veil hover:text-fg-2"
        >
          {spans.length} {spans.length === 1 ? 'span' : 'spans'}
        </button>
        <div className="ml-1.5">
          <IconButton label="Close details (Esc)" onClick={closeTask} size={26}>
            <I.Close />
          </IconButton>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {/* ---- identity: the one thing this pane is about, and nothing else */}
        <div className="flex items-start gap-3 px-6 pt-5 pb-4">
          <Dot state={task.state} progress={task.progress} size={21} className="mt-[5px]" />
          <h2 className="voice min-w-0 flex-1 text-[19px] leading-[1.3] text-fg">{task.title}</h2>
        </div>

        {task.ask && (
          <div className="px-6 pb-4">
            <AnimatePresence>
              <AskCard key={task.ask.id} task={task} ask={task.ask} />
            </AnimatePresence>
          </div>
        )}

        {/* ---- status: where it is right now, and the facts around it, in one
                surface. Previously the sentence, the meta line and a row of
                group chips floated as three unrelated things on the pane's
                background, which is what made the whole column read as a
                cluster. */}
        <section className="px-6">
          <div className="rounded-[12px] border border-line bg-ink-1 px-4 py-3.5">
            <NowLine task={task} />

            <dl className="mt-3 grid grid-cols-2 gap-x-5 gap-y-2 border-t border-line pt-3">
              {facts.map(([k, v]) => (
                <div key={k} className="min-w-0">
                  <dt className="text-[10.5px] tracking-[0.05em] text-fg-4 uppercase">{k}</dt>
                  <dd className="mt-0.5 truncate text-[12.5px] text-fg-2">{v}</dd>
                </div>
              ))}
            </dl>

            <div className="mt-3.5 border-t border-line pt-3">
              <div className="mb-2 text-[10.5px] tracking-[0.05em] text-fg-4 uppercase">
                Filed under
              </div>
              <GroupPicker
                value={task.group}
                groups={groupNames(state)}
                onChange={(next) => {
                  void api.setGroup(task.id, next)
                  if (next) toast(`Filed under ${next}.`, true)
                }}
              />
            </div>
          </div>
        </section>

        {/* ---- controls: a bar of its own, between the two cards, so the eye
                has a horizontal edge to stop at rather than four buttons
                floating in the gap. */}
        {!finished && (
          <div className="mt-4 border-y border-line bg-mark px-6 py-2.5">
            <div className="flex items-center gap-1.5">
              <Ctl
                icon={task.state === 'paused' ? <I.Play /> : <I.Pause />}
                label={task.state === 'paused' ? 'Resume' : 'Pause'}
                kbd="Space"
                onClick={() => void api.control(task.id, 'pause')}
                disabled={!live && task.state !== 'paused'}
                on={task.state === 'paused'}
              />
              <Ctl
                icon={<I.Steer />}
                label="Steer"
                kbd="S"
                dataSteer
                onClick={() => {
                  setSteeredFor(task.id)
                  setSteering((v) => !v)
                }}
                on={steering}
                disabled={task.state === 'you'}
              />
              <Ctl
                icon={<I.Hand />}
                label={task.state === 'you' ? 'Hand back' : 'Take over'}
                kbd="T"
                onClick={() => void api.control(task.id, 'take')}
                on={task.state === 'you'}
              />
              <Ctl
                icon={<I.Stop />}
                label="Stop"
                onClick={() => {
                  void api.control(task.id, 'stop')
                  toast('Stopped. Nothing was changed.', true)
                }}
                className="ml-auto"
              />
            </div>

            <AnimatePresence initial={false}>
              {steering && (
                <motion.form
                  initial={{ height: 0, opacity: 0, marginTop: 0 }}
                  animate={{ height: 'auto', opacity: 1, marginTop: 10 }}
                  exit={{ height: 0, opacity: 0, marginTop: 0 }}
                  transition={{ duration: 0.26, ease: [0.16, 1, 0.3, 1] }}
                  className="overflow-hidden"
                  onSubmit={(e) => {
                    e.preventDefault()
                    const v = steerText.trim()
                    if (!v) return
                    void api.steer(task.id, v)
                    setSteerText('')
                    setSteeredFor(null)
                    setSteering(false)
                    toast('Told it. It’ll hold that from here.')
                  }}
                >
                  <div className="flex items-center gap-2 rounded-[10px] border border-line-2 bg-ink-1 px-3 py-2">
                    <input
                      ref={steerRef}
                      value={steerText}
                      maxLength={120}
                      placeholder="Say what to change — “cheaper”, “not Fridays”…"
                      onChange={(e) => setSteerText(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key !== 'Escape') return
                        setSteeredFor(null)
                        setSteering(false)
                      }}
                      className="min-w-0 flex-1 bg-transparent text-[13px] "
                    />
                    <button
                      type="submit"
                      disabled={!steerText.trim()}
                      className="no-drag rounded-[6px] bg-fg px-2 py-1 text-[12px] font-medium text-ink-0 transition-opacity disabled:opacity-25"
                    >
                      Tell it
                    </button>
                  </div>
                </motion.form>
              )}
            </AnimatePresence>
          </div>
        )}

        {task.state === 'done' && task.receipt && <ReceiptBlock task={task} />}
        {task.notes.length > 0 && <Constraints notes={task.notes} />}

        {/* ---- steps: the calls it actually made, and nothing else.

              "What it did" and "What happened" sat one screen apart with almost
              the same words, and neither said which was the machine and which
              was the narration. One is the list of tool calls; the other is the
              running commentary. They are now named for what they contain. */}
        <section className="px-6 pt-5">
          <BlockLabel>Steps</BlockLabel>
          {task.plan.length ? (
            <ol className="mt-1.5 overflow-hidden rounded-[10px] border border-line bg-ink-1/60 px-3.5 py-2">
              {task.plan.map((p, i) => {
                const running = i === task.plan.length - 1 && !finished
                return (
                  <li
                    key={`${i}-${p}`}
                    className={cx(
                      'flex items-baseline gap-2.5 border-b border-line/70 py-[6px] text-[12.5px] leading-snug last:border-b-0',
                      running ? 'text-fg-2' : 'text-fg-3'
                    )}
                  >
                    <span className="num w-3 shrink-0 text-[10.5px] text-fg-4">{i + 1}</span>
                    <span className={cx('min-w-0', running && 'font-medium')}>{p}</span>
                  </li>
                )
              })}
            </ol>
          ) : (
            <p className="mt-1.5 text-[12.5px] text-fg-4">
              {finished ? 'Nothing was run for this one.' : 'Nothing yet.'}
            </p>
          )}
        </section>

        {/* ---- timeline: everything it said, newest first */}
        <section className="px-6 pt-5 pb-6">
          <div className="flex items-center justify-between gap-3">
            <BlockLabel>Timeline</BlockLabel>
            <button
              type="button"
              role="switch"
              aria-checked={under}
              onClick={toggleUnder}
              className="no-drag -mt-1 flex items-center gap-2 text-[11.5px] text-fg-3 transition-colors hover:text-fg-2"
            >
              Show what’s underneath
              <Switch checked={under} />
            </button>
          </div>

          <ol className="mt-2 border-l border-line pl-0">
            {[...task.story].reverse().map((e, i) => (
              <motion.li
                key={e.id}
                initial={{ opacity: 0, x: -4 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.3, delay: Math.min(i, 4) * 0.03 }}
                className="group relative py-[7px] pl-4"
              >
                <span
                  aria-hidden="true"
                  className={cx(
                    'absolute top-[13px] left-[-3.5px] h-[6px] w-[6px] rounded-full ring-3 ring-ink-0',
                    e.tone === 'needs'
                      ? 'bg-needs'
                      : e.tone === 'snag'
                        ? 'bg-snag'
                        : e.tone === 'done'
                          ? 'bg-fg'
                          : e.tone === 'you'
                            ? 'bg-fg-3'
                            : 'bg-fg-4'
                  )}
                />
                <div className="flex items-baseline gap-2">
                  <time className="num shrink-0 text-[10.5px] text-fg-4">{clock(e.at)}</time>
                  <p
                    className={cx(
                      'text-[12.5px] leading-snug',
                      e.tone === 'needs'
                        ? 'text-needs'
                        : e.tone === 'snag'
                          ? 'text-snag'
                          : e.tone === 'done'
                            ? 'text-fg-2'
                            : e.tone === 'you'
                              ? 'text-fg-2'
                              : 'text-fg-3'
                    )}
                  >
                    {e.text}
                  </p>
                </div>
                <AnimatePresence initial={false}>
                  {under && e.code && (
                    <motion.code
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.22 }}
                      className="mt-1 block overflow-hidden font-mono text-[10.5px] leading-[1.5] break-all text-fg-4"
                    >
                      {e.code}
                    </motion.code>
                  )}
                </AnimatePresence>
              </motion.li>
            ))}
          </ol>
        </section>
      </div>

      {/* footer */}
      <div className="flex shrink-0 items-center gap-2 border-t border-line px-5 py-2.5">
        <Button size="sm" variant="quiet" onClick={() => showTrace(task.id)}>
          <I.Trace className="[&_svg]:h-[13px] [&_svg]:w-[13px]" />
          {spans.length ? 'Trace' : 'No trace yet'}
        </Button>
        <Checkpoint task={task} />
        <span className="num ml-auto text-[10.5px] text-fg-4">
          {state.integrations.neatlogs.connected ? 'traced · neatlogs' : 'traced locally'}
        </span>
      </div>
    </motion.aside>
  )
}

/* ------------------------------------------------------------------- bits */

function Ctl({
  icon,
  label,
  kbd,
  onClick,
  disabled,
  on,
  className,
  dataSteer
}: {
  icon: React.ReactNode
  label: string
  kbd?: string
  onClick: () => void
  disabled?: boolean
  on?: boolean
  className?: string
  dataSteer?: boolean
}): React.JSX.Element {
  return (
    <button
      type="button"
      data-steer={dataSteer ? '' : undefined}
      onClick={onClick}
      disabled={disabled}
      className={cx(
        'no-drag inline-flex h-[27px] items-center gap-1.5 rounded-[7px] px-2 text-[12px] transition-colors',
        on ? 'bg-veil-2 text-fg' : 'text-fg-3 hover:bg-veil hover:text-fg-2',
        'disabled:opacity-35',
        className
      )}
    >
      {icon}
      {label}
      {kbd && <span className="num ml-0.5 text-[10px] text-fg-4">{kbd}</span>}
    </button>
  )
}

/** One label style for the whole app — see `SectionLabel`. */
function BlockLabel({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <SectionLabel className="mb-0">{children}</SectionLabel>
}

/** The current sentence, crossfaded rather than swapped. */
function NowLine({ task }: { task: Task }): React.JSX.Element {
  const [shown, setShown] = useState(task.line)
  const first = useRef(true)
  useEffect(() => {
    if (first.current) {
      first.current = false
      return
    }
    const t = setTimeout(() => setShown(task.line), 220)
    return () => clearTimeout(t)
  }, [task.line])
  if (!shown) return <div className="mt-2" />
  return (
    <p
      key={shown}
      className={cx(
        'crossfade voice mt-2 text-[15.5px] leading-[1.45]',
        task.state === 'needs' ? 'text-needs' : task.state === 'snag' ? 'text-snag' : 'text-fg-2'
      )}
    >
      {shown}
    </p>
  )
}

function Constraints({ notes }: { notes: string[] }): React.JSX.Element {
  return (
    <section className="px-6 pt-5">
      <BlockLabel>What you told it</BlockLabel>
      <ul className="mt-1.5 space-y-1">
        {notes.map((n, i) => (
          <li key={i} className="text-[12.5px] text-fg-3 italic">
            “{n}”
          </li>
        ))}
      </ul>
    </section>
  )
}

/* -------------------------------------------------------------- ask card */

const REASON: Record<string, string> = {
  spend: 'It has hit your budget',
  message: 'It wants to speak as you',
  action: 'It wants to act for you'
}

function AskCard({ task, ask }: { task: Task; ask: Ask }): React.JSX.Element {
  const [picked, setPicked] = useState<string | null>(null)

  return (
    <motion.div
      initial={{ opacity: 0, y: 8, scale: 0.99 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.34, ease: [0.16, 1, 0.3, 1] }}
      className={cx('overflow-hidden rounded-[13px] border border-needs/30 bg-ink-1', 'shadow-ask')}
    >
      <div className="flex items-center gap-2 border-b border-needs/15 px-4 py-2.5">
        <Dot state="needs" progress={task.progress} size={13} />
        <span className="text-[11.5px] text-needs">
          {ask.kind === 'approve' ? REASON[ask.category] : 'It needs a decision from you'}
        </span>
        <span className="num ml-auto text-[11.5px] text-needs">
          {ask.kind === 'approve' && ask.cost
            ? money(ask.cost)
            : task.story.length
              ? clock(task.story[task.story.length - 1].at)
              : ''}
        </span>
      </div>

      <div className="px-4 pt-3.5 pb-4">
        <p className="voice text-[16.5px] leading-[1.4] text-fg">{ask.q}</p>

        {ask.kind === 'approve' && ask.draft && (
          <pre className="mt-3 rounded-[9px] border border-line bg-mark p-3 font-ui text-[12.5px] leading-[1.6] whitespace-pre-wrap text-fg-2">
            {ask.draft}
          </pre>
        )}

        {ask.kind === 'choice' ? (
          <div className="mt-3 space-y-1.5">
            {ask.choices.map((c) => (
              <button
                key={c.value}
                type="button"
                onMouseEnter={() => setPicked(c.value)}
                onClick={() => void api.answer(task.id, c.value)}
                className={cx(
                  'no-drag flex w-full items-baseline gap-3 rounded-[9px] border px-3 py-2.5 text-left transition-colors',
                  picked === c.value
                    ? 'border-line-2 bg-veil-2'
                    : 'border-line hover:border-line-2 hover:bg-veil'
                )}
              >
                <span className="min-w-0 flex-1 text-[13.5px] text-fg">{c.label}</span>
                <span className="num shrink-0 text-[11.5px] whitespace-nowrap text-fg-3">
                  {c.note}
                </span>
              </button>
            ))}
            <button
              type="button"
              onClick={() => void api.answer(task.id, '__none')}
              className="no-drag -ml-1 mt-1 rounded-[6px] px-1.5 py-1 text-[12.5px] text-fg-3 transition-colors hover:bg-veil hover:text-fg-2"
            >
              {ask.none}
            </button>
          </div>
        ) : (
          ask.facts.length > 0 && (
            <dl className="mt-3 space-y-1.5">
              {ask.facts.map(([k, v]) => (
                <div key={k} className="flex items-baseline gap-3 text-[12.5px]">
                  <dt className="w-[86px] shrink-0 text-fg-3">{k}</dt>
                  <dd className="flex-1 text-fg-2">{v}</dd>
                </div>
              ))}
            </dl>
          )
        )}

        {ask.kind === 'approve' && (
          <div className="mt-4 flex items-center gap-2">
            <Button variant="solid" onClick={() => void api.answer(task.id, 'yes')}>
              {ask.yes}
            </Button>
            <Button variant="ghost" onClick={() => void api.answer(task.id, 'no')}>
              {ask.no}
            </Button>
            <span className="num ml-auto text-[11px] text-fg-4">⌘↵ to {ask.yes.toLowerCase()}</span>
          </div>
        )}
      </div>
    </motion.div>
  )
}

/* ---------------------------------------------------------------- receipt */

function ReceiptBlock({ task }: { task: Task }): React.JSX.Element {
  const r = task.receipt
  if (!r) return <></>
  const canUndo = Boolean(r.undo)

  return (
    <section className="px-6 pt-5">
      <div className="overflow-hidden rounded-[13px] border border-line bg-ink-1 shadow-lift">
        <div className="flex items-center gap-2.5 border-b border-line px-4 py-2.5">
          <Dot state="done" size={15} />
          <span className="text-[12.5px] text-fg-2">The receipt</span>
          <span className="num ml-auto text-[11px] text-fg-4">
            checked twice before it called this done
          </span>
        </div>
        <dl className="px-4 py-3">
          {r.lines.map(([k, v]) => (
            <div key={k} className="flex items-baseline gap-3 py-[5px] text-[12.5px]">
              <dt className="w-[92px] shrink-0 text-fg-3">{k}</dt>
              <dd className="flex-1 text-fg-2">{v}</dd>
            </div>
          ))}
          <div className="flex items-baseline gap-3 py-[5px] text-[12.5px]">
            <dt className="w-[92px] shrink-0 text-fg-3">Proof</dt>
            <dd className="flex flex-1 flex-wrap gap-1">
              {r.proof.map((p) => (
                <span
                  key={p}
                  className="rounded-[5px] border border-line bg-mark px-1.5 py-[1px] text-[11px] text-fg-3"
                >
                  {p}
                </span>
              ))}
            </dd>
          </div>
          <div className="mt-1 flex items-baseline gap-3 border-t border-line pt-2.5 text-[12.5px]">
            <dt className="w-[92px] shrink-0 text-fg-3">Undo</dt>
            <dd className="flex-1">
              {canUndo ? (
                <button
                  type="button"
                  onClick={() => {
                    void api.control(task.id, 'reverse')
                    toast('Reversed. Everything is back how it was.', true)
                  }}
                  className="no-drag text-fg-2 underline decoration-line-2 underline-offset-2 transition-colors hover:text-fg hover:decoration-fg-3"
                >
                  {r.undo}
                </button>
              ) : (
                <span className="text-fg-3">
                  Can’t be undone. That’s exactly why it asked you first.
                </span>
              )}
            </dd>
          </div>
        </dl>
      </div>
    </section>
  )
}

/* ------------------------------------------------------------ checkpoint */

function Checkpoint({ task }: { task: Task }): React.JSX.Element | null {
  const entire = useUI((s) => s.sheet)
  const showSheet = useUI((s) => s.showSheet)
  if (entire === 'connections') return null
  const enabled = task.checkpointId != null
  return (
    <Button
      size="sm"
      variant="quiet"
      onClick={async () => {
        const res = await window.done.checkpoint(task.id)
        toast(res.message, res.ok)
        if (!res.ok) showSheet('connections')
      }}
      title="Save this behaviour change as an Entire checkpoint"
    >
      <I.Overlap className="[&_svg]:h-[13px] [&_svg]:w-[13px]" />
      {enabled ? 'Checkpointed' : 'Checkpoint'}
    </Button>
  )
}
