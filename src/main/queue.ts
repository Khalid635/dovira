import { EventEmitter } from 'node:events'
import { randomUUID } from 'node:crypto'
import { app } from 'electron'
import { existsSync, mkdirSync, statSync, unlinkSync } from 'node:fs'
import { basename, dirname } from 'node:path'
import type { DoviraDb } from './db'
import type { SettingsManager } from './settings'
import type { Aria2Manager } from './engines/aria2'
import {
  YtDlpManager,
  YtDlpError,
  rewriteLimitRate,
  ytdlpPartFiles,
  type YtDlpDownload,
  type YtDlpDownloadOpts
} from './engines/ytdlp'
import { categorize, organizeDir, type Category } from './smart/categorize'
import { suggestName } from './smart/naming'
import { AdaptiveNet } from './smart/adaptive'
import {
  askCategory,
  askLocalModel,
  testLocalModel,
  type LocalModelSettings
} from './smart/localModel'
import {
  answerQuestion,
  buildModelPrompt,
  type AssistantAnswer,
  type AssistantSnapshot
} from './smart/assistant'
import { findFileDuplicate, type DuplicateInfo } from './smart/duplicates'
import {
  sanitizeFilename,
  resolveUniquePath,
  resolveDownloadPath,
  filenameFromUrl
} from './util/filename'
import { applyPostDownloadSecurity, findMpCmdRun } from './security'
import { mapEngineError } from './util/errors'
import { diskFreeBytes } from './util/paths'
import { logMain } from './logger'
import type {
  AddOptions,
  DownloadInfo,
  DownloadKind,
  PlainFileInfo,
  PlaylistInfo,
  ProgressEvent,
  StatusEvent,
  ToastEvent,
  VideoInfo
} from './types'

interface ActiveEntry {
  gid?: string
  ytdlpJob?: YtDlpDownload
  lastPersistedAt?: number
}

const MIN_FREE_BYTES = 50 * 1024 * 1024
const MAX_ARIA2_RESTARTS = 3
/** Retry backoff between auto-retries: a short outage (up to ~25s) is bridged
 * without burning all retries in the first seconds. */
const RETRY_DELAYS_MS = [2000, 5000, 15000]

// Phase 7: same folder, ignoring a trailing slash and Windows case.
function sameDir(a: string, b: string): boolean {
  const norm = (p: string): string => p.replace(/[\\/]+$/, '').toLowerCase()
  return norm(a) === norm(b)
}

/** Phase 4: magnet: links and .torrent file URLs go to aria2 as torrents. */
function isTorrentUrl(url: string): boolean {
  if (url.startsWith('magnet:')) return true
  try {
    return new URL(url).pathname.toLowerCase().endsWith('.torrent')
  } catch {
    return false
  }
}

/** Phase 4: torrent name from a magnet link's dn= param, else a default. */
function magnetName(url: string): string {
  try {
    const dn = new URL(url).searchParams.get('dn')
    if (dn) return dn
  } catch {
    // Fall through to the default name.
  }
  return 'torrent'
}

/** Phase 4: playlist/channel-looking URLs get a flat-playlist fetch first. */
function looksLikePlaylist(url: string): boolean {
  try {
    const parsed = new URL(url)
    // v0.6.1: a watch URL with a video id is ONE video, even when it
    // carries list= (radio/mix) or start_radio=. Sending it through the
    // flat-playlist fetch makes yt-dlp resolve the whole mix and hang
    // past the 60s timeout (v0.6.0 bug: RDGMEM mix URLs failed 'unknown').
    if (parsed.searchParams.has('v')) return false
    if (parsed.searchParams.has('list')) return true
    const p = parsed.pathname
    return (
      p.includes('/playlist') ||
      p.includes('/channel/') ||
      p.includes('/@') ||
      p.includes('/c/') ||
      p.includes('/user/') ||
      p.includes('/playlists')
    )
  } catch {
    return false
  }
}

/**
 * yt-dlp download strategy, set by the docs/benchmark.md result.
 * false = yt-dlp's own downloader (-N 4); true = aria2 as external downloader.
 * Flip this after running the benchmark (Phase 2, week 3).
 */
const YTDLP_USE_ARIA2 = false

/** Plain-file extensions: these go to aria2 without a yt-dlp info attempt. */
const FILE_EXTS = new Set([
  'zip',
  'exe',
  'msi',
  'pdf',
  'doc',
  'docx',
  'xls',
  'xlsx',
  'ppt',
  'pptx',
  'mp3',
  'mp4',
  'mkv',
  'webm',
  'mov',
  'avi',
  'png',
  'jpg',
  'jpeg',
  'gif',
  'webp',
  'wav',
  'flac',
  'ogg',
  'opus',
  'm4a',
  '7z',
  'rar',
  'tar',
  'gz',
  'iso',
  'dmg',
  'apk',
  'epub',
  'txt',
  'csv',
  'json'
])

function kindFromCategory(filename: string): DownloadKind {
  const category = categorize({ filename })
  if (category === 'Video') return 'video'
  if (category === 'Music') return 'audio'
  return 'file'
}

interface YtDlpState {
  partExists?: boolean
  ytdlExists?: boolean
  lastArgs?: string[]
  subtitles?: boolean
  subLang?: string
  embedThumbnail?: boolean
  audioBitrate?: string
  container?: string
  /** Phase 4: clip bounds (HH:MM:SS or seconds), null = no clip. */
  clipStart?: string | null
  clipEnd?: string | null
  /** Phase 4: --embed-metadata. */
  embedMetadata?: boolean
  /** Phase 4: subtitles destination. */
  subMode?: 'embed' | 'file' | 'both'
  /** Phase 4: also take auto-generated captions. */
  autoSubs?: boolean
  /** Phase 4: thumbnail-only (.jpg) download. */
  thumbnailOnly?: boolean
  /** Phase 4: skip via --download-archive. */
  useArchive?: boolean
  /** Phase 5: per-link extension cookies file (userData/ext-cookies/<id>.txt). */
  extCookiesFile?: string | null
  /** Phase 5: per-link User-Agent / Referer from the browser extension. */
  userAgent?: string | null
  referer?: string | null
}

function parseYtDlpState(raw: string | null): YtDlpState | null {
  if (!raw) return null
  try {
    return JSON.parse(raw) as YtDlpState
  } catch {
    return null
  }
}

/**
 * Owns download state: the queue, concurrency, pause/resume/cancel/retry,
 * progress polling (~500ms, aria2 only — yt-dlp pushes progress events),
 * persistence cadence (status change + ~5s), disk-space checks and aria2
 * crash recovery. Plain Node — no Electron imports, so it can be tested
 * outside the app.
 */
export class QueueManager extends EventEmitter {
  private downloads = new Map<string, DownloadInfo>()
  private active = new Map<string, ActiveEntry>()
  private retryCount = new Map<string, number>()
  private pollTimer: ReturnType<typeof setInterval> | null = null
  private pumping = false
  private aria2Restarts = 0
  private shutDown = false
  private ytDlpArgs = new Map<string, string[]>()
  /** Phase 7: Smart Download — rolling speed samples + failure count. */
  private adaptive = new AdaptiveNet()
  /** Phase 7: last live aria2 connection adjustment (10s cadence). */
  private lastAdaptiveAt = 0
  private lastAdaptiveConns = 0
  /**
   * Phase 5: per-link request headers (User-Agent / Referer / Cookie) the
   * browser extension sent for a plain-file (aria2) download. aria2 only
   * needs them at addUri time; a resume after an app restart re-sends
   * without them — login-walled plain files may then fail, which is a
   * documented v0.4 limitation. yt-dlp downloads persist theirs in
   * YtDlpState instead, so they survive restarts.
   */
  private extHeaders = new Map<string, string[]>()

  constructor(
    private db: DoviraDb,
    private settings: SettingsManager,
    /**
     * Phase 6: aria2 is null on macOS/Linux when no source-built aria2c
     * is bundled — plain files then go through the yt-dlp fallback
     * (startYtDlpPlain) instead of failing. Windows always has aria2.
     */
    private aria2: Aria2Manager | null,
    private ytdlp: YtDlpManager | null = null
  ) {
    super()
    // A fresh aria2 process has no session: anything mid-flight last time
    // comes back as paused, ready to resume (§4).
    for (const d of db.listDownloads()) {
      if (d.status === 'downloading' || d.status === 'fetching_info' || d.status === 'processing') {
        d.status = 'paused'
        db.updateDownload(d.id, { status: 'paused' })
      }
      this.downloads.set(d.id, d)
    }
    if (this.aria2) {
      this.aria2.onUnexpectedExit = () => void this.handleAria2Death()
    }
  }

  /**
   * Phase 6: a plain-file row running through the yt-dlp fallback because
   * aria2 is not available on this platform. Torrents are never fallback
   * rows — yt-dlp cannot download them, so they fail with
   * 'engine-missing' at startDownload instead.
   */
  private isFallbackRow(d: DownloadInfo): boolean {
    return this.aria2 === null && d.engine === 'aria2' && !isTorrentUrl(d.url)
  }

  /**
   * Phase 7: the speed limit that actually applies to a download — its own
   * per-download limit when set, else the global settings limit. 0 =
   * unlimited either way.
   */
  private effectiveLimitKBps(d: DownloadInfo): number {
    if (d.speedLimitKBps > 0) return d.speedLimitKBps
    return this.settings.get().speedLimitKBps
  }

