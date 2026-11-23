import { describe, it, before, beforeEach, afterEach, mock } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DoviraDb } from '../src/main/db.ts'
import { SettingsManager } from '../src/main/settings.ts'
import type { QueueManager as QueueManagerType } from '../src/main/queue.ts'

// queue.ts imports `app` from electron — mock it at module scope, and
// import the queue itself DYNAMICALLY below (a static import would load
// it before the mock is registered).
mock.module('electron', {
  exports: { app: { getVersion: () => '1.3.1' } }
})

let QueueManager: typeof QueueManagerType

before(async () => {
  ;({ QueueManager } = await import('../src/main/queue.ts'))
})

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

async function waitFor(fn: () => boolean, timeoutMs = 3000): Promise<boolean> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (fn()) return true
    await sleep(10)
  }
  return fn()
}

type Aria2Status = {
  gid: string
  status: string
  totalLength: string
  completedLength: string
  downloadSpeed: string
  uploadSpeed: string
  connections: string
  dir: string
  files?: { path: string }[]
  followedBy?: string[]
  errorMessage?: string
  errorCode?: string
}

class FakeAria2 {
  ready = false
  started = 0
  addUriCalls: { url: string; opts: Record<string, unknown> }[] = []
  addUrisCalls: { url: string; mirrors: string[]; opts: Record<string, unknown> }[] = []
  pauseCalls: string[] = []
  unpauseCalls: string[] = []
  removeCalls: string[] = []
  removeResultCalls: string[] = []
  changeOptionCalls: { gid: string; opts: Record<string, string> }[] = []
  changeGlobalCalls: Record<string, string>[] = []
  statusMode: 'active' | 'complete' | 'error' = 'active'
  statusDone = 0
  statusTotal = 1000
  statusSpeed = 100
  onUnexpectedExit: (() => void) | null = null

  isReady(): boolean {
    return this.ready
  }

  async start(): Promise<void> {
    this.started++
    this.ready = true
  }

  async stop(): Promise<void> {
    this.ready = false
  }

  getLastLog(): string {
    return ''
  }

  async addUri(url: string, opts: Record<string, unknown>): Promise<string> {
    this.addUriCalls.push({ url, opts })
    return 'gid-1'
  }

  async addUris(url: string, mirrors: string[], opts: Record<string, unknown>): Promise<string> {
    this.addUrisCalls.push({ url, mirrors, opts })
    return 'gid-1'
  }

  async tellStatus(gid: string): Promise<Aria2Status> {
    return {
      gid,
      status: this.statusMode,
      totalLength: String(this.statusTotal),
      completedLength: String(this.statusMode === 'complete' ? this.statusTotal : this.statusDone),
      downloadSpeed: String(this.statusSpeed),
      uploadSpeed: '0',
      connections: '4',
      dir: 'C:\\DL'
    }
  }

  async pause(gid: string): Promise<string> {
    this.pauseCalls.push(gid)
    return gid
  }

  async unpause(gid: string): Promise<string> {
    this.unpauseCalls.push(gid)
    return gid
  }

  async remove(gid: string): Promise<string> {
    this.removeCalls.push(gid)
    return gid
  }

  async removeDownloadResult(gid: string): Promise<string> {
    this.removeResultCalls.push(gid)
    return gid
  }

  async changeOption(gid: string, opts: Record<string, string>): Promise<string> {
    this.changeOptionCalls.push({ gid, opts })
    return 'OK'
  }

  async changeGlobalOption(opts: Record<string, string>): Promise<string> {
    this.changeGlobalCalls.push(opts)
    return 'OK'
  }
}

type YtDlpProgress = {
  doneBytes: number
  totalBytes: number
  speedBps: number
  etaSeconds: number | null
  status: 'downloading' | 'finished'
}

type FakeJob = { kill: () => void; killCalls: string[] }

class FakeYtDlp {
  buildArgsCalls: unknown[] = []
  runCalls: {
    args: string[]
    cb: { onProgress: (p: YtDlpProgress) => void; onLog: (l: string) => void }
    resolve: (r: { code: number; stderr: string }) => void
    job: FakeJob
  }[] = []
  recoverResult = true
  recoverCalls: { savePath: string; kind: string; bitrate: string }[] = []
  fetchInfoResult: unknown = null

