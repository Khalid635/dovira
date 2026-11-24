import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  formatBytes,
  formatSpeed,
  formatEta,
  formatTime,
  historyTime,
  errorKey
} from '../src/renderer/src/util/format.ts'
import { speedGraphPoints, speedGraphPolyline } from '../src/renderer/src/util/graph.ts'

describe('renderer format', () => {
  it('formatBytes: 0 B, KB/MB/GB, one decimal below 100', () => {
    assert.equal(formatBytes(0), '0 B')
    assert.equal(formatBytes(-1), '0 B')
    assert.equal(formatBytes(NaN), '0 B')
    assert.equal(formatBytes(512), '512 B')
    assert.equal(formatBytes(1536), '1.5 KB')
    assert.equal(formatBytes(150 * 1024), '150 KB')
    assert.equal(formatBytes(2.5 * 1024 * 1024), '2.5 MB')
    assert.equal(formatBytes(3 * 1024 * 1024 * 1024), '3.0 GB')
  })

  it('formatSpeed: 0 KB/s floor, bytes/s suffix', () => {
    assert.equal(formatSpeed(0), '0 KB/s')
    assert.equal(formatSpeed(-10), '0 KB/s')
    assert.equal(formatSpeed(2048), '2.0 KB/s')
  })

  it('formatEta: mm:ss below an hour, h:mm:ss above, dash on bad input', () => {
    assert.equal(formatEta(null), '—')
    assert.equal(formatEta(-5), '—')
    assert.equal(formatEta(45), '45s')
    assert.equal(formatEta(90), '01:30')
    assert.equal(formatEta(3661), '1:01:01')
  })

  it('formatTime: empty on falsy, a date string otherwise', () => {
    assert.equal(formatTime(null), '')
    assert.equal(formatTime(0), '')
    assert.match(formatTime(new Date(2026, 10, 24, 12, 0, 0).getTime()), /2026/)
  })

  it('historyTime: completed shows completion time (same as Home), else added time', () => {
    // The observed case: Tears of Steel, added 01:52:29, completed 01:52:52.
    const created = new Date(2026, 10, 24, 1, 52, 29).getTime()
    const completed = new Date(2026, 10, 24, 1, 52, 52).getTime()
    assert.equal(
      historyTime({ status: 'completed', createdAt: created, completedAt: completed }),
      completed
    )
    assert.equal(
      historyTime({ status: 'completed', createdAt: created, completedAt: null }),
      created
    )
    assert.equal(
      historyTime({ status: 'failed', createdAt: created, completedAt: completed }),
      created
    )
    assert.equal(
      historyTime({ status: 'cancelled', createdAt: created, completedAt: null }),
      created
    )
  })
  it('errorKey: known codes map to error.* keys; unknown/null -> error.unknown', () => {
    assert.equal(errorKey('network'), 'error.network')
    assert.equal(errorKey('login-required'), 'error.loginRequired')
    assert.equal(errorKey('drm'), 'error.drm')
    assert.equal(errorKey('no-space'), 'error.no-space')
    assert.equal(errorKey('bogus-code'), 'error.unknown')
    assert.equal(errorKey(null), 'error.unknown')
  })
})

describe('renderer speed graph', () => {
  it('empty samples -> no points; one sample -> flat line at its height', () => {
    assert.deepEqual(speedGraphPoints([], 100, 50), [])
    assert.deepEqual(speedGraphPoints([10], 100, 50), [
      { x: 0, y: 0 },
      { x: 100, y: 0 }
    ])
    assert.deepEqual(speedGraphPoints([0], 100, 50), [
      { x: 0, y: 50 },
      { x: 100, y: 50 }
    ])
  })

  it('newest at the right edge, peak touches the top', () => {
    const pts = speedGraphPoints([0, 50, 100], 200, 40)
    assert.deepEqual(pts, [
      { x: 0, y: 40 },
      { x: 100, y: 20 },
      { x: 200, y: 0 }
    ])
    assert.equal(speedGraphPolyline([0, 50, 100], 200, 40), '0.0,40.0 100.0,20.0 200.0,0.0')
    assert.equal(speedGraphPolyline([], 100, 50), '')
  })
})
