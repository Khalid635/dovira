import { create } from 'zustand'
import type {
  AddOptions,
  AppInfo,
  AppUpdateState,
  DownloadInfo,
  EngineInfo,
  NetworkClass,
  PlainFileInfo,
  PlaylistInfo,
  ProgressEvent,
  SchedulerCountdown,
  Settings,
  StatusEvent,
  Subscription,
  SubscriptionVideo,
  ToastEvent,
  VideoInfo
} from '../../main/types'
import { t, type Language } from './i18n'
import { buildMediaOptions, defaultHeightFor, looksLikeUrl } from './util/quickAdd'

export type Filter = 'all' | 'downloading' | 'queued' | 'completed' | 'video' | 'audio' | 'files'
export type View = 'home' | 'history' | 'settings' | 'assistant' | 'subscriptions'

export interface Toast {
  key: string
  params?: Record<string, string | number>
  at: number
  /** Phase 3: optional action button (clipboard-link toast opens the dialog). */
  action?: { labelKey: string; url: string }
}

interface Store {
  downloads: DownloadInfo[]
  filter: Filter
  view: View
  settings: Settings | null
  appInfo: AppInfo | null
  language: Language
  loaded: boolean
  /** Set when one of the startup loads failed — the app keeps working. */
  initError: string | null
  toast: Toast | null
  init: () => Promise<void>
  refresh: () => Promise<void>
  addDownload: (
    url: string,
    saveDir?: string,
    opts?: { skipDuplicateCheck?: boolean }
  ) => Promise<{ ok: boolean; error?: string }>
  pause: (id: string) => Promise<void>
  resume: (id: string) => Promise<void>
  cancel: (id: string) => Promise<void>
  remove: (id: string, deleteFile: boolean) => Promise<void>
  retry: (id: string) => Promise<void>
  // Next-level: pin to the top of the queue (persisted).
  togglePin: (id: string) => Promise<void>
  // Next-level: stop a live-stream recording and KEEP the .ts file.
  stopRecording: (id: string) => Promise<void>
  // Next-level: preview URL for a completed video/audio row.
  previewUrl: (id: string) => Promise<string | null>
  setFilter: (f: Filter) => void
  setView: (v: View) => void
  updateSettings: (patch: Partial<Settings>) => Promise<void>
  showToast: (
    key: string,
    params?: Record<string, string | number>,
    action?: { labelKey: string; url: string }
  ) => void
  // Phase 3: speed graph — last 60 speed samples per download, oldest first.
  speedHistory: Record<string, number[]>
  // Issue #7: current Smart Download network class (fast / medium / slow /
  // unstable), from the latest progress/status event. Null before any event.
  networkClass: NetworkClass | null
  // Phase 3: scheduler countdown modal (null = no countdown running).
  schedulerCountdown: SchedulerCountdown | null
  cancelSchedulerCountdown: () => Promise<void>
  // Phase 3: History + queue reorder.
  historyMissing: () => Promise<string[]>
  redownload: (id: string) => Promise<{ ok: boolean; error?: string }>
  clearHistory: () => Promise<number>
  moveToTop: (id: string) => Promise<void>
  reorderDownloads: (id: string, beforeId: string | null) => Promise<void>
  // Add Download dialog (Phase 2).
  dialogOpen: boolean
  dialogUrl: string
  dialogLoading: boolean
  dialogInfo: VideoInfo | null
  dialogPlainFile: PlainFileInfo | null
  /** Phase 4: a playlist/channel fetch result (dialog shows the entry list). */
  dialogPlaylist: PlaylistInfo | null
  /** Phase 4: a magnet/.torrent fetch result (dialog shows name + note). */
  dialogTorrent: { name: string } | null
  dialogError: string | null
  /** Raw IPC error text — shown in the dialog in dev only, never the user-facing message. */
  dialogErrorDetail: string | null
  openDialog: (url?: string) => void
  closeDialog: () => void
  /** Dialog-first extension flow: the URL the floating button just sent (null otherwise). */
  extensionRequest: { url: string } | null
  /** Open the Add dialog for an extension send (records it so cancel can discard its temp cookies file). */
  openExtensionDownload: (req: { url: string }) => void
  // One-click paste-and-download (Cobalt-inspired).
  quickPasteBusy: boolean
  quickPasteDownload: () => void
  // Phase 7: site grabber dialog (opened from the Sidebar).
  grabberOpen: boolean
  openGrabber: () => void
  closeGrabber: () => void
  // Phase 7: per-download speed limit (KB/s, 0 = use the global limit).
  setDownloadSpeedLimit: (id: string, kbps: number) => Promise<boolean>
  fetchInfo: (url: string, force?: boolean) => Promise<void>
  addWithOptions: (opts: AddOptions) => Promise<{
    ok: boolean
    error?: string
    errorDetail?: string
  }>
  // Phase 4: playlist / thumbnail-only / batch / archive.
  addPlaylist: (items: AddOptions[]) => Promise<{ added: number; failed: number }>
  addThumbnailOnly: (
    url: string,
    saveDir?: string
  ) => Promise<{ ok: boolean; id?: string; error?: string }>
  importBatchFile: () => Promise<string[] | null>
  clearDownloadArchive: () => Promise<boolean>
  // Engines (Phase 2).
  engines: EngineInfo[]
  enginesLoading: boolean
  loadEngines: (checkForUpdates: boolean) => Promise<void>
  updateEngine: (name: string) => Promise<{ ok: boolean; error?: string }>
  // App auto-update (Phase 6).
  appUpdate: AppUpdateState
  checkAppUpdate: () => Promise<void>
  downloadAppUpdate: () => Promise<void>
  installAppUpdate: () => Promise<void>
  // v1.2.0: first-run setup wizard (also re-openable from Settings).
  wizardOpen: boolean
  openWizard: () => void
  closeWizard: () => void
  // Next-level: channel subscriptions (local polling).
  subscriptions: Subscription[]
  subscriptionsLoading: boolean
  loadSubscriptions: () => Promise<void>
  addSubscription: (url: string) => Promise<{ ok: boolean; error?: string }>
  removeSubscription: (id: string) => Promise<void>
  checkSubscriptions: () => Promise<void>
  checkSubscription: (id: string) => Promise<void>
  downloadSubscriptionVideo: (subId: string, video: SubscriptionVideo) => Promise<void>
}

