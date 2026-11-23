import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  MIN_VIDEO_DURATION_SECONDS,
  MIN_VIDEO_HEIGHT,
  MIN_VIDEO_WIDTH,
  isDownloadableVideo,
  pickVideoDownloadUrl
} from '../extension/src/lib.ts'

describe('extension lib — floating button helpers (next-level)', () => {
  it('a real http(s) media URL is sent as-is', () => {
    assert.equal(
      pickVideoDownloadUrl(['https://cdn.example.com/clip.mp4'], 'https://example.com/page'),
      'https://cdn.example.com/clip.mp4'
    )
    assert.equal(
      pickVideoDownloadUrl([null, 'https://cdn.example.com/a.webm?x=1'], 'https://example.com/p'),
      'https://cdn.example.com/a.webm?x=1'
    )
  })

  it('blob: URLs (YouTube etc.) fall back to the page URL', () => {
    assert.equal(
      pickVideoDownloadUrl(
        ['blob:https://www.youtube.com/abc'],
        'https://www.youtube.com/watch?v=x'
      ),
      'https://www.youtube.com/watch?v=x'
    )
  })

  it('no src at all -> page URL', () => {
    assert.equal(
      pickVideoDownloadUrl([null, undefined, ''], 'https://example.com/p'),
      'https://example.com/p'
    )
  })

  it('non-media http URLs are ignored, first real media wins', () => {
    assert.equal(
      pickVideoDownloadUrl(
        ['https://example.com/page.html', 'https://cdn.example.com/a.mp3'],
        'https://example.com/p'
      ),
      'https://cdn.example.com/a.mp3'
    )
  })

  it('thresholds: big enough + long enough -> downloadable', () => {
    assert.equal(isDownloadableVideo({ width: 640, height: 360, duration: 60 }), true)
    assert.equal(isDownloadableVideo({ width: 200, height: 120, duration: 3 }), true)
  })

  it('thresholds: tiny videos are ads/slots, not downloads', () => {
    assert.equal(isDownloadableVideo({ width: 199, height: 360, duration: 60 }), false)
    assert.equal(isDownloadableVideo({ width: 640, height: 119, duration: 60 }), false)
  })

  it('thresholds: clips under 3s are skipped', () => {
    assert.equal(isDownloadableVideo({ width: 640, height: 360, duration: 2.9 }), false)
  })

  it('thresholds: live streams (NaN / Infinity duration) are never skipped', () => {
    assert.equal(isDownloadableVideo({ width: 640, height: 360, duration: NaN }), true)
    assert.equal(isDownloadableVideo({ width: 640, height: 360, duration: Infinity }), true)
  })

  it('threshold constants are the documented values', () => {
    assert.equal(MIN_VIDEO_WIDTH, 200)
    assert.equal(MIN_VIDEO_HEIGHT, 120)
    assert.equal(MIN_VIDEO_DURATION_SECONDS, 3)
  })
})
