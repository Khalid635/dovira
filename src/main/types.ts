import type { NetworkClass } from './smart/adaptive.ts'
import type { NamePresetId } from './smart/namePresets.ts'

export type { NetworkClass }

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
  /**
   * Next-level: user-pinned — pinned rows start before every unpinned
   * one (pump sorts pinned first). Persisted (DB migration v5).
   */
  pinned: boolean
  /**
   * Phase 7: per-download speed limit in KB/s. 0 = use the global
   * settings.speedLimitKBps. Persisted (DB migration v4).
   */
  speedLimitKBps: number
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
  /** v0.7.0: one-time flag — flips a stored 'dark' theme to the new Mint light default once. */
  themeMigrated070: boolean
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
  /** Phase 4: skip videos already downloaded (yt-dlp --download-archive). */
  playlistSkipDownloaded: boolean
  /** Phase 4: embed title/artist metadata by default (video + audio). */
  embedMetadataDefault: boolean
  /** Phase 5: the Local API token the browser extension pairs with. Empty = not generated yet. */
  extensionToken: string
  /**
   * Security: the Local API token, encrypted with safeStorage
   * (DPAPI / Keychain / libsecret). Base64 ciphertext; empty = not stored
   * encrypted yet (legacy plaintext extensionToken still applies).
   */
  extensionTokenEncrypted: string
  /** Phase 6: check for app updates automatically after startup. */
  appUpdateCheck: boolean
  /** Phase 6: download an available app update without asking first. */
  appUpdateAutoDownload: boolean
  /** Phase 7 (v1.0): AI File Organizer — sort downloads into category folders. */
  smartOrganizer: boolean
  /** Phase 7: folder name per category (user-editable). Keys are Category names. */
  organizerFolders: Record<string, string>
  /** Phase 7: user extension→category overrides, e.g. { "epub": "Documents" }. */
  organizerOverrides: Record<string, string>
  /** Phase 7: Smart filenames — strip junk tags, apply the name template. */
  smartNaming: boolean
  /** Phase 7: filename template, e.g. "{title} [{height}p]". */
  nameTemplate: string
  /** Filename style preset (Settings > Smart) — sets nameTemplate. 'custom' = hand-edited. */
  nameTemplatePreset: NamePresetId
  /** Phase 7: Duplicate Detection — warn when the file/URL was downloaded before. */
  smartDuplicates: boolean
  /** Phase 7: Smart Download — adapt aria2 connections / yt-dlp fragments to measured speed. */
  smartDownload: boolean
  /** Phase 7: local-model hook (Ollama / LM Studio) — default OFF, no bundled model. */
  localModelEnabled: boolean
  localModelProvider: 'ollama' | 'lmstudio'
  localModelEndpoint: string
  localModelName: string
  /** AI Assistant (post-v1.0, v1.1.0): chat panel in the sidebar. Default ON. */
  assistantEnabled: boolean
  /** AI Assistant: send unmatched questions to the local model (Ollama/LM Studio). Default OFF. */
  assistantLocalModel: boolean
  /** v1.2.0: first-run setup wizard completed. False = the wizard shows on launch. */
  setupCompleted: boolean
  /** v1.2.0: browser extension floating download button (default ON). */
  extensionFloatingButton: boolean
  /** v1.2.0: browser extension intercepts browser downloads (default OFF). */
  extensionIntercept: boolean
  /** Next-level: AI auto quality pick — best quality up to the default cap (default ON). */
  autoQuality: boolean
  /** Next-level: AI auto subtitles pick — best available subtitles (default OFF). */
  autoSubtitles: boolean
}

/** Phase 6: app auto-update state, shown in Settings > App updates. */
export type AppUpdateStatus =
  | 'idle'
  | 'checking'
  | 'available'
  | 'not-available'
  | 'downloading'
  | 'downloaded'
  | 'verifying'
  | 'install-ready'
  | 'checksum-failed'
  | 'error'

export interface AppUpdateState {
  state: AppUpdateStatus
  /** Version of the update being handled (null when none). */
  version: string | null
  /** Download progress 0–100 (null when not downloading). */
  progress: number | null
  /**
   * Error detail: a short code for the checksum states
   * ('checksum-mismatch' | 'checksums-missing' |
   * 'checksums-unavailable') or the updater's message for 'error'.
   */
  error: string | null
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
  /** Issue #7: Smart Download network class at the time of this event. */
  networkClass?: NetworkClass
}

