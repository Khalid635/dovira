import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  sanitizeFilename,
  isPathInside,
  resolveDownloadPath,
  resolveUniquePath,
  filenameFromUrl
} from '../src/main/util/filename.ts'
import { mapEngineError } from '../src/main/util/errors.ts'
import { categorize, extensionOf, organizeDir } from '../src/main/smart/categorize.ts'
import { cleanTitle, applyTemplate, suggestName } from '../src/main/smart/naming.ts'
import { findFileDuplicate } from '../src/main/smart/duplicates.ts'
import { AdaptiveNet } from '../src/main/smart/adaptive.ts'

const MB = 1024 * 1024

describe('filename: sanitizeFilename', () => {
  it('strips illegal Windows chars and control chars', () => {
    assert.equal(sanitizeFilename('a<b>c:"d/e\\f|g?h*i'), 'a_b_c__d_e_f_g_h_i')
    assert.equal(sanitizeFilename('a\u0001b'), 'a_b')
  })

  it('drops trailing dots/spaces, guards reserved names, falls back on empty', () => {
    assert.equal(sanitizeFilename('movie...   '), 'movie')
    assert.equal(sanitizeFilename('CON'), '_CON')
    assert.equal(sanitizeFilename('con.mp4'), '_con.mp4')
    assert.equal(sanitizeFilename('...'), 'download')
    assert.equal(sanitizeFilename(''), 'download')
  })

  it('caps at 180 chars, keeping the extension', () => {
    const long = `${'a'.repeat(200)}.mp4`
    const out = sanitizeFilename(long)
    assert.equal(out.length, 180)
    assert.ok(out.endsWith('.mp4'))
  })
})

