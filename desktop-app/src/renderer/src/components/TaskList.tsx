import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useRef, useState } from 'react'
import type { AppState, ConnectorId, ConnectorInfo, Task } from '../../../shared/types'
import { clock, connectorLabel, cx } from '../lib/format'
import { api, sections, toast, useUI } from '../store'
import type { Section } from '../store'
import { Dot } from './Dot'
import { GroupPicker } from './GroupPicker'
import { Code, Menu } from './primitives'
import * as I from './Icons'

const WHEN_OPTIONS: { value: string; label: string; note: string }[] = [
  { value: 'anytime', label: 'Whenever', note: 'No deadline' },
  { value: 'Today', label: 'Today', note: 'Before you stop' },
  { value: 'By Friday', label: 'This week', note: 'By Friday' }
]

/**
 * The money a single run may spend before it stops and asks.
 *
 * This is a list of amounts a person recognises, not an arbitrary number
 * field: the point of a ceiling is that you know what you are agreeing to
 * before you agree to it, and `$0` has to be visibly the strictest option
 * rather than a value you find by accident.
 */
const BUDGET_OPTIONS: { value: string; label: string; note: string }[] = [
  { value: 'ask', label: 'Ask me first', note: 'Stops before the first thing costs anything' },
  { value: '$1', label: 'Up to $1', note: 'A cheap run' },
  { value: '$5', label: 'Up to $5', note: '' },
  { value: '$25', label: 'Up to $25', note: '' },
  { value: '$100', label: 'Up to $100', note: '' }
]

const ENGINES: { id: ConnectorId; label: string; note: string }[] = [
  { id: 'pi', label: 'Pi', note: 'This machine · browser, shell, files' },
  { id: 'github', label: 'GitHub', note: 'Issues, pull requests, releases' },
  { id: 'claude', label: 'Claude', note: 'Code changed and run' },
  { id: 'gemini', label: 'Gemini', note: 'Whole repositories, read wide' },
  { id: 'grok', label: 'Grok', note: 'What is true right now' },
  { id: 'chatgpt', label: 'ChatGPT', note: 'Worked through step by step' },
  { id: 'muse', label: 'Muse', note: 'Ideas, landed in a real file' },
  { id: 'auto', label: 'Let it choose', note: 'I pick the engine from the wording' }
]

const DEFAULT_ENGINE = 'pi'

/**
 * Which engine ran a task.
 *
 * This was a coloured badge — amber, orange, emerald, purple, blue, rose, one
 * per agent. Six new meanings for six brands, on every row of a list whose
 * whole design rests on colour meaning one thing: amber is "needs you", coral
 * is "something broke", sage is "reversible". Once six agents each had a hue,
 * none of those three still read as themselves.
 *
 * So it is one white now, at one opacity on the ramp — quiet enough to stay off
 * your eye, dark enough to still be read. You can see which engine ran it, and
 * nothing in the row competes with the dot or the deadline.
 */
export function ConnectorTag({ id }: { id?: string }): React.JSX.Element | null {
  if (!id || id === 'auto') return null
  return (
    <span className="num shrink-0 text-[11px] tracking-[0.02em] text-fg-4 select-none">
      {connectorLabel(id)}
    </span>
  )
}

/**
 * One field. You write what you need; four quiet menus let you add an engine,
 * a deadline, a ceiling and a place to file it, without ever leaving the
 * sentence.
 *
 * The engine is the one that matters most, so it comes first and it defaults
 * to a real engine rather than to a decision made for you. "Let it choose" is
 * there — it is genuinely useful — but it is an option you pick, not the state
 * the app puts you in.
 */