  /**
   * Phase 7: apply the current limits to everything already running.
   * aria2 picks a new limit up live (changeGlobalOption for the global cap
   * + changeOption per active gid for its effective cap). yt-dlp cannot
   * change mid-flight — a running yt-dlp job keeps its old limit until it
   * is paused/resumed, when the stored args are rewritten (see
   * startYtDlp). Best-effort: a failed RPC never throws into the caller
   * (settings save must not break because aria2 blinked).
   */
  async applySpeedLimits(): Promise<void> {
    const aria2 = this.aria2
    if (!aria2 || !aria2.isReady()) return
    const global = this.settings.get().speedLimitKBps
    try {
      await aria2.changeGlobalOption({
        'max-overall-download-limit': global > 0 ? String(global * 1024) : '0'
      })
    } catch {
      // A restart racing this call — the next start applies the limit.
    }
    for (const [id, entry] of [...this.active.entries()]) {
      if (!entry.gid) continue
      const d = this.downloads.get(id)
      if (!d) continue
      const eff = this.effectiveLimitKBps(d)
      try {
        await aria2.changeOption(entry.gid, {
          'max-download-limit': eff > 0 ? String(eff * 1024) : '0'
        })
      } catch {
        // gid may be stale (aria2 restarted) — local state still wins.
      }
    }
  }

  /**
   * Phase 7: set a per-download speed limit (KB/s, 0 = use the global
   * limit). Persisted, so it survives restarts. An active aria2 download
   * picks it up immediately; a yt-dlp download picks it up on resume.
   */
  async setDownloadSpeedLimit(id: string, kbps: number): Promise<boolean> {
    const d = this.downloads.get(id)
    if (!d) return false
    const limit = Number.isFinite(kbps) ? Math.max(0, Math.min(1_000_000, Math.floor(kbps))) : 0
    d.speedLimitKBps = limit
    this.db.updateDownload(id, { speedLimitKBps: limit })
    const entry = this.active.get(id)
    if (entry?.gid && this.aria2?.isReady()) {
      try {
        await this.aria2.changeOption(entry.gid, {
          'max-download-limit': limit > 0 ? String(limit * 1024) : '0'
        })
      } catch {
        // Stale gid — the limit still applies on the next start.
      }
    }
    this.emitStatus(id)
    return true
  }

  /**
   * Phase 7: queue several plain-file URLs (site grabber). Each one goes
   * through the normal add() — HEAD, dedup, aria2 routing. Returns how
   * many were queued (a duplicate URL counts as added via its existing
   * row) and how many failed.
   */
  async addMany(urls: string[]): Promise<{ added: number; failed: number; ids: string[] }> {
    let added = 0
    let failed = 0
    const ids: string[] = []
    for (const url of urls) {
      const res = await this.add(url)
      if (res.ok && res.id) {
        added++
        ids.push(res.id)
      } else {
        failed++
      }
    }
    return { added, failed, ids }
  }

  list(): DownloadInfo[] {
    return [...this.downloads.values()].sort((a, b) => b.createdAt - a.createdAt)
  }

  get(id: string): DownloadInfo | undefined {
    return this.downloads.get(id)
  }

  /**
   * True when a save path is already claimed by a download in the queue —
   * even one whose file doesn't exist on disk yet (queued). Windows paths
   * are case-insensitive, so the comparison is lowercased.
   */
  private isSavePathTaken(candidate: string): boolean {
    const lower = candidate.toLowerCase()
    for (const d of this.downloads.values()) {
      if (d.savePath.toLowerCase() === lower) return true
    }
    return false
  }

  /** Disk-free AND queue-free path for a new download (see isSavePathTaken). */
  private resolveUniqueSavePath(dir: string, filename: string): string {
    return resolveUniquePath(dir, filename, (c) => this.isSavePathTaken(c))
  }

  /**
   * Route a pasted link: plain-file extension → aria2 info (HEAD);
   * video site or anything else → yt-dlp info; on yt-dlp failure, a HEAD
   * request decides whether it is a plain file after all (§2).
   */
  async fetchInfo(
    url: string,
    netOverride?: {
      cookiesFile?: string | null
      userAgent?: string | null
      referer?: string | null
    }
  ): Promise<{
    ok: boolean
    info?: VideoInfo
    plainFile?: PlainFileInfo
    playlist?: PlaylistInfo
    torrent?: { name: string }
    error?: string
    /** v0.6.1: raw failure detail (yt-dlp stderr excerpt) — shown in the dialog. */
    errorDetail?: string
  }> {
    const trimmed = url.trim()
    // Phase 4: magnet links never touch yt-dlp.
    if (trimmed.startsWith('magnet:')) {
      return { ok: true, torrent: { name: magnetName(trimmed) } }
    }
    let parsed: URL
    try {
      parsed = new URL(trimmed)
    } catch {
      return { ok: false, error: 'invalid-url' }
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return { ok: false, error: 'unsupported-url' }
    }
    // Phase 4: a .torrent file URL is a torrent, not a video.
    if (isTorrentUrl(trimmed)) {
      return { ok: true, torrent: { name: filenameFromUrl(trimmed) } }
    }
    // Phase 4: playlist/channel — flat fetch first; on failure fall back
    // to the single-video fetch below (a channel URL that isn't a playlist
    // still resolves — or errors honestly — as one video).
    if (looksLikePlaylist(trimmed) && this.ytdlp) {
      try {
        const playlist = await this.ytdlp.fetchPlaylist(trimmed)
        if (playlist.entries.length > 0) return { ok: true, playlist }
        // Empty playlist — fall through to the single-video fetch.
      } catch (err) {
        // Fall through to the single-video fetch below — but log it: a
        // slow/failed playlist fetch used to be invisible (v0.6.0).
        logMain(
          'warn',
          `fetchInfo playlist-first failed, falling back to single video: ${trimmed} — ${err instanceof Error ? err.message : String(err)}`
        )
      }
    }
    const ext = parsed.pathname.split('.').pop()?.toLowerCase() ?? ''
    if (FILE_EXTS.has(ext)) {
      const pf = await this.headPlainFile(url.trim())
      if (pf) return { ok: true, plainFile: pf }
      // HEAD failed (some servers refuse it) — still a plain file by
      // extension; the dialog shows it with unknown size.
      return {
        ok: true,
        plainFile: { filename: filenameFromUrl(url.trim()), size: null, contentType: null }
      }
    }
    if (this.ytdlp) {
      try {
        const info = await this.ytdlp.fetchInfo(url.trim(), netOverride)
        return { ok: true, info }
      } catch (err) {
        const code = err instanceof YtDlpError ? err.code : 'unknown'
        const detail = err instanceof Error ? err.message : String(err)
        logMain(
          'error',
          `fetchInfo failed: ${url.trim()} code=${code} detail=${detail.slice(0, 300)}`
        )
        if (code === 'unsupported' || code === 'unknown' || code === 'not-found') {
          const pf = await this.headPlainFile(url.trim())
          if (pf) return { ok: true, plainFile: pf }
        }
        return { ok: false, error: code, errorDetail: detail.slice(0, 300) || undefined }
      }
    }
    const pf = await this.headPlainFile(url.trim())
    if (pf) return { ok: true, plainFile: pf }
    return { ok: false, error: 'engine-missing' }
  }

  private async headPlainFile(url: string): Promise<PlainFileInfo | null> {
    try {
      const head = await fetch(url, {
        method: 'HEAD',
        redirect: 'follow',
        signal: AbortSignal.timeout(10_000)
      })
      const contentType = head.headers.get('content-type') ?? ''
      if (contentType.startsWith('text/html')) return null
      const filename = filenameFromUrl(url, head.headers.get('content-disposition'))
      const len = Number(head.headers.get('content-length') ?? 0)
      return {
        filename,
        size: Number.isFinite(len) && len > 0 ? len : null,
        contentType: contentType || null
      }
    } catch {
      return null
    }
  }

  async add(url: string, saveDir?: string): Promise<{ ok: boolean; id?: string; error?: string }> {
    let parsed: URL
    try {
      parsed = new URL(url.trim())
    } catch {
      return { ok: false, error: 'invalid-url' }
    }
    // Phase 4: magnet: links are accepted (routed to aria2 as torrents).
    if (
      parsed.protocol !== 'http:' &&
      parsed.protocol !== 'https:' &&
      parsed.protocol !== 'magnet:'
    ) {
      return { ok: false, error: 'unsupported-url' }
    }
    const s = this.settings.get()
    let dir = saveDir ?? s.downloadDir
    const free = diskFreeBytes(dir)
    if (free !== null && free < MIN_FREE_BYTES) return { ok: false, error: 'no-space' }

    // Same URL already live? Resume that one instead of duplicating it.
    for (const d of this.downloads.values()) {
      if (d.url === url && ['queued', 'downloading', 'paused', 'failed'].includes(d.status)) {
        if (d.status === 'paused' || d.status === 'failed') void this.resume(d.id)
        return { ok: true, id: d.id }
      }
    }

    // Best-effort HEAD: filename from Content-Disposition + total size.
    // Phase 4: no HEAD fetch for magnets (HEAD on a magnet is meaningless);
    // the name comes from the magnet's dn= param instead.
    const isMagnet = parsed.protocol === 'magnet:'
    let filename = isMagnet ? magnetName(url.trim()) : filenameFromUrl(url)
    let totalBytes = 0
    if (!isMagnet) {
      try {
        const head = await fetch(url, {
          method: 'HEAD',
          redirect: 'follow',
          signal: AbortSignal.timeout(10_000)
        })
        const fromCd = filenameFromUrl(url, head.headers.get('content-disposition'))
        if (fromCd !== 'download') filename = fromCd
        const len = Number(head.headers.get('content-length') ?? 0)
        if (Number.isFinite(len) && len > 0) totalBytes = len
      } catch {
        // Some servers refuse HEAD — aria2 will report the size shortly.
      }
    }
    if (totalBytes > 0 && free !== null && free < totalBytes) {
      return { ok: false, error: 'no-space' }
    }

    filename = sanitizeFilename(filename)
    // Phase 7 (v1.0): Smart features — smart filename, organizer folder,
    // duplicate check. Each guarded by its own Settings switch. The
    // organizer only applies when no explicit folder was passed (a folder
    // the user picked — or the dialog already organized — is respected).
    if (s.smartNaming) {
      filename = suggestName({
        filename,
        title: null,
        height: null,
        uploader: null,
        template: s.nameTemplate
      })
    }
    if (s.smartOrganizer && !saveDir) {
      dir = await this.organizeSaveDir(dir, filename, {
        kind: 'file',
        site: parsed.hostname,
        duration: null,
        ytCategory: null,
        title: null
      })
    }
    if (s.smartDuplicates) {
      const dup = this.checkDuplicate({
        url: url.trim(),
        filename,
        saveDir: dir,
        totalBytes: totalBytes > 0 ? totalBytes : null,
        remoteId: null,
        formatId: null
      })
      if (dup.duplicate) {
        this.emitToast({ key: 'toast.duplicateSkipped' })
        return { ok: false, error: 'duplicate', id: dup.existingId }
      }
    }
    mkdirSync(dir, { recursive: true })
    const savePath = this.resolveUniqueSavePath(dir, filename)
    const id = randomUUID()
    const now = Date.now()
    const info: DownloadInfo = {
      id,
      url,
      title: null,
      filename: basename(savePath),
      savePath,
      kind: kindFromCategory(filename),
      formatLabel: null,
      status: 'queued',
      totalBytes,
      doneBytes: 0,
      speedBps: 0,
      etaSeconds: null,
      errorCode: null,
      errorMessage: null,
      thumbnailUrl: null,
      site: parsed.hostname,
      createdAt: now,
      startedAt: null,
      completedAt: null,
      engine: 'aria2',
      formatId: null,
      formatString: null,
      ytdlpState: null,
      sortOrder: now,
      speedLimitKBps: 0
    }
    this.db.insertDownload({
      id: info.id,
      url: info.url,
      filename: info.filename,
      savePath: info.savePath,
      kind: info.kind,
      status: 'queued',
      totalBytes,
      doneBytes: 0,
      site: info.site,
      createdAt: info.createdAt,
      sortOrder: info.sortOrder,
      engine: 'aria2'
    })
    this.downloads.set(id, info)
    this.emitStatus(id)
    void this.pump()
    return { ok: true, id }
  }

