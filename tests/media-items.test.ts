import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { parseMediaItems } from '../src/main/util/mediaItems.ts'

const carousel = {
  id: 'post-1',
  title: 'A carousel post',
  entries: [
    {
      id: 'a1',
      title: 'Photo 1',
      webpage_url: 'https://example.com/p/1',
      url: 'https://example.com/media/1.jpg',
      duration: null,
      thumbnails: [{ url: 'https://example.com/t/1.jpg' }]
    },
    {
      id: 'a2',
      webpage_url: 'https://example.com/p/2',
      url: 'https://example.com/media/2.jpg',
      duration: 12,
      thumbnails: []
    },
    { id: '', webpage_url: 'https://example.com/p/3', url: 'https://example.com/media/3.jpg' },
    { id: 'a4', title: 'No URL item' }
  ]
}

describe('parseMediaItems (Cobalt-inspired multi-media picker)', () => {
  it('pulls the per-item list out of a multi-entry info JSON', () => {
    const items = parseMediaItems(carousel)
    assert.equal(items.length, 2)
    assert.deepEqual(items[0], {
      id: 'a1',
      title: 'Photo 1',
      thumbnail: 'https://example.com/t/1.jpg',
      url: 'https://example.com/p/1',
      duration: null
    })
    // Title falls back to the id; no thumbnails means a null thumbnail.
    assert.equal(items[1].title, 'a2')
    assert.equal(items[1].thumbnail, null)
    assert.equal(items[1].duration, 12)
  })

  it('prefers webpage_url over the direct media url', () => {
    const items = parseMediaItems(carousel)
    assert.equal(items[0].url, 'https://example.com/p/1')
  })

  it('returns [] for a single video (no choice to make)', () => {
    assert.deepEqual(parseMediaItems({ id: 'v', entries: [{ id: 'v', url: 'https://x/y' }] }), [])
    assert.deepEqual(parseMediaItems({ id: 'v', title: 'Single' }), [])
  })

  it('skips entries without an id or a url', () => {
    const items = parseMediaItems(carousel)
    assert.ok(items.every((i) => i.id && i.url))
  })
})
