import { EventEmitter } from 'node:events'
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, unlinkSync } from 'node:fs'
import { basename, dirname } from 'node:path'
import type { DoviraDb } from './db'
import type { SettingsManager } from './settings'
import type { Aria2Manager } from './engines/aria2'
import { categorize } from './smart/categorize'
import { sanitizeFilename, resolveUniquePath, filenameFromUrl } from './util/filename'
import { mapEngineError } from './util/errors'
import { diskFreeBytes } from './util/paths'
import type { DownloadInfo, DownloadKind, ProgressEvent, StatusEvent, ToastEvent } from './types'

interface ActiveEntry {
  gid: string
  lastPersistedAt: number
}

const MIN_FREE_BYTES = 50 * 1024 * 1024
const MAX_ARIA2_RESTARTS = 3
/** Retry backoff between auto-retries: a short outage (up to ~25s) is bridged
 * without burning all retries in the first seconds. */
const RETRY_DELAYS_MS = [2000, 5000, 15000]

function kindFromCategory(filename: string): DownloadKind {
  const category = categorize({ filename })
  if (category === 'Video') return 'video'
  if (category === 'Music') return 'audio'
  return 'file'
}

/**
 * Owns download state: the queue, concurrency, pause/resume/cancel/retry,
 * progress polling (~500ms), persistence cadence (status change + ~5s),
 * disk-space checks and aria2 crash recovery. Plain Node — no Electron
 * imports, so it can be tested outside the app.
 */
export class QueueManager extends EventEmitter {
  private downloads = new Map<string, DownloadInfo>()
  private active = new Map<string, ActiveEntry>()
  private retryCount = new Map<string, number>()
  private pollTimer: ReturnType<typeof setInterval> | null = null
  private pumping = false
  private aria2Restarts = 0
  private shutDown = false

  constructor(
    private db: DoviraDb,
    private settings: SettingsManager,
    private aria2: Aria2Manager
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

  async add(url: string): Promise<{ ok: boolean; id?: string; error?: string }> {
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
    const free = diskFreeBytes(s.downloadDir)
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
    mkdirSync(s.downloadDir, { recursive: true })
    const savePath = resolveUniquePath(s.downloadDir, filename)
    const id = randomUUID()
    const info: DownloadInfo = {
      id,
      url,
      filename: basename(savePath),
      savePath,
      kind: kindFromCategory(filename),
      status: 'queued',
      totalBytes,
      doneBytes: 0,
      speedBps: 0,
      etaSeconds: null,
      errorCode: null,
      errorMessage: null,
      site: parsed.hostname,
      createdAt: Date.now(),
      startedAt: null,
      completedAt: null
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
      createdAt: info.createdAt
    })
    this.downloads.set(id, info)
    this.emitStatus(id)
    void this.pump()
    return { ok: true, id }
  }

  async pause(id: string): Promise<boolean> {
    const d = this.downloads.get(id)
    if (!d || d.status !== 'downloading') return false
    const entry = this.active.get(id)
    if (entry) {
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
    // If the partial file is gone, the done-bytes count is meaningless.
    if (!existsSync(d.savePath)) d.doneBytes = 0
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
    return this.resume(id)
  }

  async cancel(id: string): Promise<boolean> {
    const d = this.downloads.get(id)
    if (!d) return false
    const entry = this.active.get(id)
    if (entry) {
      try {
        await this.aria2.remove(entry.gid)
      } catch {
        // Already gone — continue with local cleanup.
      }
      this.active.delete(id)
    }
    this.deletePartialFiles(d.savePath)
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
    if (entry) {
      try {
        await this.aria2.remove(entry.gid)
      } catch {
        // Already gone — continue with local cleanup.
      }
      this.active.delete(id)
    }
    if (deleteFile) {
      this.deletePartialFiles(d.savePath)
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
    if (this.active.size === 0) {
      this.stopPoller()
      return
    }
    for (const [id, entry] of [...this.active.entries()]) {
      const d = this.downloads.get(id)
      if (!d) {
        this.active.delete(id)
        continue
      }
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
        if (now - entry.lastPersistedAt > 5000) {
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
    if (this.active.size === 0) this.stopPoller()
  }

  private async complete(id: string): Promise<void> {
    const d = this.downloads.get(id)
    if (!d) return
    const entry = this.active.get(id)
    this.active.delete(id)
    if (entry) {
      try {
        await this.aria2.removeDownloadResult(entry.gid)
      } catch {
        // Session cleanup is best-effort.
      }
    }
    d.status = 'completed'
    d.doneBytes = d.totalBytes
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

  private async handleError(id: string, raw: string): Promise<void> {
    const d = this.downloads.get(id)
    if (!d) return
    this.active.delete(id)
    const mapped = mapEngineError(raw)
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
    const wasDownloading = [...this.downloads.values()].filter((d) => d.status === 'downloading')
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

  private deletePartialFiles(savePath: string): void {
    for (const p of [savePath, `${savePath}.aria2`]) {
      try {
        if (existsSync(p)) unlinkSync(p)
      } catch {
        // Best effort — a locked file stays until the next attempt.
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