  /** Video/audio download with the dialog's chosen format (yt-dlp engine). */
  async addWithOptions(opts: AddOptions): Promise<{
    ok: boolean
    id?: string
    error?: string
    errorDetail?: string
  }> {
    let parsed: URL
    try {
      parsed = new URL(opts.url.trim())
    } catch {
      return { ok: false, error: 'invalid-url' }
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return { ok: false, error: 'unsupported-url' }
    }
    if (!opts.formatString || !opts.savePath || !opts.filename) {
      return { ok: false, error: 'invalid-url' }
    }
    if (!this.ytdlp) return { ok: false, error: 'engine-missing' }
    const s = this.settings.get()
    const free = diskFreeBytes(s.downloadDir)
    if (free !== null && free < MIN_FREE_BYTES) return { ok: false, error: 'no-space' }

    for (const d of this.downloads.values()) {
      if (d.url === opts.url && ['queued', 'downloading', 'paused', 'failed'].includes(d.status)) {
        if (d.status === 'paused' || d.status === 'failed') void this.resume(d.id)
        return { ok: true, id: d.id }
      }
    }

    let filename = sanitizeFilename(opts.filename)
    // Phase 7: Smart filename — the Add dialog already previews this exact
    // result and passes the final name; main re-applies it only for
    // callers that did not (browser extension). applySmartName=false means
    // "the caller already decided the name".
    if (s.smartNaming && opts.applySmartName !== false) {
      filename = suggestName({
        filename,
        title: opts.title ?? null,
        height: opts.height ?? null,
        uploader: opts.uploader ?? null,
        template: s.nameTemplate
      })
    }
    let dir = dirname(opts.savePath)
    // Phase 7: organizer — only when the path is still the bare download
    // dir (the dialog already organized its own path; a folder the user
    // picked by hand is respected).
    if (s.smartOrganizer && sameDir(dir, s.downloadDir)) {
      dir = await this.organizeSaveDir(dir, filename, {
        kind: opts.kind,
        site: parsed.hostname,
        duration: null,
        ytCategory: null,
        title: opts.title ?? null
      })
    }
    // Phase 7: duplicate safety net (the dialog pre-checks; this catches
    // races and extension adds). Re-download / Keep both pass
    // skipDuplicateCheck.
    if (s.smartDuplicates && !opts.skipDuplicateCheck) {
      const dup = this.checkDuplicate({
        url: opts.url.trim(),
        filename,
        saveDir: dir,
        totalBytes: null,
        remoteId: opts.videoId && opts.extractor ? `${opts.extractor}:${opts.videoId}` : null,
        formatId: opts.formatId ?? null
      })
      if (dup.duplicate) {
        this.emitToast({ key: 'toast.duplicateSkipped' })
        return { ok: false, error: 'duplicate', errorDetail: dup.existingId }
      }
    }
    mkdirSync(dir, { recursive: true })
    const savePath = this.resolveUniqueSavePath(dir, filename)
    const id = randomUUID()
    const now = Date.now()
    const state: YtDlpState = {
      subtitles: opts.subtitles,
      subLang: opts.subLang,
      embedThumbnail: opts.embedThumbnail,
      audioBitrate: opts.kind === 'audio' ? opts.qualityLabel.replace(/[^0-9]/g, '') : undefined,
      container: opts.kind === 'video' ? 'mp4' : undefined,
      clipStart: opts.clipStart ?? null,
      clipEnd: opts.clipEnd ?? null,
      embedMetadata: opts.embedMetadata ?? false,
      subMode: opts.subMode ?? 'embed',
      autoSubs: opts.autoSubs ?? false,
      thumbnailOnly: opts.thumbnailOnly ?? false,
      useArchive: opts.useArchive ?? false,
      extCookiesFile: opts.extCookiesFile ?? null,
      userAgent: opts.userAgent ?? null,
      referer: opts.referer ?? null
    }
    const info: DownloadInfo = {
      id,
      url: opts.url,
      title: opts.title ?? null,
      filename: basename(savePath),
      savePath,
      kind: opts.kind,
      formatLabel: opts.qualityLabel,
      status: 'queued',
      totalBytes: 0,
      doneBytes: 0,
      speedBps: 0,
      etaSeconds: null,
      errorCode: null,
      errorMessage: null,
      thumbnailUrl: opts.thumbnailUrl ?? null,
      site: parsed.hostname,
      createdAt: now,
      startedAt: null,
      completedAt: null,
      engine: 'ytdlp',
      formatId: opts.formatId,
      formatString: opts.formatString,
      ytdlpState: JSON.stringify(state),
      sortOrder: now,
      speedLimitKBps: 0
    }
    this.db.insertDownload({
      id: info.id,
      url: info.url,
      title: info.title,
      filename: info.filename,
      savePath: info.savePath,
      kind: info.kind,
      formatLabel: info.formatLabel,
      status: 'queued',
      totalBytes: 0,
      doneBytes: 0,
      thumbnailUrl: info.thumbnailUrl,
      site: info.site,
      createdAt: info.createdAt,
      sortOrder: info.sortOrder,
      engine: 'ytdlp',
      // Phase 7: remote_id = "<extractor>:<videoId>" (duplicate detection).
      remoteId: opts.videoId && opts.extractor ? `${opts.extractor}:${opts.videoId}` : null,
      formatId: opts.formatId,
      formatString: opts.formatString,
      ytdlpState: info.ytdlpState
    })
    this.downloads.set(id, info)
    this.emitStatus(id)
    void this.pump()
    return { ok: true, id }
  }

  /**
   * Phase 4: download only the video's thumbnail (.jpg) — one quick call,
   * no progress events, no resume (a thumbnail fetch is one quick call).
   * The row completes through the normal pump/startYtDlp path on exit 0 +
   * the .jpg existing.
   */
  async addThumbnailOnly(
    url: string,
    saveDir?: string
  ): Promise<{ ok: boolean; id?: string; error?: string }> {
    let parsed: URL
    try {
      parsed = new URL(url.trim())
    } catch {
      return { ok: false, error: 'invalid-url' }
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return { ok: false, error: 'unsupported-url' }
    }
    if (!this.ytdlp) return { ok: false, error: 'engine-missing' }
    const s = this.settings.get()
    const free = diskFreeBytes(s.downloadDir)
    if (free !== null && free < MIN_FREE_BYTES) return { ok: false, error: 'no-space' }

    for (const d of this.downloads.values()) {
      if (d.url === url && ['queued', 'downloading', 'paused', 'failed'].includes(d.status)) {
        if (d.status === 'paused' || d.status === 'failed') void this.resume(d.id)
        return { ok: true, id: d.id }
      }
    }

    let title: string
    try {
      title = (await this.ytdlp.fetchInfo(url.trim())).title
    } catch (err) {
      return { ok: false, error: err instanceof YtDlpError ? err.code : 'unknown' }
    }

    const dir = saveDir ?? s.downloadDir
    mkdirSync(dir, { recursive: true })
    const filename = sanitizeFilename(title) + '.jpg'
    const savePath = this.resolveUniqueSavePath(dir, filename)
    const id = randomUUID()
    const now = Date.now()
    const state: YtDlpState = { thumbnailOnly: true, container: 'mp4' }
    const info: DownloadInfo = {
      id,
      url: url.trim(),
      title,
      filename: basename(savePath),
      savePath,
      kind: 'video',
      formatLabel: 'thumbnail',
      status: 'queued',
      totalBytes: 0,
      doneBytes: 0,
      speedBps: 0,
      etaSeconds: null,
      errorCode: null,
      errorMessage: null,
      thumbnailUrl: null,
      site: parsed.hostname,
      createdAt: now,
      startedAt: null,
      completedAt: null,
      engine: 'ytdlp',
      formatId: null,
      formatString: null,
      ytdlpState: JSON.stringify(state),
      sortOrder: now,
      speedLimitKBps: 0
    }
    this.db.insertDownload({
      id: info.id,
      url: info.url,
      title: info.title,
      filename: info.filename,
      savePath: info.savePath,
      kind: info.kind,
      formatLabel: info.formatLabel,
      status: 'queued',
      totalBytes: 0,
      doneBytes: 0,
      site: info.site,
      createdAt: info.createdAt,
      sortOrder: info.sortOrder,
      engine: 'ytdlp',
      formatId: null,
      formatString: null,
      ytdlpState: info.ytdlpState
    })
    this.downloads.set(id, info)
    this.emitStatus(id)
    void this.pump()
    return { ok: true, id }
  }

