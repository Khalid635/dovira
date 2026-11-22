import { create } from 'zustand'
import type {
  AddOptions,
  AppInfo,
  AppUpdateState,
  DownloadInfo,
  EngineInfo,
  PlainFileInfo,
  PlaylistInfo,
  ProgressEvent,
  SchedulerCountdown,
  Settings,
  StatusEvent,
  ToastEvent,
  VideoInfo
} from '../../main/types'
import { t, type Language } from './i18n'

export type Filter = 'all' | 'downloading' | 'queued' | 'completed' | 'video' | 'audio' | 'files'
export type View = 'home' | 'history' | 'settings'

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
  addDownload: (url: string, saveDir?: string) => Promise<{ ok: boolean; error?: string }>
  pause: (id: string) => Promise<void>
  resume: (id: string) => Promise<void>
  cancel: (id: string) => Promise<void>
  remove: (id: string, deleteFile: boolean) => Promise<void>
  retry: (id: string) => Promise<void>
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
  // Phase 7: site grabber dialog (opened from the Sidebar).
  grabberOpen: boolean
  openGrabber: () => void
  closeGrabber: () => void
  // Phase 7: per-download speed limit (KB/s, 0 = use the global limit).
  setDownloadSpeedLimit: (id: string, kbps: number) => Promise<boolean>
  fetchInfo: (url: string) => Promise<void>
  addWithOptions: (opts: AddOptions) => Promise<{ ok: boolean; error?: string }>
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
  dialogUrl: '',
  dialogLoading: false,
  dialogInfo: null,
  dialogPlainFile: null,
  dialogPlaylist: null,
  dialogTorrent: null,
  dialogError: null,
  dialogErrorDetail: null,
  engines: [],
  enginesLoading: false,
  appUpdate: { state: 'idle', version: null, progress: null, error: null },
  speedHistory: {},
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
      const [settingsRes, downloadsRes, appInfoRes, appUpdateRes] = await Promise.allSettled([
        window.dovira.getSettings(),
        window.dovira.listDownloads(),
        window.dovira.getAppInfo(),
        window.dovira.getAppUpdateState()
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
      const failed =
        settingsRes.status === 'rejected' ||
        downloadsRes.status === 'rejected' ||
        appInfoRes.status === 'rejected'
      set({
        settings,
        downloads,
        appInfo,
        appUpdate,
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
        return { downloads, speedHistory }
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
        )
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

  addDownload: async (url, saveDir) => {
    const res = await window.dovira.addDownload(url, saveDir)
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

  closeDialog: () => {
    set({ dialogOpen: false, dialogLoading: false })
  },

  openGrabber: () => set({ grabberOpen: true }),
  closeGrabber: () => set({ grabberOpen: false }),

  setDownloadSpeedLimit: async (id, kbps) => {
    try {
      const ok = await window.dovira.setDownloadSpeedLimit(id, kbps)
      if (ok) await get().refresh()
      return ok
    } catch {
      return false
    }
  },

  fetchInfo: async (url) => {
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
      const res = await window.dovira.fetchInfo(value)
      if (res.ok && res.playlist) {
        set({ dialogPlaylist: res.playlist, dialogLoading: false })
      } else if (res.ok && res.torrent) {
        set({ dialogTorrent: res.torrent, dialogLoading: false })
      } else if (res.ok && res.info) {
        set({ dialogInfo: res.info, dialogLoading: false })
      } else if (res.ok && res.plainFile) {
        set({ dialogPlainFile: res.plainFile, dialogLoading: false })
      } else {
        set({ dialogError: res.error ?? 'unknown', dialogLoading: false })
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
      set({ dialogOpen: false })
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
