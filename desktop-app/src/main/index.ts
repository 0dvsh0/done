import { app, BrowserWindow, Menu, Tray, ipcMain, nativeImage, nativeTheme, shell } from 'electron'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { seed, Store } from './agent'
import { entire, tracing } from './integrations'
import { economics } from './finance'
import type { ControlAction, CreateOptions, Limits } from '../shared/types'

/* ==========================================================================
   Paths & persistence
   ========================================================================== */

const dataDir = app.getPath('userData')
const stateFile = join(dataDir, 'state.json')
const windowFile = join(dataDir, 'window.json')

function ensureDir(): void {
  if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true })
}

function readJson(file: string): Record<string, unknown> | null {
  try {
    return existsSync(file)
      ? (JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>)
      : null
  } catch {
    return null
  }
}

interface WindowBounds {
  width: number
  height: number
  x?: number
  y?: number
  maximized?: boolean
}

function readBounds(): WindowBounds {
  const saved = readJson(windowFile) as WindowBounds | null
  return {
    width: Number(saved?.width) || 1180,
    height: Number(saved?.height) || 820,
    x: typeof saved?.x === 'number' ? saved.x : undefined,
    y: typeof saved?.y === 'number' ? saved.y : undefined,
    maximized: Boolean(saved?.maximized)
  }
}

/* ==========================================================================
   Window
   ========================================================================== */

const isMac = process.platform === 'darwin'

function createWindow(): BrowserWindow {
  const bounds = readBounds()

  const window = new BrowserWindow({
    width: bounds.width,
    height: bounds.height,
    x: bounds.x,
    y: bounds.y,
    minWidth: 940,
    minHeight: 620,
    // This is a focused app. One list, one detail pane, one decision at a
    // time — a 27-inch canvas full of empty space helps nobody, so the
    // window is allowed to be generous but never vaster than the work.
    maxWidth: 1400,
    maxHeight: 1000,
    show: false,
    frame: false,
    backgroundColor: '#09090a',
    titleBarStyle: isMac ? 'hiddenInset' : 'default',
    trafficLightPosition: isMac ? { x: 18, y: 18 } : undefined,
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      spellcheck: false,
      // The dot's pulse and the crossfaded sentences are rAF-driven. If the
      // window isn't focused, Chromium throttles rAF and the motion stalls
      // half-finished — which reads as a rendering bug, not a nicety.
      backgroundThrottling: false
    }
  })

  if (bounds.maximized) window.maximize()

  window.once('ready-to-show', () => window.show())

  const saveBounds = (): void => {
    if (window.isDestroyed()) return
    const b = window.isMaximized() ? window.getNormalBounds() : window.getBounds()
    writeFileSync(
      windowFile,
      JSON.stringify({
        width: b.width,
        height: b.height,
        x: b.x,
        y: b.y,
        maximized: window.isMaximized()
      })
    )
  }
  window.on('resize', saveBounds)
  window.on('move', saveBounds)
  window.on('maximize', saveBounds)
  window.on('unmaximize', saveBounds)

  window.on('close', saveBounds)

  window.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  // Anything that isn't the app itself opens in the real browser.
  window.webContents.on('will-navigate', (event, url) => {
    const dev = process.env['ELECTRON_RENDERER_URL']
    if (dev && url.startsWith(dev)) return
    event.preventDefault()
    void shell.openExternal(url)
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    void window.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return window
}

/* ==========================================================================
   Tray — the agent keeps working when the window isn't looking.
   ========================================================================== */

let tray: Tray | null = null

function trayImage(): Electron.NativeImage {
  // A period, on a transparent field. Same mark as the wordmark.
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16"><circle cx="8" cy="8" r="3.4" fill="#ededee"/></svg>`
  return nativeImage.createFromDataURL(
    `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`
  )
}

function buildTray(getWindow: () => BrowserWindow | null): void {
  tray = new Tray(trayImage())
  tray.setToolTip('Done.')
  refreshTray(getWindow)
}

function refreshTray(getWindow: () => BrowserWindow | null): void {
  if (!tray) return
  const needs = store.tasks.filter((t) => t.state === 'needs').length
  const working = store.tasks.filter((t) => t.state === 'working' || t.state === 'snag').length
  const label = needs
    ? `${needs} thing${needs === 1 ? '' : 's'} need you`
    : working
      ? `Working on ${working}`
      : 'Nothing needs you'
  tray.setToolTip(`Done. — ${label}`)

  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label, enabled: false },
      { type: 'separator' },
      {
        label: store.allPaused ? 'Resume everything' : 'Pause everything',
        click: () => {
          store.setAllPaused(!store.allPaused)
          refreshTray(getWindow)
        }
      },
      {
        label: 'Show Done.',
        click: () => {
          const w = getWindow()
          if (!w) return
          if (w.isMinimized()) w.restore()
          w.show()
          w.focus()
        }
      },
      { type: 'separator' },
      { label: 'Quit', role: 'quit' }
    ])
  )
}

