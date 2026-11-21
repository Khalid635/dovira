import { create } from 'zustand'
import type {
  AddOptions,
  AppInfo,
  DownloadInfo,
  EngineInfo,
  PlainFileInfo,
  ProgressEvent,
  Settings,
  StatusEvent,
  ToastEvent,
  VideoInfo
} from '../../main/types'
import { t, type Language } from './i18n'

export type Filter = 'all' | 'downloading' | 'queued' | 'completed' | 'video' | 'audio' | 'files'
export type View = 'home' | 'settings'

export interface Toast {
  key: string
  params?: Record<string, string | number>
  at: number
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
  showToast: (key: string, params?: Record<string, string | number>) => void
  // Add Download dialog (Phase 2).
  dialogOpen: boolean
  dialogUrl: string
  dialogLoading: boolean
  dialogInfo: VideoInfo | null
  dialogPlainFile: PlainFileInfo | null
  dialogError: string | null
  /** Raw IPC error text — shown in the dialog in dev only, never the user-facing message. */
  dialogErrorDetail: string | null
  openDialog: (url?: string) => void
  closeDialog: () => void
  fetchInfo: (url: string) => Promise<void>
  addWithOptions: (opts: AddOptions) => Promise<{ ok: boolean; error?: string }>
  // Engines (Phase 2).
  engines: EngineInfo[]
  enginesLoading: boolean
  loadEngines: (checkForUpdates: boolean) => Promise<void>
  updateEngine: (name: string) => Promise<{ ok: boolean; error?: string }>
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
  dialogUrl: '',
  dialogLoading: false,
  dialogInfo: null,
  dialogPlainFile: null,
  dialogError: null,
  dialogErrorDetail: null,
  engines: [],
  enginesLoading: false,

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
      const [settingsRes, downloadsRes, appInfoRes] = await Promise.allSettled([
        window.dovira.getSettings(),
        window.dovira.listDownloads(),
        window.dovira.getAppInfo()
      ])
      // A timed-out attempt must not overwrite the timeout error later.
      if (cancelled.current) return
      const settings = settingsRes.status === 'fulfilled' ? settingsRes.value : null
      const downloads = downloadsRes.status === 'fulfilled' ? downloadsRes.value : []
      const appInfo = appInfoRes.status === 'fulfilled' ? appInfoRes.value : null
      const failed =
        settingsRes.status === 'rejected' ||
        downloadsRes.status === 'rejected' ||
        appInfoRes.status === 'rejected'
      set({
        settings,
        downloads,
        appInfo,
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
      set((s) => ({
        downloads: s.downloads.map((d) =>
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
      }))
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
        void get().refresh()
      }
    })
    window.dovira.onToast((toastEv: ToastEvent) => {
      get().showToast(toastEv.key, toastEv.params)
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

  showToast: (key, params) => {
    set({ toast: { key, params, at: Date.now() } })
    setTimeout(() => {
      set((s) => (s.toast && Date.now() - s.toast.at >= 2900 ? { toast: null } : s))
    }, 3000)
  },

  openDialog: (url = '') => {
    set({
      dialogOpen: true,
      dialogUrl: url,
      dialogInfo: null,
      dialogPlainFile: null,
      dialogError: null,
      dialogLoading: false
    })
    if (url.trim()) void get().fetchInfo(url)
  },

  closeDialog: () => {
    set({ dialogOpen: false, dialogLoading: false })
  },

  fetchInfo: async (url) => {
    const value = url.trim()
    if (!value) return
    set({
      dialogLoading: true,
      dialogInfo: null,
      dialogPlainFile: null,
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
      if (res.ok && res.info) {
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
  }
}))

export function useT(): (key: string, params?: Record<string, string | number>) => string {
  const language = useStore((s) => s.language)
  return (key: string, params?: Record<string, string | number>) => t(language, key, params)
}
