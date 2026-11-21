import { app, shell, BrowserWindow, dialog } from 'electron'
import { join, dirname } from 'node:path'
import { mkdirSync } from 'node:fs'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { DoviraDb } from './db'
import { SettingsManager } from './settings'
import type { Settings } from './types'
import { Aria2Manager } from './engines/aria2'
import { YtDlpManager } from './engines/ytdlp'
import { QueueManager } from './queue'
import { SchedulerManager } from './scheduler'
import { TrayManager } from './tray'
import { ClipboardWatcher } from './clipboard'
import { registerIpc } from './ipc'
import { findBinary } from './util/paths'
import { initLogger, logMain } from './logger'

let mainWindow: BrowserWindow | null = null
let db: DoviraDb | null = null
/** Module-level alias so createWindow's close-to-tray guard can read settings. */
let settingsManager: SettingsManager | null = null
let queue: QueueManager | null = null
let aria2: Aria2Manager | null = null
let scheduler: SchedulerManager | null = null
let tray: TrayManager | null = null
let clipboardWatcher: ClipboardWatcher | null = null
/** True once a real quit is in progress — the close-to-tray guard must not block it. */
let quitting = false

/**
 * Phase 3: apply the settings that live outside the renderer — launch at
 * startup (Windows Run key) and clipboard watch. Called once at startup
 * and after every settings:set.
 */
