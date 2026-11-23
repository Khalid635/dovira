import { describe, it, before, beforeEach, afterEach, mock } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DoviraDb } from '../src/main/db.ts'
import { SettingsManager } from '../src/main/settings.ts'
import type { LocalApiServer as LocalApiServerType } from '../src/main/localApi.ts'
import type { ExtensionDownloadRequest } from '../src/main/types.ts'

// localApi.ts imports `app` + `safeStorage` from electron — mock them at
// module scope, before the module is first imported. Encryption is OFF
// in these tests (safeStorage unavailable), so the token stays plaintext
// in Settings — exactly the legacy path.
mock.module('electron', {
  exports: {
    app: { getVersion: () => '1.3.1' },
    safeStorage: {
      isEncryptionAvailable: () => false,
      encryptString: () => {
        throw new Error('no encryption in tests')
      },
      decryptString: () => {
        throw new Error('no encryption in tests')
      }
    }
  }
})

let LocalApiServer: typeof LocalApiServerType
let maskUrl: typeof import('../src/main/localApi.ts').maskUrl
let netscapeCookiesToHeader: typeof import('../src/main/localApi.ts').netscapeCookiesToHeader
let mimeForPreview: typeof import('../src/main/localApi.ts').mimeForPreview

before(async () => {
  const mod = await import('../src/main/localApi.ts')
  LocalApiServer = mod.LocalApiServer
  maskUrl = mod.maskUrl
  netscapeCookiesToHeader = mod.netscapeCookiesToHeader
  mimeForPreview = mod.mimeForPreview
})

describe('localApi pure helpers', () => {
  it('maskUrl strips the query string; invalid input -> (invalid url)', () => {
    assert.equal(maskUrl('https://x.example/p?q=1&token=abc'), 'https://x.example/p')
    assert.equal(maskUrl('https://x.example/'), 'https://x.example/')
    assert.equal(maskUrl('not a url'), '(invalid url)')
  })

  it('netscapeCookiesToHeader: domain/path/expiry matching, header joining', () => {
    const future = Math.floor(Date.now() / 1000) + 3600
    const past = Math.floor(Date.now() / 1000) - 3600
    const text = [
      '# Netscape HTTP Cookie File',
      `.example.com\tTRUE\t/\tFALSE\t${future}\tsession\tabc123`,
      `.example.com\tTRUE\t/\tFALSE\t${past}\told\tgone`,
      `.other.com\tTRUE\t/\tFALSE\t${future}\tsession\twrong-domain`,
      `.example.com\tTRUE\t/admin\tFALSE\t${future}\tadmin\tnope`,
      `.example.com\tTRUE\t/\tFALSE\t${future}\tpref\t dark `,
      'short\tline'
    ].join('\n')
    const header = netscapeCookiesToHeader(text, 'https://www.example.com/page')
    // The whole line is trimmed before splitting, so a trailing space
    // in the value does not survive.
    assert.equal(header, 'session=abc123; pref= dark')
    assert.equal(netscapeCookiesToHeader(text, 'https://other.com/'), null)
    assert.equal(netscapeCookiesToHeader('', 'https://www.example.com/'), null)
    assert.equal(netscapeCookiesToHeader(text, 'not a url'), null)
  })

  it('mimeForPreview: playable types only, case-insensitive extension', () => {
    assert.equal(mimeForPreview('Film.mp4'), 'video/mp4')
    assert.equal(mimeForPreview('Film.MP4'), 'video/mp4')
    assert.equal(mimeForPreview('Song.flac'), 'audio/flac')
    assert.equal(mimeForPreview('Song.mp3'), 'audio/mpeg')
    assert.equal(mimeForPreview('Clip.webm'), 'video/webm')
    assert.equal(mimeForPreview('Doc.txt'), null)
    assert.equal(mimeForPreview('Archive.zip'), null)
    assert.equal(mimeForPreview('noext'), null)
  })
})

