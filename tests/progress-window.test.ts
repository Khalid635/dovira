import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { ProgressWindowManager } from '../src/main/progressWindows.ts'
import type { ProgressWindowLike } from '../src/main/progressWindows.ts'
import type { DownloadStatus } from '../src/main/types.ts'

interface FakeWindow extends ProgressWindowLike {
  focused: boolean
  closed: boolean
}

function makeFake(): FakeWindow {
  const listeners: Record<string, (() => void)[]> = {}
  const win: FakeWindow = {
    focused: false,
    closed: false,
    isDestroyed: () => win.closed,
    focus: () => {
      win.focused = true
    },
    close: () => {
      win.closed = true
      for (const l of listeners['closed'] ?? []) l()
    },
    on: (event, listener) => {
      ;(listeners[event] ??= []).push(listener)
    }
  }
  return win
}

describe('ProgressWindowManager (v1.4.1 progress window)', () => {
  it('opens a window when a download starts (status = downloading)', () => {
    const created: FakeWindow[] = []
    const m = new ProgressWindowManager((id) => {
      assert.equal(id, 'dl-1')
      const w = makeFake()
      created.push(w)
      return w
    })
    m.onStatus('dl-1', 'downloading')
    assert.equal(created.length, 1)
    assert.equal(m.count(), 1)
    assert.equal(m.has('dl-1'), true)
  })

  it('opens nothing for any other status', () => {
    const others: DownloadStatus[] = [
      'queued',
      'fetching_info',
      'paused',
      'processing',
      'completed',
      'failed',
      'cancelled'
    ]
    for (const status of others) {
      const m = new ProgressWindowManager(() => {
        throw new Error(`must not create a window for ${status}`)
      })
      m.onStatus('dl-1', status)
      assert.equal(m.count(), 0, status)
      assert.equal(m.has('dl-1'), false, status)
    }
  })

  it('focuses the existing window instead of opening a second one', () => {
    const created: FakeWindow[] = []
    const m = new ProgressWindowManager(() => {
      const w = makeFake()
      created.push(w)
      return w
    })
    m.open('dl-1')
    m.open('dl-1')
    assert.equal(created.length, 1)
    assert.equal(created[0]?.focused, true)
    assert.equal(m.count(), 1)
  })

  it('opens a fresh window after the old one closed', () => {
    const created: FakeWindow[] = []
    const m = new ProgressWindowManager(() => {
      const w = makeFake()
      created.push(w)
      return w
    })
    m.open('dl-1')
    created[0]?.close()
    assert.equal(m.count(), 0)
    assert.equal(m.has('dl-1'), false)
    m.open('dl-1')
    assert.equal(created.length, 2)
    assert.equal(m.count(), 1)
  })

  it('tracks windows per download id, independently', () => {
    const created: FakeWindow[] = []
    const m = new ProgressWindowManager(() => {
      const w = makeFake()
      created.push(w)
      return w
    })
    m.open('dl-1')
    m.open('dl-2')
    assert.equal(m.count(), 2)
    m.close('dl-1')
    assert.equal(created[0]?.closed, true)
    assert.equal(created[1]?.closed, false)
    assert.equal(m.has('dl-1'), false)
    assert.equal(m.has('dl-2'), true)
    assert.equal(m.count(), 1)
  })

  it('close() on an unknown id is a no-op', () => {
    const m = new ProgressWindowManager(() => makeFake())
    m.close('nope')
    assert.equal(m.count(), 0)
  })
})
