import { describe, it, beforeEach, afterEach, after, mock } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { Readable } from 'node:stream'
import { createRequire } from 'node:module'
import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ENGINE_FILES } from '../src/main/util/paths.ts'

// Binary filename for the platform under test (yt-dlp.exe on Windows,
// yt-dlp_linux / yt-dlp_macos elsewhere) — the update flow verifies
// the platform's asset name against SHA2-256SUMS.
const YTDLP_FILE = ENGINE_FILES['yt-dlp']

const require = createRequire(import.meta.url)
const cp = require('node:child_process')
const httpsMod = require('node:https')

// Mocks installed at MODULE SCOPE, before any import of the code under test:
// Node snapshots ESM named imports from CJS modules at first import, so a
// mock.method installed in a later describe's beforeEach does NOT intercept
// a module that was already imported in an earlier describe.

let outputs: Record<string, string> = {}
let failTools: Set<string> = new Set()
let smokeVersion: string | null = null
mock.method(cp, 'execFile', ((tool: string, _args: string[], _opts: unknown, cb: (err: Error | null, stdout: string, stderr: string) => void) => {
  if (failTools.has(tool)) {
    cb(new Error(`spawn ${tool} ENOENT`), '', '')
    return undefined
  }
  cb(null, outputs[tool] ?? smokeVersion ?? '', '')
  return undefined
}) as never)

let apiOk = true
let apiStatus = 200
let apiTag: string | null = '2026.11.01'
let binaryBytes = Buffer.from('new-binary-bytes')
let sumsHash = createHash('sha256').update(binaryBytes).digest('hex')
mock.method(httpsMod, 'get', ((_url: string, _opts: unknown, cb: (res: unknown) => void) => {
  const isSums = String(_url).includes('SHA2-256SUMS')
  const body = isSums
    ? Buffer.from(`${sumsHash}  ${YTDLP_FILE}\n`, 'utf-8')
    : binaryBytes
  const res = Readable.from([body]) as unknown as { statusCode: number; headers: Record<string, string> }
  res.statusCode = 200
  res.headers = {}
  cb(res)
  return new EventEmitter() as never
}) as never)

after(() => mock.restoreAll())

describe('versions: --version parsing (execFile mocked)', () => {
  let versions: typeof import('../src/main/engines/versions.ts')

  beforeEach(async () => {
    outputs = {}
    failTools = new Set()
    smokeVersion = null
    versions = await import('../src/main/engines/versions.ts')
  })

  it('aria2 / yt-dlp / ffmpeg / deno version strings', async () => {
    outputs['aria2c.exe'] = 'aria2 version 1.37.0\nCopyright ...'
    outputs['yt-dlp.exe'] = '2026.10.26\n'
    outputs['ffmpeg.exe'] = 'ffmpeg version n9.0.2-foo Copyright ...'
    outputs['deno.exe'] = 'deno 2.9.8 (stable, ...)\n'
    assert.equal(await versions.getAria2Version('aria2c.exe'), '1.37.0')
    assert.equal(await versions.getYtDlpVersion('yt-dlp.exe'), '2026.10.26')
    assert.equal(await versions.getFfmpegVersion('ffmpeg.exe'), '9.0.2')
    assert.equal(await versions.getDenoVersion('deno.exe'), '2.9.8')
  })

  it('plain ffmpeg version (no n-prefix) and non-matching output -> null', async () => {
    outputs['ffmpeg.exe'] = 'ffmpeg version 9.0.2 Copyright ...'
    assert.equal(await versions.getFfmpegVersion('ffmpeg.exe'), '9.0.2')
    outputs['aria2c.exe'] = 'something else entirely'
    assert.equal(await versions.getAria2Version('aria2c.exe'), null)
  })

  it('a spawn failure -> null (no throw)', async () => {
    failTools.add('yt-dlp.exe')
    assert.equal(await versions.getYtDlpVersion('yt-dlp.exe'), null)
  })
})