describe('LocalApiServer (real HTTP on 127.0.0.1)', () => {
  let dir: string
  let userData: string
  let db: DoviraDb
  let settings: SettingsManager
  let api: LocalApiServerType
  let hookCalls: ExtensionDownloadRequest[]
  let queueRows: Record<string, { id: string; filename: string; status: string; kind: string; savePath: string; doneBytes: number; totalBytes: number }>
  const TOKEN = 'test-token-0123456789abcdef'

  function url(path: string): string {
    return `http://127.0.0.1:${api.getPort() as number}${path}`
  }

  async function req(path: string, init: RequestInit = {}): Promise<{ status: number; body: Record<string, unknown>; text: string; headers: Headers }> {
    // Connection: close — undici pools keep-alive sockets per origin,
    // and a pooled socket from the previous test's (now stopped) server
    // would come back as ECONNRESET on the rebound port.
    const res = await fetch(url(path), {
      ...init,
      headers: { Connection: 'close', ...(init.headers as Record<string, string> | undefined) }
    })
    const text = await res.text()
    let body: Record<string, unknown> = {}
    try {
      body = JSON.parse(text) as Record<string, unknown>
    } catch {
      // Non-JSON (e.g. /preview file bytes) — leave body empty.
    }
    return { status: res.status, body, text, headers: res.headers }
  }

  function authHeaders(extra: Record<string, string> = {}): Record<string, string> {
    return { Authorization: `Bearer ${TOKEN}`, ...extra }
  }

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'dovira-api-'))
    userData = join(dir, 'userData')
    db = new DoviraDb(join(dir, 'dovira.db'))
    settings = new SettingsManager(db)
    settings.update({ extensionToken: TOKEN, downloadDir: dir })
    hookCalls = []
    queueRows = {}
    const fakeQueue = {
      list: () => Object.values(queueRows),
      get: (id: string) => queueRows[id]
    }
    api = new LocalApiServer(settings, fakeQueue as never, userData, {
      onExtensionDownload: (r) => hookCalls.push(r)
    })
    await api.start()
    assert.ok(api.isRunning(), 'server should be listening')
    assert.ok((api.getPort() as number) >= 17530 && (api.getPort() as number) <= 17540)
    assert.equal(api.getStatus().token, TOKEN)
  })

  afterEach(() => {
    api.stop()
    try {
      db.close()
    } catch {
      // Already closed.
    }
    rmSync(dir, { recursive: true, force: true })
  })

  it('/status: 401 without a token, 403 for a web-page origin, 200 + check-in for the extension', async () => {
    assert.equal(api.getStatus().extensionSeenAt, null)
    let r = await req('/status')
    assert.equal(r.status, 401)
    assert.equal(r.body['error'], 'unauthorized')
    r = await req('/status', { headers: { Authorization: 'Bearer wrong', Origin: 'https://evil.example' } })
    assert.equal(r.status, 403)
    assert.equal(r.body['error'], 'forbidden-origin')
    r = await req('/status', { headers: authHeaders() })
    assert.equal(r.status, 200)
    assert.equal(r.body['app'], 'dovira')
    assert.equal(r.body['version'], '1.3.1')
    // Any authorized request counts as a check-in (MV3 service workers
    // send no Origin header, so the check-in cannot gate on Origin).
    assert.ok(api.getStatus().extensionSeenAt !== null)
    // An extension Origin + the options URL header are accepted and stored.
    r = await req('/status', {
      headers: authHeaders({
        Origin: 'chrome-extension://abcdef',
        'X-Dovira-Options-Url': 'chrome-extension://abcdef/options.html'
      })
    })
    assert.equal(r.status, 200)
    assert.equal(api.getStatus().extensionOptionsUrl, 'chrome-extension://abcdef/options.html')
  })

  it('/extension-settings mirrors the app toggles; /downloads lists queue rows', async () => {
    settings.update({ extensionFloatingButton: false, extensionIntercept: true })
    const r = await req('/extension-settings', { headers: authHeaders() })
    assert.equal(r.status, 200)
    assert.equal(r.body['floatingButton'], false)
    assert.equal(r.body['interceptDownloads'], true)
    queueRows['d1'] = { id: 'd1', filename: 'f.zip', status: 'downloading', kind: 'file', savePath: join(dir, 'f.zip'), doneBytes: 10, totalBytes: 100 }
    const d = await req('/downloads', { headers: authHeaders() })
    assert.equal(d.status, 200)
    assert.deepEqual(d.body['downloads'], [{ id: 'd1', filename: 'f.zip', status: 'downloading', doneBytes: 10, totalBytes: 100 }])
    const unknown = await req('/nope', { headers: authHeaders() })
    assert.equal(unknown.status, 404)
  })

  it('POST /downloads: 400s for bad JSON / missing URL / unsupported scheme; valid -> dialog + hook', async () => {
    let r = await req('/downloads', { method: 'POST', headers: authHeaders({ 'Content-Type': 'application/json' }), body: '{bad json' })
    assert.equal(r.status, 400)
    assert.equal(r.body['error'], 'invalid-json')
    r = await req('/downloads', { method: 'POST', headers: authHeaders({ 'Content-Type': 'application/json' }), body: JSON.stringify({}) })
    assert.equal(r.status, 400)
    assert.equal(r.body['error'], 'invalid-url')
    r = await req('/downloads', { method: 'POST', headers: authHeaders({ 'Content-Type': 'application/json' }), body: JSON.stringify({ url: 'ftp://x.example/f.zip' }) })
    assert.equal(r.status, 400)
    assert.equal(r.body['error'], 'unsupported-url')
    r = await req('/downloads', {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({
        url: 'https://x.example/f.zip',
        mirrors: ['https://m1.example/f.zip', 'ftp://bad.example/f.zip', 42, 'https://m2.example/f.zip', 'https://m3.example/f.zip', 'https://m4.example/f.zip', 'https://m5.example/f.zip', 'https://m6.example/f.zip']
      })
    })
    assert.equal(r.status, 200)
    assert.deepEqual(r.body, { ok: true, dialog: true })
    assert.equal(hookCalls.length, 1)
    assert.equal(hookCalls[0].url, 'https://x.example/f.zip')
    // Mirrors: http(s) only, max 5, non-strings dropped.
    assert.deepEqual(hookCalls[0].mirrors, [
      'https://m1.example/f.zip',
      'https://m2.example/f.zip',
      'https://m3.example/f.zip',
      'https://m4.example/f.zip',
      'https://m5.example/f.zip'
    ])
  })

  it('POST /downloads with cookies writes a temp file and builds the Cookie header', async () => {
    const future = Math.floor(Date.now() / 1000) + 3600
    const cookies = `.example.com\tTRUE\t/\tFALSE\t${future}\tsession\tabc123\n`
    const r = await req('/downloads', {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ url: 'https://www.example.com/f.zip', cookies })
    })
    assert.equal(r.status, 200)
    assert.equal(hookCalls.length, 1)
    assert.ok(hookCalls[0].cookiesFile !== null)
    assert.ok(existsSync(hookCalls[0].cookiesFile as string))
    assert.ok((hookCalls[0].headers ?? []).includes('Cookie: session=abc123'))
  })

  it('/preview: 401 bad token, 404 unknown/not-completed/non-media, 415 unsupported type, 200 + 206 + 416', async () => {
    const file = join(dir, 'Film.mp4')
    writeFileSync(file, Buffer.alloc(100, 7))
    queueRows['v1'] = { id: 'v1', filename: 'Film.mp4', status: 'completed', kind: 'video', savePath: file, doneBytes: 100, totalBytes: 100 }
    queueRows['t1'] = { id: 't1', filename: 'Doc.txt', status: 'completed', kind: 'file', savePath: join(dir, 'Doc.txt'), doneBytes: 1, totalBytes: 1 }
    writeFileSync(join(dir, 'Doc.txt'), 'x')
    queueRows['q1'] = { id: 'q1', filename: 'Queued.mp4', status: 'queued', kind: 'video', savePath: file, doneBytes: 0, totalBytes: 100 }

    let r = await req('/preview?token=wrong&id=v1')
    assert.equal(r.status, 401)
    r = await req(`/preview?token=${TOKEN}&id=nope`)
    assert.equal(r.status, 404)
    r = await req(`/preview?token=${TOKEN}&id=q1`)
    assert.equal(r.status, 404)
    r = await req(`/preview?token=${TOKEN}&id=t1`)
    assert.equal(r.status, 404) // kind 'file' is not a media row
    // A completed VIDEO row whose file is a .txt path is 415.
    queueRows['v2'] = { id: 'v2', filename: 'Clip.txt', status: 'completed', kind: 'video', savePath: join(dir, 'Doc.txt'), doneBytes: 1, totalBytes: 1 }
    r = await req(`/preview?token=${TOKEN}&id=v2`)
    assert.equal(r.status, 415)
    // Full file.
    r = await req(`/preview?token=${TOKEN}&id=v1`)
    assert.equal(r.status, 200)
    assert.equal(r.headers.get('content-type'), 'video/mp4')
    assert.equal(r.headers.get('content-length'), '100')
    assert.equal(r.text.length, 100)
    // Range.
    r = await req(`/preview?token=${TOKEN}&id=v1`, { headers: { Range: 'bytes=10-19' } })
    assert.equal(r.status, 206)
    assert.equal(r.headers.get('content-range'), 'bytes 10-19/100')
    assert.equal(r.text.length, 10)
    // Unsatisfiable + malformed ranges -> 416.
    r = await req(`/preview?token=${TOKEN}&id=v1`, { headers: { Range: 'bytes=500-600' } })
    assert.equal(r.status, 416)
    assert.equal(r.headers.get('content-range'), 'bytes */100')
    r = await req(`/preview?token=${TOKEN}&id=v1`, { headers: { Range: 'bytes=abc' } })
    assert.equal(r.status, 416)
  })

  it('regenerateToken: the old token stops working at once, the new one works', async () => {
    const next = api.regenerateToken()
    assert.notEqual(next, TOKEN)
    assert.equal(next.length, 64)
    assert.equal(api.getStatus().token, next)
    let r = await req('/status', { headers: authHeaders() })
    assert.equal(r.status, 401)
    r = await req('/status', { headers: { Authorization: `Bearer ${next}` } })
    assert.equal(r.status, 200)
    // The new token persisted to Settings.
    assert.equal(settings.get().extensionToken, next)
  })

  it('stop() closes the server; a second start binds again', async () => {
    api.stop()
    assert.equal(api.isRunning(), false)
    assert.equal(api.getPort(), null)
    await api.start()
    assert.equal(api.isRunning(), true)
    const r = await req('/status', { headers: authHeaders() })
    assert.equal(r.status, 200)
  })
})
