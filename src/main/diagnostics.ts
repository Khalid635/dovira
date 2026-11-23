/**
 * v1.2.0: in-app diagnostics (Settings > Setup & diagnostics).
 *
 * Pure-ish: no Electron imports — the caller passes everything the checks
 * need, so this module compiles standalone for unit tests (see
 * docs/v120-setup-test.md). The only I/O is spawning the engine binaries
 * for --version and creating the download folder when it is missing.
 */
import { existsSync, mkdirSync } from 'node:fs'
import type { Aria2Manager } from './engines/aria2'
import { checkLatest, getAria2Version, getYtDlpVersion } from './engines/versions'
import type { LocalApiServer } from './localApi'
import type { DiagnosticCheck, DiagnosticsResult } from './types'

export interface DiagnosticsDeps {
  localApi: LocalApiServer
  aria2: Aria2Manager | null
  aria2Binary: string | null
  ytDlpBinary: string | null
  downloadDir: string
  /** Free bytes on the download volume (null when it cannot be determined). */
  freeBytes: number | null
  isWindows: boolean
}

export interface DiagnosticsOptions {
  /** Check yt-dlp's latest release (network). Default true; tests pass false. */
  checkLatest?: boolean
}

/** The extension pings every 60s — seen within 2 minutes counts as connected. */
const EXTENSION_SEEN_FRESH_MS = 120_000
const LOW_DISK_BYTES = 1_000_000_000

/** Same shape as the renderer's formatBytes — Latin digits, as the rest of the app. */
export function formatSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '0 B'
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let v = bytes / 1024
  let u = 0
  while (v >= 1024 && u < units.length - 1) {
    v /= 1024
    u++
  }
  return `${v >= 100 ? Math.round(v) : v.toFixed(1)} ${units[u]}`
}

export async function runDiagnostics(
  deps: DiagnosticsDeps,
  opts: DiagnosticsOptions = {}
): Promise<DiagnosticsResult> {
  const checks: DiagnosticCheck[] = []

  // 1. Local API — the extension's only route into the app.
  const api = deps.localApi.getStatus()
  checks.push(
    api.running
      ? {
          id: 'localApi',
          status: 'ok',
          detailKey: 'diag.detailApiRunning',
          detailParams: { port: api.port ?? 0 },
          fix: null
        }
      : {
          id: 'localApi',
          status: 'fail',
          detailKey: 'diag.detailApiStopped',
          fix: null
        }
  )

  // 2. yt-dlp — version + latest release (network, best-effort).
  if (!deps.ytDlpBinary) {
    checks.push({ id: 'ytdlp', status: 'fail', detailKey: 'diag.detailYtdlpMissing', fix: null })
  } else {
    const version = await getYtDlpVersion(deps.ytDlpBinary)
    if (!version) {
      checks.push({
        id: 'ytdlp',
        status: 'fail',
        detailKey: 'diag.detailYtdlpNoVersion',
        fix: null
      })
    } else if (opts.checkLatest === false) {
      checks.push({
        id: 'ytdlp',
        status: 'ok',
        detailKey: 'diag.detailYtdlpOk',
        detailParams: { version },
        fix: null
      })
    } else {
      let latest: string | null
      try {
        latest = await checkLatest('yt-dlp')
      } catch {
        latest = null
      }
      if (latest === null) {
        checks.push({
          id: 'ytdlp',
          status: 'warn',
          detailKey: 'diag.detailYtdlpUnknown',
          detailParams: { version },
          fix: null
        })
      } else if (latest !== version) {
        checks.push({
          id: 'ytdlp',
          status: 'warn',
          detailKey: 'diag.detailYtdlpUpdate',
          detailParams: { version, latest },
          fix: 'updateYtdlp'
        })
      } else {
        checks.push({
          id: 'ytdlp',
          status: 'ok',
          detailKey: 'diag.detailYtdlpOk',
          detailParams: { version },
          fix: null
        })
      }
    }
  }

  // 3. aria2 — binary + version. The daemon starts lazily on the first
  // download, so "not running yet" is ready, not a failure.
  if (!deps.aria2Binary) {
    checks.push(
      deps.isWindows
        ? { id: 'aria2', status: 'fail', detailKey: 'diag.detailAria2Missing', fix: null }
        : { id: 'aria2', status: 'warn', detailKey: 'diag.detailAria2Fallback', fix: null }
    )
  } else {
    const version = await getAria2Version(deps.aria2Binary)
    if (!version) {
      checks.push({
        id: 'aria2',
        status: 'fail',
        detailKey: 'diag.detailAria2NoVersion',
        fix: null
      })
    } else if (deps.aria2?.isReady()) {
      checks.push({ id: 'aria2', status: 'ok', detailKey: 'diag.detailAria2Running', fix: null })
    } else {
      checks.push({ id: 'aria2', status: 'ok', detailKey: 'diag.detailAria2Ready', fix: null })
    }
  }

  // 4. Browser extension — has it ever checked in, and how recently?
  const seenAt = deps.localApi.getStatus().extensionSeenAt
  if (seenAt === null) {
    checks.push({
      id: 'extension',
      status: 'warn',
      detailKey: 'diag.detailExtNever',
      fix: 'openSetup'
    })
  } else {
    const ageMs = Date.now() - seenAt
    if (ageMs <= EXTENSION_SEEN_FRESH_MS) {
      checks.push({
        id: 'extension',
        status: 'ok',
        detailKey: 'diag.detailExtConnected',
        fix: null
      })
    } else {
      checks.push({
        id: 'extension',
        status: 'warn',
        detailKey: 'diag.detailExtSeenAgo',
        detailParams: { minutes: Math.max(1, Math.round(ageMs / 60000)) },
        fix: 'openSetup'
      })
    }
  }

  // 5. Download folder — exists (create it when missing) + free space.
  let dirCreated = false
  try {
    if (!existsSync(deps.downloadDir)) {
      mkdirSync(deps.downloadDir, { recursive: true })
      dirCreated = true
    }
    if (deps.freeBytes !== null && deps.freeBytes < LOW_DISK_BYTES) {
      checks.push({
        id: 'downloadDir',
        status: 'warn',
        detailKey: 'diag.detailDirLowSpace',
        detailParams: { free: formatSize(deps.freeBytes) },
        fix: null
      })
    } else if (dirCreated) {
      checks.push({
        id: 'downloadDir',
        status: 'ok',
        detailKey: 'diag.detailDirCreated',
        detailParams: { dir: deps.downloadDir },
        fix: null
      })
    } else {
      checks.push({
        id: 'downloadDir',
        status: 'ok',
        detailKey: 'diag.detailDirOk',
        detailParams: { free: deps.freeBytes === null ? '—' : formatSize(deps.freeBytes) },
        fix: null
      })
    }
  } catch {
    checks.push({
      id: 'downloadDir',
      status: 'fail',
      detailKey: 'diag.detailDirMissing',
      detailParams: { dir: deps.downloadDir },
      fix: 'chooseFolder'
    })
  }

  return { checks, ranAt: Date.now() }
}