/* ==========================================================================
   Menu
   ========================================================================== */

function buildMenu(getWindow: () => BrowserWindow | null): void {
  const template: Electron.MenuItemConstructorOptions[] = [
    ...(isMac
      ? ([
          {
            label: 'Done.',
            submenu: [
              { role: 'about' },
              { type: 'separator' },
              {
                label: 'Settings…',
                accelerator: 'Cmd+,',
                click: () => getWindow()?.webContents.send('menu:settings')
              },
              { type: 'separator' },
              { role: 'hide' },
              { role: 'hideOthers' },
              { role: 'unhide' },
              { type: 'separator' },
              { role: 'quit' }
            ]
          }
        ] as Electron.MenuItemConstructorOptions[])
      : []),
    {
      label: 'File',
      submenu: [
        {
          label: 'New task',
          accelerator: 'CmdOrCtrl+N',
          click: () => getWindow()?.webContents.send('menu:new')
        },
        { type: 'separator' },
        ...(isMac
          ? ([{ role: 'close' }] as Electron.MenuItemConstructorOptions[])
          : ([
              {
                label: 'Settings…',
                accelerator: 'Ctrl+,',
                click: () => getWindow()?.webContents.send('menu:settings')
              },
              { type: 'separator' },
              { role: 'quit' }
            ] as Electron.MenuItemConstructorOptions[]))
      ]
    },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        {
          label: 'Command bar',
          accelerator: 'CmdOrCtrl+K',
          click: () => getWindow()?.webContents.send('menu:command')
        },
        {
          label: 'Trace for this task',
          accelerator: 'CmdOrCtrl+T',
          click: () => getWindow()?.webContents.send('menu:trace')
        },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        ...(is.dev ? ([{ role: 'toggleDevTools' }] as Electron.MenuItemConstructorOptions[]) : [])
      ]
    },
    { role: 'windowMenu' }
  ]

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

/* ==========================================================================
   App
   ========================================================================== */

ensureDir()
nativeTheme.themeSource = 'dark'

const store = new Store()
let windowRef: BrowserWindow | null = null
let saveTimer: NodeJS.Timeout | null = null

function saveSoon(): void {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    try {
      writeFileSync(stateFile, store.serialise(), 'utf8')
    } catch {
      /* a failed save must never take the app down */
    }
  }, 900)
}

/** Clearing the saved list is what "Start fresh" does. */
function resetData(): void {
  try {
    if (existsSync(stateFile)) writeFileSync(stateFile, '', 'utf8')
  } catch {
    /* ignore */
  }
}

function boot(): void {
  // DONE_FRESH=1 starts a clean morning — handy for demos and screenshots.
  const saved = process.env['DONE_FRESH'] ? null : readJson(stateFile)
  if (saved) store.restore(readFileSync(stateFile, 'utf8'))
  else seed(store)

  void tracing.init().then((status) => {
    store.integrations.neatlogs = status
    store.bump()
  })

  // The repository this app lives in is where behaviour changes get committed.
  void entire.detect(app.getAppPath()).then((status) => {
    store.integrations.entire = status
    store.bump()
  })

  store.onChange(() => {
    saveSoon()
    refreshTray(() => windowRef)
    windowRef?.webContents.send('state:update', store.snapshot())
  })
}

