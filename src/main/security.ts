/**
 * Security hardening (free tier) — post-download file safety and engine
 * binary integrity.
 *
 * Pure where possible: no Electron imports, so the helpers compile
 * standalone for unit tests (see docs/security-hardening-test.md). The
 * only I/O is fs reads/writes, spawning MpCmdRun, and hashing files.
 * Nothing here ever throws into the download flow — every helper is
 * best-effort and reports its result instead.
 */
import { execFile } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { sha256File } from './checksum.ts'
import expectedBinaryHashes from './binary-hashes.json' with { type: 'json' }

export type DefenderScanResult = 'clean' | 'threat' | 'unknown' | 'unavailable' | 'skipped'

/** The Windows Defender command-line scanner. Null when Defender is absent. */
export function findMpCmdRun(
  programFiles: string = process.env.ProgramFiles ?? '',
  programFilesX86: string = process.env['ProgramFiles(x86)'] ?? ''
): string | null {
  const bases = [programFiles, programFilesX86].filter((b) => b.length > 0)
  for (const base of bases) {
    const candidate = join(base, 'Windows Defender', 'MpCmdRun.exe')
    if (existsSync(candidate)) return candidate
  }
  return null
}

/**
 * MpCmdRun -Scan exit codes: 0 = no threat, 2 = threat found.
 * Anything else (including a timeout) is unknown.
 */
export function parseMpCmdRunExitCode(code: number | null): 'clean' | 'threat' | 'unknown' {
  if (code === 0) return 'clean'
  if (code === 2) return 'threat'
  return 'unknown'
}

/**
 * Scan one file with Windows Defender (MpCmdRun -ScanType 3 = custom file
 * scan, -DisableRemediation = detect only, never delete). Best-effort:
 * 'unavailable' when Defender is missing, 'unknown' on any error or
 * timeout, 'skipped' off Windows. The caller must never fail a download
 * over this result.
 */
export function scanFileWithDefender(
  filePath: string,
  mpCmdRunPath: string | null,
  timeoutMs = 180_000
): Promise<DefenderScanResult> {
  if (process.platform !== 'win32') return Promise.resolve('skipped')
  if (!mpCmdRunPath) return Promise.resolve('unavailable')
  if (!existsSync(filePath)) return Promise.resolve('unknown')
  return new Promise((resolve) => {
    execFile(
      mpCmdRunPath,
      ['-Scan', '-ScanType', '3', '-File', filePath, '-DisableRemediation'],
      { timeout: timeoutMs },
      (err) => {
        if (err) {
          const code = (err as { code?: unknown }).code
          if (typeof code === 'number') return resolve(parseMpCmdRunExitCode(code))
          return resolve('unknown')
        }
        return resolve('clean')
      }
    )
  })
}

/** Internet zone (ZoneId=3) — the Mark-of-the-Web Windows applies to files from the internet. */
export function buildZoneIdentifierContent(): string {
  return '[ZoneTransfer]\r\nZoneId=3\r\n'
}

/**
 * Apply the Mark-of-the-Web (Zone.Identifier alternate data stream) so
 * Windows treats the file as downloaded from the internet — SmartScreen
 * and Office Protected View then apply. Windows + NTFS only; best-effort
 * (a non-NTFS volume or a missing file returns false, never throws).
 */
export function applyMarkOfTheWeb(filePath: string): boolean {
  if (process.platform !== 'win32') return false
  try {
    if (!existsSync(filePath)) return false
    writeFileSync(`${filePath}:Zone.Identifier`, buildZoneIdentifierContent(), 'utf-8')
    return true
  } catch {
    return false
  }
}

export interface PostDownloadSecurityResult {
  motwApplied: boolean
  scan: DefenderScanResult
}

/**
 * Run after a download completes: Mark-of-the-Web first, then a Defender
 * scan. Never throws — the download is already complete, so a failure
 * here is logged by the caller, never surfaced as a download error.
 */
export async function applyPostDownloadSecurity(
  filePath: string,
  mpCmdRunPath: string | null
): Promise<PostDownloadSecurityResult> {
  const motwApplied = applyMarkOfTheWeb(filePath)
  const scan = await scanFileWithDefender(filePath, mpCmdRunPath)
  return { motwApplied, scan }
}

export interface EngineBinaryInput {
  name: string
  path: string | null
}

export type BinaryCheckStatus = 'ok' | 'mismatch' | 'missing' | 'unknown'

export interface BinaryCheckResult {
  name: string
  status: BinaryCheckStatus
  expected?: string
  actual?: string
}

export type ExpectedBinaryHashes = Record<string, Record<string, string>>

/** The committed manifest (src/main/binary-hashes.json): platform -> engine -> sha256. */
export function getExpectedBinaryHashes(): ExpectedBinaryHashes {
  return expectedBinaryHashes as ExpectedBinaryHashes
}

/**
 * Verify bundled engine binaries against known-good SHA-256 hashes.
 * `overrides` (from userData, written by the app's own yt-dlp updater)
 * win over the committed manifest — an in-app engine update must never
 * look like tampering. A binary with no known hash reports 'unknown'
 * (warn, not fail): macOS/Linux ffmpeg and source-built aria2 have no
 * published checksums to compare against.
 */
export async function verifyEngineBinaries(
  binaries: EngineBinaryInput[],
  expected: ExpectedBinaryHashes,
  overrides: Record<string, string>,
  platform: string
): Promise<BinaryCheckResult[]> {
  const out: BinaryCheckResult[] = []
  for (const b of binaries) {
    if (!b.path || !existsSync(b.path)) {
      out.push({ name: b.name, status: 'missing' })
      continue
    }
    const expectedHash = overrides[b.name] ?? expected[platform]?.[b.name]
    if (!expectedHash) {
      out.push({ name: b.name, status: 'unknown' })
      continue
    }
    let actual: string
    try {
      actual = (await sha256File(b.path)).toLowerCase()
    } catch {
      out.push({ name: b.name, status: 'unknown', expected: expectedHash.toLowerCase() })
      continue
    }
    if (actual === expectedHash.toLowerCase()) {
      out.push({ name: b.name, status: 'ok', expected: expectedHash.toLowerCase(), actual })
    } else {
      out.push({ name: b.name, status: 'mismatch', expected: expectedHash.toLowerCase(), actual })
    }
  }
  return out
}

/** userData/engine-hashes.json — hashes the app itself recorded after an in-app engine update. */
export function engineHashOverridesPath(userData: string): string {
  return join(userData, 'engine-hashes.json')
}

export function loadEngineHashOverrides(userData: string): Record<string, string> {
  try {
    const raw = readFileSync(engineHashOverridesPath(userData), 'utf-8')
    const parsed: unknown = JSON.parse(raw)
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const out: Record<string, string> = {}
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v === 'string' && /^[0-9a-f]{64}$/i.test(v)) out[k] = v.toLowerCase()
    }
    return out
  } catch {
    return {}
  }
}

/** Record a hash the app itself verified (in-app engine update). Returns false on bad input/IO. */
export function recordEngineHashOverride(userData: string, name: string, hash: string): boolean {
  if (!/^[0-9a-f]{64}$/i.test(hash)) return false
  try {
    const next = loadEngineHashOverrides(userData)
    next[name] = hash.toLowerCase()
    mkdirSync(userData, { recursive: true })
    writeFileSync(engineHashOverridesPath(userData), JSON.stringify(next, null, 2), 'utf-8')
    return true
  } catch {
    return false
  }
}
