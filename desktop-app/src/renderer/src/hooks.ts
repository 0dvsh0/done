import { useEffect } from 'react'
import type { AppState, Task } from '../../shared/types'
import { api, ordered, toast, useUI } from './store'

const isTyping = (el: EventTarget | null): boolean => {
  const node = el as HTMLElement | null
  if (!node) return false
  const tag = node.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || node.isContentEditable
}

export function useHotkeys(state: AppState | null): void {
  const openTask = useUI((s) => s.openTask)
  const closeTask = useUI((s) => s.closeTask)
  const setCursor = useUI((s) => s.setCursor)
  const togglePalette = useUI((s) => s.togglePalette)
  const showSheet = useUI((s) => s.showSheet)
  const showTrace = useUI((s) => s.showTrace)
  const toggleUnder = useUI((s) => s.toggleUnder)
  const under = useUI((s) => s.under)
  const openId = useUI((s) => s.openId)
  const cursorId = useUI((s) => s.cursorId)
  const sheet = useUI((s) => s.sheet)
  const palette = useUI((s) => s.palette)
  const doneOpen = useUI((s) => s.doneOpen)

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const typing = isTyping(e.target)
      const overlay = Boolean(sheet) || palette
      const mod = e.metaKey || e.ctrlKey

      if (mod && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        togglePalette()
        return
      }
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        void api.undo()
        toast('Undone.')
        return
      }
      if (mod && e.key.toLowerCase() === 't') {
        e.preventDefault()
        if (openId) showTrace(openId)
        return
      }
      if (mod && e.key === 'Enter') {
        const open = state?.tasks.find((t) => t.id === openId)
        if (open?.ask) {
          e.preventDefault()
          void api.answer(open.id, open.ask.kind === 'approve' ? 'yes' : '__none')
          toast(open.ask.kind === 'approve' ? 'Going ahead.' : 'Neither. It’ll keep looking.')
        }
        return
      }
      if (mod) return

      if (e.key === 'Escape') {
        if (typing) {
          ;(e.target as HTMLElement).blur()
          return
        }
        if (overlay) {
          showSheet(null)
          useUI.getState().togglePalette(false)
          return
        }
        if (openId) closeTask()
        return
      }

      if (typing || overlay) return

      const order: Task[] = state ? ordered(state).needs.concat(ordered(state).going, doneOpen ? ordered(state).done : []) : []
      const current = state?.tasks.find((t) => t.id === (openId ?? cursorId))
      const index = current ? order.findIndex((t) => t.id === current.id) : -1

      switch (e.key) {
        case 'n':
        case 'N':
          e.preventDefault()
          document.querySelector<HTMLInputElement>('[data-composer]')?.focus()
          break

        case 'j':
        case 'ArrowDown': {
          e.preventDefault()
          const next = order[Math.min(order.length - 1, index + 1)]
          if (next) {
            setCursor(next.id)
            if (openId) openTask(next.id)
            document
              .querySelector(`[data-row="${next.id}"]`)
              ?.scrollIntoView({ block: 'nearest' })
          }
          break
        }

        case 'k':
        case 'ArrowUp': {
          e.preventDefault()
          const prev = order[Math.max(0, index - 1)]
          if (prev) {
            setCursor(prev.id)
            if (openId) openTask(prev.id)
            document
              .querySelector(`[data-row="${prev.id}"]`)
              ?.scrollIntoView({ block: 'nearest' })
          }
          break
        }

        case 'Enter':
          if (cursorId && !openId) {
            e.preventDefault()
            openTask(cursorId)
          }
          break

        case ' ': {
          if (!current) break
          e.preventDefault()
          void api.control(current.id, 'pause')
          break
        }

        case 's':
        case 'S':
          if (openId) {
            e.preventDefault()
            const btn = document.querySelector<HTMLButtonElement>('[data-steer]')
            btn?.click()
          }
          break

        case 't':
        case 'T':
          if (current) {
            e.preventDefault()
            void api.control(current.id, 'take')
          }
          break

        case 'u':
        case 'U':
          e.preventDefault()
          toggleUnder()
          toast(under ? 'Hiding the machinery.' : 'Showing the machinery.')
          break

        case '?':
          e.preventDefault()
          showSheet('shortcuts')
          break

        case ',':
          e.preventDefault()
          showSheet('limits')
          break

        default:
          break
      }
    }

    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [
    state,
    openId,
    cursorId,
    sheet,
    palette,
    under,
    doneOpen,
    openTask,
    closeTask,
    setCursor,
    togglePalette,
    showSheet,
    showTrace,
    toggleUnder
  ])
}

/** Menu items arrive from the main process; forward them to the same handlers. */
export function useMenuBridge(): void {
  const togglePalette = useUI((s) => s.togglePalette)
  const showSheet = useUI((s) => s.showSheet)
  const showTrace = useUI((s) => s.showTrace)
  const openId = useUI((s) => s.openId)
  const setMaximized = useUI((s) => s.setMaximized)

  useEffect(() => {
    const offs = [
      window.system.onMenu('menu:new', () =>
        document.querySelector<HTMLInputElement>('[data-composer]')?.focus()
      ),
      window.system.onMenu('menu:command', () => togglePalette(true)),
      window.system.onMenu('menu:settings', () => showSheet('connections')),
      window.system.onMenu('menu:trace', () => {
        if (openId) showTrace(openId)
      }),
      window.system.onMaximize(setMaximized)
    ]
    void window.system.isMaximized().then(setMaximized)
    return () => offs.forEach((off) => off())
  }, [togglePalette, showSheet, showTrace, openId, setMaximized])
}