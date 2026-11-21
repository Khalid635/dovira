import { create } from 'zustand'
import type {
  AppInfo,
  DownloadInfo,
  ProgressEvent,
  Settings,
  StatusEvent,
  ToastEvent
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
  toast: Toast | null
  init: () => Promise<void>
  refresh: () => Promise<void>
  addDownload: (url: string) => Promise<{ ok: boolean; error?: string }>
  pause: (id: string) => Promise<void>
  resume: (id: string) => Promise<void>
  cancel: (id: string) => Promise<void>
  remove: (id: string, deleteFile: boolean) => Promise<void>
  retry: (id: string) => Promise<void>
  setFilter: (f: Filter) => void
  setView: (v: View) => void
  updateSettings: (patch: Partial<Settings>) => Promise<void>
  showToast: (key: string, params?: Record<string, string | number>) => void
}

export const useStore = create<Store>()((set, get) => ({
  downloads: [],
  filter: 'all',
  view: 'home',
  settings: null,
  appInfo: null,
  language: 'bn',
  loaded: false,
  toast: null,

  init: async () => {
    const [settings, downloads, appInfo] = await Promise.all([
      window.dovira.getSettings(),
      window.dovira.listDownloads(),
      window.dovira.getAppInfo()
    ])
    set({ settings, downloads, appInfo, language: settings.language, loaded: true })

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
      void window.dovira.getAppInfo().then((ai) => set({ appInfo: ai }))
    }, 5000)
  },

  refresh: async () => {
    const downloads = await window.dovira.listDownloads()
    set({ downloads })
  },

  addDownload: async (url) => {
    const res = await window.dovira.addDownload(url)
    if (res.ok) {
      await get().refresh()
      get().showToast('toast.added')
    }
    return res
  },

  pause: async (id) => {
    await window.dovira.pauseDownload(id)
  },
  resume: async (id) => {
    await window.dovira.resumeDownload(id)
  },
  cancel: async (id) => {
    await window.dovira.cancelDownload(id)
  },
  remove: async (id, deleteFile) => {
    await window.dovira.removeDownload(id, deleteFile)
    await get().refresh()
  },
  retry: async (id) => {
    await window.dovira.retryDownload(id)
  },

  setFilter: (filter) => set({ filter }),
  setView: (view) => set({ view }),

  updateSettings: async (patch) => {
    const settings = await window.dovira.setSettings(patch)
    set({ settings, language: settings.language })
    get().showToast('toast.saved')
  },

  showToast: (key, params) => {
    set({ toast: { key, params, at: Date.now() } })
    setTimeout(() => {
      set((s) => (s.toast && Date.now() - s.toast.at >= 2900 ? { toast: null } : s))
    }, 3000)
  }
}))

export function useT(): (key: string, params?: Record<string, string | number>) => string {
  const language = useStore((s) => s.language)
  return (key: string, params?: Record<string, string | number>) => t(language, key, params)
}
