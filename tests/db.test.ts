import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { mkdtempSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DoviraDb } from '../src/main/db.ts'

describe('DoviraDb', () => {
  let dir: string
  let dbPath: string
  let db: DoviraDb

  function makeDb(): DoviraDb {
    return new DoviraDb(dbPath)
  }

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'dovira-db-'))
    dbPath = join(dir, 'dovira.db')
    db = makeDb()
  })

  afterEach(() => {
    try {
      db.close()
    } catch {
      // Already closed.
    }
    rmSync(dir, { recursive: true, force: true })
  })

  function insertMinimal(over: Record<string, unknown> = {}): string {
    const id = (over['id'] as string) ?? 'dl-1'
    db.insertDownload({
      id,
      url: (over['url'] as string) ?? 'https://x.example/f.zip',
      filename: 'f.zip',
      savePath: join(dir, 'f.zip'),
      kind: 'file',
      status: (over['status'] as 'completed' | 'downloading' | 'queued' | 'paused' | 'failed' | 'cancelled') ?? 'queued',
      totalBytes: (over['totalBytes'] as number) ?? 1000,
      doneBytes: (over['doneBytes'] as number) ?? 0,
      createdAt: (over['createdAt'] as number) ?? 1000,
      remoteId: (over['remoteId'] as string | null) ?? null,
      formatId: (over['formatId'] as string | null) ?? null,
      completedAt: (over['completedAt'] as number | null) ?? null
    })
    return id
  }

  it('fresh db: migrations to v5, settings empty, subscriptions table works', () => {
    assert.equal(db.getSetting('anything'), null)
    assert.deepEqual(db.listDownloads(), [])
    assert.deepEqual(db.listSubscriptions(), [])
    const raw = new DatabaseSync(dbPath)
    const row = raw.prepare('PRAGMA user_version').get() as {
      user_version: number
    }
    raw.close()
    assert.equal(row.user_version, 5)
  })

  it('insert + get round-trip: defaults (engine aria2, sortOrder=createdAt, pinned false)', () => {
    insertMinimal()
    const d = db.getDownload('dl-1')
    assert.ok(d)
    assert.equal(d.url, 'https://x.example/f.zip')
    assert.equal(d.filename, 'f.zip')
    assert.equal(d.kind, 'file')
    assert.equal(d.status, 'queued')
    assert.equal(d.totalBytes, 1000)
    assert.equal(d.doneBytes, 0)
    assert.equal(d.engine, 'aria2')
    assert.equal(d.sortOrder, 1000)
    assert.equal(d.speedLimitKBps, 0)
    assert.equal(d.pinned, false)
    assert.equal(d.speedBps, 0)
    assert.equal(d.etaSeconds, null)
    assert.equal(db.getDownload('nope'), null)
  })

  it('insert full fields + updateDownload patch (incl. pinned) + empty patch no-op', () => {
    db.insertDownload({
      id: 'dl-full',
      url: 'https://youtu.be/abc',
      title: 'Film',
      filename: 'Film.mp4',
      savePath: join(dir, 'Film.mp4'),
      kind: 'video',
      formatLabel: '1080p',
      status: 'downloading',
      totalBytes: 5000,
      doneBytes: 100,
      errorCode: null,
      errorMessage: null,
      thumbnailUrl: 'https://i.example/t.jpg',
      site: 'youtu.be',
      remoteId: 'abc',
      engine: 'ytdlp',
      engineRef: 'gid-9',
      formatId: '399',
      formatString: 'bv*[height<=1080]+ba',
      ytdlpState: '{"subtitles":true}',
      sortOrder: 42,
      speedLimitKBps: 512,
      pinned: true,
      createdAt: 2000,
      startedAt: 2001,
      completedAt: null
    })
    const d = db.getDownload('dl-full')
    assert.ok(d)
    assert.equal(d.title, 'Film')
    assert.equal(d.engine, 'ytdlp')
    assert.equal(d.formatId, '399')
    assert.equal(d.ytdlpState, '{"subtitles":true}')
    assert.equal(d.sortOrder, 42)
    assert.equal(d.speedLimitKBps, 512)
    assert.equal(d.pinned, true)
    db.updateDownload('dl-full', { status: 'completed', doneBytes: 5000, completedAt: 3000, pinned: false })
    const d2 = db.getDownload('dl-full')
    assert.equal(d2?.status, 'completed')
    assert.equal(d2?.doneBytes, 5000)
    assert.equal(d2?.completedAt, 3000)
    assert.equal(d2?.pinned, false)
    db.updateDownload('dl-full', {})
    assert.equal(db.getDownload('dl-full')?.status, 'completed')
  })

  it('listDownloads is newest-first; deleteDownload removes the row', () => {
    insertMinimal({ id: 'a', createdAt: 100 })
    insertMinimal({ id: 'b', createdAt: 300 })
    insertMinimal({ id: 'c', createdAt: 200 })
    assert.deepEqual(
      db.listDownloads().map((d) => d.id),
      ['b', 'c', 'a']
    )
    db.deleteDownload('b')
    assert.deepEqual(
      db.listDownloads().map((d) => d.id),
      ['c', 'a']
    )
    assert.equal(db.getDownload('b'), null)
  })

  it('findCompletedDuplicate: same URL completed; live rows excluded; remote+format match; NULLs never match', () => {
    insertMinimal({ id: 'done-url', url: 'https://x.example/a.zip', status: 'completed', completedAt: 500 })
    insertMinimal({ id: 'live-url', url: 'https://x.example/b.zip', status: 'downloading' })
    insertMinimal({
      id: 'done-remote',
      url: 'https://youtu.be/other',
      status: 'completed',
      remoteId: 'vid-1',
      formatId: '399',
      completedAt: 600
    })
    insertMinimal({
      id: 'done-null',
      url: 'https://youtu.be/third',
      status: 'completed',
      remoteId: null,
      formatId: null,
      completedAt: 700
    })

    const byUrl = db.findCompletedDuplicate('https://x.example/a.zip', null, null)
    assert.equal(byUrl?.id, 'done-url')
    assert.equal(byUrl?.filename, 'f.zip')
    // Live row with the same URL is NOT a duplicate.
    assert.equal(db.findCompletedDuplicate('https://x.example/b.zip', null, null), null)
    // Same extractor id + format, different URL -> remote match.
    const byRemote = db.findCompletedDuplicate('https://youtu.be/whatever', 'vid-1', '399')
    assert.equal(byRemote?.id, 'done-remote')
    // Wrong format -> no remote match.
    assert.equal(db.findCompletedDuplicate('https://youtu.be/whatever', 'vid-1', '140'), null)
    // NULL remote/format never match, even against a completed NULL row.
    assert.equal(db.findCompletedDuplicate('https://youtu.be/nope', null, null), null)
    assert.equal(db.findCompletedDuplicate('https://youtu.be/nope', 'vid-9', '399'), null)
  })

  it('clearHistory removes only finished rows and returns the count', () => {
    insertMinimal({ id: 'c1', status: 'completed' })
    insertMinimal({ id: 'c2', status: 'failed' })
    insertMinimal({ id: 'c3', status: 'cancelled' })
    insertMinimal({ id: 'k1', status: 'queued' })
    insertMinimal({ id: 'k2', status: 'paused' })
    insertMinimal({ id: 'k3', status: 'downloading' })
    assert.equal(db.clearHistory(), 3)
    assert.deepEqual(
      db.listDownloads().map((d) => d.id).sort(),
      ['k1', 'k2', 'k3']
    )
    assert.equal(db.clearHistory(), 0)
  })

  it('settings: set/get round-trip + overwrite', () => {
    db.setSetting('language', '"en"')
    assert.equal(db.getSetting('language'), '"en"')
    db.setSetting('language', '"bn"')
    assert.equal(db.getSetting('language'), '"bn"')
    assert.equal(db.getSetting('missing'), null)
  })

  it('subscriptions: insert/get/list/findByUrl/update/delete; corrupt pending JSON -> []', () => {
    db.insertSubscription({
      id: 'sub-1',
      url: 'https://youtube.com/@chan',
      title: 'Chan',
      uploader: 'Chan',
      lastVideoId: 'v1',
      createdAt: 100
    })
    db.insertSubscription({
      id: 'sub-2',
      url: 'https://youtube.com/@other',
      title: 'Other',
      uploader: null,
      lastVideoId: null,
      createdAt: 200
    })
    assert.deepEqual(
      db.listSubscriptions().map((s) => s.id),
      ['sub-1', 'sub-2']
    )
    assert.equal(db.findSubscriptionByUrl('https://youtube.com/@chan')?.title, 'Chan')
    assert.equal(db.findSubscriptionByUrl('https://youtube.com/@nope'), null)
    assert.equal(db.getSubscription('nope'), null)
    db.updateSubscription('sub-1', {
      lastVideoId: 'v2',
      lastCheckedAt: 999,
      pending: [{ id: 'v2', title: 'New', url: 'https://youtu.be/v2', duration: 30, thumbnail: null }]
    })
    const s1 = db.getSubscription('sub-1')
    assert.equal(s1?.lastVideoId, 'v2')
    assert.equal(s1?.lastCheckedAt, 999)
    assert.equal(s1?.pending.length, 1)
    assert.equal(s1?.pending[0].title, 'New')
    db.updateSubscription('sub-1', {})
    assert.equal(db.getSubscription('sub-1')?.lastVideoId, 'v2')
    // Corrupt the pending JSON directly — the reader falls back to [].
    const raw = new DatabaseSync(dbPath)
    raw.prepare("UPDATE subscriptions SET pending = 'not json' WHERE id = 'sub-1'").run()
    raw.close()
    assert.deepEqual(db.getSubscription('sub-1')?.pending, [])
    db.deleteSubscription('sub-1')
    assert.deepEqual(
      db.listSubscriptions().map((s) => s.id),
      ['sub-2']
    )
  })

  it('opening a v1 database migrates to v5 and leaves a .bak backup', () => {
    const v1Path = join(dir, 'v1.db')
    const raw = new DatabaseSync(v1Path)
    raw.exec(`
      CREATE TABLE downloads (
        id TEXT PRIMARY KEY, url TEXT NOT NULL, title TEXT, filename TEXT NOT NULL,
        save_path TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'file', format_label TEXT,
        status TEXT NOT NULL, total_bytes INTEGER NOT NULL DEFAULT 0,
        done_bytes INTEGER NOT NULL DEFAULT 0, error_code TEXT, error_message TEXT,
        thumbnail_url TEXT, site TEXT, remote_id TEXT,
        engine TEXT NOT NULL DEFAULT 'aria2', engine_ref TEXT,
        created_at INTEGER NOT NULL, started_at INTEGER, completed_at INTEGER
      );
      CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      PRAGMA user_version = 1;
    `)
    raw.prepare(
      "INSERT INTO downloads (id, url, filename, save_path, status, total_bytes, done_bytes, created_at) VALUES ('old-1', 'https://x.example/old.zip', 'old.zip', ?, 'completed', 10, 10, 50)"
    ).run(join(dir, 'old.zip'))
    raw.close()
    const migrated = new DoviraDb(v1Path)
    try {
      assert.equal(existsSync(`${v1Path}.bak`), true)
      // v3 backfills sort_order from created_at; v5 adds pinned + subscriptions.
      const old = migrated.getDownload('old-1')
      assert.equal(old?.sortOrder, 50)
      assert.equal(old?.pinned, false)
      assert.equal(old?.speedLimitKBps, 0)
      migrated.insertSubscription({
        id: 's',
        url: 'https://youtube.com/@x',
        title: 'X',
        uploader: null,
        lastVideoId: null,
        createdAt: 1
      })
      assert.equal(migrated.listSubscriptions().length, 1)
    } finally {
      migrated.close()
    }
  })
})
