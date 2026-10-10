import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useRef, useState } from 'react'
import type { AppState, Limits, Task } from '../../../shared/types'
import { clock, cx, money } from '../lib/format'
import { api, toast, useUI } from '../store'
import { Dot } from './Dot'
import * as I from './Icons'

const EXTRAS = {
  when: ['whenever', 'today', 'this week', 'by Friday'],
  budget: ['no spending', '$25', '$100', '$500'],
  ask: ['before anything big', 'before every step', 'only if stuck']
} as const

type ExtraKey = keyof typeof EXTRAS

/**
 * One field. You write what you need; three quiet chips let you add a
 * deadline, a ceiling and a hand-off rule without ever leaving the sentence.
 */
export function Composer({ limits }: { limits: Limits }): React.JSX.Element {
  const [value, setValue] = useState('')
  const [idx, setIdx] = useState<Record<ExtraKey, number>>({ when: 0, budget: 0, ask: 0 })
  const inputRef = useRef<HTMLInputElement>(null)
  const showSheet = useUI((s) => s.showSheet)

  // ⌘N / the File menu both land here.
  useEffect(() => {
    const off = window.system.onMenu('menu:new', () => inputRef.current?.focus())
    return () => {
      off()
    }
  }, [])

  const cycle = (key: ExtraKey): void => {
    setIdx((s) => ({ ...s, [key]: (s[key] + 1) % EXTRAS[key].length }))
    inputRef.current?.focus()
  }

  const submit = (): void => {
    const text = value.trim()
    if (!text) return
    const when = EXTRAS.when[idx.when]
    const budget = EXTRAS.budget[idx.budget]
    void api.create(text, {
      when:
        when === 'whenever' ? null : when === 'today' ? 'Today' : `By ${when.replace(/^by /, '')}`,
      budget: budget === 'no spending' ? null : `Up to ${budget}`
    })
    setValue('')
    setIdx({ when: 0, budget: 0, ask: 0 })
    toast('Written down. It’ll start in a moment.')
    inputRef.current?.blur()
  }

  const typing = value.trim().length > 0

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        submit()
      }}
      className={cx(
        'column pt-1 pb-5',
        'rounded-[13px] border bg-ink-1/60 transition-colors duration-200',
        typing ? 'border-line-2 bg-ink-1' : 'border-line hover:border-line-2'
      )}
    >
      <div className="flex items-center gap-2.5 px-3.5 py-2.5">
        <Dot state={typing ? 'working' : 'waiting'} progress={typing ? 0.14 : 0} size={15} />
        <input
          ref={inputRef}
          data-composer
          value={value}
          maxLength={140}
          spellCheck={false}
          placeholder="What needs doing?"
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.currentTarget.blur()
            }
            if (e.key === 'Tab') {
              e.preventDefault()
              cycle('when')
            }
          }}
          aria-label="What needs doing?"
          className="min-w-0 flex-1 bg-transparent text-[14.5px] text-fg placeholder:text-fg-4"
        />
      </div>

      <AnimatePresence initial={false}>
        {typing && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.26, ease: [0.16, 1, 0.3, 1] }}
            className="overflow-hidden"
          >
            <div className="flex flex-wrap items-center gap-1.5 border-t border-line px-3 py-2.5">
              <Chip onClick={() => cycle('when')}>
                By <em>{EXTRAS.when[idx.when]}</em>
              </Chip>
              <Chip onClick={() => cycle('budget')}>
                Up to <em>{EXTRAS.budget[idx.budget]}</em>
              </Chip>
              <Chip onClick={() => cycle('ask')}>
                Ask me <em>{EXTRAS.ask[idx.ask]}</em>
              </Chip>
              <button
                type="submit"
                className="no-drag ml-auto inline-flex h-[24px] items-center gap-1.5 rounded-[7px] bg-fg px-2.5 text-[12px] font-medium text-ink-0 transition-opacity hover:opacity-85"
              >
                Hand it off
                <I.ArrowRight className="[&_svg]:h-[13px] [&_svg]:w-[13px]" />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {!typing && (
        <button
          type="button"
          onClick={() => showSheet('limits')}
          className="no-drag flex w-full items-center gap-2 border-t border-line px-3.5 py-2 text-left text-[11.5px] text-fg-4 transition-colors hover:text-fg-3"
        >
          <I.Shield className="shrink-0 text-fg-5 [&_svg]:h-[13px] [&_svg]:w-[13px]" />
          <span className="min-w-0 flex-1 truncate">
            {limits.spend > 0 ? (
              <>
                It can spend <em className="not-italic text-fg-3">up to {money(limits.spend)}</em>{' '}
                without asking.
              </>
            ) : (
              'It asks before it spends anything.'
            )}{' '}
            Nothing irreversible, ever.
          </span>
        </button>
      )}
    </form>
  )
}

function Chip({
  children,
  onClick
}: {
  children: React.ReactNode
  onClick: () => void
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cx(
        'no-drag inline-flex h-[24px] items-center gap-1 rounded-[7px] border border-line',
        'px-2 text-[11.5px] text-fg-3 transition-colors hover:border-line-2 hover:bg-white/[0.04] hover:text-fg-2'
      )}
    >
      {children}
    </button>
  )
}

