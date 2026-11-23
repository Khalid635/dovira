import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { askLocalModel, askCategory, testLocalModel, type LocalModelSettings } from '../src/main/smart/localModel.ts'

const OLLAMA: LocalModelSettings = {
  enabled: true,
  provider: 'ollama',
  endpoint: 'http://127.0.0.1:11434',
  model: 'llama3.2'
}
const LMSTUDIO: LocalModelSettings = { ...OLLAMA, provider: 'lmstudio' }

type FetchStub = (url: string, init?: unknown) => Promise<unknown>

function fakeResponse(ok: boolean, body: unknown, jsonThrows?: unknown): unknown {
  return {
    ok,
    status: ok ? 200 : 500,
    json: async () => {
      if (jsonThrows !== undefined) throw jsonThrows
      return body
    }
  }
}

describe('localModel', () => {
  let origFetch: typeof fetch
  let calls: { url: string; init: unknown }[]
  let stub: FetchStub

  beforeEach(() => {
    origFetch = globalThis.fetch
    calls = []
    stub = async (url: string, init?: unknown) => {
      calls.push({ url, init })
      return fakeResponse(true, { response: 'Music' })
    }
    globalThis.fetch = stub as typeof fetch
  })

  afterEach(() => {
    globalThis.fetch = origFetch
  })

  it('askLocalModel: disabled / missing endpoint / missing model -> null, no fetch', async () => {
    assert.equal(await askLocalModel({ ...OLLAMA, enabled: false }, 'hi'), null)
    assert.equal(await askLocalModel({ ...OLLAMA, endpoint: '' }, 'hi'), null)
    assert.equal(await askLocalModel({ ...OLLAMA, model: '' }, 'hi'), null)
    assert.equal(calls.length, 0)
  })

  it('askLocalModel: ollama POSTs /api/generate and returns the response', async () => {
    const out = await askLocalModel(OLLAMA, 'categorize this')
    assert.equal(out, 'Music')
    assert.equal(calls.length, 1)
    assert.equal(calls[0].url, 'http://127.0.0.1:11434/api/generate')
    const body = JSON.parse((calls[0].init as { body: string }).body) as Record<string, unknown>
    assert.equal(body.model, 'llama3.2')
    assert.equal(body.stream, false)
  })

  it('askLocalModel: lmstudio POSTs /v1/chat/completions, trims trailing slashes', async () => {
    globalThis.fetch = (async (url: string) => {
      calls.push({ url, init: undefined })
      return fakeResponse(true, { choices: [{ message: { content: 'Video' } }] })
    }) as typeof fetch
    const out = await askLocalModel(
      { ...LMSTUDIO, endpoint: 'http://127.0.0.1:1234///' },
      'categorize this'
    )
    assert.equal(out, 'Video')
    assert.equal(calls[0].url, 'http://127.0.0.1:1234/v1/chat/completions')
  })

  it('askLocalModel: non-ok / bad JSON / fetch throw -> null', async () => {
    globalThis.fetch = (async () => fakeResponse(false, {})) as typeof fetch
    assert.equal(await askLocalModel(OLLAMA, 'x'), null)
    globalThis.fetch = (async () => fakeResponse(true, {}, new SyntaxError('bad'))) as typeof fetch
    assert.equal(await askLocalModel(OLLAMA, 'x'), null)
    globalThis.fetch = (async () => {
      throw new Error('conn refused')
    }) as typeof fetch
    assert.equal(await askLocalModel(OLLAMA, 'x'), null)
  })

  it('askCategory: matches case-insensitively, strips quotes/punctuation, null otherwise', async () => {
    globalThis.fetch = (async () => fakeResponse(true, { response: ' "Music." ' })) as typeof fetch
    assert.equal(await askCategory(OLLAMA, 'some song'), 'Music')
    globalThis.fetch = (async () => fakeResponse(true, { response: 'not a category' })) as typeof fetch
    assert.equal(await askCategory(OLLAMA, 'some song'), null)
    globalThis.fetch = (async () => fakeResponse(true, { response: '' })) as typeof fetch
    assert.equal(await askCategory(OLLAMA, 'some song'), null)
  })

  it('testLocalModel: missing endpoint/model, timeout/unreachable/bad-answer/http, ok', async () => {
    assert.deepEqual(await testLocalModel({ ...OLLAMA, endpoint: '' }), {
      ok: false,
      error: 'no-endpoint'
    })
    assert.deepEqual(await testLocalModel({ ...OLLAMA, model: '' }), {
      ok: false,
      error: 'no-model'
    })
    const abort = new Error('aborted')
    abort.name = 'AbortError'
    globalThis.fetch = (async () => {
      throw abort
    }) as typeof fetch
    assert.deepEqual(await testLocalModel(OLLAMA), { ok: false, error: 'timeout' })
    globalThis.fetch = (async () => {
      throw new Error('ECONNREFUSED')
    }) as typeof fetch
    assert.deepEqual(await testLocalModel(OLLAMA), { ok: false, error: 'unreachable' })
    globalThis.fetch = (async () => fakeResponse(false, {})) as typeof fetch
    assert.deepEqual(await testLocalModel(OLLAMA), { ok: false, error: 'http' })
    globalThis.fetch = (async () => fakeResponse(true, {}, new SyntaxError('x'))) as typeof fetch
    assert.deepEqual(await testLocalModel(OLLAMA), { ok: false, error: 'bad-answer' })
    globalThis.fetch = (async () => fakeResponse(true, { response: '   ' })) as typeof fetch
    assert.deepEqual(await testLocalModel(OLLAMA), { ok: false, error: 'bad-answer' })
    globalThis.fetch = (async () => fakeResponse(true, { response: 'ok' })) as typeof fetch
    assert.deepEqual(await testLocalModel(OLLAMA), { ok: true })
    // LM Studio path reads choices[0].message.content.
    globalThis.fetch = (async (url: string) => {
      calls.push({ url, init: undefined })
      return fakeResponse(true, { choices: [{ message: { content: 'ok' } }] })
    }) as typeof fetch
    assert.deepEqual(await testLocalModel(LMSTUDIO), { ok: true })
    assert.ok(calls[calls.length - 1].url.includes('/v1/chat/completions'))
  })
})
