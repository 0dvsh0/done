/**
 * Appearance is one of three things: `dark`, `light`, or `system`.
 *
 * `system` is the honest default — it follows the OS until you decide
 * otherwise, and the moment you decide it never overrides you again. The
 * store keeps both halves: `theme` is what you chose, `resolved` is what that
 * means right now.
 *
 * The main process owns the stored value, because Electron paints the window
 * background before any of this code exists. Preload hands that value over
 * synchronously, so the very first frame is already the right ink and there
 * is never a flash of the wrong one. The renderer repaints on every change;
 * neither side is allowed to drift, because every change goes through
 * `choose`, which does both.
 */

import { create } from 'zustand'

export type Theme = 'dark' | 'light'
export type ThemeChoice = Theme | 'system'

export const isTheme = (v: unknown): v is Theme => v === 'dark' || v === 'light'

/** What preload read off disk before this window opened. */
function initialChoice(): ThemeChoice {
  const stored = window.system?.initialTheme
  return stored === 'system' || isTheme(stored) ? stored : 'system'
}

function systemTheme(): Theme {
  try {
    return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
  } catch {
    return 'dark'
  }
}

const resolve = (choice: ThemeChoice): Theme => (choice === 'system' ? systemTheme() : choice)

/**
 * Paint the resolved mode onto the document.
 *
 * `theme-shift` is held for a beat so every element crossfades to the new ink
 * together, instead of the whole window snapping inside a single frame.
 */
export function applyTheme(theme: Theme): void {
  const root = document.documentElement
  root.dataset['theme'] = theme
  root.style.colorScheme = theme
  root.classList.add('theme-shift')
  window.setTimeout(() => root.classList.remove('theme-shift'), 320)
}

export const useTheme = create<{
  theme: ThemeChoice
  resolved: Theme
  choose: (next: ThemeChoice) => void
  toggle: () => void
}>((set, get) => ({
  theme: initialChoice(),
  resolved: resolve(initialChoice()),
  choose: (next) => {
    const resolved = resolve(next)
    applyTheme(resolved)
    void window.done?.setTheme?.(next, resolved)
    set({ theme: next, resolved })
  },
  toggle: () => get().choose(get().resolved === 'dark' ? 'light' : 'dark')
}))

/**
 * Called once, before React mounts, so the first painted frame is already the
 * right ink. Everything later arrives through `choose`.
 */
export function initTheme(): void {
  const resolved = resolve(useTheme.getState().theme)
  applyTheme(resolved)
}

/**
 * Keep `system` honest while the window is open: macOS flips its appearance at
 * sunset and the app should follow without being restarted. Once a mode is
 * chosen this is inert, because the choice is what `resolve` returns.
 */
export function watchSystemTheme(): void {
  const onChange = (): void => {
    if (useTheme.getState().theme !== 'system') return
    const resolved = systemTheme()
    applyTheme(resolved)
    void window.done?.setTheme?.('system', resolved)
    useTheme.setState({ resolved })
  }

  /* Both routes in, because neither alone is reliable: matchMedia catches a
     change made inside the window, the IPC event catches one made in System
     Settings, which does not always fire a media query change. */
  try {
    window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', onChange)
  } catch {
    /* no matchMedia — the main-process event below is still there */
  }
  window.system?.onThemeChanged?.(onChange)
}
