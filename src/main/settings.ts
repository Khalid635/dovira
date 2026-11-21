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
  theme: 'dark',
  defaultVideoQuality: '1080',
  videoContainer: 'mp4',
  defaultAudioBitrate: '320',
  subtitleLang: 'en',
  engineAutoUpdate: false,
  // Phase 3
  cookieBrowser: 'none',
  cookiesFile: null,
  launchAtStartup: false,
  minimizeToTray: false,
  proxyUrl: '',
  schedulerEnabled: false,
  schedulerTime: '02:00',
  schedulerAction: 'none',
  lastSchedulerRun: null,
  clipboardWatch: false
}

const COOKIE_BROWSERS = ['none', 'chrome', 'edge', 'firefox', 'brave'] as const
const SCHEDULER_ACTIONS = ['none', 'shutdown', 'sleep'] as const

function isValidProxyUrl(v: string): boolean {
  return /^(https?|socks5h?|socks5):\/\//i.test(v)
}

function isValidSchedulerTime(v: string): boolean {
  return /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(v)
}

function clampQuality(v: unknown): string {
  return ['2160', '1080', '720', '480', '360'].includes(String(v)) ? String(v) : '1080'
}

function normalizeSettings(next: Settings): Settings {
  next.maxConcurrent = clampInt(next.maxConcurrent, 3, 1, 5)
  next.speedLimitKBps = clampInt(next.speedLimitKBps, 0, 0, 1_000_000)
  next.autoRetry = clampInt(next.autoRetry, 3, 0, 10)
  next.connectionsPerDownload = clampInt(next.connectionsPerDownload, 8, 1, 16)
  if (next.language !== 'en' && next.language !== 'bn') next.language = 'bn'
  if (next.theme !== 'dark' && next.theme !== 'light' && next.theme !== 'system') {
    next.theme = 'dark'
  }
  next.defaultVideoQuality = clampQuality(next.defaultVideoQuality)
  if (next.videoContainer !== 'mp4' && next.videoContainer !== 'mkv') {
    next.videoContainer = 'mp4'
  }
  if (!['320', '192', '128'].includes(next.defaultAudioBitrate)) {
    next.defaultAudioBitrate = '320'
  }
  if (typeof next.subtitleLang !== 'string' || next.subtitleLang.length === 0) {
    next.subtitleLang = 'en'
  }
  next.engineAutoUpdate = next.engineAutoUpdate === true
  if (typeof next.downloadDir !== 'string' || next.downloadDir.length === 0) {
    next.downloadDir = DEFAULT_SETTINGS.downloadDir
  }
  // Phase 3
  if (!COOKIE_BROWSERS.includes(next.cookieBrowser as (typeof COOKIE_BROWSERS)[number])) {
    next.cookieBrowser = 'none'
  }
  if (typeof next.cookiesFile !== 'string' && next.cookiesFile !== null) {
    next.cookiesFile = null
  }
  next.launchAtStartup = next.launchAtStartup === true
  next.minimizeToTray = next.minimizeToTray === true
  if (typeof next.proxyUrl !== 'string') next.proxyUrl = ''
  else if (next.proxyUrl.length > 0 && !isValidProxyUrl(next.proxyUrl)) next.proxyUrl = ''
  next.schedulerEnabled = next.schedulerEnabled === true
  if (typeof next.schedulerTime !== 'string' || !isValidSchedulerTime(next.schedulerTime)) {
    next.schedulerTime = '02:00'
  }
  if (!SCHEDULER_ACTIONS.includes(next.schedulerAction as (typeof SCHEDULER_ACTIONS)[number])) {
    next.schedulerAction = 'none'
  }
  if (typeof next.lastSchedulerRun !== 'string' && next.lastSchedulerRun !== null) {
    next.lastSchedulerRun = null
  } else if (
    typeof next.lastSchedulerRun === 'string' &&
    !/^\d{4}-\d{2}-\d{2}$/.test(next.lastSchedulerRun)
  ) {
    next.lastSchedulerRun = null
  }
  next.clipboardWatch = next.clipboardWatch === true
  return next
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
    normalizeSettings(next)
    this.cache = next
  }

  get(): Settings {
    return { ...this.cache }
  }

  update(patch: Partial<Settings>): Settings {
    const prev = this.cache
    // Invalid values fall back to the previous value, not the default —
    // the same pattern as language/theme/downloadDir above.
    const cleaned: Partial<Settings> = { ...patch }
    if (
      cleaned.proxyUrl !== undefined &&
      typeof cleaned.proxyUrl === 'string' &&
      cleaned.proxyUrl.length > 0 &&
      !isValidProxyUrl(cleaned.proxyUrl)
    ) {
      cleaned.proxyUrl = prev.proxyUrl
    }
    if (
      cleaned.schedulerTime !== undefined &&
      (typeof cleaned.schedulerTime !== 'string' || !isValidSchedulerTime(cleaned.schedulerTime))
    ) {
      cleaned.schedulerTime = prev.schedulerTime
    }
    if (
      cleaned.cookieBrowser !== undefined &&
      !COOKIE_BROWSERS.includes(cleaned.cookieBrowser as (typeof COOKIE_BROWSERS)[number])
    ) {
      cleaned.cookieBrowser = prev.cookieBrowser
    }
    if (
      cleaned.schedulerAction !== undefined &&
      !SCHEDULER_ACTIONS.includes(cleaned.schedulerAction as (typeof SCHEDULER_ACTIONS)[number])
    ) {
      cleaned.schedulerAction = prev.schedulerAction
    }
    const next: Settings = normalizeSettings({ ...this.cache, ...cleaned })
    // Invalid values fall back to the previous value, not the default.
    if (next.language !== 'en' && next.language !== 'bn') next.language = prev.language
    if (next.theme !== 'dark' && next.theme !== 'light' && next.theme !== 'system') {
      next.theme = prev.theme
    }
    if (typeof next.downloadDir !== 'string' || next.downloadDir.length === 0) {
      next.downloadDir = prev.downloadDir
    }
    for (const key of Object.keys(cleaned) as (keyof Settings)[]) {
      this.db.setSetting(key, JSON.stringify(next[key]))
    }
    this.cache = next
    return this.get()
  }
}
