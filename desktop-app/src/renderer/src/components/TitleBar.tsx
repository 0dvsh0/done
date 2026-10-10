import { AnimatePresence, motion } from 'motion/react'
import type { AppState } from '../../../shared/types'
import { cx } from '../lib/format'
import { api, useUI } from '../store'
import { IconButton } from './primitives'
import { Kbd } from './Icons'
import * as I from './Icons'

/**
 * The wordmark's period is the app's heartbeat. It breathes while work is
 * happening and beckons — amber, once — when something needs a decision.
 * No badge, no badge-dot in a corner: the brand itself carries the state.
 */
export function TitleBar({ state }: { state: AppState }): React.JSX.Element {
  const togglePalette = useUI((s) => s.togglePalette)
  const showSheet = useUI((s) => s.showSheet)
  const allPaused = state.allPaused
  const needs = state.tasks.some((t) => t.state === 'needs')
  const working = state.tasks.some((t) => t.state === 'working' || t.state === 'snag')
  const platform = window.system.platform
  const isMac = platform === 'darwin'

  const tone = needs ? 'needs' : working && !allPaused ? 'working' : 'idle'

  return (
    <header
      className={cx(
        'drag relative z-30 flex h-11 shrink-0 items-center border-b border-line bg-ink-0'
      )}
      // Double-clicking the bar maximises, the way a native window does.
      onDoubleClick={() => void window.done.windowAction('maximize')}
    >
      {/* wordmark */}
      <div className={cx('flex items-center', isMac ? 'pl-[78px]' : 'pl-4')}>
        <div className="flex items-baseline text-[15px] font-medium tracking-[-0.045em] text-fg">
          done
          <span className="relative ml-[0.09em] inline-block h-[4.5px] w-[4.5px]">
            <motion.span
              className="absolute inset-0 rounded-full"
              animate={{
                backgroundColor:
                  tone === 'needs'
                    ? 'var(--color-needs)'
                    : tone === 'working'
                      ? 'var(--color-fg)'
                      : 'var(--color-fg)',
                scale: tone === 'needs' ? [1, 1.35, 1] : tone === 'working' ? [1, 0.6, 1] : 1,
                opacity: tone === 'idle' ? 0.85 : 1
              }}
              transition={
                tone === 'idle'
                  ? { duration: 0.3 }
                  : { duration: 2.6, repeat: Infinity, ease: 'easeInOut' }
              }
            />
          </span>
        </div>

        <div className="ml-3 h-3.5 w-px bg-line" />

        <button
          type="button"
          onClick={() => api.pauseAll(!allPaused)}
          title={allPaused ? 'Resume everything' : 'Pause everything'}
          className={cx(
            'no-drag ml-3 inline-flex items-center gap-1.5 rounded-[6px] px-1.5 py-1 text-[12px]',
            'transition-colors hover:bg-white/[0.05]',
            allPaused ? 'text-needs' : 'text-fg-3 hover:text-fg-2'
          )}
        >
          {allPaused ? (
            <I.Play className="[&_svg]:h-[13px] [&_svg]:w-[13px]" />
          ) : (
            <I.Pause className="[&_svg]:h-[13px] [&_svg]:w-[13px]" />
          )}
          <span className="num">{allPaused ? 'Resume all' : 'Pause all'}</span>
        </button>
      </div>

      {/* tools */}
      <div className={cx('ml-auto flex items-center gap-0.5', isMac ? 'pr-3' : 'pr-2')}>
        <button
          type="button"
          onClick={() => togglePalette()}
          className={cx(
            'no-drag mr-1 inline-flex h-[26px] items-center gap-2 rounded-[7px] border border-line',
            'bg-white/[0.02] px-2.5 text-[12px] text-fg-4 transition-colors',
            'hover:border-line-2 hover:bg-white/[0.05] hover:text-fg-3'
          )}
        >
          <I.Search className="[&_svg]:h-[13px] [&_svg]:w-[13px]" />
          <span>Search</span>
          <Kbd className="ml-1">⌘K</Kbd>
        </button>

        <IconButton label="What it can do on its own" onClick={() => showSheet('limits')}>
          <I.Shield />
        </IconButton>
        <IconButton label="Shortcuts" onClick={() => showSheet('shortcuts')}>
          <I.Keyboard />
        </IconButton>
        <IconButton label="Connections" onClick={() => showSheet('connections')}>
          <I.Trace />
        </IconButton>
      </div>

      {!isMac && <WindowControls />}
    </header>
  )
}

/* ------------------------------------------------------- window controls */

function WindowControls(): React.JSX.Element {
  const maximized = useUI((s) => s.maximized)
  return (
    <div className="no-drag -mr-[7px] flex h-full items-stretch">
      <WCButton label="Minimise" onClick={() => void window.done.windowAction('minimize')}>
        <I.Minus className="[&_svg]:h-[15px] [&_svg]:w-[15px]" />
      </WCButton>
      <WCButton
        label={maximized ? 'Restore' : 'Maximise'}
        onClick={() => void window.done.windowAction('maximize')}
      >
        {maximized ? (
          <I.Overlap className="[&_svg]:h-[15px] [&_svg]:w-[15px]" />
        ) : (
          <I.Square className="[&_svg]:h-[14px] [&_svg]:w-[14px]" />
        )}
      </WCButton>
      <WCButton label="Close window" danger onClick={() => void window.done.windowAction('close')}>
        <I.Close className="[&_svg]:h-[15px] [&_svg]:w-[15px]" />
      </WCButton>
    </div>
  )
}

function WCButton({
  children,
  onClick,
  label,
  danger
}: {
  children: React.ReactNode
  onClick: () => void
  label: string
  danger?: boolean
}): React.JSX.Element {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={cx(
        'no-drag group flex w-[46px] items-center justify-center text-fg-4',
        'transition-colors duration-100 hover:bg-white/[0.06] hover:text-fg-2',
        danger && 'hover:bg-[#c8382f] hover:text-white'
      )}
    >
      {children}
    </button>
  )
}

/* ------------------------------------------------------------------ toast */

export function Toast(): React.JSX.Element {
  const toastState = useUI((s) => s.toast)
  const clear = useUI((s) => s.clearToast)

  return (
    <AnimatePresence>
      {toastState && (
        <motion.div
          role="status"
          initial={{ opacity: 0, y: 14, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 8, scale: 0.98 }}
          transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
          className="pointer-events-none fixed inset-x-0 bottom-9 z-40 flex justify-center"
        >
          <div className="pointer-events-auto flex items-center gap-3 rounded-full border border-line-2 bg-ink-2 py-1.5 pr-1.5 pl-4 shadow-[0_18px_50px_-12px_rgba(0,0,0,0.9)]">
            <span className="text-[13px] text-fg-2">{toastState.text}</span>
            {toastState.undo && (
              <button
                type="button"
                onClick={() => {
                  void api.undo()
                  clear()
                }}
                className="no-drag inline-flex h-[24px] items-center gap-1.5 rounded-full bg-white/[0.07] px-2.5 text-[12px] text-fg transition-colors hover:bg-white/[0.12]"
              >
                <I.Undo className="[&_svg]:h-[13px] [&_svg]:w-[13px]" />
                Undo
              </button>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
