import { describe, it, before, beforeEach, afterEach, mock } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AppUpdater as AppUpdaterType } from '../src/main/updater.ts'
import type { AppUpdateState, Settings } from '../src/main/types.ts'

// updater.ts imports `app` from electron and `autoUpdater` from
// electron-updater at module level — mock both at module scope, before
// the module is first imported.
const fakeApp = { isPackaged: false }

class FakeAutoUpdater extends EventEmitter {
  forceDevUpdateConfig = false
  allowPrerelease = false
  autoDownload = true
  autoInstallOnAppQuit = true
  logger: unknown = null
  checkCalls = 0
  downloadCalls = 0
  quitCalls = 0
  checkShouldThrow: Error | null = null
  downloadShouldThrow: Error | null = null

  async checkForUpdates(): Promise<void> {
    this.checkCalls++
    if (this.checkShouldThrow) throw this.checkShouldThrow
  }

  async downloadUpdate(): Promise<void> {
    this.downloadCalls++
    if (this.downloadShouldThrow) throw this.downloadShouldThrow
  }

  quitAndInstall(): void {
    this.quitCalls++
  }
}

const fakeAutoUpdater = new FakeAutoUpdater()

mock.module('electron', { exports: { app: fakeApp } })
mock.module('electron-updater', { exports: { autoUpdater: fakeAutoUpdater } })

let AppUpdater: typeof AppUpdaterType

before(async () => {
  ;({ AppUpdater } = await import('../src/main/updater.ts'))
})

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

async function waitFor(fn: () => boolean, timeoutMs = 2000): Promise<boolean> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (fn()) return true
    await sleep(10)
  }
  return fn()
}

