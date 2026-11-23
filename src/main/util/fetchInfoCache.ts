/**
 * Issue #1 — in-memory fetchInfo cache (5-minute TTL).
 *
 * Repeat fetches of the same link used to re-run yt-dlp every time
 * (~9-13 s each). The cache lives in the main process, keyed by URL +
 * net override, and is invalidated when a download for that URL starts.
 * In-memory only — no disk cache. Pure logic, unit-tested in tests/.
 */

export const FETCH_INFO_CACHE_TTL_MS = 5 * 60 * 1000

export interface FetchInfoCacheKeyParts {
  cookiesFile?: string | null
  userAgent?: string | null
  referer?: string | null
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
