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
  /** yt-dlp format id (needed to re-download with the same format). */
  formatId: string | null
  /** JSON: { partExists, ytdlExists, lastArgs, subtitles, subLang, embedThumbnail } */
  ytdlpState: string | null
  /** Phase 3: queue position (lower = starts first). Display order is unchanged. */
  sortOrder: number
}

export type CookieBrowser = 'none' | 'chrome' | 'edge' | 'firefox' | 'brave'
export type SchedulerAction = 'none' | 'shutdown' | 'sleep'

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
  /** Phase 3: which browser yt-dlp should read cookies from ('none' = no cookies). */
  cookieBrowser: CookieBrowser
  /** Phase 3: path to a cookies.txt file (used only when cookieBrowser is 'none'). */
  cookiesFile: string | null
  /** Phase 3: start DOVIRA automatically when Windows starts. */
  launchAtStartup: boolean
  /** Phase 3: closing the window hides it to the tray instead of quitting. */
  minimizeToTray: boolean
  /** Phase 3: proxy URL for downloads (http://, https://, socks5:// or socks5h://). Empty = no proxy. */
  proxyUrl: string
  /** Phase 3: timed queue start. */
  schedulerEnabled: boolean
  schedulerTime: string
  schedulerAction: SchedulerAction
  /** Phase 3: ISO date (YYYY-MM-DD) of the last day the scheduler fired. Null = never. */
  lastSchedulerRun: string | null
  /** Phase 3: clipboard watch (AI Link Detection) — OFF by default. */
  clipboardWatch: boolean
}

/** Phase 3: the scheduler's current state, shown in Settings. */
export interface SchedulerStatus {
  enabled: boolean
  /** ISO timestamp of the next scheduled run, null when disabled. */
  nextRunAt: string | null
  /** ISO timestamp of the last run, null when never. */
  lastRunAt: string | null
}

/** Phase 3: the 60-second shutdown/sleep countdown, shown as a modal. */
export interface SchedulerCountdown {
  action: 'shutdown' | 'sleep'
  secondsLeft: number
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
