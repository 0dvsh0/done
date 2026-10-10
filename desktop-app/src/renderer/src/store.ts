import { create } from 'zustand'
import type { AppState, ControlAction, CreateOptions, Limits } from '../../shared/types'

export type SheetId = 'limits' | 'shortcuts' | 'business' | 'connections' | null

interface UI {
  /* which task's detail is open, and where the keyboard cursor is */
  openId: string | null
  cursorId: string | null
  /* open overlays */
  sheet: SheetId
  palette: boolean
  traceFor: string | null
  /* the "show what's underneath" switch, remembered across tasks */
  under: boolean
  /* done groups can be folded away */
  doneOpen: boolean
  toast: { text: string; undo: boolean } | null
  /* window is maximized — swaps the window-control glyph */
  maximized: boolean

  openTask(id: string): void
  closeTask(): void
  setCursor(id: string | null): void
  showSheet(s: SheetId): void
  togglePalette(force?: boolean): void
  showTrace(id: string | null): void
  toggleUnder(): void
  setDoneOpen(v: boolean): void
  say(text: string, undo?: boolean): void
  clearToast(): void
  setMaximized(v: boolean): void
}

interface World {
  state: AppState | null
  setState(s: AppState): void
}

export const useWorld = create<World>((set) => ({
  state: null,
  setState: (state) => set({ state })
}))

export const useUI = create<UI>((set) => ({
  openId: null,
  cursorId: null,
  sheet: null,
  palette: false,
  traceFor: null,
  under: false,
  doneOpen: true,
  toast: null,
  maximized: false,

  openTask: (id) => set({ openId: id, cursorId: id }),
  closeTask: () => set({ openId: null }),
  setCursor: (id) => set({ cursorId: id }),
  showSheet: (sheet) => set({ sheet }),
  togglePalette: (force) => set((s) => ({ palette: force ?? !s.palette })),
  showTrace: (traceFor) => set({ traceFor }),
  toggleUnder: () => set((s) => ({ under: !s.under })),
  setDoneOpen: (doneOpen) => set({ doneOpen }),
  say: (text, undo = false) => set({ toast: { text, undo } }),
  clearToast: () => set({ toast: null }),
  setMaximized: (maximized) => set({ maximized })
}))

/* -------------------------------------------------------------- commands */

let toastTimer: ReturnType<typeof setTimeout> | null = null

export function toast(text: string, undo = false, ms = 4200): void {
  useUI.getState().say(text, undo)
  if (toastTimer) clearTimeout(toastTimer)
  toastTimer = setTimeout(() => useUI.getState().clearToast(), ms)
}

export const api = {
  create: (title: string, opts?: CreateOptions) => window.done.createTask(title, opts),
  control: (id: string, action: ControlAction) => window.done.control(id, action),
  answer: (id: string, value: string) => window.done.answer(id, value),
  steer: (id: string, text: string) => window.done.steer(id, text),
  undo: () => window.done.undo(),
  dismiss: (id: string) => window.done.dismiss(id),
  clearFinished: () => window.done.clearFinished(),
  limits: (patch: Partial<Limits>) => window.done.setLimits(patch),
  pauseAll: (on: boolean) => window.done.setAllPaused(on)
}

/* --------------------------------------------------------------- derived */

export const groupOf = (s: AppState['tasks'][number]): 'needs' | 'going' | 'done' => {
  if (s.state === 'needs') return 'needs'
  if (s.state === 'done' || s.state === 'stopped') return 'done'
  return 'going'
}

export function ordered(state: AppState): Record<'needs' | 'going' | 'done', AppState['tasks']> {
  const buckets: Record<'needs' | 'going' | 'done', AppState['tasks']> = { needs: [], going: [], done: [] }
  for (const t of state.tasks) buckets[groupOf(t)].push(t)
  buckets.done.sort((a, b) => (b.finishedAt ?? 0) - (a.finishedAt ?? 0))
  return buckets
}

export function summary(state: AppState): string {
  const { needs, going } = ordered(state)
  const live = going.filter((t) => t.state !== 'paused' && t.state !== 'you').length
  if (state.allPaused) return 'Everything’s paused. Nothing will move until you say.'
  if (!needs.length && !live) return 'Everything’s done. Nothing needs you.'
  const words = ['No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten']
  const parts: string[] = []
  if (needs.length) {
    parts.push(
      `${words[needs.length] ?? needs.length} thing${needs.length === 1 ? '' : 's'} need you.`
    )
  }
  if (live) parts.push(`${words[live] ?? live} going quietly.`)
  return parts.join(' ')
}