export interface StatusEvent {
  id: string
  status: DownloadStatus
  errorCode?: string | null
  errorMessage?: string | null
  /** Issue #7: Smart Download network class at the time of this event. */
  networkClass?: NetworkClass
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

/**
 * Cobalt-inspired multi-media picker: one item of a multi-media post
 * (e.g. an Instagram carousel, an X post with several photos). Same
 * shape as PlaylistEntry — a single downloadable item with its own URL.
 */
export interface MediaItem {
  id: string
  title: string
  thumbnail: string | null
  url: string
  duration: number | null
}

export interface VideoInfo {
  url: string
  title: string
  thumbnail: string | null
  duration: number | null
  uploader: string | null
  site: string | null
  formats: VideoFormat[]
  /** Phase 4: true when the URL is a live stream (duration is null). */
  isLive: boolean
  /** Phase 4: languages with human-made subtitles (from the info JSON). */
  subtitleLangs: string[]
  /** Phase 4: languages with auto-generated captions. */
  autoCaptionLangs: string[]
  /** Phase 7: yt-dlp video id (for duplicate detection via remote_id). */
  videoId: string | null
  /** Phase 7: yt-dlp extractor key, e.g. "youtube". */
  extractor: string | null
  /** Phase 7: yt-dlp categories[0], e.g. "Music" — drives the organizer. */
  ytCategory: string | null
  /** Multi-media picker: present when the URL resolves to several media items. */
  mediaItems?: MediaItem[]
}

/** Phase 4: one flat-playlist entry (no formats — quality is chosen once). */
export interface PlaylistEntry {
  id: string
  title: string
  duration: number | null
  url: string
  thumbnail: string | null
}

/** Phase 4: a playlist/channel, fetched with --flat-playlist -J. */
export interface PlaylistInfo {
  url: string
  title: string
  uploader: string | null
  entries: PlaylistEntry[]
}

/** A plain-file link: no video/audio tabs, just name + size + save path. */
export interface PlainFileInfo {
  filename: string
  size: number | null
  contentType: string | null
}

/**
 * Issue #1: the fetchInfo result — named so the in-memory cache
 * (src/main/util/fetchInfoCache.ts) can hold it.
 */
export interface FetchInfoResult {
  ok: boolean
  info?: VideoInfo
  plainFile?: PlainFileInfo
  playlist?: PlaylistInfo
  torrent?: { name: string }
  error?: string
  /** v0.6.1: raw failure detail (yt-dlp stderr excerpt) — shown in the dialog. */
  errorDetail?: string
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
  /** Phase 4: clip bounds (HH:MM:SS or seconds), null = no clip. Video only. */
  clipStart?: string | null
  clipEnd?: string | null
  /** Phase 4: --embed-metadata (title/artist). */
  embedMetadata?: boolean
  /** Phase 4: subtitles destination — embed in the file, separate .srt, or both. */
  subMode?: 'embed' | 'file' | 'both'
  /** Phase 4: also take auto-generated captions when no manual subs exist. */
  autoSubs?: boolean
  /** Phase 4: download only the thumbnail (.jpg), no media. */
  thumbnailOnly?: boolean
  /** Next-level: live-stream recording — save the raw stream as .ts (no merge, no clip). */
  liveRecord?: boolean
  /** Phase 4: skip via --download-archive when the video was downloaded before. */
  useArchive?: boolean
  /** Phase 5: per-link network overrides from the browser extension. */
  extCookiesFile?: string | null
  userAgent?: string | null
  referer?: string | null
  /** Phase 7: yt-dlp video id + extractor (duplicate detection via remote_id). */
  videoId?: string | null
  extractor?: string | null
  /** Phase 7: chosen video height (smart filename template {height}). */
  height?: number | null
  /** Phase 7: uploader name (smart filename template {uploader}). */
  uploader?: string | null
  /** Phase 7: the user already chose Re-download / Keep both — skip the duplicate safety net. */
  skipDuplicateCheck?: boolean
  /** Phase 7: false = the caller already decided the filename (Add dialog preview); otherwise main applies smart naming. */
  applySmartName?: boolean
}

export interface EngineInfo {
  name: string
  version: string | null
  latest: string | null
  updateAvailable: boolean
  path: string | null
}

/**
 * Phase 7: one downloadable link found by the site grabber.
 * kind is decided by extension (or content-type for extension-less links).
 */
export type GrabberKind = 'image' | 'video' | 'audio' | 'document' | 'archive' | 'other'

export interface GrabberItem {
  /** Final URL after redirects — this is what gets downloaded. */
  url: string
  filename: string
  ext: string
  kind: GrabberKind
  /** Bytes from a HEAD request; null when the server did not say. */
  sizeBytes: number | null
}

/** Phase 7: result of scanning one page for downloadable links. */
export interface GrabberScanResult {
  ok: boolean
  /** Final page URL after redirects. */
  pageUrl: string
  title: string | null
  items: GrabberItem[]
  /** Error code when ok is false ('invalid-url' | 'not-found' | 'forbidden' | 'network' | 'not-html' | 'page-too-large' | 'unknown'). */
  error?: string
}

/** Phase 5: Local API status, shown in Settings > Browser & Cookies. */
export interface ExtensionApiStatus {
  running: boolean
  /** The port the Local API listens on (null when not running). */
  port: number | null
  /** The pairing token (shown so the user can copy it into the extension). */
  token: string
  /** v1.2.0: epoch ms of the last request from the extension (null = never seen). */
  extensionSeenAt: number | null
  /**
   * Next-level: the extension's own Options page URL, as reported by the
   * extension on its status ping (chrome-extension://…/options.html or
   * moz-extension://…/options.html). Null until the extension has
   * checked in — the one-click Pair button needs it.
   */
  extensionOptionsUrl: string | null
}

/**
 * Next-level (dialog-first extension handoff): one floating-button send
 * waiting for the user in the Add dialog. The Local API stores it and
 * the renderer opens the dialog the moment it arrives — the download
 * itself only starts when the user confirms, so the extension POST
 * never waits for yt-dlp extraction (~7–11 s) any more.
 *
 * `cookiesFile` is a temp Netscape file under userData/ext-cookies.
 * Whoever takes the request owns that file: the queue deletes it when
 * the download completes or is removed; a discard deletes it at once.
 */
export interface ExtensionDownloadRequest {
  url: string
  /** Temp cookies file (null when the extension sent no cookies). */
  cookiesFile: string | null
  userAgent: string | null
  referer: string | null
  /** Plain-file headers (User-Agent / Referer / Cookie) for aria2. */
  headers: string[]
  mirrors: string[]
}

/**
 * Hooks the Local API calls when an extension send arrives — wired in
 * index.ts so the API module stays UI-free.
 */
export interface LocalApiHooks {
  /** Open the Add dialog for this URL (the renderer runs fetchInfo in the background). */
  onExtensionDownload: (req: ExtensionDownloadRequest) => void
}

/**
 * v1.2.0: one self-check row from the Setup & diagnostics section.
 * detailKey is an i18n key; the renderer translates it with detailParams.
 */
export type DiagnosticId = 'localApi' | 'ytdlp' | 'aria2' | 'extension' | 'downloadDir' | 'binaries'
export type DiagnosticStatus = 'ok' | 'warn' | 'fail'
export type DiagnosticFix = 'updateYtdlp' | 'openSetup' | 'chooseFolder'

export interface DiagnosticCheck {
  id: DiagnosticId
  status: DiagnosticStatus
  detailKey: string
  detailParams?: Record<string, string | number>
  fix: DiagnosticFix | null
}

export interface DiagnosticsResult {
  checks: DiagnosticCheck[]
  ranAt: number
}

/** Next-level: one video the subscription checker found (not yet downloaded). */
export interface SubscriptionVideo {
  id: string
  title: string
  url: string
  thumbnail: string | null
  duration: number | null
}

/** Next-level: a subscribed channel/playlist (DB table `subscriptions`). */
export interface Subscription {
  id: string
  url: string
  title: string
  uploader: string | null
  /** yt-dlp id of the newest video seen at subscribe time (baseline). */
  lastVideoId: string | null
  /** Epoch ms of the last check (null = never checked). */
  lastCheckedAt: number | null
  createdAt: number
  /** New videos waiting for the user (downloaded via consume). */
  pending: SubscriptionVideo[]
}
