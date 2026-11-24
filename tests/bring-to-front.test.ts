import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { bringToFront } from '../src/main/util/bringToFront.ts'
import type { BringToFrontLike } from '../src/main/util/bringToFront.ts'

function makeFake(opts: { minimized?: boolean; destroyed?: boolean } = {}): {
  win: BringToFrontLike
  calls: string[]
} {
  const calls: string[] = []
  const win: BringToFrontLike = {
    isDestroyed: () => opts.destroyed ?? false,
    isMinimized: () => opts.minimized ?? false,
    restore: () => {
      calls.push('restore')
    },
    show: () => {
      calls.push('show')
    },
    setAlwaysOnTop: (flag: boolean) => {
      calls.push(flag ? 'alwaysOnTop:true' : 'alwaysOnTop:false')
    },
    focus: () => {
      calls.push('focus')
    },
    moveTop: () => {
      calls.push('moveTop')
    }
  }
  return { win, calls }
}

describe('bringToFront (extension dialog must appear in front)', () => {
  it('brings a visible window forward: topmost pulse, focus, then clears topmost', () => {
    const { win, calls } = makeFake()
    assert.equal(bringToFront(win), true)
    assert.deepEqual(calls, ['show', 'alwaysOnTop:true', 'focus', 'moveTop', 'alwaysOnTop:false'])
  })

  it('restores a minimized window before bringing it forward', () => {
    const { win, calls } = makeFake({ minimized: true })
    assert.equal(bringToFront(win), true)
    assert.deepEqual(calls, [
      'restore',
      'show',
      'alwaysOnTop:true',
      'focus',
      'moveTop',
      'alwaysOnTop:false'
    ])
  })

  it('does nothing (and returns false) for a destroyed window', () => {
    const { win, calls } = makeFake({ destroyed: true })
    assert.equal(bringToFront(win), false)
    assert.deepEqual(calls, [])
  })

  it('does nothing (and returns false) for a null window', () => {
    assert.equal(bringToFront(null), false)
    assert.equal(bringToFront(undefined), false)
  })

  it('never leaves the window topmost: the last always-on-top call is false', () => {
    const { win, calls } = makeFake()
    bringToFront(win)
    const topmost = calls.filter((c) => c.startsWith('alwaysOnTop'))
    assert.deepEqual(topmost, ['alwaysOnTop:true', 'alwaysOnTop:false'])
  })
})
