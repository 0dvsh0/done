import { app } from 'electron'
import { join } from 'node:path'

/**
 * Where the chosen appearance lives, shared by the main process (which writes
 * it and paints the window background from it) and the preload script (which
 * reads it before the window is shown).
 *
 * `userData` is resolved lazily rather than at module load so that importing
 * this from anywhere is safe — including from the preload sandbox, where the
 * app paths aren't ready until the renderer process actually starts.
 */

export type Theme = 'dark' | 'light'
export type ThemeChoice = Theme | 'system'

export function themeFile(): string {
  return join(app.getPath('userData'), 'theme.json')
}

/** The window background Electron paints before the interface exists. */
export function themeBackground(theme: Theme): string {
  return theme === 'light' ? '#f6f5f3' : '#0b0b0c'
}