describe('filename: isPathInside / resolveDownloadPath / resolveUniquePath', () => {
  it('isPathInside: whole-segment match, case-insensitive on Windows, .. climbs out', () => {
    assert.equal(isPathInside('C:\\DL', 'C:\\DL\\file.mp4'), true)
    assert.equal(isPathInside('C:\\DL', 'C:\\DL'), true)
    assert.equal(isPathInside('C:\\DL', 'C:\\DL2\\file.mp4'), false)
    assert.equal(isPathInside('C:\\DL', 'C:\\dl\\File.MP4'), true)
    assert.equal(isPathInside('C:\\DL', 'C:\\DL\\sub\\..\\..\\evil.exe'), false)
  })

  it('resolveDownloadPath collapses hostile names into the folder', () => {
    assert.equal(
      resolveDownloadPath('C:\\DL', '..\\..\\evil.exe'),
      join('C:\\DL', '.._.._evil.exe')
    )
    // An absolute path is collapsed the same way — it never escapes.
    assert.equal(
      resolveDownloadPath('C:\\DL', 'C:\\Windows\\evil.exe'),
      join('C:\\DL', 'C__Windows_evil.exe')
    )
  })

  it('resolveUniquePath appends (1), (2) on clash and honours isTaken', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dovira-unique-'))
    try {
      writeFileSync(join(dir, 'a.mp4'), 'x')
      assert.equal(resolveUniquePath(dir, 'a.mp4'), join(dir, 'a (1).mp4'))
      writeFileSync(join(dir, 'a (1).mp4'), 'x')
      assert.equal(resolveUniquePath(dir, 'a.mp4'), join(dir, 'a (2).mp4'))
      assert.equal(
        resolveUniquePath(dir, 'b.mp4', (c) => c === join(dir, 'b.mp4')),
        join(dir, 'b (1).mp4')
      )
      assert.equal(resolveUniquePath(dir, 'fresh.mp4'), join(dir, 'fresh.mp4'))
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('filename: filenameFromUrl', () => {
  it('prefers Content-Disposition (RFC 5987, quoted, plain), then the URL segment', () => {
    assert.equal(
      filenameFromUrl('https://x.example/a', "attachment; filename*=UTF-8''%E2%82%AC%20rates.pdf"),
      '€ rates.pdf'
    )
    assert.equal(
      filenameFromUrl('https://x.example/a', 'attachment; filename="report 2024.pdf"'),
      'report 2024.pdf'
    )
    assert.equal(filenameFromUrl('https://x.example/a', 'attachment; filename=plain.txt'), 'plain.txt')
    assert.equal(filenameFromUrl('https://x.example/files/my%20file.zip'), 'my file.zip')
    assert.equal(filenameFromUrl('https://x.example/'), 'download')
    assert.equal(filenameFromUrl('not a url'), 'download')
  })
})

describe('errors: mapEngineError', () => {
  const cases: [string, string][] = [
    ['no space left on device', 'no-space'],
    ['Disk full', 'no-space'],
    ['has already been recorded in the archive', 'already-downloaded'],
    ['aria2c.exe not found', 'engine-missing'],
    ['Unable to rename file (WinError 32)', 'rename-locked'],
    ['ERROR: This video is private', 'unavailable'],
    ['Video unavailable', 'unavailable'],
    ['has been removed by the uploader', 'unavailable'],
    ['Please sign in to view this video', 'login-required'],
    ['confirm your age to watch', 'login-required'],
    ['DRM protected', 'drm'],
    ['Unsupported URL', 'unsupported'],
    ['no video formats found', 'unsupported'],
    ['requested format is not available', 'unsupported'],
    ['ECONNRESET', 'network'],
    ['unable to connect to host', 'network'],
    ['timed out after 30s', 'network'],
    ['HTTP Error 404: Not Found', 'not-found'],
    ['HTTP Error 403: Forbidden', 'forbidden'],
    ['401 Unauthorized', 'auth'],
    ['something completely different', 'unknown']
  ]
  for (const [raw, code] of cases) {
    it(`${JSON.stringify(raw)} -> ${code}`, () => {
      assert.equal(mapEngineError(raw).code, code)
      assert.equal(mapEngineError(raw).raw, raw)
    })
  }
})

describe('categorize', () => {
  it('extensionOf: last segment, lowercase, dot <= 0 gives empty', () => {
    assert.equal(extensionOf('Film.MP4'), 'mp4')
    assert.equal(extensionOf('archive.tar.gz'), 'gz')
    assert.equal(extensionOf('.hidden'), '')
    assert.equal(extensionOf('noext'), '')
    assert.equal(extensionOf('C:\\dir\\song.flac'), 'flac')
  })

  it('priority: overrides > kind > yt category > extension > domain > Others', () => {
    assert.equal(categorize({ filename: 'x.mp4', overrides: { mp4: 'Documents' } }), 'Documents')
    assert.equal(categorize({ filename: 'x.unknown', overrides: { mp4: 'Video' } }), 'Others')
    assert.equal(categorize({ filename: 'x.zip', kind: 'audio' }), 'Music')
    assert.equal(categorize({ filename: 'x.zip', kind: 'video' }), 'Video')
    assert.equal(categorize({ filename: 'x.bin', ytCategory: 'Music' }), 'Music')
    assert.equal(categorize({ filename: 'x.bin', ytCategory: 'Film & Animation' }), 'Video')
    assert.equal(categorize({ filename: 'x.bin', ytCategory: 'Unknown Cat' }), 'Others')
    assert.equal(categorize({ filename: 'clip.mkv' }), 'Video')
    assert.equal(categorize({ filename: 'paper.pdf' }), 'Documents')
    assert.equal(categorize({ filename: 'app.apk' }), 'Programs')
    assert.equal(categorize({ filename: 'pic.avif' }), 'Images')
    assert.equal(categorize({ filename: 'x', site: 'www.youtube.com' }), 'Video')
    assert.equal(categorize({ filename: 'x', site: 'soundcloud.com' }), 'Music')
    assert.equal(categorize({ filename: 'x' }), 'Others')
  })

  it('organizeDir uses the user folder name, falling back to the category', () => {
    assert.equal(organizeDir('D:\\DL', 'Video', { Video: 'My Videos' }), join('D:\\DL', 'My Videos'))
    assert.equal(organizeDir('D:\\DL', 'Video', {}), join('D:\\DL', 'Video'))
  })
})

describe('naming: cleanTitle / applyTemplate / suggestName', () => {
  it('cleanTitle strips official/quality tags, emoji, " - YouTube", separators', () => {
    assert.equal(cleanTitle('Song (Official Video) [HD]'), 'Song')
    assert.equal(cleanTitle('Song [Official Music Video] [1080p]'), 'Song')
    assert.equal(cleanTitle('Talk | YouTube'), 'Talk')
    assert.equal(cleanTitle('Talk - YouTube'), 'Talk')
    assert.equal(cleanTitle('Fun 🎉 Video'), 'Fun Video')
    assert.equal(cleanTitle('  A   B  '), 'A B')
    assert.equal(cleanTitle('- Leading'), 'Leading')
    assert.equal(cleanTitle('Keep (Live) here'), 'Keep (Live) here')
  })

  it('applyTemplate drops the whole [height] segment when height is missing', () => {
    assert.equal(
      applyTemplate('{title} [{height}p]', { title: 'Song', height: null }),
      'Song'
    )
    assert.equal(
      applyTemplate('{title} [{height}p]', { title: 'Song', height: 720 }),
      'Song [720p]'
    )
    assert.equal(
      applyTemplate('{uploader} - {title}', { title: 'T', uploader: 'U' }),
      'U - T'
    )
    assert.equal(
      applyTemplate('{title} ({ext})', { title: 'T', ext: 'mp4' }),
      'T (mp4)'
    )
    assert.equal(
      applyTemplate('{title} [{height}p]', { title: 'T', height: null, date: '2026-11-24' }),
      'T'
    )
    assert.equal(
      applyTemplate('{title} {date}', { title: 'T', date: '2026-11-24' }),
      'T 2026-11-24'
    )
  })

  it('suggestName cleans, templates, keeps the extension, sanitizes', () => {
    assert.equal(
      suggestName({
        filename: 'Best Song (Official Video) [HD].mp4',
        title: 'Best Song (Official Video)',
        height: 1080,
        template: '{title} [{height}p]'
      }),
      'Best Song [1080p].mp4'
    )
    assert.equal(
      suggestName({ filename: 'a<b>.mp3', title: 'a<b>', template: '{title}' }),
      'a_b_.mp3'
    )
    assert.equal(
      suggestName({ filename: 'x.mp4', title: '', template: '{title}' }),
      'download.mp4'
    )
  })
})

describe('duplicates: findFileDuplicate', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'dovira-dup-'))
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('same name + same size is a duplicate; different size is not', () => {
    writeFileSync(join(dir, 'f.mp4'), Buffer.alloc(100))
    const hit = findFileDuplicate(dir, 'f.mp4', 100)
    assert.ok(hit)
    assert.equal(hit?.name, 'f.mp4')
    assert.equal(hit?.size, 100)
    assert.equal(findFileDuplicate(dir, 'f.mp4', 99), null)
    assert.equal(findFileDuplicate(dir, 'other.mp4', 100), null)
  })

  it('unknown size (null) matches on name alone; empty filename never matches', () => {
    writeFileSync(join(dir, 'f.mp4'), Buffer.alloc(5))
    assert.ok(findFileDuplicate(dir, 'f.mp4', null))
    assert.equal(findFileDuplicate(dir, '', 5), null)
  })

  it('a directory with the same name is not a file duplicate', () => {
    mkdirSync(join(dir, 'sub.mp4'))
    assert.equal(findFileDuplicate(dir, 'sub.mp4', null), null)
    assert.equal(existsSync(join(dir, 'sub.mp4')), true)
  })
})

describe('adaptive: classify / fragments / retryDelays / reset', () => {
  it('no samples -> medium; fast/medium/slow by mean', () => {
    const n = new AdaptiveNet()
    assert.equal(n.classify(), 'medium')
    assert.equal(n.sampleCount, 0)
    for (let i = 0; i < 5; i++) n.sample(10 * MB)
    assert.equal(n.classify(), 'fast')
    assert.equal(n.fragments(), 8)
    assert.deepEqual(n.retryDelaysMs(), [2000, 5000, 15000])
    n.reset()
    assert.equal(n.classify(), 'medium')
    assert.equal(n.sampleCount, 0)
    for (let i = 0; i < 5; i++) n.sample(0.5 * MB)
    assert.equal(n.classify(), 'slow')
    assert.equal(n.fragments(), 2)
    assert.deepEqual(n.retryDelaysMs(), [5000, 15000, 30000])
  })

  it('wildly varying speeds (CV > 0.6) -> unstable', () => {
    const n = new AdaptiveNet()
    for (const s of [10 * MB, 0.1 * MB, 10 * MB, 0.1 * MB, 10 * MB]) n.sample(s)
    assert.equal(n.classify(), 'unstable')
    assert.equal(n.connections(), 4)
  })

  it('ignores zero/negative/NaN samples; keeps only the last 30', () => {
    const n = new AdaptiveNet()
    n.sample(0)
    n.sample(-5)
    n.sample(NaN)
    assert.equal(n.sampleCount, 0)
    for (let i = 0; i < 40; i++) n.sample(3 * MB)
    assert.equal(n.sampleCount, 30)
    assert.equal(n.classify(), 'medium')
  })
})