/* ==========================================================================
   The list
   ========================================================================== */

export function TaskList({ state }: { state: AppState }): React.JSX.Element {
  const groups: Record<string, Task[]> = { needs: [], going: [], done: [] }
  for (const t of state.tasks) {
    if (t.state === 'needs') groups.needs.push(t)
    else if (t.state === 'done' || t.state === 'stopped') groups.done.push(t)
    else groups.going.push(t)
  }
  groups.done.sort((a, b) => (b.finishedAt ?? 0) - (a.finishedAt ?? 0))

  const openId = useUI((s) => s.openId)
  const doneOpen = useUI((s) => s.doneOpen)
  const setDoneOpen = useUI((s) => s.setDoneOpen)

  const empty = state.tasks.length === 0

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-8">
      <div className="mx-auto w-full max-w-[47.5rem] pb-10">
        {empty && <EmptyState />}

        {groups.needs.length > 0 && (
          <Group label="Needs you" tone="needs">
            {groups.needs.map((t) => (
              <Row key={t.id} task={t} open={t.id === openId} />
            ))}
          </Group>
        )}

        {groups.going.length > 0 && (
          <Group label="Going">
            {groups.going.map((t) => (
              <Row key={t.id} task={t} open={t.id === openId} />
            ))}
          </Group>
        )}

        {groups.done.length > 0 && (
          <section className="mt-1">
            <button
              type="button"
              onClick={() => setDoneOpen(!doneOpen)}
              aria-expanded={doneOpen}
              className="group mb-1.5 flex w-full items-center gap-2 py-2 pl-[30px] text-left"
            >
              <span className="text-[10.5px] font-medium tracking-[0.09em] text-fg-4 uppercase transition-colors group-hover:text-fg-3">
                Done today
              </span>
              <span className="num text-[11px] text-fg-5">{groups.done.length}</span>
              <I.Chevron
                className={cx(
                  'ml-0.5 text-fg-5 transition-transform duration-200 [&_svg]:h-[12px] [&_svg]:w-[12px]',
                  doneOpen ? '' : '-rotate-90'
                )}
              />
              {doneOpen && (
                <span className="ml-auto opacity-0 transition-opacity group-hover:opacity-100">
                  <span
                    role="button"
                    tabIndex={0}
                    onClick={(e) => {
                      e.stopPropagation()
                      void api.clearFinished()
                      toast('Cleared the finished list.')
                    }}
                    onKeyDown={(e) => e.key === 'Enter' && void api.clearFinished()}
                    className="no-drag rounded-[5px] px-1.5 py-0.5 text-[11px] text-fg-4 transition-colors hover:bg-white/[0.06] hover:text-fg-2"
                  >
                    Clear
                  </span>
                </span>
              )}
            </button>
            <AnimatePresence initial={false}>
              {doneOpen && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
                  className="overflow-hidden"
                >
                  <div className="pt-0.5">
                    {groups.done.map((t) => (
                      <Row key={t.id} task={t} open={t.id === openId} />
                    ))}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </section>
        )}
      </div>
    </div>
  )
}

function Group({
  label,
  tone,
  children
}: {
  label: string
  tone?: 'needs'
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <section className="mt-1">
      <h2 className="mb-1.5 flex items-center gap-2 py-2 pl-[30px]">
        {tone === 'needs' && <span className="h-[5px] w-[5px] rounded-full bg-needs" />}
        <span
          className={cx(
            'text-[10.5px] font-medium tracking-[0.09em] uppercase',
            tone === 'needs' ? 'text-needs/80' : 'text-fg-4'
          )}
        >
          {label}
        </span>
      </h2>
      <div className="space-y-px">{children}</div>
    </section>
  )
}

/* -------------------------------------------------------------------- row */

