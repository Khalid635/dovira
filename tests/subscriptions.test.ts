import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  MAX_NEW_PER_CHECK,
  SubscriptionManager,
  looksLikeChannel,
  type SubscriptionStore
} from '../src/main/smart/subscriptions.ts'
import type { PlaylistInfo, PlaylistEntry } from '../src/main/engines/ytdlp.ts'
import type { Subscription, SubscriptionVideo } from '../src/main/types.ts'

function entry(id: string, n: number): PlaylistEntry {
  return {
    id,
    title: `Video ${n}`,
    duration: 60,
    url: `https://www.youtube.com/watch?v=${id}`,
    thumbnail: null
  }
}

function playlist(ids: string[], title = 'Test Channel'): PlaylistInfo {
  return {
    url: 'https://www.youtube.com/@test',
    title,
    uploader: 'Test Channel',
    entries: ids.map((id, i) => entry(id, ids.length - i))
  }
}

/** In-memory SubscriptionStore — the same shape DoviraDb exposes. */
class FakeDb implements SubscriptionStore {
  private rows = new Map<string, Subscription>()

  listSubscriptions(): Subscription[] {
    return [...this.rows.values()].sort((a, b) => a.createdAt - b.createdAt)
  }
  getSubscription(id: string): Subscription | null {
    return this.rows.get(id) ?? null
  }
  findSubscriptionByUrl(url: string): Subscription | null {
    return [...this.rows.values()].find((s) => s.url === url) ?? null
  }
  insertSubscription(s: {
    id: string
    url: string
    title: string
    uploader: string | null
    lastVideoId: string | null
    createdAt: number
  }): void {
    this.rows.set(s.id, { ...s, lastCheckedAt: null, pending: [] })
  }
  updateSubscription(
    id: string,
    patch: {
      title?: string
      uploader?: string | null
      lastVideoId?: string | null
      lastCheckedAt?: number | null
      pending?: SubscriptionVideo[]
    }
  ): void {
    const row = this.rows.get(id)
    if (row) this.rows.set(id, { ...row, ...patch })
  }
  deleteSubscription(id: string): void {
    this.rows.delete(id)
  }
}

const CHANNEL = 'https://www.youtube.com/@test'