  buildArgs(opts: unknown): string[] {
    this.buildArgsCalls.push(opts)
    return ['--fake-args']
  }

  buildPlainArgs(url: string, savePath: string, limit: number): string[] {
    return ['--fake-plain-args', url, savePath, String(limit)]
  }

  runDownload(
    args: string[],
    cb: { onProgress: (p: YtDlpProgress) => void; onLog: (l: string) => void }
  ): { job: FakeJob; done: Promise<{ code: number; stderr: string }> } {
    const job: FakeJob = { kill: () => job.killCalls.push('SIGTERM'), killCalls: [] }
    let resolve!: (r: { code: number; stderr: string }) => void
    const done = new Promise<{ code: number; stderr: string }>((res) => {
      resolve = res
    })
    // The job does NOT exit on its own — the test resolves it after
    // staging the output file / progress events. No timing races.
    this.runCalls.push({ args, cb, resolve, job })
    return { job: job as never, done }
  }

  /** Deliver a progress event to the most recent run. */
  progressLast(p: YtDlpProgress): void {
    this.runCalls[this.runCalls.length - 1]?.cb.onProgress(p)
  }

  /** Resolve the most recent run's done promise. */
  resolveLast(result: { code: number; stderr: string }): void {
    this.runCalls[this.runCalls.length - 1]?.resolve(result)
  }

  async recoverRenameRace(savePath: string, kind: string, bitrate: string): Promise<boolean> {
    this.recoverCalls.push({ savePath, kind, bitrate })
    return this.recoverResult
  }

  async fetchInfo(): Promise<unknown> {
    return this.fetchInfoResult
  }

  async fetchPlaylist(): Promise<unknown> {
    return { entries: [] }
  }
}

