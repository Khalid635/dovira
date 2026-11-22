import { contextBridge, ipcRenderer } from 'electron'
import type {
  AddOptions,
  AppInfo,
  DownloadInfo,
  EngineInfo,
  ExtensionApiStatus,
  PlainFileInfo,
  PlaylistInfo,
  ProgressEvent,
  SchedulerCountdown,
  SchedulerStatus,
  Settings,
  StatusEvent,
  ToastEvent,
  VideoInfo
} from '../main/types'

export interface DoviraAPI {
  listDownloads(): Promise<DownloadInfo[]>
  addDownload(url: string, saveDir?: string): Promise<{ ok: boolean; id?: string; error?: string }>
  fetchInfo(url: string): Promise<{
    ok: boolean
    info?: VideoInfo
    plainFile?: PlainFileInfo
    playlist?: PlaylistInfo
    torrent?: { name: string }
    error?: string
  }>
  addWithOptions(opts: AddOptions): Promise<{ ok: boolean; id?: string; error?: string }>
  listEngines(checkForUpdates: boolean): Promise<EngineInfo[]>
  updateEngine(name: string): Promise<{ ok: boolean; version?: string; error?: string }>
  pauseDownload(id: string): Promise<boolean>
  resumeDownload(id: string): Promise<boolean>
  cancelDownload(id: string): Promise<boolean>
  removeDownload(id: string, deleteFile: boolean): Promise<boolean>
  retryDownload(id: string): Promise<boolean>
  openFile(id: string): Promise<boolean>
  showInFolder(id: string): Promise<boolean>
  getSettings(): Promise<Settings>
  setSettings(patch: Partial<Settings>): Promise<Settings>
  getAppInfo(): Promise<AppInfo>
  pickFolder(): Promise<string | null>
  // Phase 3
  pickCookiesFile(): Promise<string | null>
  historyMissing(): Promise<string[]>
  redownload(id: string): Promise<{ ok: boolean; id?: string; error?: string }>
  clearHistory(): Promise<{ removed: number }>
  moveToTop(id: string): Promise<boolean>
  reorderDownloads(id: string, beforeId: string | null): Promise<boolean>
  schedulerStatus(): Promise<SchedulerStatus>
  schedulerCancel(): Promise<boolean>
  // Phase 4
  importBatchFile(): Promise<{ ok: boolean; urls: string[] }>
  addThumbnailOnly(
    url: string,
    saveDir?: string
  ): Promise<{ ok: boolean; id?: string; error?: string }>
  clearDownloadArchive(): Promise<boolean>
  // Phase 5: browser extension pairing (Local API status + token).
  extensionStatus(): Promise<ExtensionApiStatus>
  regenerateExtensionToken(): Promise<string>
  onSchedulerCountdown(cb: (c: SchedulerCountdown | null) => void): () => void
  onClipboardLink(cb: (url: string) => void): () => void
  onProgress(cb: (p: ProgressEvent) => void): () => void
  onStatus(cb: (s: StatusEvent) => void): () => void
  onToast(cb: (t: ToastEvent) => void): () => void
}

function subscribe<T>(channel: string, cb: (payload: T) => void): () => void {
  const handler = (_event: unknown, payload: T): void => cb(payload)
  ipcRenderer.on(channel, handler)
  return () => {
    ipcRenderer.removeListener(channel, handler)
  }
}

