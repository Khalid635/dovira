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
  title: string | null
  filename: string
  savePath: string
  kind: DownloadKind
  formatLabel: string | null
  status: DownloadStatus
  totalBytes: number
  doneBytes: number
  /** Runtime only — not persisted. */
  speedBps: number
  /** Runtime only — not persisted. Seconds remaining, null when unknown. */
  etaSeconds: number | null
  errorCode: string | null
  errorMessage: string | null
  thumbnailUrl: string | null
  site: string | null
  createdAt: number
  startedAt: number | null
  completedAt: number | null
  /** 'aria2' for plain files, 'ytdlp' for video/audio. */
  engine: 'aria2' | 'ytdlp'
  /** Exact yt-dlp format selector used for this download (resume reuses it). */
  formatString: string | null
  /** JSON: { partExists, ytdlExists, lastArgs, subtitles, subLang, embedThumbnail } */
  ytdlpState: string | null
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
  /** Default video quality cap: '2160' | '1080' | '720' | '480' | '360'. */
  defaultVideoQuality: string
  videoContainer: 'mp4' | 'mkv'
  defaultAudioBitrate: '320' | '192' | '128'
  subtitleLang: string
  engineAutoUpdate: boolean
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
  ytDlpVersion: string | null
  ffmpegVersion: string | null
  denoVersion: string | null
  downloadDir: string
  diskFreeBytes: number | null
}

export interface VideoFormat {
  id: string
  height: number | null
  ext: string
  filesize: number | null
  note: string | null
  combined: boolean
}

export interface VideoInfo {
  url: string
  title: string
  thumbnail: string | null
  duration: number | null
  uploader: string | null
  site: string | null
  formats: VideoFormat[]
}

/** A plain-file link: no video/audio tabs, just name + size + save path. */
export interface PlainFileInfo {
  filename: string
  size: number | null
  contentType: string | null
}

export interface AddOptions {
  url: string
  kind: 'video' | 'audio'
  formatId: string
  formatString: string
  qualityLabel: string
  subtitles: boolean
  subLang: string
  embedThumbnail: boolean
  savePath: string
  filename: string
  title: string | null
  thumbnailUrl: string | null
}

export interface EngineInfo {
  name: string
  version: string | null
  latest: string | null
  updateAvailable: boolean
  path: string | null
}
