import { DatabaseSync } from 'node:sqlite'
import { copyFileSync, existsSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import type {
  DownloadInfo,
  DownloadKind,
  DownloadStatus,
  Subscription,
  SubscriptionVideo
} from './types'

interface DownloadRow {
  id: string
  url: string
  title: string | null
  filename: string
  save_path: string
  kind: string
  format_label: string | null
  status: string
  total_bytes: number
  done_bytes: number
  error_code: string | null
  error_message: string | null
  thumbnail_url: string | null
  site: string | null
  remote_id: string | null
  engine: string
  engine_ref: string | null
  format_id: string | null
  format_string: string | null
  ytdlp_state: string | null
  sort_order: number
  speed_limit_kbps: number
  pinned: number
  created_at: number
  started_at: number | null
  completed_at: number | null
}

interface SubscriptionRow {
  id: string
  url: string
  title: string
  uploader: string | null
  last_video_id: string | null
  last_checked_at: number | null
  created_at: number
  pending: string
}

export interface DownloadInsert {
  id: string
  url: string
  title?: string | null
  filename: string
  savePath: string
  kind: DownloadKind
  formatLabel?: string | null
  status: DownloadStatus
  totalBytes: number
  doneBytes: number
  errorCode?: string | null
  errorMessage?: string | null
  thumbnailUrl?: string | null
  site?: string | null
  remoteId?: string | null
  engine?: string
  engineRef?: string | null
  formatId?: string | null
  formatString?: string | null
  ytdlpState?: string | null
  sortOrder?: number
  /** Phase 7: per-download speed limit in KB/s, 0 = use the global limit. */
  speedLimitKBps?: number
  /** Next-level: pinned to the top of the queue. */
  pinned?: boolean
  createdAt: number
  startedAt?: number | null
  completedAt?: number | null
}

export interface DownloadPatch {
  status?: DownloadStatus
  totalBytes?: number
  doneBytes?: number
  errorCode?: string | null
  errorMessage?: string | null
  startedAt?: number | null
  completedAt?: number | null
  engineRef?: string | null
  filename?: string
  savePath?: string
  title?: string | null
  thumbnailUrl?: string | null
  formatLabel?: string | null
  formatString?: string | null
  ytdlpState?: string | null
  sortOrder?: number
  speedLimitKBps?: number
  /** Next-level: pinned to the top of the queue. */
  pinned?: boolean
}

/**
 * One migration per schema step. A new release adds a new entry — never edits
 * an old one (§4). Applied in order on open; a backup is taken first.
 */
const MIGRATIONS: { version: number; sql: string }[] = [
  {
    version: 1,
    sql: `
      CREATE TABLE IF NOT EXISTS downloads (
        id TEXT PRIMARY KEY,
        url TEXT NOT NULL,
        title TEXT,
        filename TEXT NOT NULL,
        save_path TEXT NOT NULL,
        kind TEXT NOT NULL DEFAULT 'file',
        format_label TEXT,
        status TEXT NOT NULL,
        total_bytes INTEGER NOT NULL DEFAULT 0,
        done_bytes INTEGER NOT NULL DEFAULT 0,
        error_code TEXT,
        error_message TEXT,
        thumbnail_url TEXT,
        site TEXT,
        remote_id TEXT,
        engine TEXT NOT NULL DEFAULT 'aria2',
        engine_ref TEXT,
        created_at INTEGER NOT NULL,
        started_at INTEGER,
        completed_at INTEGER
      );
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_downloads_status ON downloads(status);
      CREATE INDEX IF NOT EXISTS idx_downloads_created ON downloads(created_at);
    `
  },
  {
    // Phase 2: yt-dlp resume state — the exact format selector + the
    // .part/.ytdl state, so resume always reuses the SAME format (§8).
    version: 2,
    sql: `
      ALTER TABLE downloads ADD COLUMN format_id TEXT;
      ALTER TABLE downloads ADD COLUMN format_string TEXT;
      ALTER TABLE downloads ADD COLUMN ytdlp_state TEXT;
    `
  },
  {
    // Phase 3: queue position — lower sort_order starts first. Backfilled
    // from created_at so existing history keeps its relative order.
    version: 3,
    sql: `
      ALTER TABLE downloads ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0;
      UPDATE downloads SET sort_order = created_at;
      CREATE INDEX IF NOT EXISTS idx_downloads_sort ON downloads(sort_order);
    `
  },
  {
    // Phase 7: per-download speed limit (KB/s, 0 = use the global limit).
    version: 4,
    sql: `
      ALTER TABLE downloads ADD COLUMN speed_limit_kbps INTEGER NOT NULL DEFAULT 0;
    `
  },
  {
    // Next-level: pinned queue rows (pin sorts before sort_order) +
    // channel subscriptions (local polling, no server).
    version: 5,
    sql: `
      ALTER TABLE downloads ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0;
      CREATE TABLE IF NOT EXISTS subscriptions (
        id TEXT PRIMARY KEY,
        url TEXT NOT NULL UNIQUE,
        title TEXT NOT NULL,
        uploader TEXT,
        last_video_id TEXT,
        last_checked_at INTEGER,
        created_at INTEGER NOT NULL,
        pending TEXT NOT NULL DEFAULT '[]'
      );
    `
  }
]

function rowToInfo(row: DownloadRow): DownloadInfo {
  return {
    id: row.id,
    url: row.url,
    title: row.title,
    filename: row.filename,
    savePath: row.save_path,
    kind: (row.kind as DownloadKind) || 'file',
    formatLabel: row.format_label,
    status: row.status as DownloadStatus,
    totalBytes: row.total_bytes,
    doneBytes: row.done_bytes,
    speedBps: 0,
    etaSeconds: null,
    errorCode: row.error_code,
    errorMessage: row.error_message,
    thumbnailUrl: row.thumbnail_url,
    site: row.site,
    createdAt: row.created_at,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    engine: (row.engine as DownloadInfo['engine']) || 'aria2',
    formatId: row.format_id,
    formatString: row.format_string,
    ytdlpState: row.ytdlp_state,
    sortOrder: row.sort_order ?? row.created_at,
    speedLimitKBps: row.speed_limit_kbps ?? 0,
    pinned: row.pinned === 1
  }
}

function rowToSubscription(row: SubscriptionRow): Subscription {
  let pending: SubscriptionVideo[] = []
  try {
    const parsed: unknown = JSON.parse(row.pending)
    if (Array.isArray(parsed)) pending = parsed as SubscriptionVideo[]
  } catch {
    pending = []
  }
  return {
    id: row.id,
    url: row.url,
    title: row.title,
    uploader: row.uploader,
    lastVideoId: row.last_video_id,
    lastCheckedAt: row.last_checked_at,
    createdAt: row.created_at,
    pending
  }
}

export class DoviraDb {
  private db: DatabaseSync

  constructor(dbPath: string) {
    mkdirSync(dirname(dbPath), { recursive: true })
    this.db = new DatabaseSync(dbPath)
    this.db.exec('PRAGMA journal_mode = WAL;')
    this.migrate(dbPath)
  }

  private currentVersion(): number {
    const row = this.db.prepare('PRAGMA user_version').get() as { user_version: number }
    return row?.user_version ?? 0
  }

  private migrate(dbPath: string): void {
    const current = this.currentVersion()
    const pending = MIGRATIONS.filter((m) => m.version > current)
    if (pending.length === 0) return
    // Backup before touching the schema — history loss is data loss (§4).
    if (existsSync(dbPath)) {
      try {
        copyFileSync(dbPath, `${dbPath}.bak`)
      } catch {
        // Backup is best-effort; a failure here must not block the migration.
      }
    }
    for (const m of pending) {
      try {
        this.db.exec(m.sql)
        this.db.exec(`PRAGMA user_version = ${m.version}`)
      } catch (err) {
        // Never wipe user data and start fresh. Surface the failure instead.
        throw new Error(
          `Database migration to version ${m.version} failed. ` +
            `A backup was kept at ${dbPath}.bak — restore it and try again.`,
          { cause: err }
        )
      }
    }
  }

  insertDownload(d: DownloadInsert): void {
    this.db
      .prepare(
        `INSERT INTO downloads
          (id, url, title, filename, save_path, kind, format_label, status,
           total_bytes, done_bytes, error_code, error_message, thumbnail_url,
           site, remote_id, engine, engine_ref, format_id, format_string,
           ytdlp_state, sort_order, speed_limit_kbps, pinned, created_at, started_at, completed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        d.id,
        d.url,
        d.title ?? null,
        d.filename,
        d.savePath,
        d.kind,
        d.formatLabel ?? null,
        d.status,
        d.totalBytes,
        d.doneBytes,
        d.errorCode ?? null,
        d.errorMessage ?? null,
        d.thumbnailUrl ?? null,
        d.site ?? null,
        d.remoteId ?? null,
        d.engine ?? 'aria2',
        d.engineRef ?? null,
        d.formatId ?? null,
        d.formatString ?? null,
        d.ytdlpState ?? null,
        d.sortOrder ?? d.createdAt,
        d.speedLimitKBps ?? 0,
        d.pinned ? 1 : 0,
        d.createdAt,
        d.startedAt ?? null,
        d.completedAt ?? null
      )
  }

  updateDownload(id: string, patch: DownloadPatch): void {
    const sets: string[] = []
    const values: Array<string | number | null> = []
    const map: [keyof DownloadPatch, string][] = [
      ['status', 'status'],
      ['totalBytes', 'total_bytes'],
      ['doneBytes', 'done_bytes'],
      ['errorCode', 'error_code'],
      ['errorMessage', 'error_message'],
      ['startedAt', 'started_at'],
      ['completedAt', 'completed_at'],
      ['engineRef', 'engine_ref'],
      ['filename', 'filename'],
      ['savePath', 'save_path'],
      ['title', 'title'],
      ['thumbnailUrl', 'thumbnail_url'],
      ['formatLabel', 'format_label'],
      ['formatString', 'format_string'],
      ['ytdlpState', 'ytdlp_state'],
      ['sortOrder', 'sort_order'],
      ['speedLimitKBps', 'speed_limit_kbps'],
      ['pinned', 'pinned']
    ]
    for (const [key, col] of map) {
      if (patch[key] !== undefined) {
        sets.push(`${col} = ?`)
        // pinned is a boolean in the patch, 0/1 in the DB.
        values.push(
          key === 'pinned'
            ? (patch[key] as boolean)
              ? 1
              : 0
            : (patch[key] as string | number | null)
        )
      }
    }
    if (sets.length === 0) return
    values.push(id)
    this.db.prepare(`UPDATE downloads SET ${sets.join(', ')} WHERE id = ?`).run(...values)
  }

  getDownload(id: string): DownloadInfo | null {
    const row = this.db.prepare('SELECT * FROM downloads WHERE id = ?').get(id) as unknown as
      DownloadRow | undefined
    return row ? rowToInfo(row) : null
  }

  /**
   * Phase 7 (v1.0): duplicate check — a COMPLETED row with the same URL,
   * or the same extractor+video-id AND format. Live rows are excluded:
   * they resume instead of duplicating. remote_id/format_id NULLs never
   * match (SQL NULL = NULL is false, and the IS NOT NULL guards make
   * that explicit).
   */
  findCompletedDuplicate(
    url: string,
    remoteId: string | null,
    formatId: string | null
  ): {
    id: string
    url: string
    filename: string
    savePath: string
    totalBytes: number
    completedAt: number | null
  } | null {
    const row = this.db
      .prepare(
        `SELECT id, url, filename, save_path, total_bytes, completed_at FROM downloads
         WHERE status = 'completed'
           AND (url = ? OR (remote_id = ? AND remote_id IS NOT NULL AND format_id = ? AND format_id IS NOT NULL))
         ORDER BY completed_at DESC LIMIT 1`
      )
      .get(url, remoteId, formatId) as unknown as
      | {
          id: string
          url: string
          filename: string
          save_path: string
          total_bytes: number
          completed_at: number | null
        }
      | undefined
    if (!row) return null
    return {
      id: row.id,
      url: row.url,
      filename: row.filename,
      savePath: row.save_path,
      totalBytes: row.total_bytes,
      completedAt: row.completed_at
    }
  }

  listDownloads(): DownloadInfo[] {
    const rows = this.db
      .prepare('SELECT * FROM downloads ORDER BY created_at DESC')
      .all() as unknown as DownloadRow[]
    return rows.map(rowToInfo)
  }

  deleteDownload(id: string): void {
    this.db.prepare('DELETE FROM downloads WHERE id = ?').run(id)
  }

  /**
   * Phase 3: removes only finished records (completed / failed / cancelled).
   * Active downloads are never touched — and no file is ever deleted here.
   * Returns how many records were removed.
   */
  clearHistory(): number {
    const result = this.db
      .prepare("DELETE FROM downloads WHERE status IN ('completed', 'failed', 'cancelled')")
      .run() as unknown as { changes: number }
    return result.changes ?? 0
  }

  getSetting(key: string): string | null {
    const row = this.db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as
      { value: string } | undefined
    return row ? row.value : null
  }

  // ---------------------------------------------------------------
  // Next-level: channel subscriptions (DB table `subscriptions`).
  // ---------------------------------------------------------------

  listSubscriptions(): Subscription[] {
    const rows = this.db
      .prepare('SELECT * FROM subscriptions ORDER BY created_at ASC')
      .all() as unknown as SubscriptionRow[]
    return rows.map(rowToSubscription)
  }

  getSubscription(id: string): Subscription | null {
    const row = this.db.prepare('SELECT * FROM subscriptions WHERE id = ?').get(id) as unknown as
      SubscriptionRow | undefined
    return row ? rowToSubscription(row) : null
  }

  findSubscriptionByUrl(url: string): Subscription | null {
    const row = this.db.prepare('SELECT * FROM subscriptions WHERE url = ?').get(url) as unknown as
      SubscriptionRow | undefined
    return row ? rowToSubscription(row) : null
  }

  insertSubscription(s: {
    id: string
    url: string
    title: string
    uploader: string | null
    lastVideoId: string | null
    createdAt: number
  }): void {
    this.db
      .prepare(
        `INSERT INTO subscriptions
          (id, url, title, uploader, last_video_id, last_checked_at, created_at, pending)
         VALUES (?, ?, ?, ?, ?, NULL, ?, '[]')`
      )
      .run(s.id, s.url, s.title, s.uploader, s.lastVideoId, s.createdAt)
  }

  updateSubscription(
    id: string,
    patch: {
      title?: string
      uploader?: string | null
      lastVideoId?: string | null
      lastCheckedAt?: number | null
      pending?: SubscriptionVideo[]
    }
  ): void {
    const sets: string[] = []
    const values: Array<string | number | null> = []
    const map: [keyof typeof patch, string][] = [
      ['title', 'title'],
      ['uploader', 'uploader'],
      ['lastVideoId', 'last_video_id'],
      ['lastCheckedAt', 'last_checked_at']
    ]
    for (const [key, col] of map) {
      if (patch[key] !== undefined) {
        sets.push(`${col} = ?`)
        values.push(patch[key] as string | number | null)
      }
    }
    if (patch.pending !== undefined) {
      sets.push('pending = ?')
      values.push(JSON.stringify(patch.pending))
    }
    if (sets.length === 0) return
    values.push(id)
    this.db.prepare(`UPDATE subscriptions SET ${sets.join(', ')} WHERE id = ?`).run(...values)
  }

  deleteSubscription(id: string): void {
    this.db.prepare('DELETE FROM subscriptions WHERE id = ?').run(id)
  }

  setSetting(key: string, value: string): void {
    this.db
      .prepare(
        'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
      )
      .run(key, value)
  }

  close(): void {
    this.db.close()
  }
}