export function Composer({
  groups,
  engines
}: {
  groups: string[]
  engines: ConnectorInfo[]
}): React.JSX.Element {
  const [value, setValue] = useState('')
  const [when, setWhen] = useState('anytime')
  const [budget, setBudget] = useState('ask')
  const [engine, setEngine] = useState<ConnectorId>(DEFAULT_ENGINE)
  const [group, setGroup] = useState<string | null>(null)
  const [picking, setPicking] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  // ⌘N / the File menu both land here.
  useEffect(() => {
    const off = window.system.onMenu('menu:new', () => inputRef.current?.focus())
    return () => {
      off()
    }
  }, [])

  const submit = (): void => {
    const text = value.trim()
    if (!text) return
    void api.create(text, {
      when: when === 'anytime' ? null : when,
      budget: budget === 'ask' ? null : `Up to ${budget}`,
      group,
      connector: engine
    })
    setValue('')
    setGroup(null)
    setPicking(false)
    toast('Written down. It’ll start in a moment.')
    inputRef.current?.blur()
  }

  const typing = value.trim().length > 0

  /* An engine the app cannot actually reach should not sit silently in the
     list looking like it works. The note under each one says which model will
     serve it, and says so plainly when that model is the local one. */
  const engineOptions = ENGINES.map((e) => {
    const live = engines.find((c) => c.id === e.id)
    const note =
      e.id === 'auto'
        ? e.note
        : live?.native === false
          ? `${e.note} · no key, runs locally`
          : live?.model
            ? `${e.note} · ${live.model}`
            : e.note
    return { value: e.id, label: e.label, note }
  })

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        submit()
      }}
      className={cx(
        'column pt-1 pb-5',
        'rounded-[13px] border bg-ink-1/70 transition-colors duration-200',
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
              inputRef.current?.focus()
            }
          }}
          aria-label="What needs doing?"
          className="min-w-0 flex-1 bg-transparent text-[14.5px] text-fg"
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
              <Menu
                label="On"
                title="Which engine does this"
                value={engine}
                options={engineOptions}
                onChange={(v) => {
                  setEngine(v)
                  inputRef.current?.focus()
                }}
              />
              <Menu
                label="By"
                title="When it is needed"
                value={when}
                options={WHEN_OPTIONS}
                onChange={(v) => {
                  setWhen(v)
                  inputRef.current?.focus()
                }}
              />
              <Menu
                label="Up to"
                title="How much this one run may cost"
                value={budget}
                options={BUDGET_OPTIONS}
                onChange={(v) => {
                  setBudget(v)
                  inputRef.current?.focus()
                }}
              />
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
                className="no-drag ml-auto inline-flex h-[24px] items-center gap-1.5 rounded-[7px] bg-fg px-2.5 text-[12px] font-medium text-ink-0 transition-opacity hover:opacity-88"
              >
                Add
                <I.ArrowRight className="[&_svg]:h-[13px] [&_svg]:w-[13px]" />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
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
          ? 'border-line-2 bg-veil text-fg'
          : 'border-line text-fg-3 hover:border-line-2 hover:bg-veil hover:text-fg-2'
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
            tone === 'needs' ? 'text-needs' : 'text-fg-3'
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
      icon={<I.Folder className="text-fg-4 [&_svg]:h-[12px] [&_svg]:w-[12px]" />}
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
            <span className="truncate text-[10.5px] font-medium tracking-[0.09em] text-fg-3 uppercase transition-colors group-hover:text-fg-2">
              {label}
            </span>
            <span className="num text-[11px] text-fg-4">{count}</span>
            <I.Chevron
              className={cx(
                'ml-0.5 shrink-0 text-fg-4 transition-transform duration-200 [&_svg]:h-[12px] [&_svg]:w-[12px]',
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
      className="no-drag rounded-[5px] px-1.5 py-0.5 text-[11px] text-fg-3 transition-colors hover:bg-veil hover:text-fg"
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
        open ? 'bg-veil-2' : 'hover:bg-veil',
        task.id === cursorId && !open && 'bg-veil'
      )}
      onClick={() => (open ? closeTask() : openTask(task.id))}
      onDoubleClick={() => void api.control(task.id, 'pause')}
    >
      {flash && (
        <motion.span
          aria-hidden="true"
          initial={{ boxShadow: '0 0 0 0 var(--app-pulse)' }}
          animate={{ boxShadow: '0 0 0 8px transparent' }}
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

          <ConnectorTag id={task.routedConnector || task.connector} />

          <div className="ml-auto flex shrink-0 items-center gap-0.5">
            {side && (
              <span
                className={cx(
                  'num text-[11px] whitespace-nowrap transition-opacity duration-150',
                  task.state === 'needs' ? 'text-needs' : 'text-fg-4',
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
        // The state colours carry their meaning at full strength. Fading them
        // for "elegance" cost the sentence its meaning — amber at 75% no
        // longer reads as "needs you", it reads as a slightly dirty white.
        task.state === 'needs'
          ? 'text-needs'
          : task.state === 'snag'
            ? 'text-snag'
            : dim
              ? 'text-fg-4'
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
          className="no-drag inline-flex h-[20px] w-[22px] items-center justify-center rounded-[5px] text-fg-3 transition-colors hover:bg-veil-2 hover:text-fg"
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
          className="no-drag inline-flex h-[20px] w-[22px] items-center justify-center rounded-[5px] text-fg-3 transition-colors hover:bg-veil-2 hover:text-fg"
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
  const ask = (prompt: string, connector: ConnectorId): void => {
    void api.create(prompt, { connector })
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
          <p className="text-[13px] font-medium text-needs">
            There is no model key, so I can’t think yet.
          </p>
          <p className="mt-1 text-[12px] leading-relaxed text-fg-3">
            Add <Code>LLM_API_KEY</Code> to a <Code>.env</Code> file and restart. Until then nothing
            here is simulated — it just can’t run.
          </p>
        </div>
      ) : (
        <>
          {/* The model used to be named here, in a brighter white than the rest
              of the sentence, as though knowing which weights are loaded were
              part of what this app is for. It isn't. It is a detail that
              belongs in Connections, where the rest of the plumbing lives, and
              dropping it here let the sentence say the thing that matters. */}
          <p className="mt-2 max-w-[34rem] text-[12.5px] leading-relaxed text-fg-3">
            I use a real browser, a real shell and the real filesystem — and I stop and ask before
            anything I can’t take back. Each of these names the engine that should do it, so you can
            watch the work go where it belongs rather than being quietly re-routed.
          </p>

          <ul className="mt-6 grid gap-1.5">
            {STARTERS.map(({ label, hint, prompt, engine }) => (
              <li key={label}>
                <button
                  type="button"
                  onClick={() => ask(prompt, engine)}
                  className="no-drag group flex w-full items-start gap-3 rounded-[10px] border border-line bg-ink-1/50 px-3.5 py-2.5 text-left transition-colors hover:border-line-2 hover:bg-ink-1"
                >
                  <I.ArrowRight className="mt-[3px] shrink-0 text-fg-4 transition-colors group-hover:text-fg-2 [&_svg]:h-[13px] [&_svg]:w-[13px]" />
                  <span className="min-w-0">
                    <span className="block text-[13px] text-fg-2">{label}</span>
                    <span className="mt-0.5 block text-[11.5px] leading-relaxed text-fg-3">
                      {hint}
                    </span>
                  </span>
                  <span className="num ml-auto shrink-0 self-center text-[10.5px] text-fg-4">
                    {connectorLabel(engine)}
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
 *
 * Each one pins the engine that should handle it. Handing "what are the open
 * issues on this repo" to the local model means opening a browser, waiting for
 * a client-side router to hydrate and reading the DOM to produce a list that
 * one API call returns; the engine named on the row is the one that does it
 * properly.
 */
const STARTERS: {
  label: string
  hint: string
  prompt: string
  engine: ConnectorId
}[] = [
  {
    label: 'Read a repository’s open issues',
    hint: 'One API request returns the real rows — number, title, author, labels, link.',
    prompt: 'Give me the latest five open issues in vercel/next.js',
    engine: 'github'
  },
  {
    label: 'Research something on the web',
    hint: 'Searches, reads the pages, and checks its own answer before calling it done.',
    prompt: 'Find out what the current Node.js LTS version is, and tell me when it went into LTS.',
    engine: 'grok'
  },
  {
    label: 'Drive a real browser',
    hint: 'Opens pages in a hidden Chromium window and clicks with real mouse events.',
    prompt:
      'Open duckduckgo.com, search for "best coffee shop in Seattle", and tell me the name and address of the top result.',
    engine: 'pi'
  },
  {
    label: 'Have it write and change code',
    hint: 'Hands the job to a real coding agent in a folder, and reports the files it changed.',
    prompt:
      'In the current project, write a Python script called fib.py that prints the first 20 Fibonacci numbers, then run it and paste the output.',
    engine: 'claude'
  },
  {
    label: 'Touch the files on this machine',
    hint: 'Reads and writes inside your own folders, and refuses anything outside them.',
    prompt:
      'Create a file called shop-list.md in my Documents folder with a weekly shopping list for two people, then read it back.',
    engine: 'pi'
  }
]
