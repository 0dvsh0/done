import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { cx } from '../lib/format'
import { Check, Chevron, Close } from './Icons'

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
        // Solid inverts the ramp rather than picking a new hue, so it is the
        // right button in either mode without a second colour to maintain.
        variant === 'solid' &&
          'bg-fg text-ink-0 hover:opacity-88 disabled:hover:opacity-100 disabled:opacity-35',
        variant === 'ghost' &&
          'border border-line-2 text-fg-2 hover:bg-veil hover:text-fg disabled:opacity-40',
        variant === 'quiet' && 'text-fg-3 hover:bg-veil hover:text-fg',
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
        'transition-colors duration-150 hover:bg-veil hover:text-fg',
        active && 'bg-veil-2 text-fg',
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
        checked ? (locked ? 'bg-fg-4' : 'bg-fg') : 'bg-veil-2',
        'border border-transparent',
        !checked && 'border-line-2',
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

/**
 * A sunken track with a raised selection.
 *
 * Both are stated as *surfaces* rather than as tints, which is what makes the
 * pill sit up in the dark and stay up in the light. A tinted pill would have
 * been darker than its track in one mode and lighter in the other — the kind
 * of detail that only shows up once both exist.
 */
export function Segmented<T extends string | number>({
  options,
  value,
  onChange,
  ariaLabel,
  fallbackLabel
}: {
  options: { value: T; label: ReactNode }[]
  value: T
  onChange: (v: T) => void
  ariaLabel: string
  /**
   * Shown as an extra, unselectable segment when `value` is not one of the
   * options. Without it a value set from anywhere else leaves the control with
   * nothing lit, which reads as broken rather than as "this is not on the
   * scale" — and the number you had actually chosen disappears.
   */
  fallbackLabel?: string
}): React.JSX.Element {
  const known = options.some((o) => o.value === value)
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className="inline-flex items-center gap-0.5 rounded-[9px] border border-line bg-ink-0 p-0.5"
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
                className="absolute inset-0 rounded-[6px] bg-ink-1 shadow-[0_1px_2px_rgb(0_0_0_/_0.12)]"
              />
            )}
            <span className="relative">{o.label}</span>
          </button>
        )
      })}

      {!known && fallbackLabel !== undefined && (
        <span className="relative rounded-[6px] bg-ink-1 px-2.5 py-[3px] text-[12px] text-fg num shadow-[0_1px_2px_rgb(0_0_0_/_0.12)]">
          {fallbackLabel}
        </span>
      )}
    </div>
  )
}

/* -------------------------------------------------------------------- menu */

export interface MenuOption<T extends string | number> {
  value: T
  label: string
  /** The detail that tells two similar options apart. */
  note?: string
}

/**
 * A value you pick from a list, in the space a chip occupies.
 *
 * This exists because cycling a chip through four values is not a control. You
 * press it, the label changes to something you did not choose, and there is no
 * way to see what the other options are or to go back to the one you had. A
 * "money" chip that walked $25 → $100 → $500 → "no spending" was the worst
 * case, because the label it left behind read as a sentence fragment.
 *
 * So: the trigger shows the current value, and the list shows every value with
 * what it means.
 */
export function Menu<T extends string | number>({
  label,
  value,
  options,
  onChange,
  title,
  className,
  id
}: {
  label: string
  value: T
  options: MenuOption<T>[]
  onChange: (v: T) => void
  title?: string
  className?: string
  id?: string
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const current = options.find((o) => o.value === value)

  useEffect(() => {
    if (!open) return
    const away = (e: MouseEvent): void => {
      if (!root.current?.contains(e.target as Node)) setOpen(false)
    }
    const key = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', away)
    document.addEventListener('keydown', key)
    return () => {
      document.removeEventListener('mousedown', away)
      document.removeEventListener('keydown', key)
    }
  }, [open])

  return (
    <div ref={root} className={cx('relative', className)}>
      <button
        id={id}
        type="button"
        title={title}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className={cx(
          'no-drag inline-flex h-[24px] items-center gap-1.5 rounded-[7px] border px-2',
          'text-[11.5px] transition-colors',
          open
            ? 'border-line-2 bg-veil-2 text-fg'
            : 'border-line text-fg-3 hover:border-line-2 hover:bg-veil hover:text-fg-2'
        )}
      >
        <span className="text-fg-4">{label}</span>
        <span className="max-w-[13rem] truncate text-fg-2">{current?.label ?? String(value)}</span>
        <Chevron
          className={cx(
            'shrink-0 text-fg-4 transition-transform duration-150 [&_svg]:h-[11px] [&_svg]:w-[11px]',
            open ? 'rotate-180' : ''
          )}
        />
      </button>

      {open && (
        <div
          role="listbox"
          className="absolute bottom-[calc(100%+6px)] left-0 z-40 min-w-[210px] overflow-hidden rounded-[10px] border border-line-2 bg-ink-1 py-1 shadow-float"
        >
          {options.map((o) => (
            <button
              key={String(o.value)}
              type="button"
              role="option"
              aria-selected={o.value === value}
              onClick={() => {
                onChange(o.value)
                setOpen(false)
              }}
              className={cx(
                'flex w-full items-baseline gap-3 px-3 py-[7px] text-left transition-colors',
                o.value === value ? 'bg-veil-2' : 'hover:bg-veil'
              )}
            >
              <span className="flex-1 text-[12.5px] text-fg">
                {o.label}
                {o.note && <span className="mt-0.5 block text-[11px] text-fg-4">{o.note}</span>}
              </span>
              {o.value === value && (
                <Check className="shrink-0 text-fg-3 [&_svg]:h-[12px] [&_svg]:w-[12px]" />
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ sheet */

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
            className="absolute inset-0 bg-scrim backdrop-blur-[3px]"
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
              'shadow-float'
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
        'text-fg-4 transition-colors hover:bg-veil hover:text-fg'
      )}
    >
      <Close />
    </button>
  )
}

/* ----------------------------------------------------------------- field */

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

/* ------------------------------------------------------------------ label */

/**
 * A literal you have to set or type — an environment variable, an endpoint, a
 * file. It reads as code because it *is* code, and it sits on the ramp so it
 * can be read from across a room.
 */
export function Code({
  children,
  className
}: {
  children: ReactNode
  className?: string
}): React.JSX.Element {
  return (
    <code
      className={cx(
        'rounded-[4px] border border-line bg-mark px-1.5 py-px font-mono text-[0.92em] text-fg-2',
        className
      )}
    >
      {children}
    </code>
  )
}

/**
 * Every small-caps label in the app — sections, block headings, column
 * headers. Uppercase and widely tracked is the least legible text there is,
 * so the label is given size and colour on the ramp rather than being faded
 * into the background to look quiet.
 */
export function SectionLabel({
  children,
  className
}: {
  children: ReactNode
  className?: string
}): React.JSX.Element {
  return (
    <h3
      className={cx(
        'mb-2 text-[10.5px] font-medium tracking-[0.09em] text-fg-3 uppercase',
        className
      )}
    >
      {children}
    </h3>
  )
}
