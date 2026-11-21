import { DatabaseSync } from 'node:sqlite'
import { copyFileSync, existsSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import type { DownloadInfo, DownloadKind, DownloadStatus } from './types'

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
  created_at: number
  started_at: number | null
  completed_at: number | null
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
  }
]

function rowToInfo(row: DownloadRow): DownloadInfo {
  return {
    id: row.id,
    url: row.url,
    filename: row.filename,
    savePath: row.save_path,
    kind: (row.kind as DownloadKind) || 'file',
    status: row.status as DownloadStatus,
    totalBytes: row.total_bytes,
    doneBytes: row.done_bytes,
    speedBps: 0,
    etaSeconds: null,
    errorCode: row.error_code,
    errorMessage: row.error_message,
    site: row.site,
    createdAt: row.created_at,
    startedAt: row.started_at,
    completedAt: row.completed_at
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
           site, remote_id, engine, engine_ref, created_at, started_at, completed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
      ['savePath', 'save_path']
    ]
    for (const [key, col] of map) {
      if (patch[key] !== undefined) {
        sets.push(`${col} = ?`)
        values.push(patch[key] as string | number | null)
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

  listDownloads(): DownloadInfo[] {
    const rows = this.db
      .prepare('SELECT * FROM downloads ORDER BY created_at DESC')
      .all() as unknown as DownloadRow[]
    return rows.map(rowToInfo)
  }

  deleteDownload(id: string): void {
    this.db.prepare('DELETE FROM downloads WHERE id = ?').run(id)
  }

  getSetting(key: string): string | null {
    const row = this.db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as
      { value: string } | undefined
    return row ? row.value : null
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
