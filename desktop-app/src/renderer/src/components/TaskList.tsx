import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useRef, useState } from 'react'
import type { AppState, Limits, Task } from '../../../shared/types'
import { clock, cx, money } from '../lib/format'
import { api, sections, toast, useUI } from '../store'
import type { Section } from '../store'
import { Dot } from './Dot'
import { GroupPicker } from './GroupPicker'
import * as I from './Icons'

const EXTRAS = {
  when: ['whenever', 'today', 'this week', 'by Friday'],
  budget: ['no spending', '$25', '$100', '$500'],
  ask: ['before anything big', 'before every step', 'only if stuck']
} as const

type ExtraKey = keyof typeof EXTRAS

const CONNECTORS: { id: import('../../../shared/types').ConnectorId; label: string }[] = [
  { id: 'auto', label: 'Auto (AI Routed)' },
  { id: 'grok', label: 'xAI Grok' },
  { id: 'claude', label: 'Claude Code' },
  { id: 'chatgpt', label: 'ChatGPT & Codex' },
  { id: 'muse', label: 'Muse Spark' },
  { id: 'pi', label: 'Pi Agent Core' },
  { id: 'roma', label: 'Roma MCP' }
]

export function ConnectorPill({ id }: { id?: string }): React.JSX.Element | null {
  if (!id || id === 'auto') return null
  const BADGES: Record<string, { label: string; tone: string }> = {
    grok: { label: '⚡ Grok', tone: 'text-amber-400/90 border-amber-500/25 bg-amber-500/[0.06]' },
    claude: { label: '✻ Claude', tone: 'text-orange-400/90 border-orange-500/25 bg-orange-500/[0.06]' },
    chatgpt: { label: '◈ ChatGPT', tone: 'text-emerald-400/90 border-emerald-500/25 bg-emerald-500/[0.06]' },
    muse: { label: '✦ Muse', tone: 'text-purple-400/90 border-purple-500/25 bg-purple-500/[0.06]' },
    gemini: { label: '✦ Gemini', tone: 'text-blue-400/90 border-blue-500/25 bg-blue-500/[0.06]' },
    roma: { label: '☍ Roma', tone: 'text-rose-400/90 border-rose-500/25 bg-rose-500/[0.06]' },
    pi: { label: '● Pi Agent', tone: 'text-fg-4 border-line bg-ink-2/50' }
  }
  const badge = BADGES[id] ?? { label: id, tone: 'text-fg-4 border-line bg-ink-2/50' }
  return (
    <span
      className={cx(
        'shrink-0 rounded-[5px] border px-1.5 py-[1px] font-mono text-[10px] leading-tight select-none',
        badge.tone
      )}
    >
      {badge.label}
    </span>
  )
}

/**
 * One field. You write what you need; four quiet chips let you add a
 * deadline, a ceiling, a hand-off rule and a place to file it, without ever
 * leaving the sentence.
 */
