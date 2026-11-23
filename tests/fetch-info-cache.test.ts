import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { FetchInfoCache, FETCH_INFO_CACHE_TTL_MS } from '../src/main/util/fetchInfoCache.ts'

describe('FetchInfoCache (issue #1)', () => {
  it('returns a stored value before the TTL', () => {
    const cache = new FetchInfoCache<{ ok: boolean }>()
    cache.set('https://example.com/v\nnull', { ok: true }, 1000)
    assert.deepEqual(cache.get('https://example.com/v\nnull', 1000 + FETCH_INFO_CACHE_TTL_MS - 1), {
      ok: true
    })
  })

  it('expires entries older than the 5-minute TTL', () => {
    const cache = new FetchInfoCache<{ ok: boolean }>()
    cache.set('k', { ok: true }, 1000)
    assert.equal(cache.get('k', 1000 + FETCH_INFO_CACHE_TTL_MS + 1), null)
    assert.equal(cache.size, 0)
  })

  it('keys differ per net override', () => {
    assert.notEqual(
      FetchInfoCache.key('https://example.com/v'),
      FetchInfoCache.key('https://example.com/v', { userAgent: 'bot' })
    )
  })

  it('deleteForUrl drops every override of that URL only', () => {
    const cache = new FetchInfoCache<number>()
    cache.set(FetchInfoCache.key('https://a.example/v'), 1)
    cache.set(FetchInfoCache.key('https://a.example/v', { userAgent: 'x' }), 2)
    cache.set(FetchInfoCache.key('https://b.example/v'), 3)
    cache.deleteForUrl('https://a.example/v')
    assert.equal(cache.get(FetchInfoCache.key('https://a.example/v')), null)
    assert.equal(cache.get(FetchInfoCache.key('https://a.example/v', { userAgent: 'x' })), null)
    assert.equal(cache.get(FetchInfoCache.key('https://b.example/v')), 3)
  })

  it('returns null for a missing key', () => {
    assert.equal(new FetchInfoCache<number>().get('nope'), null)
  })
})
