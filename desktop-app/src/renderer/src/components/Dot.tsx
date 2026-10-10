import type { TaskState } from '../../../shared/types'
import { cx } from '../lib/format'

const CIRC = 50.27 // 2πr, r = 8

/**
 * The whole interface language in one object.
 *
 *   track = the outline · arc = how far along · core = the heartbeat
 *
 * A task starts as an open circle. Work fills the ring. When it is finished
 * the circle closes into a period — the same mark as the wordmark.
 *
 * The radius of the core can't be transitioned in CSS, so each state
 * declares it as `--core-r` here and the paint lives in `dotStyles`.
 */
export function Dot({
  state,
  progress = 0,
  size = 18,
  className
}: {
  state: TaskState
  progress?: number
  size?: number
  className?: string
}): React.JSX.Element {
  const visual = state === 'you' ? 'paused' : state
  const p = Math.max(0, Math.min(1, progress || 0))

  return (
    <svg
      viewBox="0 0 20 20"
      width={size}
      height={size}
      className={cx('dot shrink-0 overflow-visible', className)}
      aria-hidden="true"
      data-state={visual}
    >
      <circle className="dot-track" cx="10" cy="10" r="8" />
      <circle
        className="dot-arc"
        cx="10"
        cy="10"
        r="8"
        strokeDasharray={CIRC}
        strokeDashoffset={CIRC * (1 - p)}
      />
      <circle className="dot-core" cx="10" cy="10" />
    </svg>
  )
}

/**
 * Injected once, at the root. An svg can't take utility classes for its own
 * circles, so the dot gets its own small stylesheet.
 */
export const dotStyles = `
.dot circle {
  transition: stroke .42s var(--ease-in-out), fill .42s var(--ease-in-out),
              opacity .42s var(--ease-in-out), stroke-dasharray .42s var(--ease-in-out);
}
.dot .dot-track { fill: none; stroke-width: 1.25; stroke: rgb(255 255 255 / 0.24); }
.dot .dot-arc {
  fill: none; stroke: var(--color-fg); stroke-width: 1.5; stroke-linecap: round;
  transform: rotate(-90deg); transform-origin: 50% 50%;
  transition: stroke-dashoffset 1.1s var(--ease-in-out), stroke .42s var(--ease-in-out),
              opacity .42s var(--ease-in-out);
}
.dot .dot-core { fill: var(--color-fg); r: var(--core-r, 0px); transform-origin: 50% 50%; }

.dot[data-state="waiting"] { --core-r: 0px; }

.dot[data-state="working"] { --core-r: 2.6px; }
.dot[data-state="working"] .dot-track { stroke: rgb(255 255 255 / 0.12); }
.dot[data-state="working"] .dot-core { animation: breathe 3.6s var(--ease-in-out) infinite; }

.dot[data-state="snag"] { --core-r: 2.6px; }
.dot[data-state="snag"] .dot-track { stroke: rgb(229 138 116 / 0.25); }
.dot[data-state="snag"] .dot-arc { stroke: var(--color-snag); }
.dot[data-state="snag"] .dot-core { fill: var(--color-snag); animation: breathe 1.6s var(--ease-in-out) infinite; }

.dot[data-state="needs"] { --core-r: 3px; }
.dot[data-state="needs"] .dot-track { stroke: rgb(233 184 102 / 0.28); }
.dot[data-state="needs"] .dot-arc { stroke: var(--color-needs); }
.dot[data-state="needs"] .dot-core { fill: var(--color-needs); animation: beckon 2.4s var(--ease-in-out) infinite; }

.dot[data-state="paused"] { --core-r: 2.2px; }
.dot[data-state="paused"] .dot-track { stroke: rgb(255 255 255 / 0.12); }
.dot[data-state="paused"] .dot-arc { stroke: var(--color-fg-3); }
.dot[data-state="paused"] .dot-core { fill: var(--color-fg-3); }

.dot[data-state="done"] { --core-r: 5px; }
.dot[data-state="done"] .dot-track { stroke: transparent; }
.dot[data-state="done"] .dot-arc { opacity: 0; }

.dot[data-state="stopped"] { --core-r: 0px; }
.dot[data-state="stopped"] .dot-track { stroke: rgb(255 255 255 / 0.16); stroke-dasharray: 2 3.2; }
.dot[data-state="stopped"] .dot-arc { opacity: 0; }

/* the period, closing */
.dot[data-done="true"] .dot-core { animation: close 1.05s var(--ease-out); }
@keyframes close {
  0%   { transform: scale(1); }
  45%  { transform: scale(1.28); }
  100% { transform: scale(1); }
}
`