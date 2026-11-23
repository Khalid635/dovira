import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { initLogger, logMain } from '../src/main/logger.ts'

describe('logger', () => {
  let dir: string
  let origLog: typeof console.log
  let origWarn: typeof console.warn
  let origError: typeof console.error

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'dovira-log-'))
    origLog = console.log
    origWarn = console.warn
    origError = console.error
  })

  afterEach(() => {
    console.log = origLog
    console.warn = origWarn
    console.error = origError
    rmSync(dir, { recursive: true, force: true })
  })

  it('initLogger writes to <userData>/dovira.log; logMain + console mirror append', () => {
    // One test only: initLogger patches console.log/warn/error exactly
    // once (the `initialized` flag), so a second init in the same
    // process would not re-patch after afterEach restores console.
    const p = initLogger(dir)
    assert.equal(p, join(dir, 'dovira.log'))
    logMain('warn', 'something odd happened')
    logMain('error', 'boom')
    console.log('hello from console')
    console.warn('a warning')
    const text = readFileSync(p, 'utf-8')
    assert.match(text, /\[info\] DOVIRA main starting/)
    assert.match(text, /\[warn\] something odd happened/)
    assert.match(text, /\[error\] boom/)
    assert.match(text, /\[info\] hello from console/)
    assert.match(text, /\[warn\] a warning/)
    // A second init returns the same path (already initialized).
    assert.equal(initLogger(dir), p)
  })
})
