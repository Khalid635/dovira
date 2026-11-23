import { describe, it, before, mock } from 'node:test'
import assert from 'node:assert/strict'

// queue.ts imports `app` from electron (askAssistant) — mock it before
// the module is first imported (see ytdlp.test.ts for why module scope).
mock.module('electron', {
  exports: { app: { getVersion: () => '1.3.1' } }
})

describe('queue pure helpers', () => {
  let helpers: typeof import('../src/main/queue.ts')

  before(async () => {
    helpers = await import('../src/main/queue.ts')
  })

  it('sameDir: trailing slash + Windows case ignored', () => {
    assert.equal(helpers.sameDir('C:\\DL', 'c:\\dl\\'), true)
    assert.equal(helpers.sameDir('C:\\DL\\', 'C:\\DL'), true)
    assert.equal(helpers.sameDir('C:\\DL', 'C:\\Other'), false)
    assert.equal(helpers.sameDir('/a/b', '/a/b/'), true)
  })

  it('isTorrentUrl: magnet + .torrent URLs (case-insensitive), nothing else', () => {
    assert.equal(helpers.isTorrentUrl('magnet:?xt=urn:btih:abc'), true)
    assert.equal(helpers.isTorrentUrl('https://x.example/f.torrent'), true)
    assert.equal(helpers.isTorrentUrl('https://x.example/f.TORRENT'), true)
    assert.equal(helpers.isTorrentUrl('https://x.example/f.zip'), false)
    assert.equal(helpers.isTorrentUrl('not a url'), false)
  })

  it('magnetName: dn= param decoded, default torrent', () => {
    assert.equal(helpers.magnetName('magnet:?xt=urn:btih:abc&dn=My+Film'), 'My Film')
    assert.equal(helpers.magnetName('magnet:?xt=urn:btih:abc'), 'torrent')
    assert.equal(helpers.magnetName('not a url'), 'torrent')
  })

  it('looksLikePlaylist: list=/playlist/channel/@/c/user, but a watch URL with v= is one video', () => {
    assert.equal(helpers.looksLikePlaylist('https://youtube.com/playlist?list=PL1'), true)
    assert.equal(helpers.looksLikePlaylist('https://youtube.com/watch?v=abc&list=PL1'), false)
    assert.equal(helpers.looksLikePlaylist('https://youtube.com/@chan'), true)
    assert.equal(helpers.looksLikePlaylist('https://youtube.com/channel/UCx'), true)
    assert.equal(helpers.looksLikePlaylist('https://youtube.com/c/chan/playlists'), true)
    assert.equal(helpers.looksLikePlaylist('https://youtu.be/abc'), false)
    assert.equal(helpers.looksLikePlaylist('not a url'), false)
  })

  it('kindFromCategory: video/audio by extension, everything else file', () => {
    assert.equal(helpers.kindFromCategory('Film.mp4'), 'video')
    assert.equal(helpers.kindFromCategory('Film.mkv'), 'video')
    assert.equal(helpers.kindFromCategory('Song.mp3'), 'audio')
    assert.equal(helpers.kindFromCategory('Song.flac'), 'audio')
    assert.equal(helpers.kindFromCategory('Doc.pdf'), 'file')
    assert.equal(helpers.kindFromCategory('Archive.zip'), 'file')
  })

  it('parseYtDlpState: null/empty/bad JSON -> null; valid JSON -> object', () => {
    assert.equal(helpers.parseYtDlpState(null), null)
    assert.equal(helpers.parseYtDlpState(''), null)
    assert.equal(helpers.parseYtDlpState('not json'), null)
    assert.deepEqual(helpers.parseYtDlpState('{"subtitles":true,"subLang":"en"}'), {
      subtitles: true,
      subLang: 'en'
    })
  })
})
