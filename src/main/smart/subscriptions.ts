/**
 * Next-level: channel subscriptions — fully local polling, no server.
 *
 * Subscribe to a channel/playlist URL; the app checks it (60s after
 * startup, then every 6h, plus "Check now") and lists new videos with
 * Download buttons. Nothing auto-downloads — the user picks.
 *
 * The check is conservative on purpose: the baseline is the newest
 * video seen at subscribe time. On a check, only the entries NEWER
 * than the baseline are offered (cap 20); when the baseline has
 * vanished from the list (a channel that reordered, or a stale
 * baseline), only the single newest entry is offered — never a flood
 * of the whole channel. Pure except for the injected db + fetcher,
 * so it is unit-testable with a fake db (tests/subscriptions.test.ts).
 */
import { randomUUID } from 'node:crypto'
import type { PlaylistInfo, Subscription, SubscriptionVideo } from '../types.ts'

export type SubscriptionError =
  | 'invalid-url'
  | 'unsupported-url'
  | 'not-playlist'
  | 'duplicate'
  | 'fetch-failed'
  | 'engine-missing'

/** The db surface the manager needs (DoviraDb satisfies this structurally). */
export interface SubscriptionStore {
  listSubscriptions(): Subscription[]
  getSubscription(id: string): Subscription | null
  findSubscriptionByUrl(url: string): Subscription | null
  insertSubscription(s: {
    id: string
    url: string
    title: string
    uploader: string | null
    lastVideoId: string | null
    createdAt: number
  }): void
  updateSubscription(
    id: string,
    patch: {
      title?: string
      uploader?: string | null
      lastVideoId?: string | null
      lastCheckedAt?: number | null
      pending?: SubscriptionVideo[]
    }
  ): void
  deleteSubscription(id: string): void
}

export interface SubscriptionDeps {
  db: SubscriptionStore
  /** yt-dlp --flat-playlist fetch (null when the engine is unavailable). */
  fetchPlaylist: ((url: string) => Promise<PlaylistInfo>) | null
}

/** Conservative cap: never offer more than this many new videos per check. */
export const MAX_NEW_PER_CHECK = 20

/**
 * Is this URL a channel/playlist worth subscribing to? YouTube channel
 * pages (@handle, /channel/, /c/, /user/) and any playlist link
 * (list=). A plain video URL is not a subscription — it resolves to
 * one video, and subscribing to it would never find anything new.
 */
export function looksLikeChannel(url: string): boolean {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return false
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false
  const host = parsed.hostname.toLowerCase()
  if (parsed.searchParams.has('list')) return true
  if (host === 'www.youtube.com' || host === 'youtube.com' || host === 'm.youtube.com') {
    const path = parsed.pathname
    return (
      path.startsWith('/@') ||
      path.startsWith('/channel/') ||
      path.startsWith('/c/') ||
      path.startsWith('/user/') ||
      path.startsWith('/playlist')
    )
  }
  return false
}

function toVideo(e: PlaylistInfo['entries'][number]): SubscriptionVideo {
  return {
    id: e.id,
    title: e.title,
    url: e.url,
    thumbnail: e.thumbnail,
    duration: e.duration
  }
}

export class SubscriptionManager {
  // No parameter properties — Node's strip-only test runner cannot
  // parse them; explicit fields instead.
  private deps: SubscriptionDeps

  constructor(deps: SubscriptionDeps) {
    this.deps = deps
  }

  list(): Subscription[] {
    return this.deps.db.listSubscriptions()
  }