  async pause(id: string): Promise<boolean> {
    const d = this.downloads.get(id)
    if (!d) return false
    // Phase 6: a fallback row (engine 'aria2', actually running via
    // yt-dlp) pauses like a yt-dlp row — kill the yt-dlp job, keep the
    // .part file for resume.
    if (d.engine === 'ytdlp' || this.isFallbackRow(d)) {
      if (d.status !== 'downloading' && d.status !== 'processing') return false
      const entry = this.active.get(id)
      if (entry?.ytdlpJob) {
        entry.ytdlpJob.kill()
        this.active.delete(id)
      }
      const parts = ytdlpPartFiles(d.savePath)
      const prev = parseYtDlpState(d.ytdlpState) ?? {}
      const state: YtDlpState = {
        ...prev,
        partExists: parts.length > 0,
        ytdlExists: existsSync(`${d.savePath}.ytdl`),
        lastArgs: this.ytDlpArgs.get(id) ?? prev.lastArgs
      }
      d.status = 'paused'
      d.speedBps = 0
      d.etaSeconds = null
      d.ytdlpState = JSON.stringify(state)
      this.db.updateDownload(id, {
        status: 'paused',
        doneBytes: d.doneBytes,
        totalBytes: d.totalBytes,
        ytdlpState: d.ytdlpState
      })
      this.emitStatus(id)
      void this.pump()
      return true
    }
    if (d.status !== 'downloading') return false
    const entry = this.active.get(id)
    if (entry?.gid) {
      const aria2 = this.aria2
      if (aria2) {
        try {
          await aria2.pause(entry.gid)
        } catch {
          // gid may be stale (aria2 restarted) — local state still wins.
        }
      }
      this.active.delete(id)
    }
    d.status = 'paused'
    d.speedBps = 0
    d.etaSeconds = null
    this.db.updateDownload(id, {
      status: 'paused',
      doneBytes: d.doneBytes,
      totalBytes: d.totalBytes
    })
    this.emitStatus(id)
    void this.pump()
    return true
  }

  async resume(id: string): Promise<boolean> {
    const d = this.downloads.get(id)
    if (!d || (d.status !== 'paused' && d.status !== 'failed' && d.status !== 'cancelled')) {
      return false
    }
    if (d.engine === 'ytdlp' || this.isFallbackRow(d)) {
      // Output already fully on disk (e.g. the app died right after the
      // merge finished)? Mark it complete instead of re-downloading.
      if (d.totalBytes > 0 && existsSync(d.savePath)) {
        try {
          if (statSync(d.savePath).size >= d.totalBytes) {
            d.doneBytes = d.totalBytes
            await this.complete(id)
            return true
          }
        } catch {
          // Stat failed — fall through to a normal resume.
        }
      }
      // NOTE: do NOT zero doneBytes here — startYtDlp / startYtDlpPlain
      // need it to detect a missing .part file (resume-state-mismatch)
      // instead of silently restarting from zero.
    } else if (!existsSync(d.savePath)) {
      d.doneBytes = 0
    }
    this.retryCount.set(id, 0)
    d.status = 'queued'
    d.errorCode = null
    d.errorMessage = null
    this.db.updateDownload(id, {
      status: 'queued',
      doneBytes: d.doneBytes,
      errorCode: null,
      errorMessage: null
    })
    this.emitStatus(id)
    void this.pump()
    return true
  }

  async retry(id: string): Promise<boolean> {
    const d = this.downloads.get(id)
    if (
      d &&
      d.errorCode === 'resume-state-mismatch' &&
      (d.engine === 'ytdlp' || this.isFallbackRow(d))
    ) {
      // The user pressed Retry after the mismatch message: that is the
      // explicit confirmation to restart from the beginning.
      this.deleteYtDlpPartials(d.savePath)
      try {
        if (existsSync(d.savePath)) unlinkSync(d.savePath)
      } catch {
        // Best effort.
      }
      d.doneBytes = 0
      d.ytdlpState = null
      this.db.updateDownload(id, {
        doneBytes: 0,
        ytdlpState: null,
        errorCode: null,
        errorMessage: null
      })
    }
    return this.resume(id)
  }

  async cancel(id: string): Promise<boolean> {
    const d = this.downloads.get(id)
    if (!d) return false
    const entry = this.active.get(id)
    // Phase 6: a fallback row has a yt-dlp job, not a gid — kill it like
    // a yt-dlp row, or the download keeps running after cancel.
    if (d.engine === 'ytdlp' || entry?.ytdlpJob) {
      if (entry?.ytdlpJob) {
        entry.ytdlpJob.kill()
        this.active.delete(id)
      }
      this.ytDlpArgs.delete(id)
    } else if (entry?.gid) {
      const aria2 = this.aria2
      if (aria2) {
        try {
          await aria2.remove(entry.gid)
        } catch {
          // Already gone — continue with local cleanup.
        }
      }
      this.active.delete(id)
    }
    this.deletePartialFiles(d)
    d.status = 'cancelled'
    d.speedBps = 0
    d.etaSeconds = null
    this.db.updateDownload(id, { status: 'cancelled', doneBytes: 0 })
    this.emitStatus(id)
    void this.pump()
    return true
  }

  /**
   * Phase 5: delete a per-link extension cookies file (tiny text file
   * under userData/ext-cookies). Best-effort — a completed/removed
   * download never needs it again, and a stale temp file is harmless.
   */
  private deleteExtCookiesFile(d: DownloadInfo): void {
    const file = parseYtDlpState(d.ytdlpState)?.extCookiesFile
    if (!file) return
    this.deleteExtCookiesFilePath(file)
  }

  /** Delete an extension cookies file by path (null = nothing to do). */
  private deleteExtCookiesFilePath(file: string | null): void {
    if (!file) return
    try {
      if (existsSync(file)) unlinkSync(file)
    } catch {
      // Stale temp file — harmless.
    }
  }

  async remove(id: string, deleteFile: boolean): Promise<boolean> {
    const d = this.downloads.get(id)
    if (!d) return false
    const entry = this.active.get(id)
    // Phase 6: see cancel() — a fallback row's yt-dlp job must be killed.
    if (d.engine === 'ytdlp' || entry?.ytdlpJob) {
      if (entry?.ytdlpJob) {
        entry.ytdlpJob.kill()
        this.active.delete(id)
      }
      this.ytDlpArgs.delete(id)
    } else if (entry?.gid) {
      const aria2 = this.aria2
      if (aria2) {
        try {
          await aria2.remove(entry.gid)
        } catch {
          // Already gone — continue with local cleanup.
        }
      }
      this.active.delete(id)
    }
    if (deleteFile) {
      this.deletePartialFiles(d)
      try {
        if (existsSync(d.savePath)) unlinkSync(d.savePath)
      } catch {
        // File may be locked — the record is still removed.
      }
    }
    this.deleteExtCookiesFile(d)
    this.extHeaders.delete(id)
    this.downloads.delete(id)
    this.db.deleteDownload(id)
    void this.pump()
    return true
  }

  shutdown(): void {
    this.shutDown = true
    this.stopPoller()
  }

  // ------------------------------------------------------------------
  // Phase 3: queue reorder, tray actions, History, scheduler hooks
  // ------------------------------------------------------------------

  /** The download with this URL, if any — clipboard watch uses it to dedup. */
  getByUrl(url: string): DownloadInfo | undefined {
    return [...this.downloads.values()].find((d) => d.url === url)
  }

  /** No download is queued, fetching info, downloading or processing. */
  isIdle(): boolean {
    return ![...this.downloads.values()].some((d) =>
      ['queued', 'fetching_info', 'downloading', 'processing'].includes(d.status)
    )
  }

  /**
   * Move a download to the front of the queue (lowest sort_order), so the
   * pump starts it before every other queued download. Display order is
   * unchanged — the card's "Waiting #n" position shows the new rank.
   */
  async moveToTop(id: string): Promise<boolean> {
    const d = this.downloads.get(id)
    if (!d) return false
    const ordered = [...this.downloads.values()].sort(
      (a, b) => a.sortOrder - b.sortOrder || a.createdAt - b.createdAt
    )
    if (ordered[0]?.id === id) return true // Already first.
    const next = ordered[0].sortOrder - 1
    d.sortOrder = next
    this.db.updateDownload(id, { sortOrder: next })
    this.emitStatus(id)
    return true
  }

  /**
   * Drag-and-drop reorder: place `id` directly before `beforeId` in queue
   * order (null = move to the end). The whole queue is renumbered in
   * whole steps of 1000 so the order never drifts into fractions.
   */
  async reorder(id: string, beforeId: string | null): Promise<boolean> {
    const d = this.downloads.get(id)
    if (!d) return false
    const rest = [...this.downloads.values()]
      .filter((x) => x.id !== id)
      .sort((a, b) => a.sortOrder - b.sortOrder || a.createdAt - b.createdAt)
    let insertAt = rest.length
    if (beforeId !== null) {
      const idx = rest.findIndex((x) => x.id === beforeId)
      if (idx === -1) return false
      insertAt = idx
    }
    const ordered = [...rest.slice(0, insertAt), d, ...rest.slice(insertAt)]
    ordered.forEach((x, i) => {
      x.sortOrder = (i + 1) * 1000
      this.db.updateDownload(x.id, { sortOrder: x.sortOrder })
    })
    this.emitStatus(id)
    return true
  }

  /** Pause every downloading/processing download (tray menu). */
  async pauseAll(): Promise<number> {
    let n = 0
    for (const d of [...this.downloads.values()]) {
      if (d.status === 'downloading' || d.status === 'processing') {
        if (await this.pause(d.id)) n++
      }
    }
    return n
  }