export function Composer({
  limits,
  groups
}: {
  limits: Limits
  groups: string[]
}): React.JSX.Element {
  const [value, setValue] = useState('')
  const [idx, setIdx] = useState<Record<ExtraKey, number>>({ when: 0, budget: 0, ask: 0 })
  const [connectorIdx, setConnectorIdx] = useState(0)
  const [group, setGroup] = useState<string | null>(null)
  const [picking, setPicking] = useState(false)
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

  const cycleConnector = (): void => {
    setConnectorIdx((s) => (s + 1) % CONNECTORS.length)
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
      budget: budget === 'no spending' ? null : `Up to ${budget}`,
      group,
      connector: CONNECTORS[connectorIdx].id
    })
    setValue('')
    setIdx({ when: 0, budget: 0, ask: 0 })
    setGroup(null)
    setPicking(false)
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
              <Chip onClick={cycleConnector}>
                Via <em>{CONNECTORS[connectorIdx].label}</em>
              </Chip>
              <Chip onClick={() => cycle('when')}>
                By <em>{EXTRAS.when[idx.when]}</em>
              </Chip>
              <Chip onClick={() => cycle('budget')}>
                Up to <em>{EXTRAS.budget[idx.budget]}</em>
              </Chip>
              <Chip onClick={() => cycle('ask')}>
                Ask me <em>{EXTRAS.ask[idx.ask]}</em>
              </Chip>
              {picking ? (
                <GroupPicker
                  value={group}
                  groups={groups}
                  onChange={(next) => {
                    setGroup(next)
                    setPicking(false)
                    inputRef.current?.focus()
                  }}
                />
              ) : (
                <Chip
                  on={Boolean(group)}
                  onClick={() => setPicking(true)}
                  title="File this somewhere"
                >
                  In <em>{group ?? 'no group'}</em>
                </Chip>
              )}
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
                It runs on its own until a job costs{' '}
                <em className="not-italic text-fg-3">{money(limits.spend)}</em>.
              </>
            ) : (
              'It stops and asks before a job costs anything.'
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
  onClick,
  on,
  title
}: {
  children: React.ReactNode
  onClick: () => void
  on?: boolean
  title?: string
}): React.JSX.Element {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className={cx(
        'no-drag inline-flex h-[24px] items-center gap-1 rounded-[7px] border',
        'px-2 text-[11.5px] transition-colors',
        on
          ? 'border-line-2 bg-white/[0.06] text-fg'
          : 'border-line text-fg-3 hover:border-line-2 hover:bg-white/[0.04] hover:text-fg-2'
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
  const openId = useUI((s) => s.openId)
  const secs = sections(state)

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-8">
      <div className="mx-auto w-full max-w-[47.5rem] pb-10">
        {secs.length === 0 && <EmptyState state={state} />}

        {secs.map((section) =>
          section.kind === 'group' ? (
            <GroupSection key={section.key} section={section} openId={openId} />
          ) : section.kind === 'done' ? (
            <DoneSection key={section.key} section={section} openId={openId} />
          ) : (
            <Group
              key={section.key}
              label={section.label}
              tone={section.kind === 'needs' ? 'needs' : undefined}
            >
              {section.tasks.map((t) => (
                <Row key={t.id} task={t} open={t.id === openId} />
              ))}
            </Group>
          )
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

/* ----------------------------------------------------------- named groups */

function GroupSection({
  section,
  openId
}: {
  section: Section
  openId: string | null
}): React.JSX.Element {
  const isFolded = useUI((s) => s.isFolded(section.key))
  const toggleFold = useUI((s) => s.toggleFold)
  const [renaming, setRenaming] = useState(false)

  return (
    <Fold
      label={section.label}
      count={section.tasks.length}
      open={!isFolded}
      onToggle={() => toggleFold(section.key)}
      icon={<I.Folder className="text-fg-5 [&_svg]:h-[12px] [&_svg]:w-[12px]" />}
      renaming={renaming}
      onRenameDone={() => setRenaming(false)}
      actions={
        <>
          <HoverAction onClick={() => setRenaming(true)}>Rename</HoverAction>
          <HoverAction
            onClick={() => {
              void api.removeGroup(section.label)
              toast('Took the group off. The tasks are all still here.', true)
            }}
          >
            Clear
          </HoverAction>
        </>
      }
    >
      {section.tasks.map((t) => (
        <Row key={t.id} task={t} open={t.id === openId} />
      ))}
    </Fold>
  )
}

function DoneSection({
  section,
  openId
}: {
  section: Section
  openId: string | null
}): React.JSX.Element {
  const doneOpen = useUI((s) => s.doneOpen)
  const setDoneOpen = useUI((s) => s.setDoneOpen)

  return (
    <Fold
      label={section.label}
      count={section.tasks.length}
      open={doneOpen}
      onToggle={() => setDoneOpen(!doneOpen)}
      actions={
        <HoverAction
          onClick={() => {
            void api.clearFinished()
            toast('Cleared the finished list.')
          }}
        >
          Clear
        </HoverAction>
      }
    >
      {section.tasks.map((t) => (
        <Row key={t.id} task={t} open={t.id === openId} />
      ))}
    </Fold>
  )
}

/**
 * A section you can fold — your own groups, and Done today. Both use it so
 * they fold, count and reveal their actions in exactly the same way.
 */
function Fold({
  label,
  count,
  open,
  onToggle,
  icon,
  actions,
  renaming,
  onRenameDone,
  children
}: {
  label: string
  count: number
  open: boolean
  onToggle: () => void
  icon?: React.ReactNode
  actions?: React.ReactNode
  /** Swaps the label for a field while the name is being edited. */
  renaming?: boolean
  onRenameDone?: () => void
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <section className="mt-1">
      <div className="group mb-1.5 flex w-full items-center gap-2 py-2 pl-[30px]">
        {renaming ? (
          <RenameField label={label} onDone={onRenameDone} />
        ) : (
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={open}
            className="flex min-w-0 flex-1 items-center gap-2 text-left"
          >
            {icon}
            <span className="truncate text-[10.5px] font-medium tracking-[0.09em] text-fg-4 uppercase transition-colors group-hover:text-fg-3">
              {label}
            </span>
            <span className="num text-[11px] text-fg-5">{count}</span>
            <I.Chevron
              className={cx(
                'ml-0.5 shrink-0 text-fg-5 transition-transform duration-200 [&_svg]:h-[12px] [&_svg]:w-[12px]',
                open ? '' : '-rotate-90'
              )}
            />
          </button>
        )}
        {actions && (
          <span className="ml-auto flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
            {actions}
          </span>
        )}
      </div>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
            className="overflow-hidden"
          >
            <div className="space-y-px pt-0.5">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  )
}

function RenameField({ label, onDone }: { label: string; onDone?: () => void }): React.JSX.Element {
  const [draft, setDraft] = useState(label)
  const ref = useRef<HTMLInputElement>(null)

  useEffect(() => {
    ref.current?.focus()
    ref.current?.select()
  }, [])

  const commit = (keep: boolean): void => {
    const next = draft.trim()
    if (keep && next && next.toLowerCase() !== label.toLowerCase()) {
      void api.renameGroup(label, next)
      toast(`Renamed to ${next}.`, true)
    }
    onDone?.()
  }

  return (
    <input
      ref={ref}
      value={draft}
      maxLength={32}
      aria-label="Group name"
      onChange={(e) => setDraft(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          commit(true)
        }
        if (e.key === 'Escape') {
          e.preventDefault()
          commit(false)
        }
      }}
      onBlur={() => commit(true)}
      className="no-drag min-w-0 flex-1 border-b border-line-2 bg-transparent text-[12px] text-fg"
    />
  )
}

function HoverAction({
  children,
  onClick
}: {
  children: React.ReactNode
  onClick: () => void
}): React.JSX.Element {
  return (
    <span
      role="button"
      tabIndex={0}
      onClick={(e) => {
        e.stopPropagation()
        onClick()
      }}
      onKeyDown={(e) => e.key === 'Enter' && onClick()}
      className="no-drag rounded-[5px] px-1.5 py-0.5 text-[11px] text-fg-4 transition-colors hover:bg-white/[0.06] hover:text-fg-2"
    >
      {children}
    </span>
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
        <div className="flex items-baseline gap-2.5">
          <p
            className={cx(
              'min-w-0 truncate text-[14px] leading-snug',
              task.state === 'done' || task.state === 'stopped' ? 'text-fg-3' : 'text-fg'
            )}
          >
            {task.title}
          </p>

          <ConnectorPill id={task.routedConnector || task.connector} />

          <div className="ml-auto flex shrink-0 items-center gap-0.5">
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

/**
 * The empty state.
 *
 * It is a list of things the agent can genuinely do right now, on this
 * machine, with this key — not an aspirational feature list. If the model is
 * not connected it says so and stops, because everything below it would be a
 * lie. Each prompt really runs when you click it.
 */
function EmptyState({ state }: { state: AppState }): React.JSX.Element {
  const model = state.integrations.model
  const ask = (prompt: string): void => {
    void api.create(prompt)
    toast('Written down. It’ll start in a moment.')
  }

  return (
    <div className="flex flex-col pt-16">
      <div className="flex items-baseline gap-2.5">
        <Dot state="waiting" size={20} />
        <p className="voice text-[20px] text-fg-2">Write it down. It gets done.</p>
      </div>

      {!model.connected ? (
        <div className="mt-5 rounded-[11px] border border-needs/25 bg-needs/[0.06] px-4 py-3">
          <p className="text-[13px] text-needs">There is no model key, so I can’t think yet.</p>
          <p className="mt-1 text-[12px] leading-relaxed text-fg-4">
            Add{' '}
            <code className="rounded-[4px] bg-white/[0.06] px-1 font-mono text-[11px] text-fg-3">
              LLM_API_KEY
            </code>{' '}
            to a{' '}
            <code className="rounded-[4px] bg-white/[0.06] px-1 font-mono text-[11px] text-fg-3">
              .env
            </code>{' '}
            file and restart. Until then nothing here is simulated — it just can’t run.
          </p>
        </div>
      ) : (
        <>
          <p className="mt-2 max-w-[34rem] text-[12.5px] leading-relaxed text-fg-4">
            I run on <span className="text-fg-3">{model.model}</span>. I use a real browser, a real
            shell and the real filesystem — and I stop and ask before anything I can’t take back.
          </p>

          <ul className="mt-6 grid gap-1.5">
            {STARTERS.map(({ label, hint, prompt }) => (
              <li key={label}>
                <button
                  type="button"
                  onClick={() => ask(prompt)}
                  className="no-drag group flex w-full items-start gap-3 rounded-[10px] border border-line bg-ink-1/40 px-3.5 py-2.5 text-left transition-colors hover:border-line-2 hover:bg-ink-1"
                >
                  <I.ArrowRight className="mt-[3px] shrink-0 text-fg-5 transition-colors group-hover:text-fg-3 [&_svg]:h-[13px] [&_svg]:w-[13px]" />
                  <span className="min-w-0">
                    <span className="block text-[13px] text-fg-2">{label}</span>
                    <span className="mt-0.5 block text-[11.5px] leading-relaxed text-fg-5">
                      {hint}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}

/**
 * Every one of these has been run end to end against the real tools. They are
 * here because they work, not because they sound good.
 */
const STARTERS: { label: string; hint: string; prompt: string }[] = [
  {
    label: 'Research something on the web',
    hint: 'Searches, reads the pages, and checks its own answer before calling it done.',
    prompt: 'Find out what the current Node.js LTS version is, and tell me when it went into LTS.'
  },
  {
    label: 'Drive a real browser',
    hint: 'Opens pages in a hidden Chromium window and clicks with real mouse events.',
    prompt:
      'Open duckduckgo.com, search for "best coffee shop in Seattle", and tell me the name and address of the top result.'
  },
  {
    label: 'Have it write and change code',
    hint: 'Hands the job to a real coding agent in a folder, and reports the files it changed.',
    prompt:
      'In the current project, write a Python script called fib.py that prints the first 20 Fibonacci numbers, then run it and paste the output.'
  },
  {
    label: 'Touch the files on this machine',
    hint: 'Reads and writes inside your own folders, and refuses anything outside them.',
    prompt:
      'Create a file called shop-list.md in my Documents folder with a weekly shopping list for two people, then read it back.'
  }
]
