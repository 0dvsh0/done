import { create } from 'zustand'
import type { AppState, ControlAction, CreateOptions, Limits, Task } from '../../shared/types'

export type SheetId = 'limits' | 'shortcuts' | 'agent' | 'connections' | null

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
  /* named groups fold away too, remembered one by one */
  folded: Record<string, boolean>
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
  toggleFold(name: string): void
  isFolded(name: string): boolean
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

/** A group is folded only if you folded it; anything new starts open. */
function isFoldedIn(folded: Record<string, boolean>, name: string): boolean {
  return folded[name] ?? false
}

export const useUI = create<UI>((set) => ({
  openId: null,
  cursorId: null,
  sheet: null,
  palette: false,
  traceFor: null,
  under: false,
  doneOpen: true,
  folded: {},
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
  toggleFold: (name) =>
    set((s) => ({ folded: { ...s.folded, [name]: !isFoldedIn(s.folded, name) } })),
  // Everything starts open. Folding is a thing you do, not one you undo.
  isFolded: (name) => isFoldedIn(useUI.getState().folded, name),
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
  pauseAll: (on: boolean) => window.done.setAllPaused(on),
  setGroup: (id: string, group: string | null) => window.done.setGroup(id, group),
  renameGroup: (from: string, to: string) => window.done.renameGroup(from, to),
  removeGroup: (name: string) => window.done.removeGroup(name),
  setConnectorConfig: (
    id: import('../../shared/types').ConnectorId,
    config: { apiKey?: string; endpoint?: string }
  ) => window.done.setConnectorConfig(id, config)
}

/* --------------------------------------------------------------- derived */

export type SectionKind = 'needs' | 'going' | 'group' | 'done'

export interface Section {
  /** Stable identity for a section — the fold map and React keys both use it. */
  key: string
  kind: SectionKind
  label: string
  tasks: Task[]
}

/** Group names are matched the way the main process matches them: case-blind. */
const groupKey = (name: string): string => name.trim().toLowerCase()

/** Every group that has at least one task in it, alphabetically. */
export function groupNames(state: AppState): string[] {
  const names = new Map<string, string>()
  for (const t of state.tasks) {
    if (!t.group?.trim()) continue
    const key = groupKey(t.group)
    if (!names.has(key)) names.set(key, t.group.trim())
  }
  return [...names.values()].sort((a, b) => a.localeCompare(b))
}

/**
 * The list, top to bottom, exactly as it is drawn.
 *
 * "Needs you" and "Done today" stay where they have always been — a task that
 * needs a decision is never filed away out of sight. A task you have grouped
 * sits under its group instead of under "Going", so every row is drawn once
 * and only once.
 */
export function sections(state: AppState): Section[] {
  const needs: Task[] = []
  const going: Task[] = []
  const done: Task[] = []
  const groups = new Map<string, { name: string; tasks: Task[] }>()

  for (const t of state.tasks) {
    if (t.state === 'needs') {
      needs.push(t)
      continue
    }
    if (t.state === 'done' || t.state === 'stopped') {
      done.push(t)
      continue
    }
    const name = t.group?.trim()
    if (!name) {
      going.push(t)
      continue
    }
    const key = groupKey(name)
    const bucket = groups.get(key)
    if (bucket) bucket.tasks.push(t)
    else groups.set(key, { name, tasks: [t] })
  }

  done.sort((a, b) => (b.finishedAt ?? 0) - (a.finishedAt ?? 0))

  const out: Section[] = []
  if (needs.length) out.push({ key: 'needs', kind: 'needs', label: 'Needs you', tasks: needs })
  if (going.length) out.push({ key: 'going', kind: 'going', label: 'Going', tasks: going })
  for (const bucket of [...groups.values()].sort((a, b) => a.name.localeCompare(b.name))) {
    out.push({
      key: `group:${groupKey(bucket.name)}`,
      kind: 'group',
      label: bucket.name,
      tasks: bucket.tasks
    })
  }
  if (done.length) out.push({ key: 'done', kind: 'done', label: 'Done today', tasks: done })
  return out
}

/** Whether a section is showing right now, given how the fold switches sit. */
export function isSectionOpen(
  section: Section,
  doneOpen: boolean,
  folded: Record<string, boolean>
): boolean {
  if (section.kind === 'done') return doneOpen
  if (section.kind === 'group') return !isFoldedIn(folded, section.key)
  return true
}

export function summary(state: AppState): string {
  const needs = state.tasks.filter((t) => t.state === 'needs').length
  const live = state.tasks.filter(
    (t) =>
      t.state !== 'needs' &&
      t.state !== 'done' &&
      t.state !== 'stopped' &&
      t.state !== 'paused' &&
      t.state !== 'you'
  ).length
  if (state.allPaused) return 'Everything’s paused. Nothing will move until you say.'
  if (!needs && !live) return 'Everything’s done. Nothing needs you.'
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
  const parts: string[] = []
  if (needs) {
    parts.push(`${words[needs] ?? needs} thing${needs === 1 ? '' : 's'} need you.`)
  }
  if (live) parts.push(`${words[live] ?? live} going quietly.`)
  return parts.join(' ')
}