describe('QueueManager', () => {
  let dir: string
  let db: DoviraDb
  let settings: SettingsManager
  let aria2: FakeAria2
  let ytdlp: FakeYtDlp
  let q: QueueManagerType
  let origFetch: typeof fetch
  let fetchCalls: string[]
  let headShouldFail: boolean

  function makeQueue(a2: FakeAria2 | null, yt: FakeYtDlp | null): QueueManagerType {
    return new QueueManager(db, settings, a2 as never, yt as never)
  }

  function seedRow(over: Record<string, unknown> = {}): string {
    const id = (over['id'] as string) ?? `seed-${Math.random().toString(36).slice(2, 8)}`
    db.insertDownload({
      id,
      url: (over['url'] as string) ?? `https://x.example/${id}.zip`,
      filename: (over['filename'] as string) ?? 'seed.zip',
      savePath: (over['savePath'] as string) ?? join(dir, 'seed.zip'),
      kind: (over['kind'] as 'file' | 'video' | 'audio') ?? 'file',
      status: (over['status'] as 'queued' | 'downloading' | 'paused' | 'failed' | 'cancelled' | 'completed' | 'fetching_info' | 'processing') ?? 'paused',
      totalBytes: (over['totalBytes'] as number) ?? 1000,
      doneBytes: (over['doneBytes'] as number) ?? 0,
      createdAt: (over['createdAt'] as number) ?? Date.now(),
      sortOrder: (over['sortOrder'] as number) ?? Date.now(),
      engine: (over['engine'] as string) ?? 'aria2',
      completedAt: (over['completedAt'] as number | null) ?? null,
      remoteId: (over['remoteId'] as string | null) ?? null,
      formatId: (over['formatId'] as string | null) ?? null
    })
    return id
  }

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'dovira-queue-'))
    db = new DoviraDb(join(dir, 'dovira.db'))
    settings = new SettingsManager(db)
    // Keep everything inside the temp dir; no retries (no 2s/5s/15s waits).
    settings.update({ downloadDir: dir, autoRetry: 0, smartDownload: false })
    aria2 = new FakeAria2()
    ytdlp = new FakeYtDlp()
    q = makeQueue(aria2, ytdlp)
    origFetch = globalThis.fetch
    fetchCalls = []
    headShouldFail = false
    globalThis.fetch = (async (url: string) => {
      fetchCalls.push(url)
      if (headShouldFail) throw new Error('HEAD refused')
      return {
        ok: true,
        headers: {
          get: (name: string) => {
            if (name === 'content-length') return '1000'
            if (name === 'content-type') return 'application/zip'
            return null
          }
        }
      }
    }) as typeof fetch
  })

  afterEach(() => {
    globalThis.fetch = origFetch
    q.shutdown()
    try {
      db.close()
    } catch {
      // Already closed.
    }
    rmSync(dir, { recursive: true, force: true })
  })

  it('constructor resets in-flight rows to paused (memory + db)', () => {
    const id = seedRow({ status: 'downloading' })
    const q2 = makeQueue(aria2, ytdlp)
    try {
      assert.equal(q2.get(id)?.status, 'paused')
      assert.equal(db.getDownload(id)?.status, 'paused')
      const id2 = seedRow({ status: 'paused' })
      const q3 = makeQueue(aria2, ytdlp)
      try {
        assert.equal(q3.get(id2)?.status, 'paused')
      } finally {
        q3.shutdown()
      }
    } finally {
      q2.shutdown()
    }
  })

  it('fetchInfo: magnet, invalid URL, .torrent URL, plain file via HEAD, cache + force', async () => {
    const mag = await q.fetchInfo('magnet:?xt=urn:btih:abc&dn=My+Film')
    assert.equal(mag.ok, true)
    assert.equal(mag.torrent?.name, 'My Film')
    const bad = await q.fetchInfo('not a url')
    assert.deepEqual({ ok: bad.ok, error: bad.error }, { ok: false, error: 'invalid-url' })
    const tor = await q.fetchInfo('https://x.example/f.torrent')
    assert.equal(tor.ok, true)
    assert.equal(tor.torrent?.name, 'f.torrent')
    const plain = await q.fetchInfo('https://x.example/f.zip')
    assert.equal(plain.ok, true)
    assert.equal(plain.plainFile?.filename, 'f.zip')
    assert.equal(plain.plainFile?.size, 1000)
    // Second call hits the 5-min cache — no second HEAD.
    const callsBefore = fetchCalls.length
    const plain2 = await q.fetchInfo('https://x.example/f.zip')
    assert.equal(plain2.ok, true)
    assert.equal(fetchCalls.length, callsBefore)
    // force: true bypasses the cache.
    await q.fetchInfo('https://x.example/f.zip', undefined, { force: true })
    assert.equal(fetchCalls.length, callsBefore + 1)
    // HEAD failing still yields a plain file with unknown size.
    headShouldFail = true
    const noHead = await q.fetchInfo('https://x.example/other.zip')
    assert.equal(noHead.ok, true)
    assert.equal(noHead.plainFile?.size, null)
  })

  it('fetchInfo with no yt-dlp: a non-file URL fails engine-missing', async () => {
    const qNoYt = makeQueue(aria2, null)
    try {
      // The HEAD stub answers application/zip for every URL, which
      // would make this look like a plain file — fail HEAD so the
      // plain-file fallback cannot save it.
      headShouldFail = true
      const res = await qNoYt.fetchInfo('https://youtu.be/abc123')
      assert.equal(res.ok, false)
      assert.equal(res.error, 'engine-missing')
    } finally {
      qNoYt.shutdown()
    }
  })

  it('add: invalid + unsupported URLs; live-URL dedup returns the same id', async () => {
    assert.deepEqual(await q.add('not a url'), { ok: false, error: 'invalid-url' })
    assert.deepEqual(await q.add('ftp://x.example/f.zip'), { ok: false, error: 'unsupported-url' })
    const first = await q.add('https://x.example/f.zip')
    assert.equal(first.ok, true)
    assert.ok(first.id)
    // The row is downloading via the fake aria2 — a second add dedups.
    assert.equal(await waitFor(() => q.get(first.id as string)?.status === 'downloading'), true)
    const second = await q.add('https://x.example/f.zip')
    assert.deepEqual(second, { ok: true, id: first.id })
    assert.equal(aria2.addUriCalls.length, 1)
  })

  it('add: a completed row with the same URL is a duplicate', async () => {
    seedRow({ id: 'done-1', url: 'https://x.example/dup.zip', status: 'completed', completedAt: 100 })
    const q2 = makeQueue(aria2, ytdlp)
    try {
      const res = await q2.add('https://x.example/dup.zip')
      assert.equal(res.ok, false)
      assert.equal(res.error, 'duplicate')
      assert.equal(res.id, 'done-1')
    } finally {
      q2.shutdown()
    }
  })

  it('aria2 flow: add -> downloading -> pollTick complete -> completed', async () => {
    const res = await q.add('https://x.example/f.zip')
    assert.equal(res.ok, true)
    const id = res.id as string
    assert.equal(await waitFor(() => q.get(id)?.status === 'downloading'), true)
    assert.equal(aria2.addUriCalls.length, 1)
    assert.equal(aria2.addUriCalls[0].url, 'https://x.example/f.zip')
    assert.equal(aria2.addUriCalls[0].opts['dir'], join(dir, 'Archives'))
    assert.equal(aria2.addUriCalls[0].opts['out'], 'f.zip')
    // Progress tick first (active, half done).
    aria2.statusMode = 'active'
    aria2.statusDone = 500
    await (q as unknown as { pollTick: () => Promise<void> }).pollTick()
    assert.equal(q.get(id)?.doneBytes, 500)
    assert.equal(q.get(id)?.status, 'downloading')
    // Then completion.
    aria2.statusMode = 'complete'
    await (q as unknown as { pollTick: () => Promise<void> }).pollTick()
    assert.equal(q.get(id)?.status, 'completed')
    assert.equal(q.get(id)?.doneBytes, 1000)
    assert.equal(q.get(id)?.totalBytes, 1000)
    assert.ok(q.get(id)?.completedAt !== null)
    assert.deepEqual(aria2.removeResultCalls, ['gid-1'])
    assert.equal(q.isIdle(), true)
  })

  it('aria2 flow: pause -> resume -> cancel -> remove', async () => {
    const res = await q.add('https://x.example/f.zip')
    const id = res.id as string
    assert.equal(await waitFor(() => q.get(id)?.status === 'downloading'), true)
    assert.equal(await q.pause(id), true)
    assert.equal(q.get(id)?.status, 'paused')
    assert.deepEqual(aria2.pauseCalls, ['gid-1'])
    assert.equal(await q.pause(id), false) // already paused
    assert.equal(await q.resume(id), true)
    // resume() sets 'queued' synchronously, but the pump restarts the
    // download on the next microtask — wait for the steady state.
    assert.equal(await waitFor(() => q.get(id)?.status === 'downloading'), true)
    assert.equal(aria2.addUriCalls.length, 2)
    assert.equal(await q.cancel(id), true)
    assert.equal(q.get(id)?.status, 'cancelled')
    assert.deepEqual(aria2.removeCalls, ['gid-1'])
    assert.equal(await q.cancel('nope'), false)
    assert.equal(await q.remove(id, false), true)
    assert.equal(q.get(id), undefined)
    assert.equal(db.getDownload(id), null)
    assert.equal(await q.remove('nope', false), false)
  })

  it('aria2 error status fails the row (autoRetry 0, no waiting)', async () => {
    const res = await q.add('https://x.example/f.zip')
    const id = res.id as string
    assert.equal(await waitFor(() => q.get(id)?.status === 'downloading'), true)
    aria2.statusMode = 'error'
    await (q as unknown as { pollTick: () => Promise<void> }).pollTick()
    assert.equal(q.get(id)?.status, 'failed')
    assert.ok(q.get(id)?.errorCode !== null)
  })

  it('no engines: add starts the pump, which fails the row engine-missing', async () => {
    const qNoEng = makeQueue(null, null)
    try {
      const res = await qNoEng.add('https://x.example/f.zip')
      assert.equal(res.ok, true)
      const id = res.id as string
      assert.equal(await waitFor(() => qNoEng.get(id)?.status === 'failed', 3000), true)
      assert.equal(qNoEng.get(id)?.errorCode, 'engine-missing')
    } finally {
      qNoEng.shutdown()
    }
  })

  it('moveToTop / reorder / togglePin persist sort order + pin', async () => {
    seedRow({ id: 'a', sortOrder: 1000, createdAt: 1000 })
    seedRow({ id: 'b', sortOrder: 2000, createdAt: 2000 })
    seedRow({ id: 'c', sortOrder: 3000, createdAt: 3000 })
    const q2 = makeQueue(aria2, ytdlp)
    try {
      assert.equal(await q2.moveToTop('c'), true)
      assert.equal(db.getDownload('c')?.sortOrder, 999)
      assert.equal(await q2.moveToTop('nope'), false)
      assert.equal(await q2.togglePin('a'), true)
      assert.equal(db.getDownload('a')?.pinned, true)
      assert.equal(await q2.togglePin('a'), false)
      assert.equal(await q2.togglePin('nope'), null)
      // Reorder b before a: rest (excluding b) is [c=999, a=1000], so
      // the order becomes c, b, a -> renumbered 1000/2000/3000.
      assert.equal(await q2.reorder('b', 'a'), true)
      assert.equal(db.getDownload('c')?.sortOrder, 1000)
      assert.equal(db.getDownload('b')?.sortOrder, 2000)
      assert.equal(db.getDownload('a')?.sortOrder, 3000)
      assert.equal(await q2.reorder('b', 'nope'), false)
      assert.equal(await q2.reorder('nope', 'a'), false)
      // Move a to the end: order stays c, b, a.
      assert.equal(await q2.reorder('a', null), true)
      assert.equal(db.getDownload('a')?.sortOrder, 3000)
    } finally {
      q2.shutdown()
    }
  })

  it('pauseAll / resumeAll / startScheduledRun + isIdle', async () => {
    const res = await q.add('https://x.example/f.zip')
    const id = res.id as string
    assert.equal(await waitFor(() => q.get(id)?.status === 'downloading'), true)
    assert.equal(q.isIdle(), false)
    assert.equal(await q.pauseAll(), 1)
    assert.equal(q.get(id)?.status, 'paused')
    assert.equal(q.isIdle(), true)
    assert.equal(await q.resumeAll(), 1)
    assert.equal(await waitFor(() => q.get(id)?.status === 'downloading'), true)
    assert.equal(await q.startScheduledRun(), 0) // nothing paused anymore
    await q.pause(id)
    assert.equal(await q.startScheduledRun(), 1)
  })

  it('clearHistory + historyMissing + getByUrl', async () => {
    const keep = seedRow({ id: 'keep', url: 'https://x.example/keep.zip', status: 'queued' })
    const done = seedRow({ id: 'done', url: 'https://x.example/done.zip', status: 'completed', completedAt: 5, savePath: join(dir, 'exists.zip') })
    const missing = seedRow({ id: 'gone', url: 'https://x.example/gone.zip', status: 'completed', completedAt: 6, savePath: join(dir, 'gone.zip') })
    const failed = seedRow({ id: 'fail', url: 'https://x.example/fail.zip', status: 'failed', savePath: join(dir, 'fail.zip') })
    writeFileSync(join(dir, 'exists.zip'), 'x')
    const q2 = makeQueue(aria2, ytdlp)
    try {
      assert.equal(q2.getByUrl('https://x.example/keep.zip')?.id, 'keep')
      assert.deepEqual(q2.historyMissing().sort(), ['fail', 'gone'])
      assert.equal(q2.clearHistory(), 3)
      assert.equal(q2.get(done), undefined)
      assert.equal(q2.get(missing), undefined)
      assert.equal(q2.get(failed), undefined)
      assert.ok(q2.get(keep))
      assert.deepEqual(q2.historyMissing(), [])
    } finally {
      q2.shutdown()
    }
  })

  it('checkDuplicate / smartCategorize / smartSuggestName', () => {
    seedRow({ id: 'done', url: 'https://x.example/dup.zip', status: 'completed', completedAt: 5 })
    writeFileSync(join(dir, 'ondisk.zip'), 'x'.repeat(10))
    const q2 = makeQueue(aria2, ytdlp)
    try {
      const byUrl = q2.checkDuplicate({ url: 'https://x.example/dup.zip', filename: 'dup.zip', saveDir: dir, totalBytes: null })
      assert.equal(byUrl.duplicate, true)
      assert.equal(byUrl.kind, 'url')
      assert.equal(byUrl.existingId, 'done')
      const byFile = q2.checkDuplicate({ url: 'https://x.example/other.zip', filename: 'ondisk.zip', saveDir: dir, totalBytes: 10 })
      assert.equal(byFile.duplicate, true)
      assert.equal(byFile.kind, 'file')
      const none = q2.checkDuplicate({ url: 'https://x.example/new.zip', filename: 'new.zip', saveDir: dir, totalBytes: null })
      assert.equal(none.duplicate, false)
      const cat = q2.smartCategorize({ filename: 'Film.mp4', kind: 'video' })
      assert.equal(cat.category, 'Video')
      assert.equal(cat.folder, join(dir, 'Video'))
      const name = q2.smartSuggestName({ filename: 'Film.mp4', title: 'My Film', height: 1080 })
      assert.equal(name.name, 'My Film [1080p].mp4')
    } finally {
      q2.shutdown()
    }
  })

  it('applySpeedLimits + setDownloadSpeedLimit (fake aria2)', async () => {
    settings.update({ speedLimitKBps: 200 })
    aria2.ready = true
    await q.applySpeedLimits()
    assert.deepEqual(aria2.changeGlobalCalls, [{ 'max-overall-download-limit': '204800' }])
    const res = await q.add('https://x.example/f.zip')
    const id = res.id as string
    assert.equal(await waitFor(() => q.get(id)?.status === 'downloading'), true)
    assert.equal(await q.setDownloadSpeedLimit(id, 512), true)
    assert.equal(q.get(id)?.speedLimitKBps, 512)
    assert.equal(db.getDownload(id)?.speedLimitKBps, 512)
    // Live aria2 row picks the cap up immediately.
    assert.ok(aria2.changeOptionCalls.some((c) => c.opts['max-download-limit'] === '524288'))
    assert.equal(await q.setDownloadSpeedLimit(id, 2_000_000), true)
    assert.equal(q.get(id)?.speedLimitKBps, 1_000_000)
    assert.equal(await q.setDownloadSpeedLimit('nope', 100), false)
    // aria2 not ready -> applySpeedLimits is a silent no-op.
    aria2.ready = false
    aria2.changeGlobalCalls = []
    await q.applySpeedLimits()
    assert.deepEqual(aria2.changeGlobalCalls, [])
  })

  it('addMany counts added vs failed', async () => {
    const out = await q.addMany(['https://x.example/a.zip', 'not a url', 'https://x.example/b.zip'])
    assert.equal(out.added, 2)
    assert.equal(out.failed, 1)
    assert.equal(out.ids.length, 2)
  })

  it('addWithOptions: validation, engine-missing without yt-dlp, yt-dlp success flow', async () => {
    // No yt-dlp configured -> engine-missing.
    const qNoYt = makeQueue(aria2, null)
    try {
      const r = await qNoYt.addWithOptions({
        url: 'https://youtu.be/abc',
        kind: 'video',
        formatId: '1080p',
        formatString: 'bv*[height<=1080]+ba',
        qualityLabel: '1080p',
        savePath: join(dir, 'Film.mp4'),
        filename: 'Film.mp4'
      } as never)
      assert.deepEqual(r, { ok: false, error: 'engine-missing' })
    } finally {
      qNoYt.shutdown()
    }
    // Invalid options -> invalid-url.
    const bad = await q.addWithOptions({ url: 'https://youtu.be/abc', kind: 'video', formatString: '', savePath: '', filename: '' } as never)
    assert.equal(bad.ok, false)
    assert.equal(bad.error, 'invalid-url')
    // Success flow with the fake yt-dlp: the job exits 0 only when the
    // test resolves it, after the output file is staged on disk.
    const res = await q.addWithOptions({
      url: 'https://youtu.be/abc',
      kind: 'video',
      formatId: '1080p',
      formatString: 'bv*[height<=1080]+ba',
      qualityLabel: '1080p',
      savePath: join(dir, 'Film.mp4'),
      filename: 'Film.mp4',
      title: 'Film',
      thumbnailUrl: null,
      applySmartName: false
    } as never)
    assert.equal(res.ok, true)
    const id = res.id as string
    assert.equal(await waitFor(() => q.get(id)?.status === 'downloading'), true)
    assert.equal(ytdlp.buildArgsCalls.length, 1)
    const actualPath = q.get(id)?.savePath as string
    assert.equal(actualPath, join(dir, 'Video', 'Film.mp4'))
    mkdirSync(join(dir, 'Video'), { recursive: true })
    writeFileSync(actualPath, 'x'.repeat(1234))
    ytdlp.resolveLast({ code: 0, stderr: '' })
    assert.equal(await waitFor(() => q.get(id)?.status === 'completed', 3000), true)
    assert.equal(q.get(id)?.totalBytes, 1234)
    assert.equal(q.get(id)?.doneBytes, 1234)
  })

  it('yt-dlp flow: non-zero exit with rename-race + finished format recovers', async () => {
    const res = await q.addWithOptions({
      url: 'https://youtu.be/abc',
      kind: 'video',
      formatId: '1080p',
      formatString: 'bv*[height<=1080]+ba',
      qualityLabel: '1080p',
      savePath: join(dir, 'Film.mp4'),
      filename: 'Film.mp4',
      applySmartName: false
    } as never)
    const id = res.id as string
    assert.equal(await waitFor(() => q.get(id)?.status === 'downloading'), true)
    const actualPath = q.get(id)?.savePath as string
    mkdirSync(join(dir, 'Video'), { recursive: true })
    writeFileSync(actualPath, 'x'.repeat(777))
    // One format verifiably finished, then the rename failed.
    ytdlp.progressLast({ doneBytes: 100, totalBytes: 100, speedBps: 10, etaSeconds: 0, status: 'finished' })
    ytdlp.resolveLast({ code: 1, stderr: 'ERROR: Unable to rename file' })
    assert.equal(await waitFor(() => q.get(id)?.status === 'completed', 3000), true)
    assert.equal(ytdlp.recoverCalls.length, 1)
    assert.equal(ytdlp.recoverCalls[0].savePath, actualPath)
  })

  it('yt-dlp flow: non-zero exit without recovery fails with the mapped code', async () => {
    const res = await q.addWithOptions({
      url: 'https://youtu.be/abc',
      kind: 'video',
      formatId: '1080p',
      formatString: 'bv*[height<=1080]+ba',
      qualityLabel: '1080p',
      savePath: join(dir, 'Film.mp4'),
      filename: 'Film.mp4',
      applySmartName: false
    } as never)
    const id = res.id as string
    assert.equal(await waitFor(() => q.get(id)?.status === 'downloading'), true)
    ytdlp.resolveLast({ code: 1, stderr: 'ERROR: This video is unavailable' })
    assert.equal(await waitFor(() => q.get(id)?.status === 'failed', 3000), true)
    assert.equal(q.get(id)?.errorCode, 'unavailable')
  })

  it('stopRecording: false without liveRecord / when not downloading', async () => {
    const id = seedRow({ status: 'paused' })
    const q2 = makeQueue(aria2, ytdlp)
    try {
      assert.equal(await q2.stopRecording(id), false)
      assert.equal(await q2.stopRecording('nope'), false)
    } finally {
      q2.shutdown()
    }
  })

  it('askAssistant: disabled returns the disabled lines; a status question is answered by rules', async () => {
    settings.update({ assistantEnabled: false })
    const off = await q.askAssistant('how many downloads are running?')
    assert.equal(off.intent, 'fallback')
    assert.equal(off.source, 'rules')
    assert.deepEqual(off.lines, [{ key: 'assistant.disabled' }])
    settings.update({ assistantEnabled: true, assistantLocalModel: false })
    const on = await q.askAssistant('how many downloads are running?')
    assert.equal(on.source, 'rules')
    assert.ok(on.lines.length > 0)
  })

  it('retry: resume-state-mismatch clears partials and restarts from zero', async () => {
    const savePath = join(dir, 'Film.mp4')
    // Real yt-dlp temp naming: <stem>.f<id>.<ext>.part — NOT
    // <savePath>.f<id>.<ext>.part.
    writeFileSync(join(dir, 'Film.f399.mp4.part'), 'partial-bytes')
    const id = seedRow({
      status: 'failed',
      kind: 'video',
      engine: 'ytdlp',
      savePath,
      filename: 'Film.mp4',
      doneBytes: 500,
      totalBytes: 1000
    })
    const q2 = makeQueue(aria2, ytdlp)
    try {
      const row = q2.get(id) as never as { errorCode: string | null }
      row.errorCode = 'resume-state-mismatch'
      // Stop the pump so retry's own effects are what we observe —
      // otherwise the pump restarts the download immediately.
      q2.shutdown()
      assert.equal(await q2.retry(id), true)
      assert.equal(q2.get(id)?.status, 'queued')
      assert.equal(q2.get(id)?.doneBytes, 0)
      assert.equal(q2.get(id)?.ytdlpState, null)
      assert.equal(existsSync(join(dir, 'Film.f399.mp4.part')), false)
    } finally {
      q2.shutdown()
    }
  })
})