function registerIpc(): void {
  ipcMain.handle('state:get', () => store.snapshot())

  ipcMain.handle('task:create', (_e, title: string, opts?: CreateOptions) => {
    store.createTask(String(title ?? '').slice(0, 140), opts)
  })

  ipcMain.handle('task:control', (_e, id: string, action: ControlAction) => {
    store.control(id, action)
  })

  ipcMain.handle('task:answer', (_e, id: string, value: string) => {
    void store.answer(id, value)
  })

  ipcMain.handle('task:steer', (_e, id: string, text: string) => {
    store.steer(id, text)
  })

  ipcMain.handle('task:dismiss', (_e, id: string) => {
    store.dismiss(id)
  })

  ipcMain.handle('task:clear-finished', () => {
    store.clearFinished()
  })

  ipcMain.handle('app:undo', () => {
    store.undo()
  })

  ipcMain.handle('app:limits', (_e, patch: Partial<Limits>) => {
    void store.setLimits(patch)
  })

  ipcMain.handle('app:pause-all', (_e, on: boolean) => {
    store.setAllPaused(on)
  })

  ipcMain.handle('app:economics', () => economics(store.spans))

  ipcMain.handle('task:checkpoint', async (_e, id: string) => {
    const task = store.byId(id)
    if (!task) return { ok: false, id: null, message: 'That task is gone.' }
    const result = await store.recordBehaviour(
      `steer: ${task.title}`,
      `Steered “${task.title}” — the plan was rewritten to honour the instruction.`,
      {
        task: task.title,
        instructions: task.notes,
        plan: task.plan,
        limits: store.limits
      }
    )
    if (result.ok) task.checkpointId = result.id
    return result
  })

  ipcMain.handle('entire:setup', async () => {
    const repo = entire.repoRoot ?? process.cwd()
    const result = await entire.setup(repo)
    store.integrations.entire = await entire.detect(repo)
    store.bump()
    return result
  })

  ipcMain.handle('entire:refresh', async () => {
    store.integrations.entire = await entire.detect(entire.repoRoot ?? process.cwd())
    store.bump()
    return store.integrations.entire
  })

  ipcMain.handle('app:reveal-data', () => {
    shell.showItemInFolder(stateFile)
  })

  ipcMain.handle('app:reset', () => {
    resetData()
    seed(store)
    saveSoon()
    return true
  })

  ipcMain.handle('app:open-external', (_e, url: string) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
  })

  ipcMain.handle('window:action', (_e, action: 'minimize' | 'maximize' | 'close') => {
    if (!windowRef) return
    if (action === 'minimize') windowRef.minimize()
    else if (action === 'maximize')
      windowRef.isMaximized() ? windowRef.unmaximize() : windowRef.maximize()
    else windowRef.close()
  })

  ipcMain.handle('window:is-maximized', () => Boolean(windowRef?.isMaximized()))
}

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (windowRef) {
      if (windowRef.isMinimized()) windowRef.restore()
      windowRef.focus()
    }
  })

  void app.whenReady().then(() => {
    electronApp.setAppUserModelId('com.done.desktop')

    app.on('browser-window-created', (_e, window) => {
      optimizer.watchWindowShortcuts(window)
    })

    boot()
    registerIpc()

    windowRef = createWindow()
    buildMenu(() => windowRef)
    buildTray(() => windowRef)

    windowRef.on('maximize', () => windowRef?.webContents.send('window:maximized', true))
    windowRef.on('unmaximize', () => windowRef?.webContents.send('window:maximized', false))
    windowRef.webContents.on('did-finish-load', () => {
      windowRef?.webContents.send('state:update', store.snapshot())
      if (process.env['DONE_SHOT']) {
        void import('./capture')
          .then((m) => m.captureSequence(() => windowRef))
          .then(() => app.quit())
      }
    })

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        windowRef = createWindow()
        refreshTray(() => windowRef)
      }
    })
  })

  app.on('window-all-closed', () => {
    if (!isMac) app.quit()
  })

  app.on('before-quit', async () => {
    if (saveTimer) clearTimeout(saveTimer)
    try {
      writeFileSync(stateFile, store.serialise(), 'utf8')
    } catch {
      /* ignore */
    }
    await tracing.shutdown()
  })
}
