import { useEffect, useRef, useState } from 'react'
import { cx } from '../lib/format'
import * as I from './Icons'

/**
 * Filing a task is one small decision, so it gets one small row of chips —
 * the same chips the composer uses, with the current group lit.
 */
export function GroupPicker({
  value,
  groups,
  onChange,
  className
}: {
  value: string | null
  groups: string[]
  onChange: (group: string | null) => void
  className?: string
}): React.JSX.Element {
  const [naming, setNaming] = useState(false)

  if (naming) {
    return (
      <NewGroupInput
        onCancel={() => setNaming(false)}
        onCommit={(name) => {
          setNaming(false)
          onChange(name)
        }}
      />
    )
  }

  return (
    <div className={cx('flex flex-wrap items-center gap-1.5', className)}>
      {value && (
        <Chip on onClick={() => onChange(null)} title="Take it out of its group">
          No group
        </Chip>
      )}
      {groups.map((g) => (
        <Chip
          key={g}
          on={Boolean(value) && value!.toLowerCase() === g.toLowerCase()}
          onClick={() => onChange(g)}
          title={`File this under ${g}`}
        >
          {g}
        </Chip>
      ))}
      <Chip onClick={() => setNaming(true)} title="Name a new group">
        <I.Folder className="text-fg-4 [&_svg]:h-[12px] [&_svg]:w-[12px]" />
        New
      </Chip>
    </div>
  )
}

/** Typing a name for a group that doesn't exist yet. Enter keeps it. */
export function NewGroupInput({
  onCommit,
  onCancel,
  placeholder = 'Name it'
}: {
  onCommit: (name: string) => void
  onCancel: () => void
  placeholder?: string
}): React.JSX.Element {
  const [draft, setDraft] = useState('')
  const ref = useRef<HTMLInputElement>(null)
  const done = useRef(false)

  useEffect(() => {
    ref.current?.focus()
  }, [])

  // Enter and clicking away both land here, and the second one must not fire.
  const commit = (): void => {
    if (done.current) return
    done.current = true
    const name = draft.trim()
    if (name) onCommit(name)
    else onCancel()
  }

  return (
    <div className="flex items-center gap-1.5">
      <div className="flex h-[24px] items-center gap-1.5 rounded-[7px] border border-line-2 bg-ink-1 px-2 focus-within:border-line-3">
        <I.Folder className="text-fg-5 [&_svg]:h-[12px] [&_svg]:w-[12px]" />
        <input
          ref={ref}
          value={draft}
          maxLength={32}
          placeholder={placeholder}
          aria-label="Group name"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              commit()
            }
            if (e.key === 'Escape') {
              e.preventDefault()
              done.current = true
              onCancel()
            }
          }}
          onBlur={commit}
          className="w-[108px] bg-transparent text-[11.5px] text-fg placeholder:text-fg-4"
        />
      </div>
      <button
        type="button"
        onClick={commit}
        disabled={!draft.trim()}
        className="no-drag inline-flex h-[24px] items-center rounded-[7px] bg-fg px-2 text-[11.5px] font-medium text-ink-0 transition-opacity hover:opacity-85 disabled:opacity-25"
      >
        Add
      </button>
    </div>
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
        'no-drag inline-flex h-[24px] items-center gap-1 rounded-[7px] border px-2',
        'text-[11.5px] transition-colors',
        on
          ? 'border-line-2 bg-white/[0.06] text-fg'
          : 'border-line text-fg-3 hover:border-line-2 hover:bg-white/[0.04] hover:text-fg-2'
      )}
    >
      {children}
    </button>
  )
}