function applyRuntimeSettings(s: Settings): void {
  try {
    app.setLoginItemSettings({ openAtLogin: s.launchAtStartup })
  } catch (err) {
    logMain('error', `launch-at-startup apply failed: ${(err as Error).message}`)
  }
  if (clipboardWatcher) {
    if (s.clipboardWatch && !clipboardWatcher.isRunning()) clipboardWatcher.start()
    else if (!s.clipboardWatch && clipboardWatcher.isRunning()) clipboardWatcher.stop()
  }
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1080,
    height: 720,
    minWidth: 960,
    minHeight: 640,
    show: false,
    autoHideMenuBar: true,
    title: 'DOVIRA',
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      // Plan §11: sandbox on. If the preload ever breaks under it, this is
      // the first thing to re-check (Phase 1 hardening item).
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
  })

  // Phase 3: close-to-tray — when minimizeToTray is on and a tray icon
  // exists, closing the window hides it instead of quitting. The tray's
  // Quit menu and app.quit() set `quitting`, so a real quit is never
  // blocked by this guard. Without a tray (headless), close works as usual.
  mainWindow.on('close', (e) => {
    if (!quitting && settingsManager?.get().minimizeToTray && tray?.isCreated()) {
      e.preventDefault()
      mainWindow?.hide()
      logMain('info', 'window hidden to tray (close-to-tray)')
    }
  })

  // Preload errors are otherwise invisible (they only reach the DevTools
  // console). Log them — a throwing preload is the most likely cause of a
  // dead bridge, and this names the exact error.
  mainWindow.webContents.on('preload-error', (_event, preloadPath, error) => {
    logMain('error', `preload-error: ${preloadPath}: ${error.message}`)
  })

  // Renderer-mount ping: the 2026-11-22 Settings bug was a preload that
  // never exposed window.dovira, and nothing on disk recorded it. Ask the
  // loaded page directly and log the answer, so a dead bridge is provable
  // after the fact. executeJavaScript runs in the main world, where
  // contextBridge-exposed properties are visible.
  mainWindow.webContents.on('did-finish-load', () => {
    void (async () => {
      try {
        const t = await mainWindow?.webContents.executeJavaScript('typeof window.dovira')
        logMain('info', `renderer mounted: typeof window.dovira = ${String(t)}`)
        if (t !== 'object') {
          logMain(
            'error',
            'BRIDGE DEAD: preload did not expose window.dovira — the renderer shows the fatal bridge screen'
          )
        }
      } catch (err) {
        logMain('error', `renderer bridge ping failed: ${(err as Error).message}`)
      }
      try {
        // What the user actually sees: the fatal screen's text appears only
        // when the renderer's own gate found the bridge dead. The DOM is
        // shared across JS worlds, so this read stays valid even if the
        // typeof check above runs in a different world than the page.
        const fatalShown = await mainWindow?.webContents.executeJavaScript(
          "document.body.innerText.includes('অ্যাপের ভেতরের সংযোগ চালু হয়নি')"
        )
        logMain('info', `renderer mounted: fatal bridge screen shown = ${String(fatalShown)}`)
      } catch (err) {
        logMain('error', `renderer fatal-screen check failed: ${(err as Error).message}`)
      }
      // Home-state probes — React's init() IPC round-trip needs a moment,
      // and the 3s reading alone can't tell "slow init" from "stuck init".
      // Two readings do: slow ⟺ loading at 3s, settled at 12s. This proves
      // end-to-end that the bridge not only exists but answers: empty ⟺
      // init settled and the list is empty; failed ⟺ init settled with an
      // error; loading ⟺ init still hasn't settled.
      for (const delayMs of [3000, 12000]) {
        setTimeout(() => {
          void (async () => {
            try {
              const state = await mainWindow?.webContents.executeJavaScript(
                `(() => { const txt = document.body.innerText; ` +
                  `if (txt.includes('অ্যাপের ভেতরের সংযোগ চালু হয়নি') || txt.includes('internal connection did not start')) return 'fatal'; ` +
                  `if (txt.includes('এখনো কোনো ডাউনলোড নেই') || txt.includes('No downloads yet')) return 'empty'; ` +
                  `if (txt.includes('আবার চেষ্টা') || txt.includes('Retry')) return 'failed'; ` +
                  `if (txt.includes('লোড হচ্ছে') || txt.includes('Loading')) return 'loading'; ` +
                  `return 'list'; })()`
              )
              logMain(
                'info',
                `renderer mounted: home state after ${delayMs / 1000}s = ${String(state)}`
              )
              // Phase 3: speed graph — only present when a card is expanded
              // with samples, so "false" is expected on a fresh launch.
              const graph = await mainWindow?.webContents.executeJavaScript(
                "!!document.querySelector('.speed-graph')"
              )
              logMain('info', `renderer mounted: speed graph present = ${String(graph)}`)
            } catch (err) {
              logMain('error', `renderer home-state probe failed: ${(err as Error).message}`)
            }
          })()
        }, delayMs)
      }
    })()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // HMR for renderer base on electron-vite cli.
  // Load the remote URL for development or the local html file for production.
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  // Set app user model id for windows
  electronApp.setAppUserModelId('com.khalid635.dovira')

  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production.
  // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  const userData = app.getPath('userData')
  mkdirSync(userData, { recursive: true })
  initLogger(userData)
  logMain('info', `DOVIRA main starting — version ${app.getVersion()} — userData=${userData}`)

  try {
    db = new DoviraDb(join(userData, 'dovira.db'))
  } catch (err) {
    // Migration failure: never wipe user data. Tell the user, then quit.
    dialog.showErrorBox(
      'DOVIRA — Database error',
      `Could not open or migrate the download database.\n\n${(err as Error).message}`
    )
    app.quit()
    return
  }

  const settings = new SettingsManager(db)
  settingsManager = settings

  const appPath = app.getAppPath()
  const resourcesPath = process.resourcesPath
  const aria2Binary = findBinary('aria2', appPath, resourcesPath)
  const ytDlpBinary = findBinary('yt-dlp', appPath, resourcesPath)
  const ffmpegBinary = findBinary('ffmpeg', appPath, resourcesPath)
  const denoBinary = findBinary('deno', appPath, resourcesPath)
  const missing: string[] = []
  if (!aria2Binary) missing.push('aria2c.exe')
  if (!ytDlpBinary) missing.push('yt-dlp.exe')
  if (!ffmpegBinary) missing.push('ffmpeg.exe')
  if (!denoBinary) missing.push('deno.exe')
  if (missing.length > 0) {
    logMain('error', `engine files missing: ${missing.join(', ')}`)
    dialog.showErrorBox(
      'DOVIRA — Engine missing',
      `These engine files were not found under resources/bin/win:\n${missing.join('\n')}\nRun "npm run fetch-binaries" to download them.`
    )
    app.quit()
    return
  }
  const binDir = dirname(aria2Binary as string)

  aria2 = new Aria2Manager(aria2Binary as string, settings.get().downloadDir)
  // Phase 3: yt-dlp reads cookies + proxy live from Settings on every call.
  const ytdlp = new YtDlpManager(ytDlpBinary as string, binDir, denoBinary, () => {
    const s = settings.get()
    return { cookieBrowser: s.cookieBrowser, cookiesFile: s.cookiesFile, proxyUrl: s.proxyUrl }
  })
  queue = new QueueManager(db, settings, aria2, ytdlp)

  // Phase 3: scheduler — countdown events go to every window.
  scheduler = new SchedulerManager(queue, settings, {
    onCountdown: (c) => {
      for (const w of BrowserWindow.getAllWindows()) {
        w.webContents.send('dovira:scheduler:countdown', c)
      }
    },
    onLog: (line) => logMain('info', line)
  })
  scheduler.start()

  // Phase 3: tray — Quit sets `quitting` so close-to-tray never blocks it.
  tray = new TrayManager(
    () => mainWindow,
    queue,
    (line) => logMain('info', line),
    () => {
      quitting = true
      app.quit()
    }
  )
  tray.create(icon)

  // Phase 3: clipboard watch — only started when the setting is on.
  clipboardWatcher = new ClipboardWatcher(
    queue,
    (url) => {
      // Logged so a headless run can prove the watcher fired (the toast
      // itself is renderer-side and invisible from SSH).
      logMain('info', `clipboard: link detected — ${url}`)
      for (const w of BrowserWindow.getAllWindows()) {
        w.webContents.send('dovira:clipboard:link', url)
      }
    },
    (line) => logMain('info', line)
  )
  if (settings.get().clipboardWatch) clipboardWatcher.start()

  applyRuntimeSettings(settings.get())

  registerIpc({
    queue,
    settings,
    db,
    aria2Binary: aria2Binary as string,
    ytDlpBinary,
    ffmpegBinary,
    denoBinary,
    binDir,
    getMainWindow: () => mainWindow,
    scheduler,
    onSettingsChanged: (s) => applyRuntimeSettings(s)
  })

  logMain('info', 'window created')
  createWindow()

  app.on('activate', function () {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// Synchronous cleanup: stop the engine, flush the DB, then exit.
app.on('before-quit', () => {
  quitting = true
  try {
    scheduler?.stop()
  } catch {
    // Never block quitting on cleanup.
  }
  try {
    clipboardWatcher?.stop()
  } catch {
    // Never block quitting on cleanup.
  }
  try {
    tray?.destroy()
  } catch {
    // Never block quitting on cleanup.
  }
  try {
    queue?.shutdown()
  } catch {
    // Never block quitting on cleanup.
  }
  try {
    void aria2?.stop()
  } catch {
    // Ignore.
  }
  try {
    db?.close()
  } catch {
    // Ignore.
  }
})
