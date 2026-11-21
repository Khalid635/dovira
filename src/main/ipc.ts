import { BrowserWindow, Notification, dialog, ipcMain, shell, app } from 'electron'
import type { OpenDialogOptions } from 'electron'
import { existsSync } from 'node:fs'
import type { DoviraDb } from './db'
import type { SettingsManager } from './settings'
import type { QueueManager } from './queue'
import {
  getAria2Version,
  getDenoVersion,
  getFfmpegVersion,
  getYtDlpVersion,
  listEngines,
  updateYtDlp,
  type EngineSpec
} from './engines/versions'
import { diskFreeBytes } from './util/paths'
import type { AddOptions, Settings } from './types'
import { logMain } from './logger'
import type { SchedulerManager } from './scheduler'

export interface IpcDeps {
  queue: QueueManager
  settings: SettingsManager
  db: DoviraDb
  aria2Binary: string
  ytDlpBinary: string | null
  ffmpegBinary: string | null
  denoBinary: string | null
  binDir: string
  getMainWindow: () => BrowserWindow | null
  /** Phase 3: scheduler status + countdown cancel. */
  scheduler: SchedulerManager
  /** Phase 3: called after every settings:set — applies launch-at-startup, clipboard watch, etc. */
  onSettingsChanged: (s: Settings) => void
}

/**
 * IPC contract (§5). Main re-validates every input — the UI is never trusted.
 * Events: dovira:download:progress (~500ms), dovira:download:status,
 * dovira:toast.
 */