function Row({ task, open }: { task: Task; open: boolean }): React.JSX.Element {
  const cursorId = useUI((s) => s.cursorId)
  const openTask = useUI((s) => s.openTask)
  const closeTask = useUI((s) => s.closeTask)
  const [flash, setFlash] = useState(false)
  const prevState = useRef(task.state)

  useEffect(() => {
    const was = prevState.current
    prevState.current = task.state
    if (was === task.state || task.state !== 'done') return
    setFlash(true)
    const t = setTimeout(() => setFlash(false), 1200)
    return () => clearTimeout(t)
  }, [task.state])

  const side =
    task.state === 'needs'
      ? 'Answer'
      : task.state === 'paused'
        ? 'Paused'
        : task.state === 'you'
          ? 'With you'
          : task.state === 'waiting'
            ? (task.when ?? 'Soon')
            : task.state === 'done' || task.state === 'stopped'
              ? task.finishedAt
                ? clock(task.finishedAt)
                : ''
              : ''

  const showHot = task.state === 'working' || task.state === 'snag' || task.state === 'waiting'

  return (
    <div
      data-row={task.id}
      className={cx(
        'group relative -mx-2 flex cursor-default items-start gap-3 rounded-[10px] px-2 py-[9px]',
        'transition-colors duration-150',
        open ? 'bg-white/[0.045]' : 'hover:bg-white/[0.025]',
        task.id === cursorId && !open && 'bg-white/[0.02]'
      )}
      onClick={() => (open ? closeTask() : openTask(task.id))}
      onDoubleClick={() => void api.control(task.id, 'pause')}
    >
      {flash && (
        <motion.span
          aria-hidden="true"
          initial={{ boxShadow: '0 0 0 0 rgba(255,255,255,0.28)' }}
          animate={{ boxShadow: '0 0 0 8px rgba(255,255,255,0)' }}
          transition={{ duration: 1.1, ease: [0.16, 1, 0.3, 1] }}
          className="pointer-events-none absolute top-1/2 left-[22px] h-[18px] w-[18px] -translate-y-1/2 rounded-full"
        />
      )}

      <Dot state={task.state} progress={task.progress} size={18} />

      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-3">
          <p
            className={cx(
              'min-w-0 flex-1 truncate text-[14px] leading-snug',
              task.state === 'done' || task.state === 'stopped' ? 'text-fg-3' : 'text-fg'
            )}
          >
            {task.title}
          </p>

          <div className="flex shrink-0 items-center gap-0.5">
            {side && (
              <span
                className={cx(
                  'num text-[11px] whitespace-nowrap transition-opacity duration-150',
                  task.state === 'needs' ? 'text-needs' : 'text-fg-5',
                  // Only step aside for the hover controls that replace it.
                  // "Answer" is the call to action — it must never vanish
                  // because the pointer happened to land on the row.
                  showHot && task.state !== 'needs' && 'group-hover:opacity-0'
                )}
              >
                {side}
              </span>
            )}
            <RowActions task={task} live={showHot} />
          </div>
        </div>

        <TaskLine task={task} />
      </div>
    </div>
  )
}

/** The sentence changes; it crossfades rather than snapping. */
function TaskLine({ task }: { task: Task }): React.JSX.Element | null {
  const [shown, setShown] = useState(task.line)
  const first = useRef(true)

  useEffect(() => {
    if (first.current) {
      first.current = false
      setShown(task.line)
      return
    }
    if (task.line === shown) return
    const t = setTimeout(() => setShown(task.line), 220)
    return () => clearTimeout(t)
  }, [task.line, shown])

  if (!task.line) return null

  const dim = task.state === 'done' || task.state === 'stopped'

  return (
    <p
      key={shown}
      className={cx(
        'crossfade mt-0.5 line-clamp-2 text-[12.5px] leading-snug',
        task.state === 'needs'
          ? 'text-needs/75'
          : task.state === 'snag'
            ? 'text-snag/75'
            : dim
              ? 'text-fg-5'
              : 'text-fg-3'
      )}
    >
      {shown}
    </p>
  )
}

function RowActions({ task, live }: { task: Task; live: boolean }): React.JSX.Element {
  const paused = task.state === 'paused'
  const yours = task.state === 'you'
  return (
    <div className="flex items-center gap-px opacity-0 transition-opacity duration-150 group-hover:opacity-100 focus-within:opacity-100">
      {live && (
        <button
          type="button"
          aria-label={paused ? 'Resume' : 'Pause'}
          onClick={(e) => {
            e.stopPropagation()
            void api.control(task.id, 'pause')
          }}
          className="no-drag inline-flex h-[20px] w-[22px] items-center justify-center rounded-[5px] text-fg-4 transition-colors hover:bg-white/[0.08] hover:text-fg-2"
        >
          {paused ? (
            <I.Play className="[&_svg]:h-[13px] [&_svg]:w-[13px]" />
          ) : (
            <I.Pause className="[&_svg]:h-[13px] [&_svg]:w-[13px]" />
          )}
        </button>
      )}
      {(paused || yours) && (
        <button
          type="button"
          aria-label={yours ? 'Hand back' : 'Resume'}
          onClick={(e) => {
            e.stopPropagation()
            void api.control(task.id, yours ? 'take' : 'pause')
          }}
          className="no-drag inline-flex h-[20px] w-[22px] items-center justify-center rounded-[5px] text-fg-4 transition-colors hover:bg-white/[0.08] hover:text-fg-2"
        >
          {yours ? (
            <I.Hand className="[&_svg]:h-[13px] [&_svg]:w-[13px]" />
          ) : (
            <I.Play className="[&_svg]:h-[13px] [&_svg]:w-[13px]" />
          )}
        </button>
      )}
    </div>
  )
}

function EmptyState(): React.JSX.Element {
  return (
    <div className="flex flex-col items-center pt-24 text-center">
      <Dot state="done" size={22} />
      <p className="voice mt-4 text-[19px] text-fg-2">Nothing left to do.</p>
      <p className="mt-1 text-[12.5px] text-fg-4">Write one above and it’ll take care of itself.</p>
    </div>
  )
}