// Event listeners + the 5s refresh interval are attached once per renderer
// lifetime. init() can run again via the Settings Retry button — attaching
// twice would double-fire every progress/status update.
let listenersAttached = false

export const useStore = create<Store>()((set, get) => ({
  downloads: [],
  filter: 'all',
  view: 'home',
  settings: null,
  appInfo: null,
  language: 'bn',
  loaded: false,
  initError: null,
  toast: null,
  dialogOpen: false,
  grabberOpen: false,
  wizardOpen: false,
  dialogUrl: '',
  dialogLoading: false,
  dialogInfo: null,
  dialogPlainFile: null,
  dialogPlaylist: null,
  dialogTorrent: null,
  dialogError: null,
  dialogErrorDetail: null,
  extensionRequest: null,
  quickPasteBusy: false,
  engines: [],
  enginesLoading: false,
  subscriptions: [],
  subscriptionsLoading: false,
  appUpdate: { state: 'idle', version: null, progress: null, error: null },
  speedHistory: {},
  networkClass: null,
  schedulerCountdown: null,

  init: async () => {
    // Dead bridge (the preload never exposed window.dovira): no IPC call
    // can work. Settle as a failed init with a distinct code instead of
    // hanging forever — evaluating `window.dovira.getSettings()` throws
    // before Promise.allSettled even runs when window.dovira itself is
    // undefined, which is exactly how the 2026-11-22 Settings "…" bug
    // happened: init() rejected, loaded stayed false, initError stayed
    // null, and the Settings page showed a bare "…" with no error.
    if (typeof window.dovira === 'undefined') {
      set({ loaded: true, initError: 'bridge' })
      get().showToast('toast.initFailed')
      return
    }

    // Hard timeout: init must ALWAYS settle. A hanging IPC call (or a
    // preload that died mid-flight) used to leave loaded=false forever.
    const INIT_TIMEOUT_MS = 15_000
    let timedOut = false
    const cancelled = { current: false }
    const load = async (): Promise<void> => {
      const [settingsRes, downloadsRes, appInfoRes, appUpdateRes, subsRes] =
        await Promise.allSettled([
          window.dovira.getSettings(),
          window.dovira.listDownloads(),
          window.dovira.getAppInfo(),
          window.dovira.getAppUpdateState(),
          window.dovira.listSubscriptions()
        ])
      // A timed-out attempt must not overwrite the timeout error later.
      if (cancelled.current) return
      const settings = settingsRes.status === 'fulfilled' ? settingsRes.value : null
      const downloads = downloadsRes.status === 'fulfilled' ? downloadsRes.value : []
      const appInfo = appInfoRes.status === 'fulfilled' ? appInfoRes.value : null
      const appUpdate: AppUpdateState =
        appUpdateRes.status === 'fulfilled'
          ? appUpdateRes.value
          : { state: 'idle', version: null, progress: null, error: null }
      const subscriptions = subsRes.status === 'fulfilled' ? subsRes.value : []
      const failed =
        settingsRes.status === 'rejected' ||
        downloadsRes.status === 'rejected' ||
        appInfoRes.status === 'rejected'
      set({
        settings,
        downloads,
        appInfo,
        appUpdate,
        subscriptions,
        language: settings?.language ?? 'bn',
        loaded: true,
        initError: failed ? 'init' : null
      })
      if (failed) get().showToast('toast.initFailed')
    }
    // The timer is cleared in `finally`: without that, a won race would
    // still reject the losing timeout promise 15s later (unhandled).
    let timeoutId: ReturnType<typeof setTimeout> | undefined
    const timeout = new Promise<never>((_resolve, reject) => {
      timeoutId = setTimeout(() => {
        timedOut = true
        reject(new Error('init-timeout'))
      }, INIT_TIMEOUT_MS)
    })
    try {
      await Promise.race([load(), timeout])
    } catch {
      // Either the timeout fired or load() itself threw (e.g. the bridge
      // died between the check above and the first IPC call). Either way
      // init settles with a distinct code — never a bare "…".
      cancelled.current = true
      set({ loaded: true, initError: timedOut ? 'initTimeout' : 'init' })
      get().showToast('toast.initFailed')
      return
    } finally {
      if (timeoutId !== undefined) clearTimeout(timeoutId)
    }

    if (listenersAttached) return
    listenersAttached = true
    // Dialog-first extension flow: a floating-button click opens the
    // Add dialog the moment the extension POSTs — no fetchInfo wait.
    // Guarded: an old preload (stale build) must not break init.
    if (typeof window.dovira.onExtensionDownload === 'function') {
      window.dovira.onExtensionDownload((req) => {
        get().openExtensionDownload(req)
      })
      // Startup race: a send that arrived before the renderer mounted
      // is pulled once here instead of being lost.
      void window.dovira
        .getPendingExtensionDownload()
        .then((req) => {
          if (req) get().openExtensionDownload(req)
        })
        .catch(() => {
          // No pending request (or an old preload) — nothing to open.
        })
    }
    window.dovira.onProgress((p: ProgressEvent) => {
      set((s) => {
        const downloads = s.downloads.map((d) =>
          d.id === p.id
            ? {
                ...d,
                doneBytes: p.doneBytes,
                totalBytes: p.totalBytes,
                speedBps: p.speedBps,
                etaSeconds: p.etaSeconds,
                status: p.status
              }
            : d
        )
        // Phase 3: feed the speed graph — keep the last 60 samples.
        let speedHistory = s.speedHistory
        if (p.status === 'downloading') {
          const next = [...(s.speedHistory[p.id] ?? []), p.speedBps]
          if (next.length > 60) next.splice(0, next.length - 60)
          speedHistory = { ...s.speedHistory, [p.id]: next }
        } else if (p.status === 'completed' || p.status === 'failed' || p.status === 'cancelled') {
          if (p.id in s.speedHistory) {
            speedHistory = { ...s.speedHistory }
            delete speedHistory[p.id]
          }
        }
        return { downloads, speedHistory, networkClass: p.networkClass ?? s.networkClass }
      })
    })
    window.dovira.onStatus((ev: StatusEvent) => {
      set((s) => ({
        downloads: s.downloads.map((d) =>
          d.id === ev.id
            ? {
                ...d,
                status: ev.status,
                errorCode: ev.errorCode ?? d.errorCode,
                errorMessage: ev.errorMessage ?? d.errorMessage
              }
            : d
        ),
        networkClass: ev.networkClass ?? s.networkClass
      }))
      if (ev.status === 'completed' || ev.status === 'failed' || ev.status === 'cancelled') {
        // Phase 3: drop the finished download's speed history.
        set((s) => {
          if (!(ev.id in s.speedHistory)) return s
          const speedHistory = { ...s.speedHistory }
          delete speedHistory[ev.id]
          return { speedHistory }
        })
        void get().refresh()
      }
    })
    window.dovira.onToast((toastEv: ToastEvent) => {
      get().showToast(toastEv.key, toastEv.params)
    })
    // Phase 3: scheduler countdown modal + clipboard-link toast.
    window.dovira.onSchedulerCountdown((c) => {
      set({ schedulerCountdown: c })
    })
    window.dovira.onClipboardLink((url) => {
      get().showToast('toast.clipboardLink', undefined, {
        labelKey: 'toast.clipboardAdd',
        url
      })
    })
    // Phase 6: app auto-update state (check / download / verify / ready).
    window.dovira.onAppUpdateState((s: AppUpdateState) => {
      set({ appUpdate: s })
    })
    // Next-level: a background subscription check found new videos —
    // refresh the list and tell the user.
    window.dovira.onSubscriptionsUpdated(() => {
      void get().loadSubscriptions()
      get().showToast('subs.checked')
    })

    // Status bar numbers (disk free) refresh every 5s.
    setInterval(() => {
      void window.dovira
        .getAppInfo()
        .then((ai) => set({ appInfo: ai }))
        .catch(() => {
          // Keep the last known info — a failed refresh must not blank it.
        })
    }, 5000)
  },

  refresh: async () => {
    try {
      const downloads = await window.dovira.listDownloads()
      set({ downloads })
    } catch {
      // Keep the current list on a transient failure.
    }
  },

  addDownload: async (url, saveDir, opts) => {
    const res = await window.dovira.addDownload(url, saveDir, opts)
    if (res.ok) {
      await get().refresh()
      get().showToast('toast.added')
    }
    return res
  },

  pause: async (id: string) => {
    await window.dovira.pauseDownload(id)
  },
  resume: async (id: string) => {
    await window.dovira.resumeDownload(id)
  },
  cancel: async (id: string) => {
    await window.dovira.cancelDownload(id)
  },
  remove: async (id, deleteFile) => {
    await window.dovira.removeDownload(id, deleteFile)
    await get().refresh()
  },
  retry: async (id: string) => {
    await window.dovira.retryDownload(id)
  },
  togglePin: async (id: string) => {
    await window.dovira.togglePin(id)
    await get().refresh()
  },
  stopRecording: async (id: string) => {
    await window.dovira.stopRecording(id)
    await get().refresh()
  },
  previewUrl: async (id: string) => {
    try {
      return await window.dovira.previewUrl(id)
    } catch {
      return null
    }
  },

  setFilter: (filter) => set({ filter }),
  setView: (view) => set({ view }),

  updateSettings: async (patch) => {
    try {
      const settings = await window.dovira.setSettings(patch)
      set({ settings, language: settings.language })
      get().showToast('toast.saved')
    } catch {
      get().showToast('toast.saveFailed')
    }
  },

  showToast: (key, params, action) => {
    // A toast with an action (clipboard link → Add) stays 10s so the
    // button is actually clickable; plain toasts stay 3s.
    const ttl = action ? 10_000 : 3000
    set({ toast: { key, params, at: Date.now(), action } })
    setTimeout(() => {
      set((s) => (s.toast && Date.now() - s.toast.at >= ttl - 100 ? { toast: null } : s))
    }, ttl)
  },

  cancelSchedulerCountdown: async () => {
    try {
      await window.dovira.schedulerCancel()
    } catch {
      // The countdown event clears the modal; a failed cancel is harmless.
    }
    set({ schedulerCountdown: null })
  },

  historyMissing: async () => {
    try {
      return await window.dovira.historyMissing()
    } catch {
      return []
    }
  },

  redownload: async (id) => {
    const res = await window.dovira.redownload(id)
    if (res.ok) {
      await get().refresh()
      get().showToast('toast.added')
    }
    return res
  },

  clearHistory: async () => {
    const res = await window.dovira.clearHistory()
    await get().refresh()
    return res.removed
  },

  moveToTop: async (id) => {
    await window.dovira.moveToTop(id)
    await get().refresh()
  },

  reorderDownloads: async (id, beforeId) => {
    await window.dovira.reorderDownloads(id, beforeId)
    await get().refresh()
  },

  openDialog: (url = '') => {
    set({
      dialogOpen: true,
      dialogUrl: url,
      dialogInfo: null,
      dialogPlainFile: null,
      dialogPlaylist: null,
      dialogTorrent: null,
      dialogError: null,
      dialogLoading: false
    })
    if (url.trim()) void get().fetchInfo(url)
  },
  // Dialog-first extension flow: the floating button already opened the
  // dialog via openDialog — this just records which URL came from the
  // extension, so closeDialog can discard its temp cookies file when
  // the user cancels, and so a second click replaces the dialog
  // instead of stacking one.
  openExtensionDownload: (req) => {
    set({ extensionRequest: { url: req.url } })
    get().openDialog(req.url)
  },
  // One-click paste-and-download (Cobalt-inspired): read the clipboard,
  // fetch info, and start the download with the app's defaults. A playlist,
  // a torrent, or a multi-media post opens the picker dialog instead of
  // guessing — and a failed fetch opens the dialog too, so the user sees
  // the error and can Retry.
  quickPasteDownload: async () => {
    if (get().quickPasteBusy || !get().settings) return
    set({ quickPasteBusy: true })
    let url: string
    try {
      url = (await navigator.clipboard.readText()).trim()
    } catch {
      get().showToast('quickPaste.noClipboard')
      set({ quickPasteBusy: false })
      return
    }
    if (!looksLikeUrl(url)) {
      get().showToast('quickPaste.invalid')
      set({ quickPasteBusy: false })
      return
    }
    try {
      const res = await window.dovira.fetchInfo(url)
      const current = get()
      if (!res.ok) {
        current.openDialog(url)
        return
      }
      if (res.playlist || res.torrent || (res.info?.mediaItems && res.info.mediaItems.length > 1)) {
        current.openDialog(url)
        return
      }
      if (res.plainFile) {
        const addRes = await window.dovira.addDownload(url, current.settings?.downloadDir)
        if (addRes.ok) {
          await current.refresh()
          get().showToast('toast.added')
        } else if (addRes.error === 'duplicate') {
          get().showToast('error.duplicate')
        } else {
          get().showToast('toast.infoFailed')
        }
        return
      }
      if (res.info) {
        // Next-level: AI auto quality — ON = the best available height
        // at or below the Settings cap (defaultHeightFor); OFF = the
        // Settings cap verbatim, as before.
        const settings = current.settings
        const height = settings?.autoQuality
          ? defaultHeightFor(res.info, settings)
          : Number(settings?.defaultVideoQuality ?? '1080')
        const addRes = await current.addWithOptions(
          buildMediaOptions({
            info: res.info,
            settings: current.settings,
            height,
            bitrate: current.settings?.defaultAudioBitrate ?? '192',
            saveDir: current.settings?.downloadDir ?? ''
          })
        )
        if (!addRes.ok && addRes.error === 'duplicate') {
          get().showToast('error.duplicate')
        }
        // Success toasts 'toast.added' inside addWithOptions.
        return
      }
      current.openDialog(url)
    } catch {
      get().openDialog(url)
    } finally {
      set({ quickPasteBusy: false })
    }
  },

  closeDialog: () => {
    const req = get().extensionRequest
    set({ dialogOpen: false, dialogLoading: false, extensionRequest: null })
    // Dialog-first extension flow: the user cancelled the dialog, so
    // the extension send's temp cookies file must be deleted — no
    // download started. After a successful submit the IPC handler
    // already took the request, so this is a no-op there.
    if (req) void window.dovira.dismissExtensionDownload(req.url)
  },

  openGrabber: () => set({ grabberOpen: true }),
  closeGrabber: () => set({ grabberOpen: false }),

  openWizard: () => set({ wizardOpen: true }),
  closeWizard: () => set({ wizardOpen: false }),

  // Next-level: channel subscriptions.
  loadSubscriptions: async () => {
    try {
      const subscriptions = await window.dovira.listSubscriptions()
      set({ subscriptions })
    } catch {
      // Keep the current list on a transient failure.
    }
  },
  addSubscription: async (url) => {
    const res = await window.dovira.addSubscription(url)
    if (res.ok) {
      await get().loadSubscriptions()
      get().showToast('subs.added')
    }
    return res
  },
  removeSubscription: async (id) => {
    await window.dovira.removeSubscription(id)
    await get().loadSubscriptions()
  },
  checkSubscriptions: async () => {
    set({ subscriptionsLoading: true })
    try {
      await window.dovira.checkSubscriptions()
      await get().loadSubscriptions()
      get().showToast('subs.checked')
    } finally {
      set({ subscriptionsLoading: false })
    }
  },
  checkSubscription: async (id) => {
    set({ subscriptionsLoading: true })
    try {
      await window.dovira.checkSubscription(id)
      await get().loadSubscriptions()
    } finally {
      set({ subscriptionsLoading: false })
    }
  },
  downloadSubscriptionVideo: async (subId, video) => {
    // The check only fetches titles — fetch fresh info first, so the
    // quality + subtitle auto-pick applies exactly like a pasted link.
    const res = await window.dovira.fetchInfo(video.url)
    if (!res.ok || !res.info) {
      get().showToast('toast.infoFailed')
      return
    }
    const settings = get().settings
    const height = settings?.autoQuality
      ? defaultHeightFor(res.info, settings)
      : Number(settings?.defaultVideoQuality ?? '1080')
    const addRes = await get().addWithOptions(
      buildMediaOptions({
        info: res.info,
        settings,
        height,
        bitrate: settings?.defaultAudioBitrate ?? '192',
        saveDir: settings?.downloadDir ?? ''
      })
    )
    if (addRes.ok) {
      await window.dovira.consumeSubscriptionVideo(subId, video.id)
      await get().loadSubscriptions()
    }
  },

  setDownloadSpeedLimit: async (id, kbps) => {
    try {
      const ok = await window.dovira.setDownloadSpeedLimit(id, kbps)
      if (ok) await get().refresh()
      return ok
    } catch {
      return false
    }
  },

  fetchInfo: async (url, force) => {
    const value = url.trim()
    if (!value) return
    set({
      dialogLoading: true,
      dialogInfo: null,
      dialogPlainFile: null,
      dialogPlaylist: null,
      dialogTorrent: null,
      dialogError: null,
      dialogErrorDetail: null
    })
    // A dead bridge is NOT a download failure — say so, with its own code.
    if (typeof window.dovira === 'undefined') {
      set({ dialogError: 'bridge', dialogLoading: false })
      get().showToast('toast.infoFailed')
      return
    }
    try {
      const res = await window.dovira.fetchInfo(value, force ? { force: true } : undefined)
      if (res.ok && res.playlist) {
        set({ dialogPlaylist: res.playlist, dialogLoading: false })
      } else if (res.ok && res.torrent) {
        set({ dialogTorrent: res.torrent, dialogLoading: false })
      } else if (res.ok && res.info) {
        set({ dialogInfo: res.info, dialogLoading: false })
      } else if (res.ok && res.plainFile) {
        set({ dialogPlainFile: res.plainFile, dialogLoading: false })
      } else {
        set({
          dialogError: res.error ?? 'unknown',
          dialogErrorDetail: res.errorDetail ?? null,
          dialogLoading: false
        })
        get().showToast('toast.infoFailed')
      }
    } catch (err) {
      // The IPC call itself threw — most commonly a bridge that died
      // mid-flight. Never let that masquerade as "download failed".
      const bridgeDead = typeof window.dovira === 'undefined'
      set({
        dialogError: bridgeDead ? 'bridge' : 'unknown',
        dialogErrorDetail: import.meta.env.DEV
          ? err instanceof Error
            ? err.message
            : String(err)
          : null,
        dialogLoading: false
      })
      get().showToast('toast.infoFailed')
    }
  },

  addWithOptions: async (opts) => {
    const res = await window.dovira.addWithOptions(opts)
    if (res.ok) {
      // Dialog-first extension flow: the IPC handler took the pending
      // request — clear the flag so a later closeDialog cannot dismiss
      // a request the queue already owns.
      set({ dialogOpen: false, extensionRequest: null })
      await get().refresh()
      get().showToast('toast.added')
    }
    return res
  },

  addPlaylist: async (items) => {
    // One toast for the whole playlist, not one per video — and the
    // per-item addWithOptions in this store would close the dialog and
    // toast on every item, so this loops the raw bridge call instead.
    let added = 0
    let failed = 0
    for (const opts of items) {
      try {
        const res = await window.dovira.addWithOptions(opts)
        if (res.ok) added++
        else failed++
      } catch {
        failed++
      }
    }
    set({ dialogOpen: false })
    await get().refresh()
    if (added > 0) get().showToast('toast.playlistAdded', { n: added })
    return { added, failed }
  },

  addThumbnailOnly: async (url, saveDir) => {
    const res = await window.dovira.addThumbnailOnly(url, saveDir)
    if (res.ok) {
      set({ dialogOpen: false })
      await get().refresh()
      get().showToast('toast.added')
    }
    return res
  },

  importBatchFile: async () => {
    try {
      const res = await window.dovira.importBatchFile()
      return res.ok ? res.urls : null
    } catch {
      return null
    }
  },

  clearDownloadArchive: async () => {
    try {
      const cleared = await window.dovira.clearDownloadArchive()
      get().showToast(cleared ? 'toast.archiveCleared' : 'settings.archiveEmpty')
      return cleared
    } catch {
      return false
    }
  },

  loadEngines: async (checkForUpdates) => {
    set({ enginesLoading: true })
    try {
      const engines = await window.dovira.listEngines(checkForUpdates)
      set({ engines, enginesLoading: false })
    } catch {
      set({ enginesLoading: false })
    }
  },

  updateEngine: async (name) => {
    const res = await window.dovira.updateEngine(name)
    if (res.ok) {
      get().showToast('toast.engineUpdated')
      await get().loadEngines(false)
    } else {
      get().showToast('toast.updateFailed')
    }
    return res
  },

  checkAppUpdate: async () => {
    try {
      const s = await window.dovira.checkAppUpdate()
      set({ appUpdate: s })
    } catch {
      // The state event carries errors; a failed IPC call leaves the
      // last known state — never blank the section.
    }
  },

  downloadAppUpdate: async () => {
    try {
      const s = await window.dovira.downloadAppUpdate()
      set({ appUpdate: s })
    } catch {
      // See checkAppUpdate.
    }
  },

  installAppUpdate: async () => {
    try {
      await window.dovira.installAppUpdate()
    } catch {
      // quitAndInstall restarts the app; a failure here leaves the
      // 'install-ready' state so the user can retry.
    }
  }
}))

export function useT(): (key: string, params?: Record<string, string | number>) => string {
  const language = useStore((s) => s.language)
  return (key: string, params?: Record<string, string | number>) => t(language, key, params)
}
