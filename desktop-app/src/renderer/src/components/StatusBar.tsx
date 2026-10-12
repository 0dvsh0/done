import { motion } from 'motion/react'
import type { AppState } from '../../../shared/types'
import { ago, cx, minutes, money } from '../lib/format'
import { useUI } from '../store'

/**
 * The quietest strip in the app. Three numbers, two connections, no labels
 * you'd have to read. It is the only place the ledger exists.
 */
export function StatusBar({ state }: { state: AppState }): React.JSX.Element {
  const showSheet = useUI((s) => s.showSheet)
  const { ledger, integrations } = state

  return (
    <footer className="flex h-[26px] shrink-0 items-center gap-3 border-t border-line bg-ink-0 px-4 text-[11px] text-fg-3 select-none">
      <span className="num">
        {ledger.spent > 0
          ? `Spent ${money(ledger.spent)} today, all approved by you`
          : 'Spent nothing today'}
      </span>
      <span className="text-fg-4">·</span>
      <span className="num">Saved you about {minutes(ledger.minutes)}</span>

      <div className="ml-auto flex items-center gap-3">
        <Chip
          tone={
            integrations.neatlogs.connected
              ? 'on'
              : integrations.neatlogs.installed
                ? 'idle'
                : 'off'
          }
          onClick={() => showSheet('connections')}
          label={
            integrations.neatlogs.connected
              ? `neatlogs · ${integrations.neatlogs.spansExported} spans exported`
              : integrations.neatlogs.installed
                ? 'neatlogs · local only'
                : 'neatlogs · not installed'
          }
        />
        <Chip
          tone={integrations.entire.enabled ? 'on' : integrations.entire.installed ? 'idle' : 'off'}
          onClick={() => showSheet('connections')}
          label={
            integrations.entire.enabled
              ? `Entire · ${integrations.entire.checkpoints} checkpoint${
                  integrations.entire.checkpoints === 1 ? '' : 's'
                }`
              : integrations.entire.installed
                ? 'Entire · not enabled'
                : 'Entire · not installed'
          }
        />
        <span className="num text-fg-4">
          {integrations.neatlogs.lastExportAt
            ? `traced ${ago(integrations.neatlogs.lastExportAt)}`
            : ''}
        </span>
      </div>
    </footer>
  )
}

function Chip({
  label,
  tone,
  onClick
}: {
  label: string
  tone: 'on' | 'idle' | 'off'
  onClick: () => void
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className="no-drag inline-flex items-center gap-1.5 rounded-[5px] px-1 py-[1px] text-fg-3 transition-colors hover:bg-veil hover:text-fg-2"
    >
      <motion.span
        aria-hidden="true"
        initial={false}
        animate={{ opacity: tone === 'off' ? 0.55 : 1 }}
        className={cx(
          'h-[4px] w-[4px] rounded-full',
          tone === 'on' ? 'bg-calm' : tone === 'idle' ? 'bg-needs' : 'bg-fg-4'
        )}
      />
      <span className="num">{label}</span>
    </button>
  )
}

/* ---------------------------------------------------------- day heading */

export function DayHeader({ state }: { state: AppState }): React.JSX.Element {
  const summary = (() => {
    const needs = state.tasks.filter((t) => t.state === 'needs').length
    const going = state.tasks.filter(
      (t) => t.state === 'working' || t.state === 'snag' || t.state === 'waiting'
    ).length
    const words = [
      'No',
      'One',
      'Two',
      'Three',
      'Four',
      'Five',
      'Six',
      'Seven',
      'Eight',
      'Nine',
      'Ten'
    ]
    if (state.allPaused) return 'Everything’s paused. Nothing will move until you say.'
    if (!needs && !going) return 'Everything’s done. Nothing needs you.'
    const parts: string[] = []
    if (needs) {
      parts.push(`${words[needs] ?? needs} thing${needs === 1 ? ' needs' : 's need'} you.`)
    }
    if (going) parts.push(`${words[going] ?? going} going quietly.`)
    return parts.join(' ')
  })()

  const today = new Date()
  const dayName = today.toLocaleDateString(undefined, { weekday: 'long' })
  const date = today.toLocaleDateString(undefined, { month: 'long', day: 'numeric' })

  return (
    <div className="column pt-7 pb-4">
      <h1 className="voice flex items-baseline gap-3 text-[27px] leading-none text-fg">
        {dayName}
        <span className="num text-[12.5px] font-normal text-fg-3">{date}</span>
      </h1>
      <motion.p
        key={summary}
        initial={{ opacity: 0, y: 3 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.32, ease: [0.16, 1, 0.3, 1] }}
        className={cx('mt-2 text-[13.5px]', state.allPaused ? 'text-needs' : 'text-fg-3')}
        aria-live="polite"
      >
        {summary}
      </motion.p>
    </div>
  )
}
