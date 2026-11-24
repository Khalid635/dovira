import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  AUTO_START_ARG,
  applyAutoStart,
  isAutoLaunched,
  type AutoStartAppLike
} from '../src/main/util/autoStart.ts'

function fakeApp(opts: { openAtLogin?: boolean; willLaunch?: boolean } = {}): {
  app: AutoStartAppLike
  calls: unknown[]
} {
  const calls: unknown[] = []
  let current = opts.openAtLogin ?? false
  let willLaunch = opts.willLaunch ?? opts.openAtLogin ?? false
  const app: AutoStartAppLike = {
    setLoginItemSettings: (s) => {
      calls.push(s)
      current = s.openAtLogin
      willLaunch = s.openAtLogin
    },
    getLoginItemSettings: () => ({ openAtLogin: current, executableWillLaunchAtLogin: willLaunch })
  }
  return { app, calls }
}

describe('isAutoLaunched', () => {
  it('true only when the autostart flag is present', () => {
    assert.equal(isAutoLaunched(['dovira.exe', '--autostart']), true)
    assert.equal(isAutoLaunched(['electron.exe', 'D:/Projects/dovira', '--autostart']), true)
    assert.equal(isAutoLaunched(['dovira.exe']), false)
    assert.equal(isAutoLaunched([]), false)
    assert.equal(isAutoLaunched(['dovira.exe', '--autostarted']), false)
  })

  it('flag constant is --autostart', () => {
    assert.equal(AUTO_START_ARG, '--autostart')
  })
})

describe('applyAutoStart (always on, no toggle)', () => {
  it('registers openAtLogin:true with the autostart arg, confirmed by read-back', () => {
    const { app, calls } = fakeApp()
    assert.equal(applyAutoStart(app), true)
    assert.deepEqual(calls, [{ openAtLogin: true, args: ['--autostart'] }])
  })

  it('trusts executableWillLaunchAtLogin when openAtLogin lies (real Electron quirk)', () => {
    // Live-verified 2026-11-25: with args present, Electron reports
    // openAtLogin:false while executableWillLaunchAtLogin:true and the
    // Run entry exists and is enabled. The apply must still pass.
    const quirk: AutoStartAppLike = {
      setLoginItemSettings: () => {},
      getLoginItemSettings: () => ({ openAtLogin: false, executableWillLaunchAtLogin: true })
    }
    assert.equal(applyAutoStart(quirk), true)
  })

  it('returns false when the login item cannot be set', () => {
    const throwing: AutoStartAppLike = {
      setLoginItemSettings: () => {
        throw new Error('no registry')
      },
      getLoginItemSettings: () => ({ openAtLogin: false, executableWillLaunchAtLogin: false })
    }
    assert.equal(applyAutoStart(throwing), false)
  })

  it('returns false when the read-back says it is off', () => {
    const lying: AutoStartAppLike = {
      setLoginItemSettings: () => {},
      getLoginItemSettings: () => ({ openAtLogin: false, executableWillLaunchAtLogin: false })
    }
    assert.equal(applyAutoStart(lying), false)
  })
})
