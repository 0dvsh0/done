import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import type { AppState, ControlAction, DoneApi, Limits } from '../shared/types'

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
  checkpoint: (id: string) => ipcRenderer.invoke('task:checkpoint', id),
  revealData: () => ipcRenderer.invoke('app:reveal-data'),
  openExternal: (url: string) => ipcRenderer.invoke('app:open-external', url),
  windowAction: (action) => ipcRenderer.invoke('window:action', action)
}

/** Escape hatches used by the app itself (menus, devtools), not by UI code. */
const system = {
  ...electronAPI,
  platform: process.platform,
  onMenu: (channel: 'menu:new' | 'menu:command' | 'menu:settings' | 'menu:trace', cb: () => void) => {
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
  economics: () => ipcRenderer.invoke('app:economics'),
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
  // @ts-ignore
  window.done = api
  // @ts-ignore
  window.system = system
}