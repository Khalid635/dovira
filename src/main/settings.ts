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
  theme: 'light',
  /** v0.7.0: one-time migration flag (see SettingsManager). */
  themeMigrated070: false,
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
  clipboardWatch: false,
  // Phase 4
  playlistSkipDownloaded: false,
  embedMetadataDefault: false,
  // Phase 5
  extensionToken: '',
  // Phase 6
  appUpdateCheck: true,
  appUpdateAutoDownload: false,
  // Phase 7 (v1.0) — Smart features. All rule-based and local; the
  // local-model hook is OFF by default and never bundles a model.
  smartOrganizer: true,
  organizerFolders: {
    Video: 'Video',
    Music: 'Music',
    Documents: 'Documents',
    Archives: 'Archives',
    Programs: 'Programs',
    Images: 'Images',
    Others: 'Others'
  },
  organizerOverrides: {},
  smartNaming: true,
  nameTemplate: '{title} [{height}p]',
  smartDuplicates: true,
  smartDownload: true,
  localModelEnabled: false,
  localModelProvider: 'ollama',
  localModelEndpoint: 'http://127.0.0.1:11434',
  localModelName: 'llama3.2',
  // AI Assistant (post-v1.0, v1.1.0) — rule-based first; the local model
  // is an opt-in enhancement, default OFF.
  assistantEnabled: true,
  assistantLocalModel: false,
  // v1.2.0: guided in-app setup — first-run wizard, extension section, diagnostics.
  setupCompleted: false,
  extensionFloatingButton: false,
  extensionIntercept: false
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
    next.theme = 'light'
  }
  next.themeMigrated070 = next.themeMigrated070 === true
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
  // Phase 4
  next.playlistSkipDownloaded = next.playlistSkipDownloaded === true
  next.embedMetadataDefault = next.embedMetadataDefault === true
  // Phase 5
  if (typeof next.extensionToken !== 'string') next.extensionToken = ''
  // Phase 6
  next.appUpdateCheck = next.appUpdateCheck === true
  next.appUpdateAutoDownload = next.appUpdateAutoDownload === true
  // Phase 7 (v1.0) — Smart features.
  next.smartOrganizer = next.smartOrganizer === true
  next.organizerFolders = normalizeOrganizerFolders(next.organizerFolders)
  next.organizerOverrides = normalizeOrganizerOverrides(next.organizerOverrides)
  next.smartNaming = next.smartNaming === true
  if (typeof next.nameTemplate !== 'string' || next.nameTemplate.trim().length === 0) {
    next.nameTemplate = '{title} [{height}p]'
  } else {
    next.nameTemplate = next.nameTemplate.trim().slice(0, 120)
  }
  next.smartDuplicates = next.smartDuplicates === true
  next.smartDownload = next.smartDownload === true
  next.localModelEnabled = next.localModelEnabled === true
  if (next.localModelProvider !== 'ollama' && next.localModelProvider !== 'lmstudio') {
    next.localModelProvider = 'ollama'
  }
  if (typeof next.localModelEndpoint !== 'string') next.localModelEndpoint = ''
  else if (
    next.localModelEndpoint.length > 0 &&
    !/^https?:\/\/[^/]+/i.test(next.localModelEndpoint)
  ) {
    next.localModelEndpoint = ''
  }
  if (typeof next.localModelName !== 'string' || next.localModelName.trim().length === 0) {
    next.localModelName = 'llama3.2'
  } else {
    next.localModelName = next.localModelName.trim().slice(0, 80)
  }
  // AI Assistant (post-v1.0, v1.1.0).
  next.assistantEnabled = next.assistantEnabled === true
  next.assistantLocalModel = next.assistantLocalModel === true
  // v1.2.0: guided setup.
  next.setupCompleted = next.setupCompleted === true
  next.extensionFloatingButton = next.extensionFloatingButton === true
  next.extensionIntercept = next.extensionIntercept === true
  return next
}

const ORGANIZER_CATEGORIES = [
  'Video',
  'Music',
  'Documents',
  'Archives',
  'Programs',
  'Images',
  'Others'
] as const

/** Folder name per category — every category keeps a valid folder name. */
function normalizeOrganizerFolders(v: unknown): Record<string, string> {
  const fallback: Record<string, string> = {}
  for (const c of ORGANIZER_CATEGORIES) fallback[c] = c
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return fallback
  const out: Record<string, string> = { ...fallback }
  for (const c of ORGANIZER_CATEGORIES) {
    const raw = (v as Record<string, unknown>)[c]
    if (typeof raw === 'string') {
      // A folder name, not a path — no separators, no traversal.
      const clean = raw
        .replace(/[<>:"/\\|?*]/g, '')
        .trim()
        .replace(/[. ]+$/, '')
      if (clean.length > 0 && clean !== '.' && clean !== '..') out[c] = clean.slice(0, 60)
    }
  }
  return out
}

/** User extension→category overrides — keys are bare extensions, values are categories. */
function normalizeOrganizerOverrides(v: unknown): Record<string, string> {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return {}
  const out: Record<string, string> = {}
  for (const [rawExt, rawCat] of Object.entries(v as Record<string, unknown>)) {
    const ext = String(rawExt)
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '')
    if (ext.length === 0 || ext.length > 12) continue
    if (typeof rawCat !== 'string') continue
    const cat = rawCat.trim()
    if ((ORGANIZER_CATEGORIES as readonly string[]).includes(cat)) out[ext] = cat
  }
  return out
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
    // v0.7.0 one-time migration: Mint is the new default. Stored settings
    // from older versions say 'dark' (the old default); flip once so the
    // redesign is visible on first 0.7.0 launch. The flag stops this from
    // ever re-flipping after the user picks Dark themselves.
    if (!next.themeMigrated070) {
      next.theme = 'light'
      next.themeMigrated070 = true
      this.db.setSetting('theme', JSON.stringify('light'))
      this.db.setSetting('themeMigrated070', JSON.stringify(true))
    }
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
