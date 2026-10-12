import { app, BrowserWindow, Menu, Tray, ipcMain, nativeImage, nativeTheme, shell } from 'electron'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { shutdown, Store } from './agent'
import { entire, tracing } from './integrations'
import { hydrateEnv, envKey } from './env'
import { economics } from './finance'
import { discoverModels } from './llm'
import type { ControlAction, CreateOptions, Limits } from '../shared/types'
import { themeBackground, themeFile, type Theme, type ThemeChoice } from '../shared/theme'

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
  if (!existsSync(file)) return null
  try {
    // A UTF-8 BOM is invisible and `JSON.parse` rejects it, so a preferences
    // file written by a Windows text editor silently reads as empty — which
    // for `theme.json` means the user's chosen appearance quietly reverts to
    // following the system, with no error anywhere to explain it.
    return JSON.parse(readFileSync(file, 'utf8').replace(/^\uFEFF/, '')) as Record<string, unknown>
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

/**
 * The chosen appearance, resolved to what should actually be painted.
 *
 * `system` is deliberately resolved here and not stored: the OS setting is
 * read live, so toggling the Mac between light and dark moves the window with
 * it, while an explicit choice stays exactly as it was left.
 */
function readTheme(): { choice: ThemeChoice; resolved: Theme } {
  const raw = readJson(themeFile())?.['choice']
  const choice: ThemeChoice = raw === 'dark' || raw === 'light' || raw === 'system' ? raw : 'system'
  const resolved: Theme =
    choice === 'system' ? (nativeTheme.shouldUseDarkColors ? 'dark' : 'light') : choice
  return { choice, resolved }
}

function writeTheme(choice: ThemeChoice): void {
  try {
    writeFileSync(themeFile(), JSON.stringify({ choice }), 'utf8')
  } catch {
    /* an unwritable preferences file costs you your mode, not the app */
  }
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
    show: false,
    frame: false,
    // Painted by Electron before the renderer exists, so the window opens in
    // the right ink instead of flashing the other one and correcting.
    backgroundColor: themeBackground(readTheme().resolved),
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
        {
          label: 'Full Screen',
          accelerator: 'F11',
          click: () => {
            const w = getWindow()
            if (w) w.setFullScreen(!w.isFullScreen())
          }
        },
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
/* `themeSource` follows the app's own choice, so native-drawn surfaces —
   scrollbars, text selection menus, the caret — are never the other mode.
   Pinning it to 'dark' was what made light mode impossible to do honestly. */
nativeTheme.themeSource = readTheme().resolved
hydrateEnv()
process.env.DONE_REPO_IS_GIT = existsSync(join(app.getAppPath(), '.git')) ? '1' : ''

const store = new Store()

/* Settles the brain pool against the provider's own catalogue before the
   first task is written down, so an engine card never promises a model this
   key cannot reach. Not awaited: a slow probe must not delay the window, and
   the pool is correct without it. */
void discoverModels()
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
    writeFileSync(
      stateFile,
      JSON.stringify({
        tasks: [],
        spans: {},
        limits: store.limits,
        ledger: { spent: 0, minutes: 0, done: 0 },
        allPaused: false
      }),
      'utf8'
    )
  } catch {
    /* ignore */
  }
}

function boot(): void {
  // No fabricated history. The app opens on whatever you actually did last
  // time, and on an empty list if there isn't any.
  // Compared rather than tested for truthiness: DONE_FRESH=0 is the natural
  // thing to write, and treating it as "set" silently threw away the saved
  // list.
  const fresh = /^(1|true|yes)$/i.test(process.env['DONE_FRESH'] ?? '')
  const saved = fresh ? null : readJson(stateFile)
  if (saved) {
    store.restore(readFileSync(stateFile, 'utf8'))
    // Reserialize in case legacy seed tasks were stripped during restore
    try {
      writeFileSync(stateFile, store.serialise(), 'utf8')
    } catch {
      /* ignore */
    }
  } else {
    resetData()
  }
  store.bump()

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

  ipcMain.handle('task:group', (_e, id: string, group: string | null) => {
    store.setGroup(id, group)
  })

  ipcMain.handle('group:rename', (_e, from: string, to: string) => {
    store.renameGroup(from, to)
  })

  ipcMain.handle('group:remove', (_e, name: string) => {
    store.removeGroup(name)
  })

  ipcMain.handle('app:economics', () => economics(store.spans))

  // Whether a real search backend is configured. The UI says so out loud,
  // because a search that silently returns nothing is indistinguishable from a
  // task that cannot be done.
  ipcMain.handle('app:search-configured', () =>
    Boolean(envKey('BRAVE_SEARCH_API_KEY') || envKey('TAVILY_API_KEY'))
  )

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
    for (const t of store.tasks) store.halt(t)
    store.tasks = []
    store.spans = {}
    store.ledger = { spent: 0, minutes: 0, done: 0 }
    store.allPaused = false
    store.bump()
    return true
  })

  ipcMain.handle('app:open-external', (_e, url: string) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
  })

  ipcMain.handle(
    'connector:config',
    (
      _e,
      id: import('../shared/types').ConnectorId,
      config: { apiKey?: string; endpoint?: string }
    ) => {
      return store.setConnectorConfig(id, config)
    }
  )

  ipcMain.handle(
    'window:action',
    (_e, action: 'minimize' | 'maximize' | 'close' | 'fullscreen') => {
      if (!windowRef) return
      if (action === 'minimize') windowRef.minimize()
      else if (action === 'maximize')
        windowRef.isMaximized() ? windowRef.unmaximize() : windowRef.maximize()
      else if (action === 'fullscreen') windowRef.setFullScreen(!windowRef.isFullScreen())
      else windowRef.close()
    }
  )

  ipcMain.handle('window:is-maximized', () => Boolean(windowRef?.isMaximized()))

  ipcMain.handle('theme:set', (_e, payload: { choice: ThemeChoice; resolved: Theme }) => {
    writeTheme(payload.choice)
    nativeTheme.themeSource = payload.resolved
    // The window's own background has to move too, or a resize or a
    // maximised repaint flashes the old ink for a frame.
    windowRef?.setBackgroundColor(themeBackground(payload.resolved))
  })
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

    /* Following the OS means following it *while running*. Without this,
       flipping the Mac to light at sunset would leave a dark window on screen
       with no way to move it short of restarting the app. */
    nativeTheme.on('updated', () => {
      if (readTheme().choice !== 'system') return
      const resolved: Theme = nativeTheme.shouldUseDarkColors ? 'dark' : 'light'
      nativeTheme.themeSource = resolved
      windowRef?.setBackgroundColor(themeBackground(resolved))
      windowRef?.webContents.send('theme:changed', resolved)
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
    for (const t of store.tasks) store.halt(t)
    shutdown()
    await tracing.shutdown()
  })
}