  async add(
    rawUrl: string
  ): Promise<{ ok: boolean; subscription?: Subscription; error?: SubscriptionError }> {
    const url = rawUrl.trim()
    let parsed: URL
    try {
      parsed = new URL(url)
    } catch {
      return { ok: false, error: 'invalid-url' }
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return { ok: false, error: 'unsupported-url' }
    }
    if (!looksLikeChannel(url)) return { ok: false, error: 'unsupported-url' }
    if (this.deps.db.findSubscriptionByUrl(url)) return { ok: false, error: 'duplicate' }
    if (!this.deps.fetchPlaylist) return { ok: false, error: 'engine-missing' }
    let playlist: PlaylistInfo
    try {
      playlist = await this.deps.fetchPlaylist(url)
    } catch {
      return { ok: false, error: 'fetch-failed' }
    }
    if (!playlist.entries || playlist.entries.length === 0) {
      return { ok: false, error: 'not-playlist' }
    }
    const sub: Subscription = {
      id: randomUUID(),
      url,
      title: playlist.title || playlist.uploader || url,
      uploader: playlist.uploader,
      lastVideoId: playlist.entries[0].id,
      lastCheckedAt: null,
      createdAt: Date.now(),
      pending: []
    }
    this.deps.db.insertSubscription({
      id: sub.id,
      url: sub.url,
      title: sub.title,
      uploader: sub.uploader,
      lastVideoId: sub.lastVideoId,
      createdAt: sub.createdAt
    })
    return { ok: true, subscription: sub }
  }

  /**
   * Check one subscription for new videos. Returns how many NEW videos
   * were added to its pending list (0 = up to date). Never throws —
   * a failed fetch reports ok:false and leaves the row untouched.
   */
  async checkOne(id: string): Promise<{ ok: boolean; found: number; error?: SubscriptionError }> {
    const sub = this.deps.db.getSubscription(id)
    if (!sub) return { ok: false, found: 0, error: 'not-playlist' }
    if (!this.deps.fetchPlaylist) return { ok: false, found: 0, error: 'engine-missing' }
    let playlist: PlaylistInfo
    try {
      playlist = await this.deps.fetchPlaylist(sub.url)
    } catch {
      return { ok: false, found: 0, error: 'fetch-failed' }
    }
    const entries = playlist.entries ?? []
    const now = Date.now()
    if (entries.length === 0) {
      this.deps.db.updateSubscription(id, { lastCheckedAt: now })
      return { ok: true, found: 0 }
    }
    const baselineIdx = sub.lastVideoId ? entries.findIndex((e) => e.id === sub.lastVideoId) : -1
    // Newer than the baseline; when the baseline is gone, only the
    // single newest entry (conservative — never flood the pending list).
    const newer =
      baselineIdx >= 0 ? entries.slice(0, baselineIdx).slice(0, MAX_NEW_PER_CHECK) : [entries[0]]
    const existingIds = new Set(sub.pending.map((v) => v.id))
    const fresh = newer.filter((e) => !existingIds.has(e.id)).map(toVideo)
    this.deps.db.updateSubscription(id, {
      lastVideoId: entries[0].id,
      lastCheckedAt: now,
      pending: [...fresh, ...sub.pending]
    })
    return { ok: true, found: fresh.length }
  }

  /** Check every subscription; returns totals (a failed one is skipped, not fatal). */
  async checkAll(): Promise<{ checked: number; found: number }> {
    let checked = 0
    let found = 0
    for (const sub of this.deps.db.listSubscriptions()) {
      const r = await this.checkOne(sub.id)
      if (r.ok) {
        checked++
        found += r.found
      }
    }
    return { checked, found }
  }

  /**
   * Take one pending video out of the list (called after its download
   * was successfully added). Returns the video, or null when it is not
   * pending any more.
   */
  consumePending(id: string, videoId: string): SubscriptionVideo | null {
    const sub = this.deps.db.getSubscription(id)
    if (!sub) return null
    const video = sub.pending.find((v) => v.id === videoId) ?? null
    if (!video) return null
    this.deps.db.updateSubscription(id, {
      pending: sub.pending.filter((v) => v.id !== videoId)
    })
    return video
  }

  remove(id: string): boolean {
    if (!this.deps.db.getSubscription(id)) return false
    this.deps.db.deleteSubscription(id)
    return true
  }
}
