export type DownloadStatus =
  | 'queued'
  | 'fetching_info'
  | 'downloading'
  | 'paused'
  | 'processing'
  | 'completed'
  | 'failed'
  | 'cancelled'

export type DownloadKind = 'file' | 'video' | 'audio'

export interface DownloadInfo {
  id: string
  url: string
  filename: string
  savePath: string
  kind: DownloadKind
  status: DownloadStatus
  totalBytes: number
  doneBytes: number
  /** Runtime only — not persisted. */
  speedBps: number
  /** Runtime only — not persisted. Seconds remaining, null when unknown. */
  etaSeconds: number | null
  errorCode: string | null
  errorMessage: string | null
  site: string | null
  createdAt: number
  startedAt: number | null
  completedAt: number | null
}

export interface Settings {
  downloadDir: string
  maxConcurrent: number
  /** KB/s, 0 = unlimited. */
  speedLimitKBps: number
  autoRetry: number
  connectionsPerDownload: number
  language: 'en' | 'bn'
  theme: 'dark' | 'light' | 'system'
}

export interface ProgressEvent {
  id: string
  doneBytes: number
  totalBytes: number
  speedBps: number
  etaSeconds: number | null
  status: DownloadStatus
}

export interface StatusEvent {
  id: string
  status: DownloadStatus
  errorCode?: string | null
  errorMessage?: string | null
}

export interface ToastEvent {
  key: string
  params?: Record<string, string | number>
}

export interface AppInfo {
  version: string
  electronVersion: string
  chromeVersion: string
  nodeVersion: string
  aria2Version: string | null
  downloadDir: string
  diskFreeBytes: number | null
}
