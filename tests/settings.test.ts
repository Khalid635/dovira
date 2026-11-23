import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DoviraDb } from '../src/main/db.ts'
import { SettingsManager, DEFAULT_SETTINGS } from '../src/main/settings.ts'

describe('SettingsManager', () => {
  let dir: string
  let db: DoviraDb

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'dovira-settings-'))
    db = new DoviraDb(join(dir, 'dovira.db'))
  })

  afterEach(() => {
    try {
      db.close()
    } catch {
      // Already closed.
    }
    rmSync(dir, { recursive: true, force: true })
  })

  it('fresh db: defaults (language bn, theme light, maxConcurrent 3) + v0.7.0 migration flag persisted', () => {
    const s = new SettingsManager(db).get()
    assert.equal(s.language, 'bn')
    assert.equal(s.theme, 'light')
    assert.equal(s.maxConcurrent, 3)
    assert.equal(s.speedLimitKBps, 0)
    assert.equal(s.autoRetry, 3)
    assert.equal(s.connectionsPerDownload, 8)
    assert.equal(s.defaultVideoQuality, '1080')
    assert.equal(s.smartOrganizer, true)
    assert.equal(s.assistantEnabled, true)
    assert.equal(s.extensionFloatingButton, true)
    assert.equal(s.autoQuality, true)
    assert.equal(s.themeMigrated070, true)
    // The migration wrote the flag + theme back to the db.
    assert.equal(db.getSetting('theme'), JSON.stringify('light'))
    assert.equal(db.getSetting('themeMigrated070'), JSON.stringify(true))
    // DEFAULT_SETTINGS itself is the pre-migration shape.
    assert.equal(DEFAULT_SETTINGS.themeMigrated070, false)
  })

  it('v0.7.0 migration: stored dark flips to light once; a later user dark choice sticks', () => {
    db.setSetting('theme', JSON.stringify('dark'))
    db.setSetting('themeMigrated070', JSON.stringify(false))
    const first = new SettingsManager(db)
    assert.equal(first.get().theme, 'light')
    assert.equal(first.get().themeMigrated070, true)
    first.update({ theme: 'dark' })
    assert.equal(first.get().theme, 'dark')
    // Second construction does NOT re-flip — the flag is set.
    const second = new SettingsManager(db)
    assert.equal(second.get().theme, 'dark')
    assert.equal(second.get().themeMigrated070, true)
  })

  it('update: valid changes persist to the db and the cache', () => {
    const m = new SettingsManager(db)
    const next = m.update({ maxConcurrent: 5, language: 'en', downloadDir: 'C:\\DL' })
    assert.equal(next.maxConcurrent, 5)
    assert.equal(next.language, 'en')
    assert.equal(next.downloadDir, 'C:\\DL')
    assert.equal(db.getSetting('maxConcurrent'), JSON.stringify(5))
    assert.equal(db.getSetting('language'), JSON.stringify('en'))
    // A fresh manager reads the persisted values back.
    const again = new SettingsManager(db)
    assert.equal(again.get().maxConcurrent, 5)
    assert.equal(again.get().language, 'en')
  })

  it('update: numeric clamps (concurrency 1-5, speed 0-1M, retry 0-10, connections 1-32)', () => {
    const m = new SettingsManager(db)
    let s = m.update({ maxConcurrent: 99 })
    assert.equal(s.maxConcurrent, 5)
    s = m.update({ maxConcurrent: 0 })
    assert.equal(s.maxConcurrent, 1)
    s = m.update({ speedLimitKBps: -5 })
    assert.equal(s.speedLimitKBps, 0)
    s = m.update({ speedLimitKBps: 2_000_000 })
    assert.equal(s.speedLimitKBps, 1_000_000)
    s = m.update({ autoRetry: 99 })
    assert.equal(s.autoRetry, 10)
    s = m.update({ connectionsPerDownload: 99 })
    assert.equal(s.connectionsPerDownload, 32)
    s = m.update({ connectionsPerDownload: 0 })
    assert.equal(s.connectionsPerDownload, 1)
  })

  it('update: invalid values revert to the PREVIOUS value, not the default', () => {
    const m = new SettingsManager(db)
    m.update({ language: 'en', proxyUrl: 'http://proxy.example:8080', schedulerTime: '03:30', cookieBrowser: 'chrome', schedulerAction: 'shutdown' })
    let s = m.update({ language: 'fr' })
    // Language is coerced by normalizeSettings to the default 'bn' —
    // unlike proxy/schedulerTime, it does NOT revert to the previous value.
    assert.equal(s.language, 'bn')
    s = m.update({ proxyUrl: 'ftp://not-a-proxy' })
    assert.equal(s.proxyUrl, 'http://proxy.example:8080')
    s = m.update({ schedulerTime: '25:99' })
    assert.equal(s.schedulerTime, '03:30')
    s = m.update({ cookieBrowser: 'safari' })
    assert.equal(s.cookieBrowser, 'chrome')
    s = m.update({ schedulerAction: 'reboot' })
    assert.equal(s.schedulerAction, 'shutdown')
    // A valid proxy/schedulerTime still goes through.
    s = m.update({ proxyUrl: 'socks5://127.0.0.1:1080', schedulerTime: '23:59' })
    assert.equal(s.proxyUrl, 'socks5://127.0.0.1:1080')
    assert.equal(s.schedulerTime, '23:59')
  })

  it('update: quality/container/bitrate fall back to the valid set', () => {
    const m = new SettingsManager(db)
    let s = m.update({ defaultVideoQuality: '144' })
    assert.equal(s.defaultVideoQuality, '1080')
    s = m.update({ defaultVideoQuality: '720' })
    assert.equal(s.defaultVideoQuality, '720')
    s = m.update({ videoContainer: 'avi' })
    assert.equal(s.videoContainer, 'mp4')
    s = m.update({ videoContainer: 'mkv' })
    assert.equal(s.videoContainer, 'mkv')
    s = m.update({ defaultAudioBitrate: '999' })
    assert.equal(s.defaultAudioBitrate, '320')
    s = m.update({ defaultAudioBitrate: '192' })
    assert.equal(s.defaultAudioBitrate, '192')
  })

  it('normalize: organizer folders are cleaned (no separators/traversal); overrides keep only known categories', () => {
    const m = new SettingsManager(db)
    const s = m.update({
      organizerFolders: {
        Video: '../evil',
        Music: 'My Music',
        Documents: '',
        Archives: 'Archives',
        Programs: 'Programs',
        Images: 'Images',
        Others: 'Others'
      },
      organizerOverrides: {
        mp3: 'Music',
        '.MP4': 'Video',
        exe: 'NotACategory',
        '!!!': 'Video'
      }
    })
    assert.equal(s.organizerFolders.Video, '..evil')
    assert.equal(s.organizerFolders.Music, 'My Music')
    assert.equal(s.organizerFolders.Documents, 'Documents')
    assert.deepEqual(s.organizerOverrides, { mp3: 'Music', mp4: 'Video' })
  })

  it('normalize: name template/preset, local model endpoint, lastSchedulerRun', () => {
    const m = new SettingsManager(db)
    let s = m.update({ nameTemplate: '   ', nameTemplatePreset: 'nope' })
    assert.equal(s.nameTemplate, '{title} [{height}p]')
    assert.equal(s.nameTemplatePreset, 'title-quality')
    s = m.update({ nameTemplate: '  {title}  ' })
    assert.equal(s.nameTemplate, '{title}')
    s = m.update({ localModelEndpoint: 'not-a-url' })
    assert.equal(s.localModelEndpoint, '')
    s = m.update({ localModelEndpoint: 'http://127.0.0.1:11434' })
    assert.equal(s.localModelEndpoint, 'http://127.0.0.1:11434')
    s = m.update({ lastSchedulerRun: 'not-a-date' })
    assert.equal(s.lastSchedulerRun, null)
    s = m.update({ lastSchedulerRun: '2026-11-24' })
    assert.equal(s.lastSchedulerRun, '2026-11-24')
  })

  it('constructor: a corrupt stored value keeps the default; get() returns a copy', () => {
    db.setSetting('maxConcurrent', 'not-json{')
    db.setSetting('language', '"xx"')
    const m = new SettingsManager(db)
    assert.equal(m.get().maxConcurrent, 3)
    assert.equal(m.get().language, 'bn')
    const copy = m.get()
    copy.maxConcurrent = 1
    assert.equal(m.get().maxConcurrent, 3)
  })
})
