/**
 * Issue #1 — in-memory fetchInfo cache (5-minute TTL).
 *
 * Repeat fetches of the same link used to re-run yt-dlp every time
 * (~9-13 s each). The cache lives in the main process, keyed by URL +
 * net override, and is invalidated when a download for that URL starts.
 * In-memory only — no disk cache. Pure logic, unit-tested in tests/.
 *
 * Cache-key rule: the key must be a function of the cookies' CONTENT,
 * never of the temp file's PATH. The Local API writes a fresh
 * random-named cookies file per extension send, so keying on the path
 * made the cache never hit for extension sends (two 9.3 s / 11.3 s
 * fetches 17 s apart for the same URL, 2026-11-24). Callers pass
 * `cookiesHash` (see cookiesFileHash); `cookiesFile` stays only for
 * backward compatibility and must not be passed by new callers.
 */
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'

export const FETCH_INFO_CACHE_TTL_MS = 5 * 60 * 1000

export interface FetchInfoCacheKeyParts {
  /**
   * @deprecated — the temp filename is random per extension send, so
   * it must never be the cache key. Pass cookiesHash instead.
   */
  cookiesFile?: string | null
  /** SHA-256 of the per-link cookies file's CONTENT — same cookies, same key, whatever the temp filename. */
  cookiesHash?: string | null
  userAgent?: string | null
  referer?: string | null
}

/**
 * SHA-256 of a per-link cookies file's content, or null when there is
 * no file / it cannot be read. Reading is best-effort — a missing file
 * just means "no cookies", never an error.
 */
export function cookiesFileHash(path: string | null | undefined): string | null {
  if (!path) return null
  try {
    return createHash('sha256').update(readFileSync(path)).digest('hex')
  } catch {
    return null
  }
}

/**
 * Fix 2(c): validate Netscape cookies.txt text, shared by the yt-dlp
 * --cookies choke point (ytdlp.ts) and the Local API write point
 * (localApi.ts) — a single definition, never duplicated.
 *
 * Valid = one or more cookie lines; `#` comment lines and blank lines
 * are allowed. Every cookie line must split into exactly 7
 * tab-separated fields with a numeric expiry (field 5). A `#HttpOnly_`
 * prefix is NOT a comment — it marks a host-only cookie, so such a
 * line still counts as a cookie line. A file with no cookie lines
 * (empty, or comments only) is invalid: it carries no cookies, so
 * passing it to yt-dlp would only fail the fetch. A file containing
 * only `muse.` is invalid (one field, no tabs).
 */
export function isValidNetscapeCookiesText(text: string): boolean {
  let cookies = 0
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line) continue
    if (line.startsWith('#') && !line.startsWith('#HttpOnly_')) continue
    const parts = line.split('\t')
    if (parts.length !== 7) return false
    if (!/^\d+$/.test(parts[4])) return false
    cookies++
  }
  return cookies > 0
}

/**
 * Read a cookies file and validate its text. An unreadable or missing
 * file is invalid — the caller skips --cookies instead of handing
 * yt-dlp a path it cannot use.
 */
export function isValidNetscapeCookiesFile(path: string): boolean {
  try {
    return isValidNetscapeCookiesText(readFileSync(path, 'utf-8'))
  } catch {
    return false
  }
}

export class FetchInfoCache<V> {
  private entries = new Map<string, { at: number; value: V }>()

  /** Cache key: the URL plus the net override (cookies/UA/referer change results). */
  static key(url: string, netOverride?: FetchInfoCacheKeyParts | null): string {
    return `${url}\n${JSON.stringify(netOverride ?? null)}`
  }

  get(key: string, now = Date.now()): V | null {
    const entry = this.entries.get(key)
    if (!entry) return null
    if (now - entry.at > FETCH_INFO_CACHE_TTL_MS) {
      this.entries.delete(key)
      return null
    }
    return entry.value
  }

  set(key: string, value: V, now = Date.now()): void {
    this.entries.set(key, { at: now, value })
  }

  delete(key: string): void {
    this.entries.delete(key)
  }

  /** Drop every cached result for a URL (any net override) — a download started. */
  deleteForUrl(url: string): void {
    const prefix = `${url}\n`
    for (const key of [...this.entries.keys()]) {
      if (key.startsWith(prefix)) this.entries.delete(key)
    }
  }

  get size(): number {
    return this.entries.size
  }
}