describe('versions: checkLatest + listEngines (fetch stubbed)', () => {
  let origFetch: typeof fetch
  let routes: Record<string, { ok: boolean; body: unknown; text?: string }>
  let versions: typeof import('../src/main/engines/versions.ts')

  beforeEach(async () => {
    origFetch = globalThis.fetch
    routes = {}
    globalThis.fetch = (async (url: string) => {
      const r = routes[url]
      if (!r) return { ok: false, status: 404, json: async () => ({}), text: async () => '' }
      return {
        ok: r.ok,
        status: r.ok ? 200 : 500,
        json: async () => r.body,
        text: async () => r.text ?? ''
      }
    }) as typeof fetch
    versions = await import('../src/main/engines/versions.ts')
  })

  afterEach(() => {
    globalThis.fetch = origFetch
  })

  it('GitHub tags: yt-dlp as-is, aria2 release- stripped, deno v- stripped', async () => {
    routes['https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest'] = {
      ok: true,
      body: { tag_name: '2026.10.26' }
    }
    routes['https://api.github.com/repos/aria2/aria2/releases/latest'] = {
      ok: true,
      body: { tag_name: 'release-1.37.0' }
    }
    routes['https://api.github.com/repos/denoland/deno/releases/latest'] = {
      ok: true,
      body: { tag_name: 'v2.9.8' }
    }
    assert.equal(await versions.checkLatest('yt-dlp'), '2026.10.26')
    assert.equal(await versions.checkLatest('aria2'), '1.37.0')
    assert.equal(await versions.checkLatest('deno'), '2.9.8')
  })

  it('unknown engine, failed fetch, empty tag -> null', async () => {
    assert.equal(await versions.checkLatest('nope'), null)
    routes['https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest'] = {
      ok: false,
      body: {}
    }
    assert.equal(await versions.checkLatest('yt-dlp'), null)
    routes['https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest'] = {
      ok: true,
      body: {}
    }
    assert.equal(await versions.checkLatest('yt-dlp'), null)
    globalThis.fetch = (async () => {
      throw new Error('network down')
    }) as typeof fetch
    assert.equal(await versions.checkLatest('yt-dlp'), null)
  })

  it('ffmpeg on Windows parses the gyan.dev build list', async () => {
    if (process.platform !== 'win32') return
    routes['https://www.gyan.dev/ffmpeg/builds/'] = {
      ok: true,
      body: {},
      text: '<a href="ffmpeg-9.0.2-essentials_build.zip">dl</a>'
    }
    assert.equal(await versions.checkLatest('ffmpeg'), '9.0.2')
  })

  it('listEngines: version + latest + updateAvailable, no check when disabled', async () => {
    routes['https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest'] = {
      ok: true,
      body: { tag_name: '2026.11.01' }
    }
    const specs = [
      { name: 'yt-dlp', path: 'yt-dlp.exe', getVersion: async () => '2026.10.26' },
      { name: 'aria2', path: null, getVersion: async () => '1.37.0' }
    ]
    const withCheck = await versions.listEngines(specs, true)
    assert.equal(withCheck[0].version, '2026.10.26')
    assert.equal(withCheck[0].latest, '2026.11.01')
    assert.equal(withCheck[0].updateAvailable, true)
    assert.equal(withCheck[1].version, null)
    assert.equal(withCheck[1].updateAvailable, false)
    const noCheck = await versions.listEngines(specs, false)
    assert.equal(noCheck[0].latest, null)
    assert.equal(noCheck[0].updateAvailable, false)
  })
})