  /** Resume every paused/failed/cancelled download (tray menu, scheduler). */
  async resumeAll(): Promise<number> {
    let n = 0
    for (const d of [...this.downloads.values()]) {
      if (d.status === 'paused' || d.status === 'failed' || d.status === 'cancelled') {
        if (await this.resume(d.id)) n++
      }
    }
    return n
  }

  /** Scheduler: resume everything paused and let the pump start the queue. */
  async startScheduledRun(): Promise<number> {
    return this.resumeAll()
  }

  /**
   * Re-download from History. Paused/failed/cancelled → resume in place.
   * Completed → a fresh download with the same URL, reusing the same
   * yt-dlp format where one was stored (plain files go through add()).
   * Active downloads cannot be re-downloaded.
   */
  async redownload(id: string): Promise<{ ok: boolean; id?: string; error?: string }> {
    const d = this.downloads.get(id)
    if (!d) return { ok: false, error: 'unknown' }
    if (d.status === 'paused' || d.status === 'failed' || d.status === 'cancelled') {
      const ok = await this.resume(id)
      return ok ? { ok: true, id } : { ok: false, error: 'unknown' }
    }
    if (d.status !== 'completed') return { ok: false, error: 'unknown' }
    if (d.engine === 'ytdlp') {
      if (!d.formatString) return { ok: false, error: 'unknown' }
      const state = parseYtDlpState(d.ytdlpState)
      return this.addWithOptions({
        url: d.url,
        kind: d.kind === 'audio' ? 'audio' : 'video',
        formatId: d.formatId ?? '',
        formatString: d.formatString,
        qualityLabel: d.formatLabel ?? '',
        subtitles: state?.subtitles ?? false,
        subLang: state?.subLang ?? 'en',
        embedThumbnail: state?.embedThumbnail ?? false,
        clipStart: state?.clipStart ?? null,
        clipEnd: state?.clipEnd ?? null,
        embedMetadata: state?.embedMetadata ?? false,
        subMode: state?.subMode ?? 'embed',
        autoSubs: state?.autoSubs ?? false,
        thumbnailOnly: state?.thumbnailOnly ?? false,
        // Phase 4: never re-skip on an explicit re-download (plan §1).
        useArchive: false,
        savePath: d.savePath,
        filename: d.filename,
        title: d.title,
        thumbnailUrl: d.thumbnailUrl
      })
    }
    return this.add(d.url)
  }

  /**
   * Clear history: delete only finished records (completed / failed /
   * cancelled) from the DB and the in-memory map. Active downloads are
   * never touched and no file is ever deleted here.
   */
  clearHistory(): number {
    const count = this.db.clearHistory()
    for (const [id, d] of [...this.downloads.entries()]) {
      if (['completed', 'failed', 'cancelled'].includes(d.status)) {
        // Phase 5: finished rows may still hold an extension cookies file.
        this.deleteExtCookiesFile(d)
        this.extHeaders.delete(id)
        this.downloads.delete(id)
        this.retryCount.delete(id)
        this.ytDlpArgs.delete(id)
      }
    }
    return count
  }

  /**
   * Ids of finished rows whose file no longer exists on disk — the History
   * page shows the "File missing" badge for these. Queued/active rows are
   * excluded (their file simply hasn't been written yet), and so are
   * cancelled rows: cancel() deliberately deletes the partial file, so a
   * cancelled row would otherwise ALWAYS show "missing" — noise, not
   * information. Only completed/failed rows ever had a file worth losing.
   */
  historyMissing(): string[] {
    const out: string[] = []
    for (const d of this.downloads.values()) {
      if (!['completed', 'failed'].includes(d.status)) continue
      if (!existsSync(d.savePath)) out.push(d.id)
    }
    return out
  }

  private async pump(): Promise<void> {
    if (this.pumping || this.shutDown) return
    this.pumping = true
    try {
      for (;;) {
        const s = this.settings.get()
        const activeCount = [...this.downloads.values()].filter(
          (d) => d.status === 'downloading'
        ).length
        if (activeCount >= s.maxConcurrent) return
        // Phase 3: the queue starts by sort_order (Move to top / reorder),
        // not by age. createdAt only breaks ties. Display order is
        // unchanged — list() still returns newest first.
        const next = [...this.downloads.values()]
          .filter((d) => d.status === 'queued')
          .sort((a, b) => a.sortOrder - b.sortOrder || a.createdAt - b.createdAt)[0]
        if (!next) return
        await this.startDownload(next)
      }
    } finally {
      this.pumping = false
    }
  }

  /**
   * Phase 7 (v1.0): Smart IPC — categorize a download into a folder.
   * Returns the category + the full folder path. Rules only; the local
   * model is NOT consulted here (the dialog must stay fast) — it runs at
   * add time, only for "Others" results.
   */
  smartCategorize(input: {
    filename: string
    kind?: 'video' | 'audio' | 'file'
    site?: string | null
    duration?: number | null
    ytCategory?: string | null
  }): { category: Category; folder: string } {
    const s = this.settings.get()
    const category = categorize({ ...input, overrides: s.organizerOverrides })
    return { category, folder: organizeDir(s.downloadDir, category, s.organizerFolders) }
  }

  /** Phase 7: Smart IPC — the smart filename for a title + template. */
  smartSuggestName(input: {
    filename: string
    title?: string | null
    height?: number | null
    uploader?: string | null
  }): { name: string } {
    const s = this.settings.get()
    return { name: suggestName({ ...input, template: s.nameTemplate }) }
  }

  /**
   * Phase 7: Smart IPC + safety net — duplicate check (DB + disk).
   * (a) DB: same URL, or same extractor+id+format, among COMPLETED rows;
   * (b) disk: same name + size in the destination folder.
   */
  checkDuplicate(q: {
    url: string
    filename: string
    saveDir: string
    totalBytes: number | null
    remoteId?: string | null
    formatId?: string | null
  }): DuplicateInfo {
    const row = this.db.findCompletedDuplicate(q.url, q.remoteId ?? null, q.formatId ?? null)
    if (row) {
      return {
        duplicate: true,
        kind: row.url === q.url ? 'url' : 'remote',
        existingId: row.id,
        existingName: row.filename,
        existingSize: row.totalBytes > 0 ? row.totalBytes : null,
        existingCompletedAt: row.completedAt
      }
    }
    const onDisk = findFileDuplicate(q.saveDir, q.filename, q.totalBytes)
    if (onDisk) {
      return {
        duplicate: true,
        kind: 'file',
        existingName: onDisk.name,
        existingSize: onDisk.size,
        existingCompletedAt: Math.round(onDisk.mtimeMs)
      }
    }
    return { duplicate: false }
  }

  /** Phase 7: Smart IPC — test the local-model endpoint (Settings > Smart). */
  async testLocalModel(): Promise<{ ok: boolean; error?: string }> {
    const s = this.settings.get()
    const cfg: LocalModelSettings = {
      enabled: s.localModelEnabled,
      provider: s.localModelProvider,
      endpoint: s.localModelEndpoint,
      model: s.localModelName
    }
    return testLocalModel(cfg)
  }

  /**
   * AI Assistant (post-v1.0, v1.1.0): answer one chat question.
   * Rules first, from live state. Only the `fallback` intent goes to the
   * local model — and only when the user turned the assistant's model mode
   * on. Any model failure falls back to the rules fallback answer.
   */
  async askAssistant(question: string): Promise<AssistantAnswer> {
    const s = this.settings.get()
    if (!s.assistantEnabled) {
      return {
        intent: 'fallback',
        source: 'rules',
        lines: [{ key: 'assistant.disabled' }]
      }
    }
    const snap: AssistantSnapshot = {
      downloads: this.list(),
      settings: s,
      appVersion: app.getVersion(),
      downloadDir: s.downloadDir,
      diskFreeBytes: diskFreeBytes(s.downloadDir)
    }
    const rules = answerQuestion(snap, question)
    if (rules.intent !== 'fallback' || !s.assistantLocalModel) return rules
    const prompt = buildModelPrompt(snap, question, s.language)
    const text = await askLocalModel(
      {
        enabled: true,
        provider: s.localModelProvider,
        endpoint: s.localModelEndpoint,
        model: s.localModelName
      },
      prompt
    )
    if (!text) return rules
    return { intent: 'fallback', source: 'model', lines: [], modelText: text.trim() }
  }

  /**
   * Phase 7: the organizer folder for a download. When the rules say
   * Others AND the local model is enabled, ask it once (5s timeout) —
   * any failure falls back to Others silently.
   */
  private async organizeSaveDir(
    baseDir: string,
    filename: string,
    input: {
      kind: 'video' | 'audio' | 'file'
      site?: string | null
      duration?: number | null
      ytCategory?: string | null
      title?: string | null
    }
  ): Promise<string> {
    const s = this.settings.get()
    let category = categorize({ filename, ...input, overrides: s.organizerOverrides })
    if (category === 'Others' && s.localModelEnabled) {
      const modelCat = await askCategory(
        {
          enabled: s.localModelEnabled,
          provider: s.localModelProvider,
          endpoint: s.localModelEndpoint,
          model: s.localModelName
        },
        input.title ?? filename
      )
      if (modelCat) category = modelCat
    }
    return organizeDir(baseDir, category, s.organizerFolders)
  }

