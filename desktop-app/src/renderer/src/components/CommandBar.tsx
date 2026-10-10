import { AnimatePresence, motion } from 'motion/react'
import { useMemo, useState } from 'react'
import type { AppState } from '../../../shared/types'
import { cx } from '../lib/format'
import { api, toast, useUI } from '../store'
import { Dot } from './Dot'
import * as I from './Icons'
import { Kbd } from './Icons'

interface Command {
  id: string
  label: string
  hint?: string
  keys?: string[]
  run: () => void
  icon: React.ReactNode
}

/**
 * Everything the app can do, behind one keystroke. Tasks and verbs live in
 * the same list so you never have to remember where a thing is.
 */
export function CommandBar({ state }: { state: AppState }): React.JSX.Element {
  const open = useUI((s) => s.palette)

  return (
    <AnimatePresence>
      {/* Keyed so every opening starts from a clean query and cursor. */}
      {open && <Palette key="palette" state={state} />}
    </AnimatePresence>
  )
}

function Palette({ state }: { state: AppState }): React.JSX.Element {
  const toggle = useUI((s) => s.togglePalette)
  const under = useUI((s) => s.under)
  const openId = useUI((s) => s.openId)
  const openTask = useUI((s) => s.openTask)
  const showTrace = useUI((s) => s.showTrace)
  const [q, setQ] = useState('')
  const [cursor, setCursor] = useState(0)

  const close = (): void => toggle(false)

  const commands = useMemo<Command[]>(() => {
    const openTask_ = openId
    const list: Command[] = [
      {
        id: 'new',
        label: 'Write something new',
        keys: ['N'],
        icon: <I.Plus className="[&_svg]:h-[14px] [&_svg]:w-[14px]" />,
        run: () => {
          close()
          setTimeout(() => document.querySelector<HTMLInputElement>('[data-composer]')?.focus(), 40)
        }
      },
      {
        id: 'pause',
        label: state.allPaused ? 'Resume everything' : 'Pause everything',
        icon: state.allPaused ? (
          <I.Play className="[&_svg]:h-[14px] [&_svg]:w-[14px]" />
        ) : (
          <I.Pause className="[&_svg]:h-[14px] [&_svg]:w-[14px]" />
        ),
        run: () => {
          void api.pauseAll(!state.allPaused)
          close()
        }
      },
      {
        id: 'limits',
        label: 'What it can do on its own',
        keys: [','],
        icon: <I.Shield className="[&_svg]:h-[14px] [&_svg]:w-[14px]" />,
        run: () => {
          useUI.getState().showSheet('limits')
          close()
        }
      },
      {
        id: 'under',
        label: under ? 'Hide what’s underneath' : 'Show what’s underneath',
        keys: ['U'],
        icon: <I.Trace className="[&_svg]:h-[14px] [&_svg]:w-[14px]" />,
        run: () => {
          useUI.getState().toggleUnder()
          close()
        }
      },
      {
        id: 'trace',
        label: 'Look under the hood',
        hint: openTask_ ? 'for the open task' : undefined,
        keys: ['⌘', 'T'],
        icon: <I.Trace className="[&_svg]:h-[14px] [&_svg]:w-[14px]" />,
        run: () => {
          if (openTask_) showTrace(openTask_)
          else toast('Open a task first.')
          close()
        }
      },
      {
        id: 'business',
        label: 'Pay per period',
        hint: 'the economics, in cfo.ai',
        icon: <I.Coin className="[&_svg]:h-[14px] [&_svg]:w-[14px]" />,
        run: () => {
          useUI.getState().showSheet('business')
          close()
        }
      },
      {
        id: 'connections',
        label: 'Connections',
        hint: 'neatlogs · Entire',
        icon: <I.Overlap className="[&_svg]:h-[14px] [&_svg]:w-[14px]" />,
        run: () => {
          useUI.getState().showSheet('connections')
          close()
        }
      },
      {
        id: 'keys',
        label: 'Shortcuts',
        keys: ['?'],
        icon: <I.Keyboard className="[&_svg]:h-[14px] [&_svg]:w-[14px]" />,
        run: () => {
          useUI.getState().showSheet('shortcuts')
          close()
        }
      },
      {
        id: 'undo',
        label: 'Undo the last thing',
        keys: ['⌘', 'Z'],
        icon: <I.Undo className="[&_svg]:h-[14px] [&_svg]:w-[14px]" />,
        run: () => {
          void api.undo()
          close()
        }
      },
      {
        id: 'clear',
        label: 'Clear everything finished',
        icon: <I.Check className="[&_svg]:h-[14px] [&_svg]:w-[14px]" />,
        run: () => {
          void api.clearFinished()
          close()
        }
      }
    ]
    return list
  }, [state.allPaused, under, openId])

  const tasks = useMemo(
    () =>
      state.tasks
        .filter((t) => !q || t.title.toLowerCase().includes(q.toLowerCase()))
        .slice(0, 6)
        .map<Command>((t) => ({
          id: `task-${t.id}`,
          label: t.title,
          hint: t.state === 'needs' ? 'needs you' : undefined,
          icon: <Dot state={t.state} progress={t.progress} size={14} />,
          run: () => {
            openTask(t.id)
            close()
          }
        })),
    [state.tasks, q, openTask]
  )

  const matches = useMemo(() => {
    const needle = q.trim().toLowerCase()
    const cmds = needle ? commands.filter((c) => c.label.toLowerCase().includes(needle)) : commands
    return [...cmds.slice(0, needle ? 5 : 7), ...tasks]
  }, [q, commands, tasks])

  // Clamp rather than reset in an effect: typing narrows the list, and the
  // cursor should never point past its end.
  const active = Math.min(cursor, Math.max(0, matches.length - 1))

  return (
    <motion.div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh]"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.15 }}
    >
      <div className="absolute inset-0 bg-black/45 backdrop-blur-[2px]" onClick={close} />
      <motion.div
        initial={{ opacity: 0, y: -10, scale: 0.985 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: -8, scale: 0.99 }}
        transition={{ duration: 0.26, ease: [0.16, 1, 0.3, 1] }}
        className="relative w-[600px] overflow-hidden rounded-[14px] border border-line-2 bg-ink-1 shadow-[0_28px_90px_-12px_rgba(0,0,0,0.85)]"
      >
        <div className="flex items-center gap-2.5 border-b border-line px-4 py-3">
          <I.Search className="text-fg-4 [&_svg]:h-[15px] [&_svg]:w-[15px]" />
          <input
            autoFocus
            value={q}
            onChange={(e) => {
              setQ(e.target.value)
              setCursor(0)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') return close()
              if (e.key === 'ArrowDown') {
                e.preventDefault()
                setCursor((c) => Math.min(matches.length - 1, c + 1))
              }
              if (e.key === 'ArrowUp') {
                e.preventDefault()
                setCursor((c) => Math.max(0, c - 1))
              }
              if (e.key === 'Enter') {
                e.preventDefault()
                matches[active]?.run()
              }
            }}
            placeholder="Search your list, or type a command…"
            className="min-w-0 flex-1 bg-transparent text-[14px] placeholder:text-fg-5"
          />
          <Kbd>esc</Kbd>
        </div>

        <div className="max-h-[46vh] overflow-y-auto py-1.5">
          {matches.length === 0 && (
            <p className="px-4 py-6 text-center text-[13px] text-fg-5">Nothing matches “{q}”.</p>
          )}
          {matches.map((c, i) => (
            <button
              key={c.id}
              type="button"
              onMouseEnter={() => setCursor(i)}
              onClick={c.run}
              className={cx(
                'flex w-full items-center gap-3 px-4 py-[7px] text-left transition-colors',
                i === active ? 'bg-white/[0.06]' : ''
              )}
            >
              <span className="flex h-[18px] w-[18px] shrink-0 items-center justify-center text-fg-3">
                {c.icon}
              </span>
              <span className="min-w-0 flex-1 truncate text-[13px] text-fg">{c.label}</span>
              {c.hint && <span className="shrink-0 text-[11px] text-needs">{c.hint}</span>}
              {c.keys && (
                <span className="flex shrink-0 gap-1">
                  {c.keys.map((k) => (
                    <Kbd key={k}>{k}</Kbd>
                  ))}
                </span>
              )}
            </button>
          ))}
        </div>
      </motion.div>
    </motion.div>
  )
}
