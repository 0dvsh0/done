import { AnimatePresence, motion } from 'motion/react'
import type { ReactNode } from 'react'
import { cx } from '../lib/format'
import { Close } from './Icons'

/* ------------------------------------------------------------------ button */

type ButtonProps = {
  children: ReactNode
  onClick?: () => void
  variant?: 'solid' | 'ghost' | 'quiet'
  size?: 'sm' | 'md'
  disabled?: boolean
  className?: string
  title?: string
  type?: 'button' | 'submit'
  autoFocus?: boolean
}

export function Button({
  children,
  onClick,
  variant = 'ghost',
  size = 'md',
  disabled,
  className,
  title,
  type = 'button',
  autoFocus
}: ButtonProps): React.JSX.Element {
  return (
    <button
      type={type}
      title={title}
      disabled={disabled}
      autoFocus={autoFocus}
      onClick={onClick}
      className={cx(
        'no-drag inline-flex items-center justify-center gap-1.5 rounded-[8px] font-medium',
        'transition-colors duration-150 select-none',
        size === 'sm' ? 'h-[26px] px-2.5 text-[12px]' : 'h-[32px] px-3.5 text-[13px]',
        variant === 'solid' &&
          'bg-fg text-ink-0 hover:bg-white disabled:hover:bg-fg disabled:opacity-30',
        variant === 'ghost' &&
          'border border-line-2 text-fg-2 hover:bg-white/[0.045] hover:text-fg disabled:opacity-30',
        variant === 'quiet' && 'text-fg-3 hover:bg-white/[0.045] hover:text-fg-2',
        'disabled:cursor-default',
        className
      )}
    >
      {children}
    </button>
  )
}

export function IconButton({
  children,
  onClick,
  label,
  active,
  className,
  size = 30
}: {
  children: ReactNode
  onClick?: () => void
  label: string
  active?: boolean
  className?: string
  size?: number
}): React.JSX.Element {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      style={{ width: size, height: size }}
      className={cx(
        'no-drag inline-flex items-center justify-center rounded-[7px] text-fg-3',
        'transition-colors duration-150 hover:bg-white/[0.055] hover:text-fg',
        active && 'bg-white/[0.07] text-fg',
        className
      )}
    >
      {children}
    </button>
  )
}

/* ------------------------------------------------------------------ switch */

export function Switch({
  checked,
  onChange,
  label,
  locked,
  className
}: {
  checked: boolean
  onChange?: (next: boolean) => void
  label?: string
  locked?: boolean
  className?: string
}): React.JSX.Element {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      aria-disabled={locked}
      disabled={locked}
      onClick={() => onChange?.(!checked)}
      className={cx(
        'no-drag relative h-[16px] w-[28px] shrink-0 rounded-full transition-colors duration-200',
        checked ? (locked ? 'bg-fg-3' : 'bg-fg/85') : 'bg-white/[0.09]',
        locked && 'cursor-default opacity-70',
        className
      )}
    >
      <motion.span
        layout
        transition={{ type: 'spring', stiffness: 700, damping: 42 }}
        className={cx(
          'absolute top-[2px] h-[12px] w-[12px] rounded-full',
          checked ? 'bg-ink-0' : 'bg-fg-3'
        )}
        style={{ left: checked ? 14 : 2 }}
      />
    </button>
  )
}

/* --------------------------------------------------------------- segmented */

export function Segmented<T extends string | number>({
  options,
  value,
  onChange,
  ariaLabel
}: {
  options: { value: T; label: ReactNode }[]
  value: T
  onChange: (v: T) => void
  ariaLabel: string
}): React.JSX.Element {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className="inline-flex items-center gap-0.5 rounded-[9px] border border-line bg-ink-1 p-0.5"
    >
      {options.map((o) => {
        const on = o.value === value
        return (
          <button
            key={String(o.value)}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(o.value)}
            className={cx(
              'no-drag relative rounded-[6px] px-2.5 py-[3px] text-[12px] num transition-colors duration-150',
              on ? 'text-fg' : 'text-fg-3 hover:text-fg-2'
            )}
          >
            {on && (
              <motion.span
                layoutId={`seg-${ariaLabel}`}
                transition={{ type: 'spring', stiffness: 600, damping: 44 }}
                className="absolute inset-0 rounded-[6px] bg-white/[0.08]"
              />
            )}
            <span className="relative">{o.label}</span>
          </button>
        )
      })}
    </div>
  )
}

/* ------------------------------------------------------------------- sheet */

export function Sheet({
  open,
  onClose,
  title,
  subtitle,
  children,
  width = 520,
  footer
}: {
  open: boolean
  onClose: () => void
  title: string
  subtitle?: string
  children: ReactNode
  width?: number
  footer?: ReactNode
}): React.JSX.Element {
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 flex items-start justify-center pt-[13vh]"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
        >
          <div
            className="absolute inset-0 bg-black/45 backdrop-blur-[2px]"
            onClick={onClose}
            aria-hidden="true"
          />
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label={title}
            initial={{ opacity: 0, y: -10, scale: 0.985 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.99 }}
            transition={{ duration: 0.26, ease: [0.16, 1, 0.3, 1] }}
            style={{ width }}
            className={cx(
              'relative overflow-hidden rounded-[16px] border border-line-2 bg-ink-1',
              'shadow-[0_28px_90px_-12px_rgba(0,0,0,0.85)]'
            )}
          >
            <header className="flex items-start justify-between gap-6 px-6 pt-5 pb-4">
              <div>
                <h2 className="voice text-[19px] leading-tight text-fg">{title}</h2>
                {subtitle && <p className="mt-1 text-[12.5px] text-fg-3">{subtitle}</p>}
              </div>
              <CloseButton onClick={onClose} />
            </header>
            <div className="max-h-[62vh] overflow-y-auto px-6 pb-2">{children}</div>
            {footer && <footer className="border-t border-line px-6 py-3.5">{footer}</footer>}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

export function CloseButton({ onClick }: { onClick: () => void }): React.JSX.Element {
  return (
    <button
      type="button"
      data-sheet-close
      aria-label="Close"
      onClick={onClick}
      className={cx(
        'no-drag -mt-0.5 -mr-1.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-[7px]',
        'text-fg-4 transition-colors hover:bg-white/[0.06] hover:text-fg-2'
      )}
    >
      <Close />
    </button>
  )
}

/* ------------------------------------------------------------------ toggle */

export function Field({
  title,
  hint,
  children,
  locked
}: {
  title: string
  hint?: string
  children: ReactNode
  locked?: boolean
}): React.JSX.Element {
  return (
    <div className="flex items-start justify-between gap-6 border-b border-line py-3.5 last:border-b-0">
      <div className="min-w-0">
        <p className={cx('text-[13.5px]', locked ? 'text-fg-2' : 'text-fg')}>{title}</p>
        {hint && <p className="mt-0.5 text-[12px] leading-snug text-fg-3">{hint}</p>}
      </div>
      <div className="shrink-0 pt-0.5">{children}</div>
    </div>
  )
}

/* ------------------------------------------------------------------- label */

export function SectionLabel({ children }: { children: ReactNode }): React.JSX.Element {
  return (
    <h3 className="mb-2 text-[10.5px] font-medium tracking-[0.09em] text-fg-4 uppercase">
      {children}
    </h3>
  )
}
