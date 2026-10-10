import { cx } from '../lib/format'

/**
 * Hand-drawn on a 20×20 grid at 1.4 stroke. Drawn here rather than pulled
 * from a pack so the weights match the hairlines everywhere else.
 */
const S = ({ children, className }: { children: React.ReactNode; className?: string }): React.JSX.Element => (
  <svg
    viewBox="0 0 20 20"
    width="18"
    height="18"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.4"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    className={cx('shrink-0', className)}
  >
    {children}
  </svg>
)

export const Pause = (p: { className?: string }): React.JSX.Element => (
  <S className={p.className}>
    <path d="M7.6 5.6v8.8M12.4 5.6v8.8" strokeWidth="1.5" />
  </S>
)

export const Play = (p: { className?: string }): React.JSX.Element => (
  <S className={p.className}>
    <path d="M7 5.8 13.6 10 7 14.2V5.8Z" />
  </S>
)

export const Stop = (p: { className?: string }): React.JSX.Element => (
  <S className={p.className}>
    <rect x="6.4" y="6.4" width="7.2" height="7.2" rx="1.6" />
  </S>
)

export const Steer = (p: { className?: string }): React.JSX.Element => (
  <S className={p.className}>
    <path d="M4 10h12" />
    <path d="M12.6 6.4 16 10l-3.4 3.6" />
    <path d="M7.4 6.4 4 10l3.4 3.6" opacity="0.45" />
  </S>
)

export const Hand = (p: { className?: string }): React.JSX.Element => (
  <S className={p.className}>
    <path d="M7 9.2V5.6a1.1 1.1 0 0 1 2.2 0v3.1" />
    <path d="M9.2 8.4V4.9a1.1 1.1 0 0 1 2.2 0v3.9" />
    <path d="M11.4 8.9V6.4a1.1 1.1 0 0 1 2.2 0v5.1c0 2.3-1.7 4.1-4 4.1-2 0-3.2-1-4-2.4L4.4 11a1.05 1.05 0 0 1 1.8-1.1l.8 1.1" />
  </S>
)

export const Shield = (p: { className?: string }): React.JSX.Element => (
  <S className={p.className}>
    <path d="M10 3.4 15.4 5.5v4.2c0 3.2-2.3 5.6-5.4 6.7-3.1-1.1-5.4-3.5-5.4-6.7V5.5L10 3.4Z" />
  </S>
)

export const Keyboard = (p: { className?: string }): React.JSX.Element => (
  <S className={p.className}>
    <rect x="2.8" y="5.8" width="14.4" height="8.6" rx="2.2" />
    <path d="M6 9.4h.01M9 9.4h.01M12 9.4h.01M7.4 12h5.2" strokeWidth="1.5" />
  </S>
)

export const Search = (p: { className?: string }): React.JSX.Element => (
  <S className={p.className}>
    <circle cx="9" cy="9" r="5.2" />
    <path d="m12.9 12.9 3.4 3.4" />
  </S>
)

export const Close = (p: { className?: string }): React.JSX.Element => (
  <S className={p.className}>
    <path d="m6.2 6.2 7.6 7.6M13.8 6.2l-7.6 7.6" />
  </S>
)

export const Chevron = (p: { className?: string }): React.JSX.Element => (
  <S className={p.className}>
    <path d="m6.5 8.4 3.5 3.6 3.5-3.6" />
  </S>
)

export const ArrowRight = (p: { className?: string }): React.JSX.Element => (
  <S className={p.className}>
    <path d="M4.5 10h10M11 6.4 14.6 10 11 13.6" />
  </S>
)

export const Undo = (p: { className?: string }): React.JSX.Element => (
  <S className={p.className}>
    <path d="M4.4 8.2h7.1a3.5 3.5 0 0 1 0 7H7.6" />
    <path d="M7.2 5 4.4 8.2l2.8 3.2" />
  </S>
)

export const Check = (p: { className?: string }): React.JSX.Element => (
  <S className={p.className}>
    <path d="m4.8 10.4 3.4 3.4 7-7.6" strokeWidth="1.6" />
  </S>
)

export const Trace = (p: { className?: string }): React.JSX.Element => (
  <S className={p.className}>
    <path d="M3 13.5h2.4M7.3 13.5h2.6M12.7 13.5H15M3 6.5h3.4M9 6.5h3.2M14.6 6.5H17" opacity="0.5" />
    <circle cx="6" cy="13.5" r="1.5" />
    <circle cx="10.6" cy="6.5" r="1.5" />
  </S>
)

export const Coin = (p: { className?: string }): React.JSX.Element => (
  <S className={p.className}>
    <circle cx="10" cy="10" r="6.4" />
    <path d="M10 6.6v6.8M11.7 8.2c-.5-.5-1.1-.8-1.9-.8-1.1 0-1.9.6-1.9 1.5 0 2.2 3.9 1 3.9 3.2 0 .9-.8 1.5-2 1.5-.8 0-1.5-.3-2-.8" />
  </S>
)

export const External = (p: { className?: string }): React.JSX.Element => (
  <S className={p.className}>
    <path d="M11.4 4.6h4v4" />
    <path d="m15.4 4.6-6 6" />
    <path d="M14 11.6v3a1.4 1.4 0 0 1-1.4 1.4H5.6a1.4 1.4 0 0 1-1.4-1.4V7.6A1.4 1.4 0 0 1 5.6 6.2h3" />
  </S>
)

export const Plus = (p: { className?: string }): React.JSX.Element => (
  <S className={p.className}>
    <path d="M10 5.2v9.6M5.2 10h9.6" />
  </S>
)

export const Minus = (p: { className?: string }): React.JSX.Element => (
  <S className={p.className}>
    <path d="M5.4 10h9.2" />
  </S>
)

export const Square = (p: { className?: string }): React.JSX.Element => (
  <S className={p.className}>
    <rect x="5.4" y="5.4" width="9.2" height="9.2" rx="1.4" />
  </S>
)

export const Overlap = (p: { className?: string }): React.JSX.Element => (
  <S className={p.className}>
    <rect x="3.6" y="7.4" width="9" height="9" rx="1.6" />
    <path d="M7.6 7.4V6a1.6 1.6 0 0 1 1.6-1.6h5.2A1.6 1.6 0 0 1 16 6v5.2a1.6 1.6 0 0 1-1.6 1.6h-1.4" opacity="0.55" />
  </S>
)

export const Kbd = ({
  children,
  className
}: {
  children: React.ReactNode
  className?: string
}): React.JSX.Element => (
  <kbd
    className={cx(
      'inline-flex h-[17px] min-w-[17px] items-center justify-center rounded-[4px] px-1',
      'border border-line bg-white/[0.035] font-ui text-[10px] leading-none font-medium text-fg-3',
      className
    )}
  >
    {children}
  </kbd>
)