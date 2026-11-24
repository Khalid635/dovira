import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync, readFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import {
  parseMpCmdRunExitCode,
  findMpCmdRun,
  buildZoneIdentifierContent,
  applyMarkOfTheWeb,
  applyPostDownloadSecurity,
  verifyEngineBinaries,
  getExpectedBinaryHashes,
  engineHashOverridesPath,
  loadEngineHashOverrides,
  recordEngineHashOverride
} from '../src/main/security.ts'

describe('security: Defender scan helpers', () => {
  it('parseMpCmdRunExitCode: 0 clean, 2 threat, anything else unknown', () => {
    assert.equal(parseMpCmdRunExitCode(0), 'clean')
    assert.equal(parseMpCmdRunExitCode(2), 'threat')
    assert.equal(parseMpCmdRunExitCode(1), 'unknown')
    assert.equal(parseMpCmdRunExitCode(null), 'unknown')
    assert.equal(parseMpCmdRunExitCode(-1), 'unknown')
  })

  it('findMpCmdRun: finds the scanner under Program Files, null when absent', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dovira-def-'))
    try {
      assert.equal(findMpCmdRun(dir, ''), null)
      const wd = join(dir, 'Windows Defender')
      mkdirSync(wd, { recursive: true })
      writeFileSync(join(wd, 'MpCmdRun.exe'), '')
      assert.equal(findMpCmdRun(dir, ''), join(wd, 'MpCmdRun.exe'))
      // The x86 folder is the fallback when the first has nothing.
      assert.equal(findMpCmdRun(join(dir, 'nope'), dir), join(wd, 'MpCmdRun.exe'))
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('buildZoneIdentifierContent is the ZoneId=3 block', () => {
    assert.equal(buildZoneIdentifierContent(), '[ZoneTransfer]\r\nZoneId=3\r\n')
  })

  it('applyMarkOfTheWeb: false for a missing file, true for a real file (win32)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dovira-motw-'))
    try {
      assert.equal(applyMarkOfTheWeb(join(dir, 'nope.mp4')), false)
      const f = join(dir, 'real.mp4')
      writeFileSync(f, 'data')
      if (process.platform === 'win32') {
        assert.equal(applyMarkOfTheWeb(f), true)
        assert.equal(readFileSync(`${f}:Zone.Identifier`, 'utf-8'), '[ZoneTransfer]\r\nZoneId=3\r\n')
      } else {
        assert.equal(applyMarkOfTheWeb(f), false)
      }
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('applyPostDownloadSecurity: missing file -> motw false, scan unavailable/unknown on Windows, skipped elsewhere', async () => {
    const missing = join(tmpdir(), 'dovira-definitely-missing.mp4')
    // Off Windows the Defender scan is skipped by design (see security.ts),
    // so a missing file still reports 'skipped', not 'unavailable'/'unknown'.
    const isWin = process.platform === 'win32'
    const r1 = await applyPostDownloadSecurity(missing, null)
    assert.deepEqual(r1, { motwApplied: false, scan: isWin ? 'unavailable' : 'skipped' })
    const r2 = await applyPostDownloadSecurity(missing, 'C:\\Defender\\MpCmdRun.exe')
    assert.deepEqual(r2, { motwApplied: false, scan: isWin ? 'unknown' : 'skipped' })
  })
})

describe('security: engine binary verification', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'dovira-bin-'))
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  function sha(content: string): string {
    return createHash('sha256').update(content).digest('hex')
  }

  it('missing / unknown / ok / mismatch + overrides win over the manifest', async () => {
    const f = join(dir, 'yt-dlp.exe')
    writeFileSync(f, 'binary-bytes')
    const expected = { win32: { 'yt-dlp': sha('binary-bytes') } }
    const ok = await verifyEngineBinaries(
      [{ name: 'yt-dlp', path: f }],
      expected,
      {},
      'win32'
    )
    assert.deepEqual(ok, [
      { name: 'yt-dlp', status: 'ok', expected: sha('binary-bytes'), actual: sha('binary-bytes') }
    ])
    const bad = await verifyEngineBinaries(
      [{ name: 'yt-dlp', path: f }],
      { win32: { 'yt-dlp': '0'.repeat(64) } },
      {},
      'win32'
    )
    assert.equal(bad[0].status, 'mismatch')
    const missing = await verifyEngineBinaries(
      [{ name: 'yt-dlp', path: join(dir, 'nope.exe') }],
      expected,
      {},
      'win32'
    )
    assert.deepEqual(missing, [{ name: 'yt-dlp', status: 'missing' }])
    const unknown = await verifyEngineBinaries(
      [{ name: 'ffmpeg', path: f }],
      expected,
      {},
      'win32'
    )
    assert.deepEqual(unknown, [{ name: 'ffmpeg', status: 'unknown' }])
    // An override (recorded by the app's own engine update) beats the manifest.
    const over = await verifyEngineBinaries(
      [{ name: 'yt-dlp', path: f }],
      { win32: { 'yt-dlp': '0'.repeat(64) } },
      { 'yt-dlp': sha('binary-bytes') },
      'win32'
    )
    assert.equal(over[0].status, 'ok')
  })

  it('getExpectedBinaryHashes reads the real committed manifest', () => {
    const m = getExpectedBinaryHashes()
    assert.match(m.win['yt-dlp'], /^[0-9a-f]{64}$/)
    assert.match(m.win['aria2'], /^[0-9a-f]{64}$/)
    assert.match(m.mac['yt-dlp'], /^[0-9a-f]{64}$/)
  })

  it('engine hash overrides: record/load round-trip, bad input rejected', () => {
    const userData = join(dir, 'userData')
    assert.deepEqual(loadEngineHashOverrides(userData), {})
    assert.equal(recordEngineHashOverride(userData, 'yt-dlp', 'Z'.repeat(64)), false)
    assert.equal(recordEngineHashOverride(userData, 'yt-dlp', 'a'.repeat(64)), true)
    assert.deepEqual(loadEngineHashOverrides(userData), { 'yt-dlp': 'a'.repeat(64) })
    assert.equal(engineHashOverridesPath(userData), join(userData, 'engine-hashes.json'))
    // Corrupt / non-object files load as empty.
    writeFileSync(join(userData, 'engine-hashes.json'), 'not json{')
    assert.deepEqual(loadEngineHashOverrides(userData), {})
    writeFileSync(join(userData, 'engine-hashes.json'), '["a","b"]')
    assert.deepEqual(loadEngineHashOverrides(userData), {})
    writeFileSync(
      join(userData, 'engine-hashes.json'),
      JSON.stringify({ 'yt-dlp': 'not-a-hash', aria2: 'B'.repeat(64) })
    )
    assert.deepEqual(loadEngineHashOverrides(userData), { aria2: 'b'.repeat(64) })
  })
})
