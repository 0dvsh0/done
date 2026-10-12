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
 * An svg can't take utility classes for its own circles, so the paint lives in
 * `styles.css`, where it can also follow the active appearance. The radius of
 * the core can't be transitioned in CSS either, so each state declares it as
 * `--core-r` there too.
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