  private async startDownload(d: DownloadInfo): Promise<void> {
    if (d.engine === 'ytdlp') {
      await this.startYtDlp(d)
      return
    }
    // Phase 6: no aria2 on this platform — plain files go through yt-dlp.
    // Torrents cannot (yt-dlp has no torrent engine) — fail honestly.
    if (this.aria2 === null) {
      if (isTorrentUrl(d.url)) {
        this.fail(d, 'engine-missing', 'aria2 is not available on this platform')
        return
      }
      await this.startYtDlpPlain(d)
      return
    }
    const aria2 = this.aria2
    const s = this.settings.get()
    try {
      if (!aria2.isReady()) await aria2.start()
    } catch (err) {
      this.fail(d, 'engine-missing', (err as Error).message)
      return
    }
    if (d.totalBytes > 0) {
      const free = diskFreeBytes(s.downloadDir)
      if (free !== null && free < d.totalBytes) {
        this.fail(d, 'no-space', '')
        return
      }
    }
    const effLimit = this.effectiveLimitKBps(d)
    // Phase 7: Smart Download — connections from the measured network
    // class (fast 16 / medium 8 / slow 4). When Smart Download is off,
    // the Settings value is used as before.
    const conns = s.smartDownload ? this.adaptive.connections() : s.connectionsPerDownload
    this.lastAdaptiveConns = conns
    const opts: Record<string, string | string[]> = {
      dir: dirname(d.savePath),
      'max-connection-per-server': String(conns),
      split: String(conns),
      continue: 'true',
      'allow-overwrite': 'false',
      'auto-file-renaming': 'false',
      'max-overall-download-limit': s.speedLimitKBps > 0 ? String(s.speedLimitKBps * 1024) : '0',
      // Phase 7: per-download cap (0 = no cap beyond the global one).
      'max-download-limit': effLimit > 0 ? String(effLimit * 1024) : '0'
    }
    // Phase 4: aria2 ignores `out` for torrents — the real filename
    // comes from the torrent metadata (fixed up by the poll tick).
    if (!isTorrentUrl(d.url)) opts['out'] = basename(d.savePath)
    // Phase 3: proxy applies to aria2 too (yt-dlp gets it via baseArgs).
    if (s.proxyUrl) opts['all-proxy'] = s.proxyUrl
    // Phase 5: per-link headers the browser extension sent (User-Agent /
    // Referer / Cookie). aria2's `header` option takes a list of strings.
    const ext = this.extHeaders.get(d.id)
    if (ext && ext.length > 0) opts['header'] = ext
    try {
      const gid = await aria2.addUri(d.url, opts)
      // Phase 7: addUri does NOT apply the global option — aria2 keeps
      // whatever max-overall-download-limit it already had (e.g. 200 KB/s
      // from an earlier limit). Sync it explicitly, so a limit that was
      // raised back to unlimited (or changed) actually takes effect for
      // this download — and so a limit set in settings applies after an
      // aria2 restart, when the fresh process starts unlimited.
      try {
        await aria2.changeGlobalOption({
          'max-overall-download-limit': s.speedLimitKBps > 0 ? String(s.speedLimitKBps * 1024) : '0'
        })
      } catch {
        // Best-effort: the per-download cap still applies.
      }
      d.status = 'downloading'
      d.startedAt = d.startedAt ?? Date.now()
      d.errorCode = null
      d.errorMessage = null
      this.active.set(d.id, { gid, lastPersistedAt: Date.now() })
      this.db.updateDownload(d.id, {
        status: 'downloading',
        startedAt: d.startedAt,
        errorCode: null,
        errorMessage: null
      })
      this.emitStatus(d.id)
      this.ensurePoller()
    } catch (err) {
      this.fail(d, 'engine', (err as Error).message)
    }
  }

  private buildYtDlpOpts(d: DownloadInfo): YtDlpDownloadOpts {
    const state = parseYtDlpState(d.ytdlpState)
    return {
      url: d.url,
      savePath: d.savePath,
      formatString: d.formatString ?? '',
      kind: d.kind === 'audio' ? 'audio' : 'video',
      audioBitrate: state?.audioBitrate,
      subtitles: state?.subtitles ?? false,
      subLang: state?.subLang ?? 'en',
      embedThumbnail: state?.embedThumbnail ?? false,
      container: state?.container ?? 'mp4',
      useAria2: YTDLP_USE_ARIA2,
      clipStart: state?.clipStart ?? null,
      clipEnd: state?.clipEnd ?? null,
      embedMetadata: state?.embedMetadata ?? false,
      subMode: state?.subMode ?? 'embed',
      autoSubs: state?.autoSubs ?? false,
      thumbnailOnly: state?.thumbnailOnly ?? false,
      useArchive: state?.useArchive ?? false,
      cookiesFile: state?.extCookiesFile ?? null,
      userAgent: state?.userAgent ?? null,
      referer: state?.referer ?? null,
      // Phase 7: yt-dlp gets --limit-rate at start.
      speedLimitKBps: this.effectiveLimitKBps(d),
      // Phase 7: concurrent fragments from the measured network class.
      // A resumed download reuses stored lastArgs (old -N) — the new
      // fragment count applies to the NEXT FRESH download only.
      fragments: this.settings.get().smartDownload ? this.adaptive.fragments() : undefined
    }
  }

  /**
   * Phase 5: add a download sent by the browser extension's Local API.
   * The extension sends one URL with no quality choice — the app picks
   * the Settings defaults, exactly like the dialog's batch path:
   * torrents/plain files → aria2 (with the extension's headers when
   * given); videos → yt-dlp at the default quality, audio-only URLs as
   * 320kbps MP3. A playlist URL is refused with 'playlist' — picking
   * entries needs the app's Add dialog, and silently queueing a whole
   * playlist from one click would be a surprise.
   */
  async addFromExtension(
    url: string,
    opts: {
      kind?: 'video' | 'audio' | 'auto'
      quality?: string
      cookiesFile?: string | null
      userAgent?: string | null
      referer?: string | null
      headers?: string[]
    } = {}
  ): Promise<{
    ok: boolean
    id?: string
    error?: string
    errorDetail?: string
  }> {
    const trimmed = url.trim()
    let parsed: URL
    try {
      parsed = new URL(trimmed)
    } catch {
      return { ok: false, error: 'invalid-url' }
    }
    if (
      parsed.protocol !== 'http:' &&
      parsed.protocol !== 'https:' &&
      parsed.protocol !== 'magnet:'
    ) {
      return { ok: false, error: 'unsupported-url' }
    }
    const netOverride = {
      cookiesFile: opts.cookiesFile ?? null,
      userAgent: opts.userAgent ?? null,
      referer: opts.referer ?? null
    }
    const res = await this.fetchInfo(trimmed, netOverride)
    if (!res.ok) {
      return { ok: false, error: res.error ?? 'unknown', errorDetail: res.errorDetail }
    }
    if (res.torrent) {
      // Torrents never use the per-link cookies file — drop it so it
      // does not linger (the Local API only unlinks on failure).
      this.deleteExtCookiesFilePath(opts.cookiesFile ?? null)
      return this.add(trimmed)
    }
    if (res.plainFile) {
      const added = await this.add(trimmed)
      if (added.ok && added.id && opts.headers && opts.headers.length > 0) {
        this.extHeaders.set(added.id, opts.headers)
      }
      // Plain files get cookies as a request header, not a file.
      this.deleteExtCookiesFilePath(opts.cookiesFile ?? null)
      return added
    }
    if (res.playlist) {
      return { ok: false, error: 'playlist' }
    }
    if (!res.info) return { ok: false, error: 'unknown' }
    const s = this.settings.get()
    const info = res.info
    const hasVideo = info.formats.some((f) => f.height !== null)
    const kind: 'video' | 'audio' =
      opts.kind === 'video' || opts.kind === 'audio' ? opts.kind : hasVideo ? 'video' : 'audio'
    const container = s.videoContainer
    const name =
      kind === 'video'
        ? `${sanitizeFilename(info.title)}.${container}`
        : `${sanitizeFilename(info.title)}.mp3`
    const height =
      opts.quality && /^\d{3,4}$/.test(opts.quality) ? opts.quality : s.defaultVideoQuality
    const bitrate =
      opts.quality && ['320', '192', '128'].includes(opts.quality)
        ? opts.quality
        : s.defaultAudioBitrate
    // Security: the extension-supplied path is built through the
    // containment-checked helper — a hostile title can never escape the
    // download folder.
    const savePath = resolveDownloadPath(s.downloadDir, name)
    return this.addWithOptions({
      url: trimmed,
      kind,
      formatId: kind === 'video' ? `${height}p` : `mp3-${bitrate}`,
      formatString:
        kind === 'video' ? `bv*[height<=${height}]+ba/b[height<=${height}]` : 'bestaudio',
      qualityLabel: kind === 'video' ? `${height}p` : `${bitrate} kbps`,
      subtitles: false,
      subLang: s.subtitleLang,
      embedThumbnail: false,
      embedMetadata: s.embedMetadataDefault,
      clipStart: null,
      clipEnd: null,
      subMode: 'embed',
      autoSubs: false,
      thumbnailOnly: false,
      useArchive: false,
      extCookiesFile: opts.cookiesFile ?? null,
      userAgent: opts.userAgent ?? null,
      referer: opts.referer ?? null,
      savePath,
      filename: name,
      title: info.title,
      thumbnailUrl: info.thumbnail,
      // Phase 7: duplicate identity + smart filename inputs.
      videoId: info.videoId,
      extractor: info.extractor,
      height: kind === 'video' ? Number(height) : null,
      uploader: info.uploader
    })
  }

