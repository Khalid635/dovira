import { BrowserWindow, Notification, dialog, ipcMain, shell, app } from 'electron'
import type { OpenDialogOptions } from 'electron'
import { existsSync, readFileSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
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
import { scanPage } from './grabber'
import type {
  AddOptions,
  AppUpdateState,
  ExtensionApiStatus,
  GrabberScanResult,
  Settings
} from './types'
import { logMain } from './logger'
import type { SchedulerManager } from './scheduler'
import type { LocalApiServer } from './localApi'
import type { AppUpdater } from './updater'

export interface IpcDeps {
  queue: QueueManager
  settings: SettingsManager
  db: DoviraDb
  /** Phase 6: null on macOS/Linux when no source-built aria2c is bundled. */
  aria2Binary: string | null
  ytDlpBinary: string | null
  ffmpegBinary: string | null
  denoBinary: string | null
  binDir: string
  getMainWindow: () => BrowserWindow | null
  /** Phase 3: scheduler status + countdown cancel. */
  scheduler: SchedulerManager
  /** Phase 5: Local API (token + status for Settings > Browser & Cookies). */
  localApi: LocalApiServer
  /** Phase 6: app auto-update (check / download / install). */
  updater: AppUpdater
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
  // Phase 7 (v1.0): Smart features — main re-validates every input
  // (settings are the source of truth for folders/template/switches).
  ipcMain.handle('dovira:smart:categorize', (_e, input: unknown) => {
    if (input === null || typeof input !== 'object' || Array.isArray(input)) {
      return { category: 'Others', folder: settings.get().downloadDir }
    }
    const i = input as {
      filename?: unknown
      kind?: unknown
      site?: unknown
      duration?: unknown
      ytCategory?: unknown
    }
    return queue.smartCategorize({
      filename: typeof i.filename === 'string' ? i.filename : 'download',
      kind: i.kind === 'video' || i.kind === 'audio' || i.kind === 'file' ? i.kind : undefined,
      site: typeof i.site === 'string' ? i.site : null,
      duration: typeof i.duration === 'number' ? i.duration : null,
      ytCategory: typeof i.ytCategory === 'string' ? i.ytCategory : null
    })
  })
  ipcMain.handle('dovira:smart:suggestName', (_e, input: unknown) => {
    if (input === null || typeof input !== 'object' || Array.isArray(input)) {
      return { name: 'download' }
    }
    const i = input as {
      filename?: unknown
      title?: unknown
      height?: unknown
      uploader?: unknown
    }
    return queue.smartSuggestName({
      filename: typeof i.filename === 'string' ? i.filename : 'download',
      title: typeof i.title === 'string' ? i.title : null,
      height: typeof i.height === 'number' ? i.height : null,
      uploader: typeof i.uploader === 'string' ? i.uploader : null
    })
  })
  ipcMain.handle('dovira:smart:checkDuplicate', (_e, input: unknown) => {
    if (input === null || typeof input !== 'object' || Array.isArray(input)) {
      return { duplicate: false }
    }
    const i = input as {
      url?: unknown
      filename?: unknown
      saveDir?: unknown
      totalBytes?: unknown
      remoteId?: unknown
      formatId?: unknown
    }
    return queue.checkDuplicate({
      url: typeof i.url === 'string' ? i.url : '',
      filename: typeof i.filename === 'string' ? i.filename : '',
      saveDir: typeof i.saveDir === 'string' ? i.saveDir : settings.get().downloadDir,
      totalBytes: typeof i.totalBytes === 'number' ? i.totalBytes : null,
      remoteId: typeof i.remoteId === 'string' ? i.remoteId : null,
      formatId: typeof i.formatId === 'string' ? i.formatId : null
    })
  })
  ipcMain.handle('dovira:smart:testLocalModel', () => queue.testLocalModel())
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
  // Phase 4: batch import — read a .txt of URLs in main, return the lines
  // (http(s) + magnet: only, trimmed, de-duped, max 200).
  ipcMain.handle('dovira:batch:importFile', async () => {
    const win = deps.getMainWindow()
    const options: OpenDialogOptions = {
      properties: ['openFile'],
      filters: [{ name: 'Text file', extensions: ['txt'] }]
    }
    const res = win
      ? await dialog.showOpenDialog(win, options)
      : await dialog.showOpenDialog(options)
    if (res.canceled || !res.filePaths[0]) return { ok: false, urls: [] as string[] }
    try {
      const text = readFileSync(res.filePaths[0], 'utf-8')
      const seen = new Set<string>()
      const urls: string[] = []
      for (const line of text.split(/\r?\n/)) {
        const u = line.trim()
        if (!u || seen.has(u) || urls.length >= 200) continue
        if (u.startsWith('magnet:') || u.startsWith('http://') || u.startsWith('https://')) {
          seen.add(u)
          urls.push(u)
        }
      }
      return { ok: true, urls }
    } catch {
      return { ok: false, urls: [] as string[] }
    }
  })
  // Phase 4: thumbnail-only download.
  ipcMain.handle('dovira:downloads:addThumbnailOnly', (_e, url: unknown, saveDir: unknown) =>
    typeof url === 'string'
      ? queue.addThumbnailOnly(url, typeof saveDir === 'string' ? saveDir : undefined)
      : { ok: false, error: 'invalid-url' }
  )
  // Phase 7: per-download speed limit (KB/s, 0 = use the global limit).
  ipcMain.handle('dovira:downloads:setSpeedLimit', (_e, id: unknown, kbps: unknown) =>
    typeof id === 'string' && typeof kbps === 'number'
      ? queue.setDownloadSpeedLimit(id, kbps)
      : false
  )
  // Phase 7: site grabber — scan a page for downloadable links, then queue
  // the selected ones as normal plain-file downloads.
  ipcMain.handle('dovira:grabber:scan', (_e, url: unknown): Promise<GrabberScanResult> =>
    typeof url === 'string'
      ? scanPage(url)
      : Promise.resolve({
          ok: false,
          pageUrl: '',
          title: null,
          items: [],
          error: 'invalid-url'
        })
  )
  ipcMain.handle('dovira:grabber:add', (_e, urls: unknown) =>
    Array.isArray(urls) && urls.every((u) => typeof u === 'string')
      ? queue.addMany(urls as string[])
      : { added: 0, failed: 0, ids: [] as string[] }
  )
  // Phase 4: delete the download archive (userData/download-archive.txt).
  // Returns true when a file was actually removed.
  ipcMain.handle('dovira:settings:clearArchive', () => {
    const archivePath = join(app.getPath('userData'), 'download-archive.txt')
    try {
      if (existsSync(archivePath)) {
        unlinkSync(archivePath)
        return true
      }
      return false
    } catch {
      return false
    }
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
  // Phase 6: app auto-update — the renderer drives check / download /
  // install; state changes arrive as 'dovira:update:state' events.
  ipcMain.handle('dovira:update:state', (): AppUpdateState => deps.updater.getState())
  ipcMain.handle('dovira:update:check', (): Promise<AppUpdateState> => deps.updater.check())
  ipcMain.handle('dovira:update:download', (): Promise<AppUpdateState> => deps.updater.download())
  ipcMain.handle('dovira:update:install', (): boolean => deps.updater.install())
  // Phase 5: browser extension pairing — status (running/port/token)
  // and token regeneration. The token is shown in Settings so the user
  // can copy it into the extension's options page.
  ipcMain.handle('dovira:extension:status', (): ExtensionApiStatus => deps.localApi.getStatus())
  ipcMain.handle('dovira:extension:regenerateToken', (): string => deps.localApi.regenerateToken())
  // The four --version spawns used to run sequentially, so startup init()
  // waited the SUM of four cold process spawns (several seconds under
  // Defender) and Home sat on its loading state. They are independent —
  // run them in parallel. Safe: runVersion never rejects (null on error).
  ipcMain.handle('dovira:app:info', async () => {
    const [aria2Version, ytDlpVersion, ffmpegVersion, denoVersion] = await Promise.all([
      deps.aria2Binary ? getAria2Version(deps.aria2Binary) : Promise.resolve(null),
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
