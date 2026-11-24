import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  getDefaultDownloadDir,
  currentPlatform,
  ENGINE_FILES,
  platformDirName,
  findBinary,
  ensureExecutable,
  diskFreeBytes,
  isLoadableExtensionDir,
  getExtensionDir,
  getSetupGuideVideoPath
} from '../src/main/util/paths.ts'

describe('paths', () => {
  it('getDefaultDownloadDir ends in Downloads/DOVIRA; currentPlatform matches the runtime', () => {
    assert.ok(getDefaultDownloadDir().endsWith(join('Downloads', 'DOVIRA')))
    assert.equal(currentPlatform(), process.platform === 'win32' ? 'win' : process.platform === 'darwin' ? 'mac' : 'linux')
    assert.equal(platformDirName('win'), 'win')
    assert.equal(platformDirName('mac'), 'mac')
  })

  it('ENGINE_FILES matches the platform (Windows -> .exe names)', () => {
    if (process.platform === 'win32') {
      assert.equal(ENGINE_FILES['yt-dlp'], 'yt-dlp.exe')
      assert.equal(ENGINE_FILES['aria2'], 'aria2c.exe')
      assert.equal(ENGINE_FILES['ffmpeg'], 'ffmpeg.exe')
    }
  })

  it('diskFreeBytes: a real dir reports > 0; a nonexistent path reports null', () => {
    const free = diskFreeBytes(tmpdir())
    assert.ok(typeof free === 'number' && (free as number) > 0)
    assert.equal(diskFreeBytes(join(tmpdir(), 'definitely-not-here-xyz', 'sub')), null)
  })

  it('ensureExecutable is a no-op on Windows and never throws for a missing file', () => {
    assert.doesNotThrow(() => ensureExecutable(join(tmpdir(), 'nope.exe')))
  })

  it('findBinary: dev layout wins; unknown engine -> null', () => {
    const root = mkdtempSync(join(tmpdir(), 'dovira-bin-'))
    try {
      const binDir = join(root, 'resources', 'bin', 'win')
      mkdirSync(binDir, { recursive: true })
      const target = join(binDir, 'yt-dlp.exe')
      writeFileSync(target, '')
      assert.equal(findBinary('yt-dlp', root, join(root, 'res')), target)
      assert.equal(findBinary('nope-engine', root, join(root, 'res')), null)
      assert.equal(findBinary('yt-dlp', join(root, 'empty'), join(root, 'empty2')), null)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('isLoadableExtensionDir: needs a manifest + every referenced file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dovira-ext-'))
    try {
      assert.equal(isLoadableExtensionDir(dir), false)
      writeFileSync(
        join(dir, 'manifest.json'),
        JSON.stringify({
          background: { service_worker: 'background.js' },
          content_scripts: [{ js: ['content.js'] }],
          action: { default_popup: 'popup.html' },
          options_page: 'options.html'
        })
      )
      assert.equal(isLoadableExtensionDir(dir), false)
      for (const f of ['background.js', 'content.js', 'popup.html', 'options.html']) {
        writeFileSync(join(dir, f), '')
      }
      assert.equal(isLoadableExtensionDir(dir), true)
      writeFileSync(join(dir, 'manifest.json'), '{broken json')
      assert.equal(isLoadableExtensionDir(dir), false)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('getExtensionDir: dev extension/dist when loadable, null otherwise (never the source folder)', () => {
    const root = mkdtempSync(join(tmpdir(), 'dovira-extdir-'))
    try {
      assert.equal(getExtensionDir(root, join(root, 'res')), null)
      const dist = join(root, 'extension', 'dist')
      mkdirSync(dist, { recursive: true })
      writeFileSync(join(dist, 'manifest.json'), JSON.stringify({}))
      assert.equal(getExtensionDir(root, join(root, 'res')), dist)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('getSetupGuideVideoPath: dev resources file wins, packaged resources path next, null otherwise', () => {
    const root = mkdtempSync(join(tmpdir(), 'dovira-guide-'))
    try {
      assert.equal(getSetupGuideVideoPath(root, join(root, 'res')), null)
      const dev = join(root, 'resources', 'setup-guide.mp4')
      mkdirSync(join(root, 'resources'), { recursive: true })
      writeFileSync(dev, '')
      assert.equal(getSetupGuideVideoPath(root, join(root, 'res')), dev)
      mkdirSync(join(root, 'res'), { recursive: true })
      writeFileSync(join(root, 'res', 'setup-guide.mp4'), '')
      // Dev candidate still wins when both exist.
      assert.equal(getSetupGuideVideoPath(root, join(root, 'res')), dev)
      assert.equal(
        getSetupGuideVideoPath(join(root, 'empty'), join(root, 'res')),
        join(root, 'res', 'setup-guide.mp4')
      )
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