  private async startYtDlp(d: DownloadInfo): Promise<void> {
    if (!this.ytdlp) {
      this.fail(d, 'engine-missing', 'yt-dlp not configured')
      return
    }
    const s = this.settings.get()
    // Resume-state check (§8): bytes were downloaded before but no .part
    // file survives — the state is gone. Never silently restart from zero.
    if (d.doneBytes > 0 && !existsSync(d.savePath)) {
      const parts = ytdlpPartFiles(d.savePath)
      if (parts.length === 0) {
        this.fail(d, 'resume-state-mismatch', 'part file missing, doneBytes > 0')
        return
      }
    }
    if (d.totalBytes > 0) {
      const free = diskFreeBytes(s.downloadDir)
      if (free !== null && free < d.totalBytes) {
        this.fail(d, 'no-space', '')
        return
      }
    }
    const opts = this.buildYtDlpOpts(d)
    const state = parseYtDlpState(d.ytdlpState)
    // Phase 7: a resumed download reuses stored args — rewrite the limit
    // inside them so the CURRENT limit is what the new process gets.
    // Honest limit (proven by CLI test 2026-11-22): yt-dlp's HLS/DASH
    // resume keeps the ORIGINAL throttle — a changed limit does NOT take
    // effect on a resumed fragmented download, it takes effect on the
    // NEXT fresh download. aria2 resumes DO apply the new limit.
    const args =
      state?.lastArgs && state.lastArgs.length > 0
        ? rewriteLimitRate(state.lastArgs, this.effectiveLimitKBps(d))
        : this.ytdlp.buildArgs(opts)
    d.status = 'downloading'
    d.startedAt = d.startedAt ?? Date.now()
    d.errorCode = null
    d.errorMessage = null
    this.ytDlpArgs.set(d.id, args)
    this.db.updateDownload(d.id, {
      status: 'downloading',
      startedAt: d.startedAt,
      errorCode: null,
      errorMessage: null,
      ytdlpState: JSON.stringify({
        ...(state ?? {}),
        lastArgs: args,
        partExists: ytdlpPartFiles(d.savePath).length > 0
      })
    })
    this.emitStatus(d.id)
    // How many formats yt-dlp reported fully downloaded ('finished' fires
    // once per format file). The rename-race recovery below only runs when
    // at least one format verifiably finished.
    let finishedCount = 0
    const { job, done } = this.ytdlp.runDownload(args, {
      onProgress: (p) => {
        if (p.totalBytes > 0) d.totalBytes = p.totalBytes
        if (p.totalBytes > 0 || p.doneBytes > 0) d.doneBytes = p.doneBytes
        d.speedBps = p.speedBps
        d.etaSeconds = p.etaSeconds
        // Phase 7: feed the adaptive sampler (yt-dlp speeds).
        if (p.speedBps > 0) this.adaptive.sample(p.speedBps)
        if (p.status === 'finished') {
          finishedCount++
          if (d.status === 'downloading') {
            // All fragments are in — now merging/converting.
            d.status = 'processing'
            d.speedBps = 0
            d.etaSeconds = null
            this.db.updateDownload(d.id, {
              status: 'processing',
              totalBytes: d.totalBytes,
              doneBytes: d.doneBytes
            })
            this.emitStatus(d.id)
          }
          return
        }
        this.emitProgress(d)
      },
      onLog: () => {
        // Log tail lives on the job (used for "Copy details" on failure).
      }
    })
    this.active.set(d.id, { ytdlpJob: job })
    const { code, stderr } = await done
    // Pause/cancel already removed this job from `active` — ignore the exit.
    if (this.active.get(d.id)?.ytdlpJob !== job) return
    this.active.delete(d.id)
    this.ytDlpArgs.delete(d.id)
    if (code === 0) {
      // Phase 4: yt-dlp skipped this one — it is already in the download
      // archive. A file on disk means the earlier download is the result;
      // no file means it was downloaded before and skipped now.
      if (stderr.includes('has already been recorded in the archive')) {
        if (existsSync(d.savePath)) {
          await this.complete(d.id)
          return
        }
        this.fail(
          d,
          'already-downloaded',
          stderr.slice(0, 300) || 'already recorded in the download archive'
        )
        return
      }
      if (!existsSync(d.savePath)) {
        this.fail(d, 'unknown', stderr.slice(0, 300) || 'yt-dlp exited 0 but no output file')
        return
      }
      await this.complete(d.id)
      return
    }
    // Non-zero exit (or killed by something else). First: the Windows
    // rename race — yt-dlp finished downloading but its final rename hit a
    // transient file lock (WinError 32). If at least one format verifiably
    // finished, redo the rename + merge ourselves instead of failing a
    // download whose bytes are all on disk.
    if (stderr.includes('Unable to rename file') && finishedCount >= 1) {
      const state = parseYtDlpState(d.ytdlpState)
      const recovered = await this.ytdlp.recoverRenameRace(
        d.savePath,
        d.kind === 'audio' ? 'audio' : 'video',
        state?.audioBitrate ?? '320'
      )
      if (recovered) {
        await this.complete(d.id)
        return
      }
    }
    // Otherwise: map + retry with backoff.
    const mapped = mapEngineError(stderr)
    await this.handleError(d.id, stderr, mapped.code)
  }

  /**
   * Phase 6: plain-file download through yt-dlp — the aria2-missing
   * fallback on macOS/Linux. Same shape as startYtDlp (resume-state
   * check, progress events, map + retry), but no format selection, no
   * merge step and no rename-race recovery (a plain file has nothing to
   * merge). The row keeps engine 'aria2' in the DB, so a later restart
   * routes it here again.
   */
  private async startYtDlpPlain(d: DownloadInfo): Promise<void> {
    if (!this.ytdlp) {
      this.fail(d, 'engine-missing', 'yt-dlp not configured')
      return
    }
    const s = this.settings.get()
    // Resume-state check (§8): bytes were downloaded before but no .part
    // file survives — the state is gone. Never silently restart from zero.
    if (d.doneBytes > 0 && !existsSync(d.savePath)) {
      const parts = ytdlpPartFiles(d.savePath)
      if (parts.length === 0) {
        this.fail(d, 'resume-state-mismatch', 'part file missing, doneBytes > 0')
        return
      }
    }
    if (d.totalBytes > 0) {
      const free = diskFreeBytes(s.downloadDir)
      if (free !== null && free < d.totalBytes) {
        this.fail(d, 'no-space', '')
        return
      }
    }
    const ytdlp = this.ytdlp
    // Phase 7: same lastArgs rewrite as startYtDlp (same yt-dlp resume
    // caveat as above — the rewritten limit is passed, but a resumed
    // fragmented download keeps its original throttle).
    const stored = this.ytDlpArgs.get(d.id)
    const args = stored
      ? rewriteLimitRate(stored, this.effectiveLimitKBps(d))
      : ytdlp.buildPlainArgs(d.url, d.savePath, this.effectiveLimitKBps(d))
    d.status = 'downloading'
    d.startedAt = d.startedAt ?? Date.now()
    d.errorCode = null
    d.errorMessage = null
    this.ytDlpArgs.set(d.id, args)
    this.db.updateDownload(d.id, {
      status: 'downloading',
      startedAt: d.startedAt,
      errorCode: null,
      errorMessage: null
    })
    this.emitStatus(d.id)
    const { job, done } = ytdlp.runDownload(args, {
      onProgress: (p) => {
        if (p.totalBytes > 0) d.totalBytes = p.totalBytes
        if (p.totalBytes > 0 || p.doneBytes > 0) d.doneBytes = p.doneBytes
        d.speedBps = p.speedBps
        d.etaSeconds = p.etaSeconds
        // Phase 7: feed the adaptive sampler (yt-dlp speeds).
        if (p.speedBps > 0) this.adaptive.sample(p.speedBps)
        if (p.status === 'finished') {
          if (d.status === 'downloading') {
            // All bytes are in — yt-dlp is doing the final rename.
            d.status = 'processing'
            d.speedBps = 0
            d.etaSeconds = null
            this.db.updateDownload(d.id, {
              status: 'processing',
              totalBytes: d.totalBytes,
              doneBytes: d.doneBytes
            })
            this.emitStatus(d.id)
          }
          return
        }
        this.emitProgress(d)
      },
      onLog: () => {
        // Log tail lives on the job (used for "Copy details" on failure).
      }
    })
    this.active.set(d.id, { ytdlpJob: job })
    const { code, stderr } = await done
    // Pause/cancel already removed this job from `active` — ignore the exit.
    if (this.active.get(d.id)?.ytdlpJob !== job) return
    this.active.delete(d.id)
    this.ytDlpArgs.delete(d.id)
    if (code === 0) {
      if (!existsSync(d.savePath)) {
        this.fail(d, 'unknown', stderr.slice(0, 300) || 'yt-dlp exited 0 but no output file')
        return
      }
      await this.complete(d.id)
      return
    }
    // Otherwise: map + retry with backoff.
    const mapped = mapEngineError(stderr)
    await this.handleError(d.id, stderr, mapped.code)
  }

  private ensurePoller(): void {
    if (this.pollTimer) return
    this.pollTimer = setInterval(() => void this.pollTick(), 500)
  }