describe('subscriptions (next-level)', () => {
  it('looksLikeChannel: @handle / channel / playlist yes, plain video no', () => {
    assert.equal(looksLikeChannel('https://www.youtube.com/@test'), true)
    assert.equal(looksLikeChannel('https://www.youtube.com/channel/UCabc'), true)
    assert.equal(looksLikeChannel('https://www.youtube.com/playlist?list=PLabc'), true)
    assert.equal(looksLikeChannel('https://www.youtube.com/watch?v=abc&list=PLabc'), true)
    assert.equal(looksLikeChannel('https://www.youtube.com/watch?v=abc'), false)
    assert.equal(looksLikeChannel('https://example.com/page'), false)
  })

  it('add: baseline is the first (newest) entry, pending starts empty', async () => {
    const db = new FakeDb()
    const mgr = new SubscriptionManager({
      db,
      fetchPlaylist: async () => playlist(['v3', 'v2', 'v1'])
    })
    const r = await mgr.add(CHANNEL)
    assert.equal(r.ok, true)
    assert.equal(r.subscription?.lastVideoId, 'v3')
    assert.deepEqual(r.subscription?.pending, [])
    assert.equal(db.listSubscriptions().length, 1)
  })

  it('add: invalid URL / unsupported URL / duplicate / empty playlist', async () => {
    const db = new FakeDb()
    const mgr = new SubscriptionManager({
      db,
      fetchPlaylist: async () => playlist(['v1'])
    })
    assert.deepEqual((await mgr.add('not a url')).error, 'invalid-url')
    assert.deepEqual(
      (await mgr.add('https://www.youtube.com/watch?v=abc')).error,
      'unsupported-url'
    )
    assert.equal((await mgr.add(CHANNEL)).ok, true)
    assert.deepEqual((await mgr.add(CHANNEL)).error, 'duplicate')
    const empty = new SubscriptionManager({
      db: new FakeDb(),
      fetchPlaylist: async () => playlist([])
    })
    assert.deepEqual((await empty.add(CHANNEL)).error, 'not-playlist')
  })

  it('add: engine missing -> engine-missing, fetch throws -> fetch-failed', async () => {
    const noEngine = new SubscriptionManager({ db: new FakeDb(), fetchPlaylist: null })
    assert.deepEqual((await noEngine.add(CHANNEL)).error, 'engine-missing')
    const failing = new SubscriptionManager({
      db: new FakeDb(),
      fetchPlaylist: async () => {
        throw new Error('boom')
      }
    })
    assert.deepEqual((await failing.add(CHANNEL)).error, 'fetch-failed')
  })

  it('checkOne: newer videos land in pending, baseline advances', async () => {
    const db = new FakeDb()
    let current = ['v3', 'v2', 'v1']
    const mgr = new SubscriptionManager({
      db,
      fetchPlaylist: async () => playlist(current)
    })
    const added = await mgr.add(CHANNEL)
    assert.equal(added.ok, true)
    current = ['v5', 'v4', 'v3', 'v2', 'v1']
    const r = await mgr.checkOne(added.subscription!.id)
    assert.deepEqual(r, { ok: true, found: 2 })
    const sub = db.getSubscription(added.subscription!.id)!
    assert.deepEqual(
      sub.pending.map((v) => v.id),
      ['v5', 'v4']
    )
    assert.equal(sub.lastVideoId, 'v5')
    // A second check with nothing new finds nothing (no duplicates).
    const r2 = await mgr.checkOne(added.subscription!.id)
    assert.deepEqual(r2, { ok: true, found: 0 })
    assert.equal(db.getSubscription(added.subscription!.id)!.pending.length, 2)
  })

  it('checkOne: baseline gone -> only the single newest entry', async () => {
    const db = new FakeDb()
    let current = ['v3', 'v2', 'v1']
    const mgr = new SubscriptionManager({
      db,
      fetchPlaylist: async () => playlist(current)
    })
    const added = await mgr.add(CHANNEL)
    current = ['v9', 'v8', 'v7']
    const r = await mgr.checkOne(added.subscription!.id)
    assert.equal(r.found, 1)
    assert.deepEqual(
      db.getSubscription(added.subscription!.id)!.pending.map((v) => v.id),
      ['v9']
    )
  })

  it('checkOne: caps at MAX_NEW_PER_CHECK', async () => {
    const db = new FakeDb()
    const first = Array.from({ length: 25 }, (_, i) => `old${i}`)
    let current = first
    const mgr = new SubscriptionManager({
      db,
      fetchPlaylist: async () => playlist(current)
    })
    const added = await mgr.add(CHANNEL)
    current = [...Array.from({ length: 25 }, (_, i) => `new${i}`), ...first]
    const r = await mgr.checkOne(added.subscription!.id)
    assert.equal(r.found, MAX_NEW_PER_CHECK)
  })

  it('checkOne: failed fetch leaves the row untouched', async () => {
    const db = new FakeDb()
    let fail = false
    const mgr = new SubscriptionManager({
      db,
      fetchPlaylist: async () => {
        if (fail) throw new Error('boom')
        return playlist(['v1'])
      }
    })
    const added = await mgr.add(CHANNEL)
    fail = true
    const r = await mgr.checkOne(added.subscription!.id)
    assert.equal(r.ok, false)
    assert.equal(db.getSubscription(added.subscription!.id)!.lastCheckedAt, null)
  })

  it('consumePending removes one video; remove deletes the subscription', async () => {
    const db = new FakeDb()
    let current = ['v1']
    const mgr = new SubscriptionManager({
      db,
      fetchPlaylist: async () => playlist(current)
    })
    const added = await mgr.add(CHANNEL)
    const id = added.subscription!.id
    current = ['v2', 'v1']
    await mgr.checkOne(id)
    assert.equal(mgr.consumePending(id, 'v2')?.id, 'v2')
    assert.equal(mgr.consumePending(id, 'v2'), null)
    assert.equal(db.getSubscription(id)!.pending.length, 0)
    assert.equal(mgr.remove(id), true)
    assert.equal(mgr.remove(id), false)
    assert.equal(db.listSubscriptions().length, 0)
  })

  it('checkAll: totals across subscriptions, a failed one is skipped', async () => {
    const db = new FakeDb()
    const mgr = new SubscriptionManager({
      db,
      fetchPlaylist: async (url) => (url.includes('@a') ? playlist(['a1']) : playlist(['b2', 'b1']))
    })
    const a = await mgr.add('https://www.youtube.com/@a')
    const b = await mgr.add('https://www.youtube.com/@b')
    assert.equal(a.ok && b.ok, true)
    const r = await mgr.checkAll()
    assert.deepEqual(r, { checked: 2, found: 0 })
  })
})