describe('AppUpdater', () => {
  let dir: string
  let states: AppUpdateState[]
  let settings: Settings
  let updater: AppUpdaterType
  let origFetch: typeof fetch
  let sumsText: string
  let sumsOk: boolean

  function makeUpdater(): AppUpdaterType {
    return new AppUpdater(
      () => settings,
      (s) => states.push(s)
    )
  }

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'dovira-upd-'))
    states = []
    settings = {
      appUpdateCheck: true,
      appUpdateAutoDownload: false
    } as Settings
    fakeAutoUpdater.removeAllListeners()
    fakeAutoUpdater.checkCalls = 0
    fakeAutoUpdater.downloadCalls = 0
    fakeAutoUpdater.quitCalls = 0
    fakeAutoUpdater.checkShouldThrow = null
    fakeAutoUpdater.downloadShouldThrow = null
    fakeApp.isPackaged = false
    origFetch = globalThis.fetch
    sumsText = ''
    sumsOk = true
    globalThis.fetch = (async () => {
      if (!sumsOk) return { ok: false, status: 404, text: async () => '' }
      return { ok: true, status: 200, text: async () => sumsText }
    }) as typeof fetch
    updater = makeUpdater()
  })

  afterEach(() => {
    globalThis.fetch = origFetch
    rmSync(dir, { recursive: true, force: true })
  })

  it('constructor: idle state; dev build forces the dev update config', () => {
    assert.deepEqual(updater.getState(), { state: 'idle', version: null, progress: null, error: null })
    assert.equal(fakeAutoUpdater.forceDevUpdateConfig, true)
    assert.equal(fakeAutoUpdater.allowPrerelease, true)
    assert.equal(fakeAutoUpdater.autoDownload, false)
    assert.equal(fakeAutoUpdater.autoInstallOnAppQuit, false)
  })

  it('event flow: checking -> available -> downloading -> not-available / error', async () => {
    fakeAutoUpdater.emit('checking-for-update')
    assert.equal(updater.getState().state, 'checking')
    // check() is a no-op while checking.
    await updater.check()
    assert.equal(fakeAutoUpdater.checkCalls, 0)
    fakeAutoUpdater.emit('update-available', { version: '1.3.2' })
    assert.deepEqual(updater.getState(), { state: 'available', version: '1.3.2', progress: null, error: null })
    fakeAutoUpdater.emit('download-progress', { percent: 42.5 })
    assert.equal(updater.getState().state, 'downloading')
    assert.equal(updater.getState().progress, 43)
    fakeAutoUpdater.emit('update-not-available', { version: '1.3.1' })
    assert.equal(updater.getState().state, 'not-available')
    assert.equal(updater.getState().version, '1.3.1')
    // errorText strips query strings from the message.
    fakeAutoUpdater.emit('error', new Error('net fail?token=secret&x=1'))
    assert.equal(updater.getState().state, 'error')
    assert.equal(updater.getState().error, 'net fail')
  })

  it('update-available with autoDownload on starts the download; download() only from available', async () => {
    settings.appUpdateAutoDownload = true
    fakeAutoUpdater.emit('update-available', { version: '1.3.2' })
    assert.equal(updater.getState().state, 'available')
    await sleep(10)
    assert.equal(fakeAutoUpdater.downloadCalls, 1)
    // download() from a non-available state is a no-op.
    fakeAutoUpdater.emit('update-not-available', { version: '1.3.1' })
    await updater.download()
    assert.equal(fakeAutoUpdater.downloadCalls, 1)
    // With autoDownload off, the explicit download() is what starts it.
    settings.appUpdateAutoDownload = false
    fakeAutoUpdater.emit('update-available', { version: '1.3.2' })
    await sleep(10)
    assert.equal(fakeAutoUpdater.downloadCalls, 1)
    await updater.download()
    assert.equal(fakeAutoUpdater.downloadCalls, 2)
  })

  it('check(): calls checkForUpdates; a throw becomes the error state', async () => {
    const s = await updater.check()
    assert.equal(fakeAutoUpdater.checkCalls, 1)
    assert.equal(s.state, 'idle') // no event fired in this test
    fakeAutoUpdater.checkShouldThrow = new Error('network down')
    const s2 = await updater.check()
    assert.equal(s2.state, 'error')
    assert.equal(s2.error, 'network down')
  })

  function stageInstaller(name: string, content: string): { path: string; hash: string } {
    const path = join(dir, name)
    writeFileSync(path, content)
    return { path, hash: createHash('sha256').update(content).digest('hex') }
  }

  it('verifyAndStage: matching checksum -> install-ready; install() only then', async () => {
    const { path, hash } = stageInstaller('dovira-1.3.2-win.exe', 'installer-bytes')
    sumsText = `${hash}  dovira-1.3.2-win.exe\n`
    fakeAutoUpdater.emit('update-available', { version: '1.3.2' })
    fakeAutoUpdater.emit('update-downloaded', { version: '1.3.2', downloadedFile: path })
    assert.equal(await waitFor(() => updater.getState().state === 'install-ready'), true)
    assert.equal(updater.getState().version, '1.3.2')
    assert.equal(updater.install(), true)
    assert.equal(fakeAutoUpdater.quitCalls, 1)
  })

  it('verifyAndStage: mismatch -> checksum-failed; unlisted file -> checksums-missing; unreachable sums -> checksums-unavailable', async () => {
    const { path, hash } = stageInstaller('dovira-1.3.2-win.exe', 'installer-bytes')
    // Mismatch.
    sumsText = `${'0'.repeat(64)}  dovira-1.3.2-win.exe\n`
    fakeAutoUpdater.emit('update-downloaded', { version: '1.3.2', downloadedFile: path })
    assert.equal(await waitFor(() => updater.getState().state === 'checksum-failed'), true)
    assert.equal(updater.getState().error, 'checksum-mismatch')
    assert.equal(updater.install(), false)
    // Unlisted file.
    sumsText = `${hash}  some-other-file.exe\n`
    fakeAutoUpdater.emit('update-downloaded', { version: '1.3.2', downloadedFile: path })
    assert.equal(await waitFor(() => updater.getState().error === 'checksums-missing'), true)
    // Sums unreachable.
    sumsOk = false
    fakeAutoUpdater.emit('update-downloaded', { version: '1.3.2', downloadedFile: path })
    assert.equal(await waitFor(() => updater.getState().error === 'checksums-unavailable'), true)
    assert.equal(updater.install(), false)
    assert.equal(fakeAutoUpdater.quitCalls, 0)
  })

  it('install() refuses every non-install-ready state', () => {
    assert.equal(updater.install(), false)
    fakeAutoUpdater.emit('update-available', { version: '1.3.2' })
    assert.equal(updater.install(), false)
  })

  it('startStartupCheck: fires after the delay when the setting is on, not when off', async () => {
    updater.startStartupCheck(10)
    assert.equal(await waitFor(() => fakeAutoUpdater.checkCalls === 1, 1000), true)
    settings.appUpdateCheck = false
    const updater2 = makeUpdater()
    updater2.startStartupCheck(10)
    await sleep(50)
    assert.equal(fakeAutoUpdater.checkCalls, 1)
  })
})
