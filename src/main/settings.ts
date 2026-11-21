import type { DoviraDb } from './db'
import type { Settings } from './types'
import { getDefaultDownloadDir } from './util/paths'

export const DEFAULT_SETTINGS: Settings = {
  downloadDir: getDefaultDownloadDir(),
  maxConcurrent: 3,
  speedLimitKBps: 0,
  autoRetry: 3,
  connectionsPerDownload: 8,
  language: 'bn',
  theme: 'dark'
}

function clampInt(v: unknown, fallback: number, min: number, max: number): number {
  const n = typeof v === 'number' && Number.isFinite(v) ? Math.floor(v) : fallback
  return Math.min(max, Math.max(min, n))
}

export class SettingsManager {
  private cache: Settings

  constructor(private db: DoviraDb) {
    const next: Settings = { ...DEFAULT_SETTINGS }
    for (const key of Object.keys(DEFAULT_SETTINGS) as (keyof Settings)[]) {
      const raw = db.getSetting(key)
      if (raw === null) continue
      try {
        const parsed: unknown = JSON.parse(raw)
        ;(next as unknown as Record<string, unknown>)[key] = parsed
      } catch {
        // Corrupt value — keep the default.
      }
    }
    next.maxConcurrent = clampInt(next.maxConcurrent, 3, 1, 5)
    next.speedLimitKBps = clampInt(next.speedLimitKBps, 0, 0, 1_000_000)
    next.autoRetry = clampInt(next.autoRetry, 3, 0, 10)
    next.connectionsPerDownload = clampInt(next.connectionsPerDownload, 8, 1, 16)
    if (next.language !== 'en' && next.language !== 'bn') next.language = 'bn'
    if (next.theme !== 'dark' && next.theme !== 'light' && next.theme !== 'system') {
      next.theme = 'dark'
    }
    if (typeof next.downloadDir !== 'string' || next.downloadDir.length === 0) {
      next.downloadDir = DEFAULT_SETTINGS.downloadDir
    }
    this.cache = next
  }

  get(): Settings {
    return { ...this.cache }
  }

  update(patch: Partial<Settings>): Settings {
    const next: Settings = { ...this.cache, ...patch }
    next.maxConcurrent = clampInt(next.maxConcurrent, 3, 1, 5)
    next.speedLimitKBps = clampInt(next.speedLimitKBps, 0, 0, 1_000_000)
    next.autoRetry = clampInt(next.autoRetry, 3, 0, 10)
    next.connectionsPerDownload = clampInt(next.connectionsPerDownload, 8, 1, 16)
    if (next.language !== 'en' && next.language !== 'bn') next.language = this.cache.language
    if (next.theme !== 'dark' && next.theme !== 'light' && next.theme !== 'system') {
      next.theme = this.cache.theme
    }
    if (typeof next.downloadDir !== 'string' || next.downloadDir.length === 0) {
      next.downloadDir = this.cache.downloadDir
    }
    for (const key of Object.keys(patch) as (keyof Settings)[]) {
      this.db.setSetting(key, JSON.stringify(next[key]))
    }
    this.cache = next
    return this.get()
  }
}
