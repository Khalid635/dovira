import { describe, it, beforeEach, afterEach, after, mock } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const require = createRequire(import.meta.url)
const cp = require('node:child_process')

// execFile mock at module scope (see ytdlp.test.ts for why): versions.ts
// reads the CJS binding at first import, so a later mock would not apply.
let outputs: Record<string, string> = {}
let failTools: Set<string> = new Set()
mock.method(cp, 'execFile', ((tool: string, _args: string[], _opts: unknown, cb: (err: Error | null, stdout: string, stderr: string) => void) => {
  if (failTools.has(tool)) {
    cb(new Error(`spawn ${tool} ENOENT`), '', '')
    return undefined
  }
  cb(null, outputs[tool] ?? '', '')
  return undefined
}) as never)

after(() => mock.restoreAll())

type FakeApi = { getStatus: () => { running: boolean; port: number | null; extensionSeenAt: number | null; extensionOptionsUrl: string | null } }
type FakeAria2 = { isReady: () => boolean }

function fakeApi(over: Partial<{ running: boolean; port: number | null; extensionSeenAt: number | null }> = {}): FakeApi {
  return {
    getStatus: () => ({
      running: over.running ?? true,
      port: over.port ?? 17530,
      // null means "never seen" — must NOT fall through to Date.now()
      // (the ?? operator would, since null is nullish).
      extensionSeenAt: over.extensionSeenAt === undefined ? Date.now() : over.extensionSeenAt,
      extensionOptionsUrl: null
    })
  }
}

describe('diagnostics formatSize', () => {
  it('B/KB/MB/GB boundaries, >=100 rounds, invalid -> 0 B', async () => {
    const { formatSize } = await import('../src/main/diagnostics.ts')
    assert.equal(formatSize(0), '0 B')
    assert.equal(formatSize(500), '500 B')
    assert.equal(formatSize(1023), '1023 B')
    assert.equal(formatSize(1024), '1.0 KB')
    assert.equal(formatSize(1536), '1.5 KB')
    assert.equal(formatSize(5 * 1024 * 1024), '5.0 MB')
    assert.equal(formatSize(150 * 1024 * 1024), '150 MB')
    assert.equal(formatSize(500_000_000), '477 MB')
    assert.equal(formatSize(2 * 1024 * 1024 * 1024), '2.0 GB')
    assert.equal(formatSize(-1), '0 B')
    assert.equal(formatSize(Number.NaN), '0 B')
    assert.equal(formatSize(Number.POSITIVE_INFINITY), '0 B')
  })
})

