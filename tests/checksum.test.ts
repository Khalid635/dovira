import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { sha256File, parseChecksums, verifyFileAgainstChecksums } from '../src/main/checksum.ts'

describe('checksum: sha256File', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'dovira-sum-'))
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('hashes a file (known vector: "hello")', async () => {
    const f = join(dir, 'hello.txt')
    writeFileSync(f, 'hello')
    assert.equal(
      await sha256File(f),
      '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824'
    )
  })

  it('rejects on a missing file', async () => {
    await assert.rejects(() => sha256File(join(dir, 'nope.bin')), /ENOENT/)
  })
})

describe('checksum: parseChecksums', () => {
  it('parses GNU sha256sum lines, * binary mode, skips junk', () => {
    const h = 'a'.repeat(64)
    const h2 = 'B'.repeat(64)
    const map = parseChecksums(
      `${h}  dovira-setup.exe\n${h2} *app.dmg\n\nnot a checksum line\n${'c'.repeat(63)}  short.exe\n`
    )
    assert.equal(map.size, 2)
    assert.equal(map.get('dovira-setup.exe'), h)
    assert.equal(map.get('app.dmg'), h2.toLowerCase())
    assert.equal(map.get('short.exe'), undefined)
  })

  it('handles CRLF line endings', () => {
    const h = 'd'.repeat(64)
    assert.equal(parseChecksums(`${h}  f.exe\r\n`).get('f.exe'), h)
  })
})

describe('checksum: verifyFileAgainstChecksums', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'dovira-vsum-'))
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('ok on match, ok:false on mismatch, ok:false when unlisted', async () => {
    const f = join(dir, 'setup.exe')
    writeFileSync(f, 'hello')
    const good =
      '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824  setup.exe\n'
    const r1 = await verifyFileAgainstChecksums(f, good)
    assert.equal(r1.ok, true)
    assert.equal(r1.expected, '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824')
    assert.equal(r1.actual, '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824')
    const r2 = await verifyFileAgainstChecksums(f, `${'0'.repeat(64)}  setup.exe\n`)
    assert.equal(r2.ok, false)
    assert.equal(r2.expected, '0'.repeat(64))
    const r3 = await verifyFileAgainstChecksums(f, `${'0'.repeat(64)}  other.exe\n`)
    assert.equal(r3.ok, false)
    assert.equal(r3.expected, undefined)
  })

  it('rejects on a missing file', async () => {
    await assert.rejects(() =>
      verifyFileAgainstChecksums(join(dir, 'nope.exe'), '')
    )
  })
})