// Custom APIs for renderer
const api: DoviraAPI = {
  listDownloads: () => ipcRenderer.invoke('dovira:downloads:list'),
  addDownload: (url: string, saveDir?: string) =>
    ipcRenderer.invoke('dovira:downloads:add', url, saveDir),
  fetchInfo: (url: string) => ipcRenderer.invoke('dovira:info:fetch', url),
  addWithOptions: (opts: AddOptions) => ipcRenderer.invoke('dovira:downloads:addWithOptions', opts),
  listEngines: (checkForUpdates: boolean) =>
    ipcRenderer.invoke('dovira:engines:list', checkForUpdates),
  updateEngine: (name: string) => ipcRenderer.invoke('dovira:engines:update', name),
  pauseDownload: (id: string) => ipcRenderer.invoke('dovira:downloads:pause', id),
  resumeDownload: (id: string) => ipcRenderer.invoke('dovira:downloads:resume', id),
  cancelDownload: (id: string) => ipcRenderer.invoke('dovira:downloads:cancel', id),
  removeDownload: (id: string, deleteFile: boolean) =>
    ipcRenderer.invoke('dovira:downloads:remove', id, deleteFile),
  retryDownload: (id: string) => ipcRenderer.invoke('dovira:downloads:retry', id),
  openFile: (id: string) => ipcRenderer.invoke('dovira:downloads:openFile', id),
  showInFolder: (id: string) => ipcRenderer.invoke('dovira:downloads:showInFolder', id),
  getSettings: () => ipcRenderer.invoke('dovira:settings:get'),
  setSettings: (patch: Partial<Settings>) => ipcRenderer.invoke('dovira:settings:set', patch),
  getAppInfo: () => ipcRenderer.invoke('dovira:app:info'),
  pickFolder: () => ipcRenderer.invoke('dovira:pickFolder'),
  // Phase 3
  pickCookiesFile: () => ipcRenderer.invoke('dovira:pickCookiesFile'),
  historyMissing: () => ipcRenderer.invoke('dovira:history:missing'),
  redownload: (id: string) => ipcRenderer.invoke('dovira:history:redownload', id),
  clearHistory: () => ipcRenderer.invoke('dovira:history:clear'),
  moveToTop: (id: string) => ipcRenderer.invoke('dovira:downloads:moveToTop', id),
  reorderDownloads: (id: string, beforeId: string | null) =>
    ipcRenderer.invoke('dovira:downloads:reorder', id, beforeId),
  schedulerStatus: () => ipcRenderer.invoke('dovira:scheduler:status'),
  schedulerCancel: () => ipcRenderer.invoke('dovira:scheduler:cancel'),
  // Phase 4
  importBatchFile: () => ipcRenderer.invoke('dovira:batch:importFile'),
  addThumbnailOnly: (url: string, saveDir?: string) =>
    ipcRenderer.invoke('dovira:downloads:addThumbnailOnly', url, saveDir),
  clearDownloadArchive: () => ipcRenderer.invoke('dovira:settings:clearArchive'),
  // Phase 5
  extensionStatus: () => ipcRenderer.invoke('dovira:extension:status'),
  regenerateExtensionToken: () => ipcRenderer.invoke('dovira:extension:regenerateToken'),
  onSchedulerCountdown: (cb) =>
    subscribe<SchedulerCountdown | null>('dovira:scheduler:countdown', cb),
  onClipboardLink: (cb) => subscribe<string>('dovira:clipboard:link', cb),
  onProgress: (cb) => subscribe<ProgressEvent>('dovira:download:progress', cb),
  onStatus: (cb) => subscribe<StatusEvent>('dovira:download:status', cb),
  onToast: (cb) => subscribe<ToastEvent>('dovira:toast', cb)
}

// NOTE: this preload must NOT import any npm package — not even
// @electron-toolkit/preload. The app runs with sandbox:true, and a sandboxed
// preload's require() cannot load node_modules: the packaged app died on
// `preload-error: module not found: @electron-toolkit/preload` (2026-11-22),
// which left window.dovira undefined and every screen stuck on a bare "…".
// Only require('electron') — a built-in — works here. window.electron is
// intentionally NOT exposed: nothing in the renderer reads it; the whole
// API surface is window.dovira.
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('dovira', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.dovira = api
}

// Bridge self-report: main logs it, so a preload that never ran (or died
// before this line) is distinguishable from a ping that reads the wrong
// JS world. Sent after the expose above, so it fires even if expose threw.
ipcRenderer.send('dovira:bridge:ready')
