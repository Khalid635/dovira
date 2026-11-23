/**
 * Shared pure helpers for the DOVIRA browser extension (popup, options,
 * and the Node harness). No chrome.* APIs here — nothing in this file
 * touches the browser, so it can be unit-tested with plain Node.
 *
 * NOTE: background.ts is deliberately self-contained (MV3 service
 * workers cannot reliably import ES modules across Chrome/Firefox), so
 * it carries its own small copies of formatNetscapeCookies and the
 * fetch-error mapping. This file is the source of truth — keep them in
 * sync when either changes.
 */

export interface ExtCookie {
  domain: string
  hostOnly: boolean
  path: string
  secure: boolean
  expirationDate?: number
  name: string
  value: string
}

/** Only these schemes ever reach the app. */
export function isSupportedUrl(url: string): boolean {
  if (typeof url !== 'string' || url.length === 0 || url.length > 4096) return false
  try {
    const u = new URL(url)
    return u.protocol === 'http:' || u.protocol === 'https:' || u.protocol === 'magnet:'
  } catch {
    return false
  }
}

/** Host only — the query string (tokens, session ids) is never logged. */
export function maskUrlForLog(url: string): string {
  try {
    const u = new URL(url)
    return `${u.protocol}//${u.host}${u.pathname}`
  } catch {
    return '(invalid url)'
  }
}

/**
 * chrome.cookies.Cookie[] → Netscape cookies.txt text (the format
 * yt-dlp's --cookies reads). Tabs separate the seven fields; `#HttpOnly_`
 * prefixes a host-only cookie's domain line, matching curl's format.
 */
export function formatNetscapeCookies(cookies: ExtCookie[]): string {
  const lines: string[] = ['# Netscape HTTP Cookie File', '# DOVIRA extension — per-link cookies']
  for (const c of cookies) {
    if (!c.name || /[\t\r\n]/.test(c.name) || /[\t\r\n]/.test(c.value)) continue
    const domain = c.hostOnly ? `#HttpOnly_${c.domain}` : c.domain
    const expires = c.expirationDate ? Math.floor(c.expirationDate) : 0
    lines.push(
      [
        domain,
        'TRUE',
        c.path || '/',
        c.secure ? 'TRUE' : 'FALSE',
        String(expires),
        c.name,
        c.value
      ].join('\t')
    )
  }
  return lines.join('\n') + '\n'
}

/**
 * Map a failed Local API call to a stable key. A network error (the app
 * is closed, or the port is wrong) is 'app-not-running'; a 401 is
 * 'unauthorized' (wrong token — re-pair); anything else is 'failed'.
 */
export function apiErrorMessage(err: unknown): 'app-not-running' | 'unauthorized' | 'failed' {
  if (err instanceof Response) {
    return err.status === 401 ? 'unauthorized' : 'failed'
  }
  if (err instanceof Error) {
    // fetch() throws TypeError on connection refused / DNS failure.
    if (err.name === 'TypeError') return 'app-not-running'
  }
  return 'failed'
}

// --- IDM-style floating button (next-level) ---------------------------
// Pure helpers for the hover-over-video button. content.ts carries its
// own copies (MV3 content scripts cannot import ES modules) — this
// file is the source of truth, keep them in sync.

/** Ignore videos smaller than a real player / ad slot. */
export const MIN_VIDEO_WIDTH = 200
export const MIN_VIDEO_HEIGHT = 120
/** Ignore clips shorter than this (when the duration is known). */
export const MIN_VIDEO_DURATION_SECONDS = 3

const MEDIA_EXTENSIONS = new Set([
  'mp4',
  'm4v',
  'webm',
  'mov',
  'mkv',
  'avi',
  'mp3',
  'm4a',
  'ogg',
  'ogv',
  'wav',
  'flac'
])

function isRealMediaUrl(url: string): boolean {
  try {
    const u = new URL(url)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false
    const ext = u.pathname.split('.').pop()?.toLowerCase() ?? ''
    return MEDIA_EXTENSIONS.has(ext)
  } catch {
    return false
  }
}

/**
 * Which URL to send for a hovered video. A real http(s) media URL
 * (direct <video src> or <source>) goes as-is; anything else — blob:
 * URLs on YouTube etc., data: URLs, no src at all — falls back to the
 * PAGE URL, which yt-dlp resolves.
 */
export function pickVideoDownloadUrl(srcs: (string | null | undefined)[], pageUrl: string): string {
  for (const src of srcs) {
    if (src && isRealMediaUrl(src)) return src
  }
  return pageUrl
}

/**
 * A video is worth a floating button when it is big enough to be a
 * real player and, when its duration is known, not a few-second clip.
 * Live streams (NaN / Infinity duration) are never skipped.
 */
export function isDownloadableVideo(input: {
  width: number
  height: number
  duration: number
}): boolean {
  if (input.width < MIN_VIDEO_WIDTH || input.height < MIN_VIDEO_HEIGHT) return false
  if (Number.isFinite(input.duration) && input.duration < MIN_VIDEO_DURATION_SECONDS) return false
  return true
}