describe('versions: updateYtDlp (fetch + https.get mocked)', () => {
  let origFetch: typeof fetch
  let dir: string
  let versions: typeof import('../src/main/engines/versions.ts')

  beforeEach(async () => {
    origFetch = globalThis.fetch
    dir = mkdtempSync(join(tmpdir(), 'dovira-upd-'))
    apiOk = true
    apiStatus = 200
    apiTag = '2026.11.01'
    binaryBytes = Buffer.from('new-binary-bytes')
    sumsHash = createHash('sha256').update(binaryBytes).digest('hex')
    smokeVersion = '2026.11.01'
    outputs = {}
    failTools = new Set()
    globalThis.fetch = (async () => {
      if (!apiOk) return { ok: false, status: apiStatus, json: async () => ({}), text: async () => '' }
      return { ok: true, status: 200, json: async () => ({ tag_name: apiTag }), text: async () => '' }
    }) as typeof fetch
    versions = await import('../src/main/engines/versions.ts')
  })

  afterEach(() => {
    globalThis.fetch = origFetch
    rmSync(dir, { recursive: true, force: true })
  })

  it('GitHub API failure: 403 -> update-forbidden, 500 -> message, no tag -> error', async () => {
    apiOk = false
    apiStatus = 403
    assert.deepEqual(await versions.updateYtDlp(dir), { ok: false, error: 'update-forbidden' })
    apiStatus = 500
    assert.deepEqual(await versions.updateYtDlp(dir), { ok: false, error: 'GitHub API HTTP 500' })
    apiOk = true
    apiTag = null
    assert.deepEqual(await versions.updateYtDlp(dir), { ok: false, error: 'no release tag' })
  })

  it('checksum mismatch -> error, temp files cleaned up', async () => {
    sumsHash = '0'.repeat(64)
    const r = await versions.updateYtDlp(dir)
    assert.deepEqual(r, { ok: false, error: 'checksum mismatch' })
    assert.equal(existsSync(join(dir, `${YTDLP_FILE}.new`)), false)
    assert.equal(existsSync(join(dir, 'SHA2-256SUMS.new')), false)
  })

  it('success: replaces the binary, smoke-tests it, removes backup + temps', async () => {
    writeFileSync(join(dir, YTDLP_FILE), 'old-binary-bytes')
    const r = await versions.updateYtDlp(dir)
    assert.deepEqual(r, { ok: true, version: '2026.11.01' })
    assert.equal(readFileSync(join(dir, YTDLP_FILE), 'utf-8'), 'new-binary-bytes')
    assert.equal(existsSync(join(dir, `${YTDLP_FILE}.bak`)), false)
    assert.equal(existsSync(join(dir, `${YTDLP_FILE}.new`)), false)
    assert.equal(existsSync(join(dir, 'SHA2-256SUMS.new')), false)
  })

  it('smoke-test failure rolls the old binary back', async () => {
    writeFileSync(join(dir, YTDLP_FILE), 'old-binary-bytes')
    smokeVersion = null
    const r = await versions.updateYtDlp(dir)
    assert.equal(r.ok, false)
    assert.match(r.error ?? '', /smoke test failed/)
    assert.equal(readFileSync(join(dir, YTDLP_FILE), 'utf-8'), 'old-binary-bytes')
    assert.equal(existsSync(join(dir, `${YTDLP_FILE}.new`)), false)
  })
})

describe('versions: updateYtDlpIfOutdated (fetch + https.get mocked)', () => {
  let origFetch: typeof fetch
  let dir: string
  let versions: typeof import('../src/main/engines/versions.ts')

  beforeEach(async () => {
    origFetch = globalThis.fetch
    dir = mkdtempSync(join(tmpdir(), 'dovira-upd2-'))
    apiOk = true
    apiStatus = 200
    apiTag = '2026.11.01'
    binaryBytes = Buffer.from('new-binary-bytes')
    sumsHash = createHash('sha256').update(binaryBytes).digest('hex')
    smokeVersion = '2026.11.01'
    outputs = {}
    failTools = new Set()
    globalThis.fetch = (async () => {
      if (!apiOk) return { ok: false, status: apiStatus, json: async () => ({}), text: async () => '' }
      return { ok: true, status: 200, json: async () => ({ tag_name: apiTag }), text: async () => '' }
    }) as typeof fetch
    versions = await import('../src/main/engines/versions.ts')
  })

  afterEach(() => {
    globalThis.fetch = origFetch
    rmSync(dir, { recursive: true, force: true })
  })

  it('already current: no download, binary untouched', async () => {
    outputs[YTDLP_FILE] = '2026.11.01\n'
    writeFileSync(join(dir, YTDLP_FILE), 'old-binary-bytes')
    const r = await versions.updateYtDlpIfOutdated({
      binDir: dir,
      ytDlpPath: YTDLP_FILE,
      userData: dir
    })
    assert.deepEqual(r, { checked: true, updated: false, version: '2026.11.01' })
    assert.equal(readFileSync(join(dir, YTDLP_FILE), 'utf-8'), 'old-binary-bytes')
    assert.equal(existsSync(join(dir, `${YTDLP_FILE}.new`)), false)
    assert.equal(existsSync(join(dir, `${YTDLP_FILE}.bak`)), false)
  })

  it('outdated: updates the binary and records the hash override', async () => {
    outputs[YTDLP_FILE] = '2026.10.26\n'
    writeFileSync(join(dir, YTDLP_FILE), 'old-binary-bytes')
    let recorded: { userData: string; name: string; hash: string } | null = null
    const r = await versions.updateYtDlpIfOutdated({
      binDir: dir,
      ytDlpPath: YTDLP_FILE,
      userData: dir,
      recordHashOverride: (userData: string, name: string, hash: string) => {
        recorded = { userData, name, hash }
        return true
      }
    })
    assert.deepEqual(r, { checked: true, updated: true, version: '2026.11.01' })
    assert.equal(readFileSync(join(dir, YTDLP_FILE), 'utf-8'), 'new-binary-bytes')
    assert.equal(recorded?.name, 'yt-dlp')
    assert.equal(recorded?.hash, sumsHash)
  })

  it('API failure: not checked, no download', async () => {
    apiOk = false
    apiStatus = 500
    outputs[YTDLP_FILE] = '2026.10.26\n'
    writeFileSync(join(dir, YTDLP_FILE), 'old-binary-bytes')
    const r = await versions.updateYtDlpIfOutdated({
      binDir: dir,
      ytDlpPath: YTDLP_FILE,
      userData: dir
    })
    assert.equal(r.checked, false)
    assert.equal(r.updated, false)
    assert.equal(r.version, '2026.10.26')
    assert.equal(readFileSync(join(dir, YTDLP_FILE), 'utf-8'), 'old-binary-bytes')
  })

  it('unreadable installed version: not checked', async () => {
    failTools.add(YTDLP_FILE)
    const r = await versions.updateYtDlpIfOutdated({
      binDir: dir,
      ytDlpPath: YTDLP_FILE,
      userData: dir
    })
    assert.equal(r.checked, false)
    assert.equal(r.updated, false)
    assert.equal(r.version, null)
  })
})

