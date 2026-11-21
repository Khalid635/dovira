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
  engines: [],
  enginesLoading: false,

  init: async () => {
    // Phase 1 loaded all three in one Promise.all with no error handling:
    // a single rejection left settings null and the whole UI stuck on "…"
    // with no message. Each call now fails independently and the app still
    // loads — the Settings page shows the error with a Retry button.
    const [settingsRes, downloadsRes, appInfoRes] = await Promise.allSettled([
      window.dovira.getSettings(),
      window.dovira.listDownloads(),
      window.dovira.getAppInfo()
    ])
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
    set({ dialogLoading: true, dialogInfo: null, dialogPlainFile: null, dialogError: null })
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
    } catch {
      set({ dialogError: 'unknown', dialogLoading: false })
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
