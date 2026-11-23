import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import type { Settings, VideoInfo } from '../src/main/types.ts'
import {
  buildMediaOptions,
  defaultHeightFor,
  looksLikeUrl,
  sanitizeStem
} from '../src/renderer/src/util/quickAdd.ts'

function makeInfo(overrides: Partial<VideoInfo> = {}): VideoInfo {
  return {
    url: 'https://example.com/watch?v=1',
    title: 'Test Video',
    thumbnail: null,
    duration: 60,
    formats: [
      { height: 1080, filesize: 100, combined: false },
      { height: 720, filesize: 50, combined: false },
      { height: null, filesize: 10, combined: false }
    ],
    subtitleLangs: [],
    autoCaptionLangs: [],
    videoId: '1',
    extractor: 'youtube',
    uploader: 'Tester',
    site: 'YouTube',
    ytCategory: null,
    ...overrides
  } as unknown as VideoInfo
}

function makeSettings(overrides: Partial<Settings> = {}): Settings {
  return {
    defaultVideoQuality: '1080',
    defaultAudioBitrate: '192',
    videoContainer: 'mp4',
    subtitleLang: 'en',
    embedMetadataDefault: false,
    downloadDir: 'D:\\Downloads',
    ...overrides
  } as unknown as Settings
}

describe('looksLikeUrl (one-click paste-and-download)', () => {
  it('accepts http(s) links with a path', () => {
    assert.equal(looksLikeUrl('https://www.youtube.com/watch?v=abc'), true)
    assert.equal(looksLikeUrl('http://example.com/file.zip'), true)
  })

  it('rejects homepages, non-http schemes and junk', () => {
    assert.equal(looksLikeUrl('https://example.com'), false)
    assert.equal(looksLikeUrl('https://example.com/'), false)
    assert.equal(looksLikeUrl('ftp://example.com/file.zip'), false)
    assert.equal(looksLikeUrl('not a url'), false)
    assert.equal(looksLikeUrl(''), false)
    assert.equal(looksLikeUrl('https://example.com/a b'), false)
  })
})

describe('sanitizeStem', () => {
  it('strips Windows-illegal chars and caps at 120', () => {
    assert.equal(sanitizeStem('a<b>c:d"e/f\\g|h?i*j'), 'abcdefghij')
    assert.equal(sanitizeStem('x'.repeat(200)).length, 120)
    assert.equal(sanitizeStem('   '), 'download')
  })
})

describe('defaultHeightFor', () => {
  it('takes the Settings quality when the video has it', () => {
    assert.equal(defaultHeightFor(makeInfo(), makeSettings({ defaultVideoQuality: '720' })), 720)
  })

  it('falls back to the best row at or below 1080p', () => {
    assert.equal(defaultHeightFor(makeInfo(), makeSettings({ defaultVideoQuality: '2160' })), 1080)
  })

  it('returns the Settings value for audio-only info', () => {
    const audioOnly = makeInfo({ formats: [{ height: null, filesize: 10, combined: false }] })
    assert.equal(defaultHeightFor(audioOnly, makeSettings()), 1080)
  })
})

describe('buildMediaOptions', () => {
  it('builds a video add with the Settings container and quality', () => {
    const opts = buildMediaOptions({
      info: makeInfo(),
      settings: makeSettings(),
      height: 720,
      bitrate: '192',
      saveDir: 'D:\\Downloads'
    })
    assert.equal(opts.kind, 'video')
    assert.equal(opts.formatId, '720p')
    assert.equal(opts.qualityLabel, '720p')
    assert.equal(opts.filename, 'Test Video.mp4')
    assert.equal(opts.savePath, 'D:\\Downloads\\Test Video.mp4')
    assert.equal(opts.height, 720)
    assert.equal(opts.uploader, 'Tester')
  })

  it('builds an audio add as MP3 when there is no video format', () => {
    const audioOnly = makeInfo({
      formats: [{ height: null, filesize: 10, combined: false }],
      title: 'Song: Live?'
    })
    const opts = buildMediaOptions({
      info: audioOnly,
      settings: makeSettings(),
      height: 1080,
      bitrate: '320',
      saveDir: 'D:\\Downloads'
    })
    assert.equal(opts.kind, 'audio')
    assert.equal(opts.formatId, 'mp3-320')
    assert.equal(opts.filename, 'Song Live.mp3')
    assert.equal(opts.height, null)
  })

  it('leaves smart naming to main (applySmartName unset)', () => {
    const opts = buildMediaOptions({
      info: makeInfo(),
      settings: makeSettings(),
      height: 1080,
      bitrate: '192',
      saveDir: 'D:\\Downloads'
    })
    assert.equal(opts.applySmartName, undefined)
  })
})