  private stopPoller(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer)
      this.pollTimer = null
    }
  }

  private async pollTick(): Promise<void> {
    const hasAria2 = [...this.active.values()].some((e) => e.gid)
    if (!hasAria2) {
      this.stopPoller()
      return
    }
    // Phase 6: a gid can only exist when aria2 exists, but the field is
    // nullable now — narrow it once for the whole tick.
    const aria2 = this.aria2
    if (!aria2) {
      this.stopPoller()
      return
    }
    for (const [id, entry] of [...this.active.entries()]) {
      const d = this.downloads.get(id)
      if (!d) {
        this.active.delete(id)
        continue
      }
      if (!entry.gid) continue // yt-dlp pushes progress; it is never polled.
      try {
        const st = await aria2.tellStatus(entry.gid)
        const total = Number(st.totalLength || 0)
        const done = Number(st.completedLength || 0)
        const speed = Number(st.downloadSpeed || 0)
        // aria2 reports 0/0 before it has fetched headers — never let those
        // early ticks clobber the known size / done bytes (e.g. from HEAD or
        // a previous session).
        if (total > 0) d.totalBytes = total
        if (total > 0 || done > 0) d.doneBytes = done
        d.speedBps = speed
        // Phase 7: feed the adaptive sampler (aria2 speeds, 500ms ticks).
        if (speed > 0) this.adaptive.sample(speed)
        d.etaSeconds =
          speed > 0 && d.totalBytes > d.doneBytes
            ? Math.round((d.totalBytes - d.doneBytes) / speed)
            : null

        // Phase 4: torrents ignore aria2's `out` — the real file path
        // comes from the torrent metadata. Fix the row up on first sight.
        if (isTorrentUrl(d.url)) {
          const realPath = st.files?.[0]?.path
          if (realPath && realPath !== d.savePath) {
            d.filename = basename(realPath)
            d.savePath = realPath
            this.db.updateDownload(id, { filename: d.filename, savePath: realPath })
          }
        }

        // Disk filled up mid-download: pause with a clear reason.
        if (total > 0) {
          const free = diskFreeBytes(this.settings.get().downloadDir)
          if (free !== null && free + done < total) {
            await this.pause(id)
            this.fail(d, 'no-space', '')
            continue
          }
        }

        this.emitProgress(d)
        const now = Date.now()
        if (now - (entry.lastPersistedAt ?? 0) > 5000) {
          this.db.updateDownload(id, { totalBytes: total, doneBytes: done })
          entry.lastPersistedAt = now
        }

        if (st.status === 'complete' && st.followedBy?.length) {
          // Magnet link: aria2 first completes a tiny metadata download
          // (~165 bytes), then starts the real file download under a new
          // GID. Follow it — marking the row complete here would report
          // a "completed" torrent whose file is just the metadata blob.
          const nextGid = st.followedBy[0]
          try {
            await aria2.removeDownloadResult(entry.gid)
          } catch {
            // Session cleanup is best-effort.
          }
          entry.gid = nextGid
          entry.lastPersistedAt = Date.now()
          continue
        }
        if (st.status === 'complete') {
          await this.complete(id)
        } else if (st.status === 'error') {
          await this.handleError(id, st.errorMessage ?? st.errorCode ?? 'aria2 error')
        } else if (st.status === 'removed') {
          this.active.delete(id)
        }
      } catch (err) {
        const msg = (err as Error).message.toLowerCase()
        if (msg.includes('not found') || msg.includes('no such')) {
          // gid is gone (aria2 restarted) — keep the partial file, let the
          // user resume; the DB already holds the done bytes.
          this.active.delete(id)
          if (d.status === 'downloading') {
            d.status = 'paused'
            this.db.updateDownload(id, { status: 'paused' })
            this.emitStatus(id)
          }
        }
        // Other RPC errors (aria2 mid-restart) — next tick retries.
      }
    }
    // Phase 7: live connection adjustment — every ~10s, if the measured
    // class changed, retune the active aria2 downloads. Best-effort:
    // aria2 may ignore changeOption for a finished/queued gid, and the
    // next FRESH download always uses the new value.
    if (this.settings.get().smartDownload) {
      const now = Date.now()
      const conns = this.adaptive.connections()
      if (now - this.lastAdaptiveAt >= 10_000 && conns !== this.lastAdaptiveConns) {
        this.lastAdaptiveAt = now
        this.lastAdaptiveConns = conns
        for (const aentry of [...this.active.values()]) {
          if (!aentry.gid) continue
          try {
            await aria2.changeOption(aentry.gid, {
              'max-connection-per-server': String(conns),
              split: String(conns)
            })
          } catch {
            // Best-effort — the next fresh download uses the new value.
          }
        }
        logMain('info', `smartDownload: live connections -> ${conns} (${this.adaptive.classify()})`)
      }
    }
    if (![...this.active.values()].some((e) => e.gid)) this.stopPoller()
  }

  private async complete(id: string): Promise<void> {
    const d = this.downloads.get(id)
    if (!d) return
    const entry = this.active.get(id)
    this.active.delete(id)
    if (entry?.gid) {
      const aria2 = this.aria2
      if (aria2) {
        try {
          await aria2.removeDownloadResult(entry.gid)
        } catch {
          // Session cleanup is best-effort.
        }
      }
    }
    d.status = 'completed'
    // Phase 6: a fallback row's totals come from the file, like a yt-dlp
    // row's — yt-dlp may never have reported a total for a plain file.
    if (d.engine === 'ytdlp' || this.isFallbackRow(d)) {
      // yt-dlp may never have reported a total — take it from the file.
      try {
        const size = statSync(d.savePath).size
        d.doneBytes = size
        if (d.totalBytes <= 0) d.totalBytes = size
      } catch {
        // Keep the progress values.
      }
    } else {
      d.doneBytes = d.totalBytes
    }
    d.speedBps = 0
    d.etaSeconds = null
    d.completedAt = Date.now()
    // Phase 5: the per-link extension cookies file is no longer needed —
    // a completed download never re-runs (re-download builds fresh opts).
    this.deleteExtCookiesFile(d)
    this.db.updateDownload(id, {
      status: 'completed',
      totalBytes: d.totalBytes,
      doneBytes: d.doneBytes,
      completedAt: d.completedAt
    })
    this.emitStatus(id)
    // Security: Mark-of-the-Web + Defender scan (best-effort, never
    // blocks completion — a threat only warns, it never fails the file).
    void this.runPostDownloadSecurity(d)
    void this.pump()
  }

  /**
   * Security: after a download completes, tag the file with the
   * Mark-of-the-Web and scan it with Windows Defender. Fire-and-forget —
   * the download is already complete; a threat only warns (toast + log),
   * it never fails or deletes the download.
   */
  private async runPostDownloadSecurity(d: DownloadInfo): Promise<void> {
    try {
      const { motwApplied, scan } = await applyPostDownloadSecurity(d.savePath, findMpCmdRun())
      if (scan === 'threat') {
        logMain(
          'warn',
          `defender: threat found in ${d.filename} — file left in place, delete it if untrusted`
        )
        this.emitToast({ key: 'toast.defenderThreat', params: { filename: d.filename } })
      } else {
        logMain(
          'info',
          `post-download security: ${d.filename} motw=${motwApplied} defender=${scan}`
        )
      }
    } catch (err) {
      logMain('error', `post-download security failed: ${(err as Error).message}`)
    }
  }

  private async handleError(id: string, raw: string, codeOverride?: string): Promise<void> {
    const d = this.downloads.get(id)
    if (!d) return
    this.active.delete(id)
    const mapped = codeOverride ? { code: codeOverride, raw } : mapEngineError(raw)
    // A resume-state mismatch is a user decision, never an auto-retry.
    if (mapped.code === 'resume-state-mismatch') {
      this.fail(d, mapped.code, raw)
      return
    }
    // Phase 7: Smart Download — network failures feed the classifier.
    if (mapped.code === 'network' || mapped.code === 'timeout') {
      this.adaptive.noteFailure()
    }
    const retries = this.retryCount.get(id) ?? 0
    const maxRetry = this.settings.get().autoRetry
    if (retries < maxRetry) {
      this.retryCount.set(id, retries + 1)
      d.status = 'queued'
      d.speedBps = 0
      d.etaSeconds = null
      this.db.updateDownload(id, { status: 'queued' })
      this.emitStatus(id)
      this.emitToast({ key: 'toast.retrying', params: { n: retries + 1, max: maxRetry } })
      // Phase 7: retry gaps stretch when the network is slow/unstable.
      const delays = this.settings.get().smartDownload
        ? this.adaptive.retryDelaysMs()
        : RETRY_DELAYS_MS
      const delay = delays[Math.min(retries, delays.length - 1)]
      setTimeout(() => void this.pump(), delay)
      return
    }
    this.fail(d, mapped.code, raw)
  }

  private fail(d: DownloadInfo, code: string, raw: string): void {
    this.active.delete(d.id)
    d.status = 'failed'
    d.speedBps = 0
    d.etaSeconds = null
    d.errorCode = code
    d.errorMessage = raw ? raw.slice(0, 300) : null
    this.db.updateDownload(d.id, {
      status: 'failed',
      errorCode: code,
      errorMessage: d.errorMessage
    })
    this.emitStatus(d.id)
    void this.pump()
  }

  private async handleAria2Death(): Promise<void> {
    if (this.shutDown) return
    const wasDownloading = [...this.downloads.values()].filter(
      (d) => d.status === 'downloading' && d.engine === 'aria2'
    )
    this.active.clear()
    this.stopPoller()
    for (const d of wasDownloading) {
      d.status = 'queued'
      this.db.updateDownload(d.id, { status: 'queued' })
      this.emitStatus(d.id)
    }
    this.aria2Restarts++
    if (this.aria2Restarts > MAX_ARIA2_RESTARTS) {
      for (const d of wasDownloading) {
        d.status = 'paused'
        this.db.updateDownload(d.id, { status: 'paused' })
        this.emitStatus(d.id)
      }
      this.emitToast({ key: 'toast.engineDied' })
      return
    }
    await new Promise((r) => setTimeout(r, 2000))
    // Phase 6: without aria2 there is nothing to restart — and this
    // handler is only wired when aria2 exists, so this is a guard only.
    const aria2 = this.aria2
    if (!aria2) return
    try {
      await aria2.start()
      this.aria2Restarts = 0
      await this.pump()
    } catch {
      void this.handleAria2Death()
    }
  }

  private deletePartialFiles(d: DownloadInfo): void {
    const paths = [d.savePath, `${d.savePath}.aria2`, ...ytdlpPartFiles(d.savePath)]
    for (const p of paths) {
      try {
        if (existsSync(p)) unlinkSync(p)
      } catch {
        // Best effort — a locked file stays until the next attempt.
      }
    }
  }

  private deleteYtDlpPartials(savePath: string): void {
    for (const p of ytdlpPartFiles(savePath)) {
      try {
        if (existsSync(p)) unlinkSync(p)
      } catch {
        // Best effort.
      }
    }
  }

  private emitProgress(d: DownloadInfo): void {
    const payload: ProgressEvent = {
      id: d.id,
      doneBytes: d.doneBytes,
      totalBytes: d.totalBytes,
      speedBps: d.speedBps,
      etaSeconds: d.etaSeconds,
      status: d.status
    }
    this.emit('progress', payload)
  }

  private emitStatus(id: string): void {
    const d = this.downloads.get(id)
    if (!d) return
    const payload: StatusEvent = {
      id: d.id,
      status: d.status,
      errorCode: d.errorCode,
      errorMessage: d.errorMessage
    }
    this.emit('status', payload)
  }

  private emitToast(t: ToastEvent): void {
    this.emit('toast', t)
  }
}
