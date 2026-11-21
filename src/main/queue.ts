import { EventEmitter } from 'node:events'
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, statSync, unlinkSync } from 'node:fs'
import { basename, dirname } from 'node:path'
import type { DoviraDb } from './db'
import type { SettingsManager } from './settings'
import type { Aria2Manager } from './engines/aria2'
import {
  YtDlpManager,
  YtDlpError,
  ytdlpPartFiles,
  type YtDlpDownload,
  type YtDlpDownloadOpts
} from './engines/ytdlp'
import { categorize } from './smart/categorize'
import { sanitizeFilename, resolveUniquePath, filenameFromUrl } from './util/filename'
import { mapEngineError } from './util/errors'
import { diskFreeBytes } from './util/paths'
import type {
  AddOptions,
  DownloadInfo,
  DownloadKind,
  PlainFileInfo,
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

  constructor(
    private db: DoviraDb,
    private settings: SettingsManager,
    private aria2: Aria2Manager,
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
    this.aria2.onUnexpectedExit = () => void this.handleAria2Death()
  }

  list(): DownloadInfo[] {
    return [...this.downloads.values()].sort((a, b) => b.createdAt - a.createdAt)
  }

  get(id: string): DownloadInfo | undefined {
    return this.downloads.get(id)
  }

  /**
   * Route a pasted link: plain-file extension → aria2 info (HEAD);
   * video site or anything else → yt-dlp info; on yt-dlp failure, a HEAD
   * request decides whether it is a plain file after all (§2).
   */
  async fetchInfo(
    url: string
  ): Promise<{ ok: boolean; info?: VideoInfo; plainFile?: PlainFileInfo; error?: string }> {
    let parsed: URL
    try {
      parsed = new URL(url.trim())
    } catch {
      return { ok: false, error: 'invalid-url' }
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return { ok: false, error: 'unsupported-url' }
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
        const info = await this.ytdlp.fetchInfo(url.trim())
        return { ok: true, info }
      } catch (err) {
        const code = err instanceof YtDlpError ? err.code : 'unknown'
        if (code === 'unsupported' || code === 'unknown' || code === 'not-found') {
          const pf = await this.headPlainFile(url.trim())
          if (pf) return { ok: true, plainFile: pf }
        }
        return { ok: false, error: code }
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
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return { ok: false, error: 'unsupported-url' }
    }
    const s = this.settings.get()
    const dir = saveDir ?? s.downloadDir
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
    let filename = filenameFromUrl(url)
    let totalBytes = 0
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
    if (totalBytes > 0 && free !== null && free < totalBytes) {
      return { ok: false, error: 'no-space' }
    }

    filename = sanitizeFilename(filename)
    mkdirSync(dir, { recursive: true })
    const savePath = resolveUniquePath(dir, filename)
    const id = randomUUID()
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
      createdAt: Date.now(),
      startedAt: null,
      completedAt: null,
      engine: 'aria2',
      formatString: null,
      ytdlpState: null
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
      engine: 'aria2'
    })
    this.downloads.set(id, info)
    this.emitStatus(id)
    void this.pump()
    return { ok: true, id }
  }

  /** Video/audio download with the dialog's chosen format (yt-dlp engine). */
  async addWithOptions(opts: AddOptions): Promise<{ ok: boolean; id?: string; error?: string }> {
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

    const filename = sanitizeFilename(opts.filename)
    const dir = dirname(opts.savePath)
    mkdirSync(dir, { recursive: true })
    const savePath = resolveUniquePath(dir, filename)
    const id = randomUUID()
    const state: YtDlpState = {
      subtitles: opts.subtitles,
      subLang: opts.subLang,
      embedThumbnail: opts.embedThumbnail,
      audioBitrate: opts.kind === 'audio' ? opts.qualityLabel.replace(/[^0-9]/g, '') : undefined,
      container: opts.kind === 'video' ? 'mp4' : undefined
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
      createdAt: Date.now(),
      startedAt: null,
      completedAt: null,
      engine: 'ytdlp',
      formatString: opts.formatString,
      ytdlpState: JSON.stringify(state)
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
      engine: 'ytdlp',
      formatId: opts.formatId,
      formatString: opts.formatString,
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
    if (d.engine === 'ytdlp') {
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
      try {
        await this.aria2.pause(entry.gid)
      } catch {
        // gid may be stale (aria2 restarted) — local state still wins.
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
    if (d.engine === 'ytdlp') {
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
      // NOTE: do NOT zero doneBytes here — startYtDlp needs it to detect a
      // missing .part file (resume-state-mismatch) instead of silently
      // restarting from zero.
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
    if (d?.engine === 'ytdlp' && d.errorCode === 'resume-state-mismatch') {
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
    if (d.engine === 'ytdlp') {
      if (entry?.ytdlpJob) {
        entry.ytdlpJob.kill()
        this.active.delete(id)
      }
      this.ytDlpArgs.delete(id)
    } else if (entry?.gid) {
      try {
        await this.aria2.remove(entry.gid)
      } catch {
        // Already gone — continue with local cleanup.
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

  async remove(id: string, deleteFile: boolean): Promise<boolean> {
    const d = this.downloads.get(id)
    if (!d) return false
    const entry = this.active.get(id)
    if (d.engine === 'ytdlp') {
      if (entry?.ytdlpJob) {
        entry.ytdlpJob.kill()
        this.active.delete(id)
      }
      this.ytDlpArgs.delete(id)
    } else if (entry?.gid) {
      try {
        await this.aria2.remove(entry.gid)
      } catch {
        // Already gone — continue with local cleanup.
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
    this.downloads.delete(id)
    this.db.deleteDownload(id)
    void this.pump()
    return true
  }

  shutdown(): void {
    this.shutDown = true
    this.stopPoller()
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
        const next = [...this.downloads.values()]
          .filter((d) => d.status === 'queued')
          .sort((a, b) => a.createdAt - b.createdAt)[0]
        if (!next) return
        await this.startDownload(next)
      }
    } finally {
      this.pumping = false
    }
  }

  private async startDownload(d: DownloadInfo): Promise<void> {
    if (d.engine === 'ytdlp') {
      await this.startYtDlp(d)
      return
    }
    const s = this.settings.get()
    try {
      if (!this.aria2.isReady()) await this.aria2.start()
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
    const opts: Record<string, string> = {
      dir: dirname(d.savePath),
      out: basename(d.savePath),
      'max-connection-per-server': String(s.connectionsPerDownload),
      split: String(s.connectionsPerDownload),
      continue: 'true',
      'allow-overwrite': 'false',
      'auto-file-renaming': 'false',
      'max-overall-download-limit': s.speedLimitKBps > 0 ? String(s.speedLimitKBps * 1024) : '0'
    }
    try {
      const gid = await this.aria2.addUri(d.url, opts)
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
      useAria2: YTDLP_USE_ARIA2
    }
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
    const args =
      state?.lastArgs && state.lastArgs.length > 0 ? state.lastArgs : this.ytdlp.buildArgs(opts)
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
    for (const [id, entry] of [...this.active.entries()]) {
      const d = this.downloads.get(id)
      if (!d) {
        this.active.delete(id)
        continue
      }
      if (!entry.gid) continue // yt-dlp pushes progress; it is never polled.
      try {
        const st = await this.aria2.tellStatus(entry.gid)
        const total = Number(st.totalLength || 0)
        const done = Number(st.completedLength || 0)
        const speed = Number(st.downloadSpeed || 0)
        // aria2 reports 0/0 before it has fetched headers — never let those
        // early ticks clobber the known size / done bytes (e.g. from HEAD or
        // a previous session).
        if (total > 0) d.totalBytes = total
        if (total > 0 || done > 0) d.doneBytes = done
        d.speedBps = speed
        d.etaSeconds =
          speed > 0 && d.totalBytes > d.doneBytes
            ? Math.round((d.totalBytes - d.doneBytes) / speed)
            : null

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
    if (![...this.active.values()].some((e) => e.gid)) this.stopPoller()
  }

  private async complete(id: string): Promise<void> {
    const d = this.downloads.get(id)
    if (!d) return
    const entry = this.active.get(id)
    this.active.delete(id)
    if (entry?.gid) {
      try {
        await this.aria2.removeDownloadResult(entry.gid)
      } catch {
        // Session cleanup is best-effort.
      }
    }
    d.status = 'completed'
    if (d.engine === 'ytdlp') {
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
    this.db.updateDownload(id, {
      status: 'completed',
      totalBytes: d.totalBytes,
      doneBytes: d.doneBytes,
      completedAt: d.completedAt
    })
    this.emitStatus(id)
    void this.pump()
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
      const delay = RETRY_DELAYS_MS[Math.min(retries, RETRY_DELAYS_MS.length - 1)]
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
    try {
      await this.aria2.start()
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
