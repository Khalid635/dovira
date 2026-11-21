import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import type {
  AppInfo,
  DownloadInfo,
  ProgressEvent,
  Settings,
  StatusEvent,
  ToastEvent
} from '../main/types'

export interface DoviraAPI {
  listDownloads(): Promise<DownloadInfo[]>
  addDownload(url: string): Promise<{ ok: boolean; id?: string; error?: string }>
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
  addDownload: (url: string) => ipcRenderer.invoke('dovira:downloads:add', url),
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
  onProgress: (cb) => subscribe<ProgressEvent>('dovira:download:progress', cb),
  onStatus: (cb) => subscribe<StatusEvent>('dovira:download:status', cb),
  onToast: (cb) => subscribe<ToastEvent>('dovira:toast', cb)
}

// Use `contextBridge` APIs to expose Electron APIs to
// renderer only if context isolation is enabled, otherwise
// just add to the DOM global.
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('dovira', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.dovira = api
}