describe('versions: renameWithRetry (Windows file-lock backoff)', () => {
  let dir: string
  let versions: typeof import('../src/main/engines/versions.ts')

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'dovira-rename-'))
    versions = await import('../src/main/engines/versions.ts')
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  /**
   * Hold a file open with FileShare::None in a short-lived PowerShell
   * child — the only way to really block a rename on Windows. (Node's
   * own openSync shares FILE_SHARE_DELETE, so it does NOT block rename.)
   * The child writes a marker file once the lock is held, so the test
   * only starts renaming while the lock is definitely in place. cp.spawn
   * is used because cp.execFile is mocked in this file.
   */
  function holdFileExclusive(path: string, ms: number, marker: string): Promise<void> {
    const script = `$fs=[System.IO.File]::Open('${path}', 'Open', 'ReadWrite', 'None'); [System.IO.File]::WriteAllText('${marker}', 'locked'); Start-Sleep -Milliseconds ${ms}; $fs.Close()`
    return new Promise((resolve, reject) => {
      const child = cp.spawn('powershell', ['-NoProfile', '-Command', script], { windowsHide: true })
      child.on('error', reject)
      child.on('close', () => resolve())
    })
  }

  async function waitForMarker(marker: string, timeoutMs = 10_000): Promise<void> {
    const deadline = Date.now() + timeoutMs
    for (;;) {
      if (existsSync(marker)) return
      if (Date.now() > deadline) throw new Error('lock marker never appeared — PowerShell holder failed to start')
      await new Promise((r) => setTimeout(r, 50))
    }
  }

  it('succeeds once the lock holder releases the file', async () => {
    // Windows-only: POSIX rename(2) never blocks on an open file, so no
    // lock holder can reproduce the EBUSY race on Linux/macOS.
    if (process.platform !== 'win32') return
    const target = join(dir, 'a.txt')
    const dest = join(dir, 'b.txt')
    const marker = join(dir, 'locked.marker')
    writeFileSync(target, 'x')
    const hold = holdFileExclusive(target, 900, marker)
    await waitForMarker(marker)
    await versions.renameWithRetry(target, dest, 12, 200)
    await hold
    assert.equal(existsSync(dest), true)
    assert.equal(existsSync(target), false)
  })

  it('gives up after the attempts are exhausted and the file stays put', async () => {
    // Windows-only: POSIX rename(2) never blocks on an open file, so no
    // lock holder can reproduce the EBUSY race on Linux/macOS.
    if (process.platform !== 'win32') return
    const target = join(dir, 'c.txt')
    const dest = join(dir, 'd.txt')
    const marker = join(dir, 'locked2.marker')
    writeFileSync(target, 'x')
    const hold = holdFileExclusive(target, 3000, marker)
    await waitForMarker(marker)
    await assert.rejects(() => versions.renameWithRetry(target, dest, 3, 100))
    await hold
    assert.equal(existsSync(target), true)
    assert.equal(existsSync(dest), false)
  })

  it('plain rename with no lock succeeds on the first attempt', async () => {
    const target = join(dir, 'e.txt')
    const dest = join(dir, 'f.txt')
    writeFileSync(target, 'x')
    await versions.renameWithRetry(target, dest)
    assert.equal(existsSync(dest), true)
  })
})