export function registerIpc(deps: IpcDeps): void {
  const { queue, settings } = deps

  // Preload self-report (sent from src/preload/index.ts after the bridge
  // is exposed). If main never logs this line, the preload never ran.
  ipcMain.on('dovira:bridge:ready', () => {
    logMain('info', 'preload ran: bridge exposed to renderer')
  })

  ipcMain.handle('dovira:downloads:list', () => queue.list())
  ipcMain.handle('dovira:downloads:add', (_e, url: unknown, saveDir: unknown) =>
    typeof url === 'string'
      ? queue.add(url, typeof saveDir === 'string' ? saveDir : undefined)
      : { ok: false, error: 'invalid-url' }
  )
  ipcMain.handle('dovira:downloads:pause', (_e, id: unknown) =>
    typeof id === 'string' ? queue.pause(id) : false
  )
  ipcMain.handle('dovira:downloads:resume', (_e, id: unknown) =>
    typeof id === 'string' ? queue.resume(id) : false
  )
  ipcMain.handle('dovira:downloads:cancel', (_e, id: unknown) =>
    typeof id === 'string' ? queue.cancel(id) : false
  )
  ipcMain.handle('dovira:downloads:remove', (_e, id: unknown, deleteFile: unknown) =>
    typeof id === 'string' ? queue.remove(id, deleteFile === true) : false
  )
  ipcMain.handle('dovira:downloads:retry', (_e, id: unknown) =>
    typeof id === 'string' ? queue.retry(id) : false
  )
  ipcMain.handle('dovira:downloads:openFile', (_e, id: unknown) => {
    if (typeof id !== 'string') return false
    const d = queue.get(id)
    if (d && existsSync(d.savePath)) {
      void shell.openPath(d.savePath)
      return true
    }
    return false
  })
  ipcMain.handle('dovira:downloads:showInFolder', (_e, id: unknown) => {
    if (typeof id !== 'string') return false
    const d = queue.get(id)
    if (d) {
      shell.showItemInFolder(d.savePath)
      return true
    }
    return false
  })
  ipcMain.handle('dovira:info:fetch', (_e, url: unknown) =>
    typeof url === 'string' ? queue.fetchInfo(url) : { ok: false, error: 'invalid-url' }
  )
  ipcMain.handle('dovira:downloads:addWithOptions', (_e, opts: unknown) => {
    if (opts === null || typeof opts !== 'object' || Array.isArray(opts)) {
      return { ok: false, error: 'invalid-url' }
    }
    return queue.addWithOptions(opts as AddOptions)
  })
  const engineSpecs = (): EngineSpec[] => [
    { name: 'aria2', path: deps.aria2Binary, getVersion: getAria2Version },
    { name: 'yt-dlp', path: deps.ytDlpBinary, getVersion: getYtDlpVersion },
    { name: 'ffmpeg', path: deps.ffmpegBinary, getVersion: getFfmpegVersion },
    { name: 'deno', path: deps.denoBinary, getVersion: getDenoVersion }
  ]
  ipcMain.handle('dovira:engines:list', async (_e, checkForUpdates: unknown) =>
    listEngines(engineSpecs(), checkForUpdates === true)
  )
  ipcMain.handle('dovira:engines:update', async (_e, name: unknown) => {
    if (name !== 'yt-dlp') return { ok: false, error: 'not-supported' }
    return updateYtDlp(deps.binDir)
  })
  ipcMain.handle('dovira:settings:get', () => settings.get())
  ipcMain.handle('dovira:settings:set', (_e, patch: unknown) => {
    if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) {
      return settings.get()
    }
    const next = settings.update(patch as Partial<Settings>)
    deps.onSettingsChanged(next)
    return next
  })
  // Phase 3: cookies file picker (Netscape cookies.txt).
  ipcMain.handle('dovira:pickCookiesFile', async () => {
    const win = deps.getMainWindow()
    const options: OpenDialogOptions = {
      properties: ['openFile'],
      filters: [{ name: 'Cookies file', extensions: ['txt'] }]
    }
    const res = win
      ? await dialog.showOpenDialog(win, options)
      : await dialog.showOpenDialog(options)
    return res.canceled ? null : (res.filePaths[0] ?? null)
  })
  // Phase 3: History — missing files, re-download, clear (records only).
  ipcMain.handle('dovira:history:missing', () => queue.historyMissing())
  ipcMain.handle('dovira:history:redownload', (_e, id: unknown) =>
    typeof id === 'string' ? queue.redownload(id) : { ok: false, error: 'unknown' }
  )
  ipcMain.handle('dovira:history:clear', () => ({ removed: queue.clearHistory() }))
  // Phase 3: queue reorder.
  ipcMain.handle('dovira:downloads:moveToTop', (_e, id: unknown) =>
    typeof id === 'string' ? queue.moveToTop(id) : false
  )
  ipcMain.handle('dovira:downloads:reorder', (_e, id: unknown, beforeId: unknown) =>
    typeof id === 'string'
      ? queue.reorder(id, beforeId === null ? null : typeof beforeId === 'string' ? beforeId : null)
      : false
  )
  // Phase 3: scheduler.
  ipcMain.handle('dovira:scheduler:status', () => deps.scheduler.getStatus())
  ipcMain.handle('dovira:scheduler:cancel', () => {
    deps.scheduler.cancelCountdown()
    return true
  })
  // The four --version spawns used to run sequentially, so startup init()
  // waited the SUM of four cold process spawns (several seconds under
  // Defender) and Home sat on its loading state. They are independent —
  // run them in parallel. Safe: runVersion never rejects (null on error).
  ipcMain.handle('dovira:app:info', async () => {
    const [aria2Version, ytDlpVersion, ffmpegVersion, denoVersion] = await Promise.all([
      getAria2Version(deps.aria2Binary),
      deps.ytDlpBinary ? getYtDlpVersion(deps.ytDlpBinary) : Promise.resolve(null),
      deps.ffmpegBinary ? getFfmpegVersion(deps.ffmpegBinary) : Promise.resolve(null),
      deps.denoBinary ? getDenoVersion(deps.denoBinary) : Promise.resolve(null)
    ])
    return {
      version: app.getVersion(),
      electronVersion: process.versions.electron ?? '',
      chromeVersion: process.versions.chrome ?? '',
      nodeVersion: process.versions.node ?? '',
      aria2Version,
      ytDlpVersion,
      ffmpegVersion,
      denoVersion,
      downloadDir: settings.get().downloadDir,
      diskFreeBytes: diskFreeBytes(settings.get().downloadDir)
    }
  })
  ipcMain.handle('dovira:pickFolder', async () => {
    const win = deps.getMainWindow()
    const options: OpenDialogOptions = { properties: ['openDirectory', 'createDirectory'] }
    const res = win
      ? await dialog.showOpenDialog(win, options)
      : await dialog.showOpenDialog(options)
    return res.canceled ? null : (res.filePaths[0] ?? null)
  })

  // Forward queue events to the window; show a Windows toast on completion.
  queue.on('progress', (p) => {
    for (const w of BrowserWindow.getAllWindows()) {
      w.webContents.send('dovira:download:progress', p)
    }
  })
  queue.on('status', (s) => {
    for (const w of BrowserWindow.getAllWindows()) {
      w.webContents.send('dovira:download:status', s)
    }
    if (s.status === 'completed' && Notification.isSupported()) {
      const d = queue.get(s.id)
      if (d) {
        try {
          const n = new Notification({ title: 'DOVIRA', body: `Download complete: ${d.filename}` })
          n.on('click', () => shell.showItemInFolder(d.savePath))
          n.show()
        } catch {
          // Notifications must never break the download flow.
        }
      }
    }
  })
  queue.on('toast', (t) => {
    for (const w of BrowserWindow.getAllWindows()) {
      w.webContents.send('dovira:toast', t)
    }
  })
}
