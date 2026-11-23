import { contextBridge, ipcRenderer } from 'electron'
import type { AssistantAnswer } from '../main/smart/assistant'
import type {
  AddOptions,
  AppInfo,
  AppUpdateState,
  DiagnosticsResult,
  DownloadInfo,
  EngineInfo,
  ExtensionApiStatus,
  ExtensionDownloadRequest,
  GrabberScanResult,
  PlainFileInfo,
  PlaylistInfo,
  ProgressEvent,
  SchedulerCountdown,
  SchedulerStatus,
  Settings,
  StatusEvent,
  Subscription,
  SubscriptionVideo,
  ToastEvent,
  VideoInfo
} from '../main/types'

export interface DoviraAPI {
  listDownloads(): Promise<DownloadInfo[]>
  addDownload(
    url: string,
    saveDir?: string,
    opts?: { skipDuplicateCheck?: boolean }
  ): Promise<{ ok: boolean; id?: string; error?: string }>
  fetchInfo(
    url: string,
    opts?: { force?: boolean }
  ): Promise<{
    ok: boolean
    info?: VideoInfo
    plainFile?: PlainFileInfo
    playlist?: PlaylistInfo
    torrent?: { name: string }
    error?: string
    errorDetail?: string
  }>
  addWithOptions(opts: AddOptions): Promise<{
    ok: boolean
    id?: string
    error?: string
    errorDetail?: string
  }>
  listEngines(checkForUpdates: boolean): Promise<EngineInfo[]>
  updateEngine(name: string): Promise<{ ok: boolean; version?: string; error?: string }>
  pauseDownload(id: string): Promise<boolean>
  resumeDownload(id: string): Promise<boolean>
  cancelDownload(id: string): Promise<boolean>
  removeDownload(id: string, deleteFile: boolean): Promise<boolean>
  retryDownload(id: string): Promise<boolean>
  // Next-level: pin to the top of the queue (persisted).
  togglePin(id: string): Promise<boolean | null>
  // Next-level: stop a live-stream recording and KEEP the .ts file.
  stopRecording(id: string): Promise<boolean>
  // Next-level: preview URL for a completed video/audio row (null when
  // the row is not previewable or the Local API is down).
  previewUrl(id: string): Promise<string | null>
  // Next-level: channel subscriptions (local polling).
  listSubscriptions(): Promise<Subscription[]>
  addSubscription(url: string): Promise<{
    ok: boolean
    subscription?: Subscription
    error?: string
  }>
  removeSubscription(id: string): Promise<boolean>
  checkSubscriptions(): Promise<{ checked: number; found: number }>
  checkSubscription(id: string): Promise<{ ok: boolean; found: number; error?: string }>
  consumeSubscriptionVideo(id: string, videoId: string): Promise<SubscriptionVideo | null>
  onSubscriptionsUpdated(cb: () => void): () => void
  // Next-level: one-click pairing — opens the extension's Options page
  // with the token in the URL. Fails when the extension has not
  // checked in yet (nothing to open).
  pairExtension(): Promise<{ ok: boolean; error?: string }>
  // Phase 7: per-download speed limit (KB/s, 0 = use the global limit).
  setDownloadSpeedLimit(id: string, kbps: number): Promise<boolean>
  // Phase 7 (v1.0): Smart features.
  smartCategorize(input: {
    filename: string
    kind?: 'video' | 'audio' | 'file'
    site?: string | null
    duration?: number | null
    ytCategory?: string | null
  }): Promise<{ category: string; folder: string }>
  smartSuggestName(input: {
    filename: string
    title?: string | null
    height?: number | null
    uploader?: string | null
  }): Promise<{ name: string }>
  smartCheckDuplicate(input: {
    url: string
    filename: string
    saveDir: string
    totalBytes: number | null
    remoteId?: string | null
    formatId?: string | null
  }): Promise<{
    duplicate: boolean
    kind?: 'url' | 'remote' | 'file'
    existingId?: string
    existingName?: string
    existingSize?: number | null
    existingCompletedAt?: number | null
  }>
  testLocalModel(): Promise<{ ok: boolean; error?: string }>
  // AI Assistant (post-v1.0, v1.1.0).
  askAssistant(question: string): Promise<AssistantAnswer>
  // Phase 7: site grabber — scan a page, then queue the picked links.
  scanPage(url: string): Promise<GrabberScanResult>
  addGrabbedLinks(urls: string[]): Promise<{ added: number; failed: number; ids: string[] }>
  openFile(id: string): Promise<boolean>
  showInFolder(id: string): Promise<boolean>
  showPathInFolder(path: string): Promise<boolean>
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
  // Dialog-first extension flow: a floating-button click opens the Add
  // dialog immediately (main sends the URL); the pending request is
  // pulled once at startup in case the send arrived before mount.
  onExtensionDownload(cb: (req: ExtensionDownloadRequest) => void): () => void
  getPendingExtensionDownload(): Promise<ExtensionDownloadRequest | null>
  dismissExtensionDownload(url: string): Promise<boolean>
  // v1.2.0: guided setup + diagnostics.
  runDiagnostics(): Promise<DiagnosticsResult>
  extensionFolderPath(): Promise<string | null>
  openExtensionFolder(): Promise<boolean>
  // Cobalt-inspired Local API docs — opens docs/local-api.md on GitHub.
  openLocalApiDocs(): Promise<boolean>
  // Phase 6: app auto-update (electron-updater + GitHub Releases).
  getAppUpdateState(): Promise<AppUpdateState>
  checkAppUpdate(): Promise<AppUpdateState>
  downloadAppUpdate(): Promise<AppUpdateState>
  installAppUpdate(): Promise<boolean>
  onAppUpdateState(cb: (s: AppUpdateState) => void): () => void
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
  addDownload: (url: string, saveDir?: string, opts?: { skipDuplicateCheck?: boolean }) =>
    ipcRenderer.invoke('dovira:downloads:add', url, saveDir, opts ?? null),
  fetchInfo: (url: string, opts?: { force?: boolean }) =>
    ipcRenderer.invoke('dovira:info:fetch', url, opts ?? null),
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
  // Next-level
  togglePin: (id: string) => ipcRenderer.invoke('dovira:downloads:togglePin', id),
  stopRecording: (id: string) => ipcRenderer.invoke('dovira:downloads:stopRecording', id),
  previewUrl: (id: string) => ipcRenderer.invoke('dovira:preview:url', id),
  listSubscriptions: () => ipcRenderer.invoke('dovira:subscriptions:list'),
  addSubscription: (url: string) => ipcRenderer.invoke('dovira:subscriptions:add', url),
  removeSubscription: (id: string) => ipcRenderer.invoke('dovira:subscriptions:remove', id),
  checkSubscriptions: () => ipcRenderer.invoke('dovira:subscriptions:check'),
  checkSubscription: (id: string) => ipcRenderer.invoke('dovira:subscriptions:checkOne', id),
  consumeSubscriptionVideo: (id: string, videoId: string) =>
    ipcRenderer.invoke('dovira:subscriptions:consumePending', id, videoId),
  onSubscriptionsUpdated: (cb) => subscribe<void>('dovira:subscriptions:updated', cb),
  pairExtension: () => ipcRenderer.invoke('dovira:extension:pair'),
  // Phase 7
  setDownloadSpeedLimit: (id: string, kbps: number) =>
    ipcRenderer.invoke('dovira:downloads:setSpeedLimit', id, kbps),
  // Phase 7 (v1.0): Smart features.
  smartCategorize: (input) => ipcRenderer.invoke('dovira:smart:categorize', input),
  smartSuggestName: (input) => ipcRenderer.invoke('dovira:smart:suggestName', input),
  smartCheckDuplicate: (input) => ipcRenderer.invoke('dovira:smart:checkDuplicate', input),
  testLocalModel: () => ipcRenderer.invoke('dovira:smart:testLocalModel'),
  askAssistant: (question: string) => ipcRenderer.invoke('dovira:assistant:ask', question),
  scanPage: (url: string) => ipcRenderer.invoke('dovira:grabber:scan', url),
  addGrabbedLinks: (urls: string[]) => ipcRenderer.invoke('dovira:grabber:add', urls),
  openFile: (id: string) => ipcRenderer.invoke('dovira:downloads:openFile', id),
  showInFolder: (id: string) => ipcRenderer.invoke('dovira:downloads:showInFolder', id),
  showPathInFolder: (path: string) => ipcRenderer.invoke('dovira:downloads:showPathInFolder', path),
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
  // Dialog-first extension flow: a floating-button click opens the Add
  // dialog immediately (main sends the URL); the pending request is
  // pulled once at startup in case the send arrived before mount.
  onExtensionDownload: (cb) => subscribe<ExtensionDownloadRequest>('dovira:extension:download', cb),
  getPendingExtensionDownload: () => ipcRenderer.invoke('dovira:extension:pending'),
  dismissExtensionDownload: (url: string) => ipcRenderer.invoke('dovira:extension:dismiss', url),
  // v1.2.0
  runDiagnostics: () => ipcRenderer.invoke('dovira:diagnostics:run'),
  extensionFolderPath: () => ipcRenderer.invoke('dovira:extension:folderPath'),
  openExtensionFolder: () => ipcRenderer.invoke('dovira:extension:openFolder'),
  openLocalApiDocs: () => ipcRenderer.invoke('dovira:docs:openLocalApi'),
  // Phase 6
  getAppUpdateState: () => ipcRenderer.invoke('dovira:update:state'),
  checkAppUpdate: () => ipcRenderer.invoke('dovira:update:check'),
  downloadAppUpdate: () => ipcRenderer.invoke('dovira:update:download'),
  installAppUpdate: () => ipcRenderer.invoke('dovira:update:install'),
  onAppUpdateState: (cb) => subscribe<AppUpdateState>('dovira:update:state', cb),
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
