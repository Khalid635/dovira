import { app, shell, BrowserWindow, dialog } from 'electron'
import { join, dirname } from 'node:path'
import { mkdirSync } from 'node:fs'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { DoviraDb } from './db'
import { SettingsManager } from './settings'
import { Aria2Manager } from './engines/aria2'
import { YtDlpManager } from './engines/ytdlp'
import { QueueManager } from './queue'
import { registerIpc } from './ipc'
import { findBinary } from './util/paths'

let mainWindow: BrowserWindow | null = null
let db: DoviraDb | null = null
let queue: QueueManager | null = null
let aria2: Aria2Manager | null = null

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
    dialog.showErrorBox(
      'DOVIRA — Engine missing',
      `These engine files were not found under resources/bin/win:\n${missing.join('\n')}\nRun "npm run fetch-binaries" to download them.`
    )
    app.quit()
    return
  }
  const binDir = dirname(aria2Binary as string)

  aria2 = new Aria2Manager(aria2Binary as string, settings.get().downloadDir)
  const ytdlp = new YtDlpManager(ytDlpBinary as string, binDir, denoBinary)
  queue = new QueueManager(db, settings, aria2, ytdlp)
  registerIpc({
    queue,
    settings,
    db,
    aria2Binary: aria2Binary as string,
    ytDlpBinary,
    ffmpegBinary,
    denoBinary,
    binDir,
    getMainWindow: () => mainWindow
  })

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
