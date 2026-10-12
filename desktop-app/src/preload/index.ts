import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import { existsSync, readFileSync } from 'node:fs'
import type { AppState, ControlAction, DoneApi, Limits } from '../shared/types'
import { themeFile, type ThemeChoice } from '../shared/theme'

/** The stored appearance, or `system` the first time the app is ever opened. */
function readInitialTheme(): ThemeChoice {
  try {
    const raw = existsSync(themeFile())
      ? (JSON.parse(readFileSync(themeFile(), 'utf8')) as string)
      : null
    return raw === 'dark' || raw === 'light' || raw === 'system' ? raw : 'system'
  } catch {
    return 'system'
  }
}

const api: DoneApi = {
  getState: () => ipcRenderer.invoke('state:get'),
  onState: (cb) => {
    const listener = (_e: unknown, state: AppState): void => cb(state)
    ipcRenderer.on('state:update', listener)
    return () => ipcRenderer.removeListener('state:update', listener)
  },
  createTask: (title, opts) => ipcRenderer.invoke('task:create', title, opts),
  control: (id: string, action: ControlAction) => ipcRenderer.invoke('task:control', id, action),
  answer: (id: string, value: string) => ipcRenderer.invoke('task:answer', id, value),
  steer: (id: string, text: string) => ipcRenderer.invoke('task:steer', id, text),
  undo: () => ipcRenderer.invoke('app:undo'),
  dismiss: (id: string) => ipcRenderer.invoke('task:dismiss', id),
  clearFinished: () => ipcRenderer.invoke('task:clear-finished'),
  setLimits: (patch: Partial<Limits>) => ipcRenderer.invoke('app:limits', patch),
  setAllPaused: (on: boolean) => ipcRenderer.invoke('app:pause-all', on),
  setGroup: (id: string, group: string | null) => ipcRenderer.invoke('task:group', id, group),
  renameGroup: (from: string, to: string) => ipcRenderer.invoke('group:rename', from, to),
  removeGroup: (name: string) => ipcRenderer.invoke('group:remove', name),
  checkpoint: (id: string) => ipcRenderer.invoke('task:checkpoint', id),
  revealData: () => ipcRenderer.invoke('app:reveal-data'),
  openExternal: (url: string) => ipcRenderer.invoke('app:open-external', url),
  setConnectorConfig: (id, config) => ipcRenderer.invoke('connector:config', id, config),
  windowAction: (action) => ipcRenderer.invoke('window:action', action),
  setTheme: (choice, resolved) => ipcRenderer.invoke('theme:set', { choice, resolved })
}

/** Escape hatches used by the app itself (menus, devtools), not by UI code. */
const system = {
  ...electronAPI,
  platform: process.platform,
  /**
   * Read synchronously from disk before the window is shown, so the first
   * painted frame is already in the right ink. The renderer must never have
   * to guess and then correct itself — that correction is a visible flash.
   */
  initialTheme: readInitialTheme(),
  onMenu: (
    channel: 'menu:new' | 'menu:command' | 'menu:settings' | 'menu:trace',
    cb: () => void
  ) => {
    const listener = (): void => cb()
    ipcRenderer.on(channel, listener)
    return () => ipcRenderer.removeListener(channel, listener)
  },
  onMaximize: (cb: (maximized: boolean) => void) => {
    const listener = (_e: unknown, v: boolean): void => cb(v)
    ipcRenderer.on('window:maximized', listener)
    return () => ipcRenderer.removeListener('window:maximized', listener)
  },
  isMaximized: () => ipcRenderer.invoke('window:is-maximized'),
  /** The OS changed appearance underneath a 'system' theme. */
  onThemeChanged: (cb: (resolved: 'dark' | 'light') => void) => {
    const listener = (_e: unknown, v: 'dark' | 'light'): void => cb(v)
    ipcRenderer.on('theme:changed', listener)
    return () => ipcRenderer.removeListener('theme:changed', listener)
  },
  economics: () => ipcRenderer.invoke('app:economics'),
  searchConfigured: () => ipcRenderer.invoke('app:search-configured'),
  reset: () => ipcRenderer.invoke('app:reset'),
  entireSetup: () => ipcRenderer.invoke('entire:setup'),
  entireRefresh: () => ipcRenderer.invoke('entire:refresh')
}

export type DoneSystem = typeof system

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('done', api)
    contextBridge.exposeInMainWorld('system', system)
  } catch (err) {
    console.error(err)
  }
} else {
  // contextIsolation is off — the renderer can hold the objects directly.
  const w = window as unknown as { done: DoneApi; system: DoneSystem }
  w.done = api
  w.system = system
}