describe('diagnostics runDiagnostics', () => {
  let dir: string
  let origFetch: typeof fetch
  let routes: Record<string, { ok: boolean; body: unknown }>
  let runDiagnostics: typeof import('../src/main/diagnostics.ts').runDiagnostics
  let ytDlpBin: string
  let aria2Bin: string

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'dovira-diag-'))
    ytDlpBin = join(dir, 'yt-dlp.exe')
    aria2Bin = join(dir, 'aria2c.exe')
    outputs = {
      [ytDlpBin]: '2026.10.26\n',
      [aria2Bin]: 'aria2 version 1.37.0\n'
    }
    failTools = new Set()
    origFetch = globalThis.fetch
    routes = {}
    globalThis.fetch = (async (url: string) => {
      const r = routes[url]
      if (!r) return { ok: false, status: 404, json: async () => ({}), text: async () => '' }
      return { ok: r.ok, status: r.ok ? 200 : 500, json: async () => r.body, text: async () => '' }
    }) as typeof fetch
    ;({ runDiagnostics } = await import('../src/main/diagnostics.ts'))
  })

  afterEach(() => {
    globalThis.fetch = origFetch
    rmSync(dir, { recursive: true, force: true })
  })

  function baseDeps(over: Record<string, unknown> = {}): import('../src/main/diagnostics.ts').DiagnosticsDeps {
    return {
      localApi: fakeApi() as never,
      aria2: { isReady: () => true } as FakeAria2 as never,
      aria2Binary: aria2Bin,
      ytDlpBinary: ytDlpBin,
      downloadDir: dir,
      freeBytes: 5_000_000_000,
      isWindows: true,
      ...over
    }
  }

  function byId(result: import('../src/main/types.ts').DiagnosticsResult): Record<string, import('../src/main/types.ts').DiagnosticCheck> {
    return Object.fromEntries(result.checks.map((c) => [c.id, c]))
  }

  it('all-ok run: 5 checks, api/yt-dlp/aria2/extension/dir all ok', async () => {
    const result = await runDiagnostics(baseDeps(), { checkLatest: false })
    const checks = byId(result)
    assert.equal(result.checks.length, 5)
    assert.equal(checks.localApi.status, 'ok')
    assert.equal(checks.localApi.detailParams?.port, 17530)
    assert.equal(checks.ytdlp.status, 'ok')
    assert.equal(checks.ytdlp.detailParams?.version, '2026.10.26')
    assert.equal(checks.aria2.status, 'ok')
    // The fake aria2's isReady is true, so the check reports Running.
    assert.equal(checks.aria2.detailKey, 'diag.detailAria2Running')
    assert.equal(checks.extension.status, 'ok')
    assert.equal(checks.downloadDir.status, 'ok')
    assert.equal(checks.downloadDir.detailKey, 'diag.detailDirOk')
    assert.ok(result.ranAt <= Date.now() && result.ranAt > Date.now() - 5000)
  })

  it('localApi stopped -> fail; yt-dlp missing binary -> fail; yt-dlp no version -> fail', async () => {
    let result = await runDiagnostics(
      baseDeps({ localApi: fakeApi({ running: false, port: null, extensionSeenAt: null }) as never }),
      { checkLatest: false }
    )
    assert.equal(byId(result).localApi.status, 'fail')
    result = await runDiagnostics(baseDeps({ ytDlpBinary: null }), { checkLatest: false })
    assert.equal(byId(result).ytdlp.status, 'fail')
    assert.equal(byId(result).ytdlp.detailKey, 'diag.detailYtdlpMissing')
    failTools.add(ytDlpBin)
    result = await runDiagnostics(baseDeps(), { checkLatest: false })
    assert.equal(byId(result).ytdlp.status, 'fail')
    assert.equal(byId(result).ytdlp.detailKey, 'diag.detailYtdlpNoVersion')
  })

  it('aria2: null binary is fail on Windows, warn elsewhere; not-ready daemon is ok/Ready', async () => {
    let result = await runDiagnostics(baseDeps({ aria2Binary: null, isWindows: true }), { checkLatest: false })
    assert.equal(byId(result).aria2.status, 'fail')
    result = await runDiagnostics(baseDeps({ aria2Binary: null, isWindows: false }), { checkLatest: false })
    assert.equal(byId(result).aria2.status, 'warn')
    assert.equal(byId(result).aria2.detailKey, 'diag.detailAria2Fallback')
    result = await runDiagnostics(
      baseDeps({ aria2: { isReady: () => false } as FakeAria2 as never }),
      { checkLatest: false }
    )
    assert.equal(byId(result).aria2.status, 'ok')
    assert.equal(byId(result).aria2.detailKey, 'diag.detailAria2Ready')
  })

  it('checkLatest: newer release -> warn + updateYtdlp fix; same version -> ok; fetch fails -> warn unknown', async () => {
    routes['https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest'] = {
      ok: true,
      body: { tag_name: '2026.11.01' }
    }
    let result = await runDiagnostics(baseDeps(), {})
    assert.equal(byId(result).ytdlp.status, 'warn')
    assert.equal(byId(result).ytdlp.fix, 'updateYtdlp')
    assert.equal(byId(result).ytdlp.detailParams?.latest, '2026.11.01')
    routes['https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest'] = {
      ok: true,
      body: { tag_name: '2026.10.26' }
    }
    result = await runDiagnostics(baseDeps(), {})
    assert.equal(byId(result).ytdlp.status, 'ok')
    routes['https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest'] = {
      ok: false,
      body: {}
    }
    result = await runDiagnostics(baseDeps(), {})
    assert.equal(byId(result).ytdlp.status, 'warn')
    assert.equal(byId(result).ytdlp.detailKey, 'diag.detailYtdlpUnknown')
  })

  it('extension: never seen -> warn + openSetup; seen 10 min ago -> warn with minutes', async () => {
    let result = await runDiagnostics(
      baseDeps({ localApi: fakeApi({ extensionSeenAt: null }) as never }),
      { checkLatest: false }
    )
    assert.equal(byId(result).extension.status, 'warn')
    assert.equal(byId(result).extension.fix, 'openSetup')
    result = await runDiagnostics(
      baseDeps({ localApi: fakeApi({ extensionSeenAt: Date.now() - 10 * 60_000 }) as never }),
      { checkLatest: false }
    )
    assert.equal(byId(result).extension.status, 'warn')
    assert.equal(byId(result).extension.detailParams?.minutes, 10)
  })

  it('downloadDir: missing dir is created (ok/Created); low disk -> warn; uncreatable path -> fail', async () => {
    const missing = join(dir, 'new-dir')
    let result = await runDiagnostics(baseDeps({ downloadDir: missing }), { checkLatest: false })
    assert.equal(byId(result).downloadDir.status, 'ok')
    assert.equal(byId(result).downloadDir.detailKey, 'diag.detailDirCreated')
    const { existsSync } = await import('node:fs')
    assert.equal(existsSync(missing), true)
    result = await runDiagnostics(baseDeps({ freeBytes: 500_000_000 }), { checkLatest: false })
    assert.equal(byId(result).downloadDir.status, 'warn')
    assert.equal(byId(result).downloadDir.detailParams?.free, '477 MB')
    const file = join(dir, 'a-file')
    writeFileSync(file, 'x')
    result = await runDiagnostics(baseDeps({ downloadDir: join(file, 'sub') }), { checkLatest: false })
    assert.equal(byId(result).downloadDir.status, 'fail')
    assert.equal(byId(result).downloadDir.fix, 'chooseFolder')
  })

  it('binaries: missing file -> fail; hash mismatch -> fail; unknown name -> warn', async () => {
    let result = await runDiagnostics(
      baseDeps({ binaries: [{ name: 'yt-dlp', path: join(dir, 'nope.exe') }] }),
      { checkLatest: false }
    )
    assert.equal(byId(result).binaries.status, 'fail')
    assert.equal(byId(result).binaries.detailKey, 'diag.detailBinariesMissing')
    const wrongHash = join(dir, 'yt-dlp.exe')
    writeFileSync(wrongHash, 'not the real binary')
    result = await runDiagnostics(
      baseDeps({ binaries: [{ name: 'yt-dlp', path: wrongHash }] }),
      { checkLatest: false }
    )
    assert.equal(byId(result).binaries.status, 'fail')
    assert.equal(byId(result).binaries.detailKey, 'diag.detailBinariesMismatch')
    const unknown = join(dir, 'custom-tool.exe')
    writeFileSync(unknown, 'x')
    result = await runDiagnostics(
      baseDeps({ binaries: [{ name: 'custom-tool', path: unknown }] }),
      { checkLatest: false }
    )
    assert.equal(byId(result).binaries.status, 'warn')
    assert.equal(byId(result).binaries.detailKey, 'diag.detailBinariesUnknown')
  })
})
