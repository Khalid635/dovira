import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { classifyLocalModelTestError } from '../src/main/util/errors.ts'

describe('classifyLocalModelTestError (issue #5)', () => {
  it('maps an abort to timeout', () => {
    const err = new Error('The operation was aborted')
    err.name = 'AbortError'
    assert.equal(classifyLocalModelTestError(err), 'timeout')
  })

  it('maps a fetch TypeError to unreachable', () => {
    assert.equal(classifyLocalModelTestError(new TypeError('fetch failed')), 'unreachable')
  })

  it('maps a JSON SyntaxError to bad-answer', () => {
    assert.equal(classifyLocalModelTestError(new SyntaxError('Unexpected token')), 'bad-answer')
  })

  it('maps anything else to unreachable', () => {
    assert.equal(classifyLocalModelTestError(new Error('boom')), 'unreachable')
    assert.equal(classifyLocalModelTestError('plain string'), 'unreachable')
    assert.equal(classifyLocalModelTestError(null), 'unreachable')
  })
})
