import { describe, it, beforeEach, afterEach, after, mock } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { createRequire } from 'node:module'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, basename } from 'node:path'
import { ENGINE_FILES } from '../src/main/util/paths.ts'

// ffmpeg binary name for the platform under test (ffmpeg.exe on Windows,
// bare 'ffmpeg' elsewhere) — recoverYtDlpRename looks for the platform name.
const FFMPEG_FILE = ENGINE_FILES['ffmpeg']

const require = createRequire(import.meta.url)
const cp = require('node:child_process')

// ---------------------------------------------------------------------------
// Mocks are installed at MODULE SCOPE, before any import of the code under
// test. Node snapshots ESM named imports from CJS modules at first import,
// so a mock.method installed in a later describe's beforeEach does NOT
// intercept a module that was already imported in an earlier describe.
// ---------------------------------------------------------------------------

type FakeChild = EventEmitter & {
  stdout: EventEmitter
  stderr: EventEmitter
  kill: (sig?: string) => boolean
  killed: boolean
  killCalls: string[]
}

type SpawnCall = { file: string; args: string[]; opts: unknown }

function makeChild(): FakeChild {
  const child = new EventEmitter() as FakeChild
  child.stdout = new EventEmitter()
  child.stderr = new EventEmitter()
  child.killed = false
  child.killCalls = []
  child.kill = (sig = 'SIGTERM') => {
    child.killed = true
    child.killCalls.push(sig)
    return true
  }
  return child
}

let spawnCalls: SpawnCall[] = []
let nextChild: FakeChild | null = null
mock.method(cp, 'spawn', (file: string, args: string[], opts?: unknown) => {
  spawnCalls.push({ file, args: [...args], opts })
  return (nextChild ?? makeChild()) as never
})

function probeOutput(kind: 'video' | 'audio' | 'both'): string {
  const videoLine = '    Stream #0:0(und): Video: h264 (High), yuv420p, 1280x720, 30 fps'
  const audioLine = '    Stream #0:1(und): Audio: aac (LC), 48000 Hz, stereo'
  const streams =
    kind === 'video' ? videoLine : kind === 'audio' ? audioLine : `${videoLine}\n${audioLine}`
  return `Input #0, mov,mp4,m4a,3gp,3g2,mj2, from 'x.mp4':\n  Duration: 00:01:00.00, start: 0.000000, bitrate: 1000 kb/s\n${streams}\n`
}

let execFileMode: 'ok' | 'merge-fail' | 'no-streams' = 'ok'
let execFileCalls: { tool: string; args: string[] }[] = []
mock.method(
  cp,
  'execFile',
  (
    tool: string,
    args: string[],
    _opts: unknown,
    cb: (err: Error | null, stdout: string, stderr: string) => void
  ) => {
    execFileCalls.push({ tool, args: [...args] })
    if (execFileMode === 'no-streams') {
      cb(null, '', 'Duration: N/A')
      return undefined
    }
    // ffmpeg probe: -hide_banner -i <file>
    if (args.includes('-hide_banner') && args.includes('-i')) {
      const target = args[args.length - 1]
      if (target.endsWith('.m4a')) cb(null, '', probeOutput('audio'))
      else if (/\.f\d+\.mp4$/.test(target)) cb(null, '', probeOutput('video'))
      else cb(null, '', probeOutput('both'))
      return undefined
    }
    if (execFileMode === 'merge-fail') {
      cb(new Error('ffmpeg failed'), '', '')
      return undefined
    }
    // ffmpeg merge/transcode: last arg is the output file.
    writeFileSync(args[args.length - 1], 'merged-bytes')
    cb(null, '', '')
    return undefined
  }
)

after(() => mock.restoreAll())

// ---------------------------------------------------------------------------

function baseOpts(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    url: 'https://youtu.be/abc123',
    savePath: 'C:\\DL\\Film.mp4',
    kind: 'video',
    formatString: 'bv*[height<=1080]+ba/b[height<=1080]',
    container: 'mp4',
    audioBitrate: '320',
    ...over
  }
}

function makeManager(
  network?: () => {
    cookieBrowser: string
    cookiesFile: string | null
    proxyUrl: string
    downloadArchive: string | null
  },
  extCookiesDir?: string | null
): Promise<import('../src/main/engines/ytdlp.ts').YtDlpManager> {
  return import('../src/main/engines/ytdlp.ts').then(
    ({ YtDlpManager }) =>
      new YtDlpManager(
        'C:\\bin\\yt-dlp.exe',
        'C:\\bin',
        'C:\\bin\\deno.exe',
        network ??
          (() => ({
            cookieBrowser: 'none',
            cookiesFile: null,
            proxyUrl: '',
            downloadArchive: null
          })),
        undefined,
        extCookiesDir ?? null
      )
  )
}

describe('ytdlp pure helpers', () => {
  it('mapYtDlpError: unavailable, login, drm, engine-missing, forbidden, not-found, network, unknown', async () => {
    const { mapYtDlpError } = await import('../src/main/engines/ytdlp.ts')
    // Takes the raw stderr/message STRING, not an Error object.
    assert.equal(mapYtDlpError('ERROR: This video is unavailable'), 'unavailable')
    assert.equal(mapYtDlpError('Private video'), 'unavailable')
    assert.equal(mapYtDlpError('Sign in to confirm your age'), 'login-required')
    // Fix 2(d): a message carrying both 404 and a login phrase is not-found.
    assert.equal(mapYtDlpError('ERROR: 404 Not Found — Sign in to confirm your age'), 'not-found')
    assert.equal(mapYtDlpError('This video has DRM'), 'drm')
    assert.equal(mapYtDlpError('spawn yt-dlp.exe ENOENT'), 'engine-missing')
    assert.equal(mapYtDlpError('ERROR: 403 Forbidden'), 'forbidden')
    assert.equal(mapYtDlpError('ERROR: 404 Not Found'), 'not-found')
    assert.equal(mapYtDlpError('Request timed out'), 'network')
    // No 429 branch exists in the mapper — it falls through to unknown.
    assert.equal(mapYtDlpError('HTTP Error 429: Too Many Requests'), 'unknown')
    assert.equal(mapYtDlpError('some weird failure'), 'unknown')
  })

  it('rewriteLimitRate strips the two-token --limit-rate, leaves --limit-rate=X, and (re)adds it before -o', async () => {
    const { rewriteLimitRate } = await import('../src/main/engines/ytdlp.ts')
    assert.deepEqual(rewriteLimitRate(['-x', '--limit-rate', '100K'], 0), ['-x'])
    assert.deepEqual(rewriteLimitRate(['-x', '--limit-rate=100K'], 0), ['-x', '--limit-rate=100K'])
    assert.deepEqual(rewriteLimitRate(['-x'], 512), ['-x', '--limit-rate', '512K'])
    assert.deepEqual(rewriteLimitRate(['-x', '-o', 'out.mp4'], 256), [
      '-x',
      '--limit-rate',
      '256K',
      '-o',
      'out.mp4'
    ])
  })

  it('parseProgressLine: short-key JSON only; NA -> nulls; finished status; plain text -> null', async () => {
    const { parseProgressLine } = await import('../src/main/engines/ytdlp.ts')
    // The progress template emits {"d":...,"t":...,"s":...,"e":...,"st":...}.
    const json = parseProgressLine('{"d":50,"t":100,"s":10,"e":5,"st":"downloading"}')
    assert.deepEqual(json, {
      doneBytes: 50,
      totalBytes: 100,
      speedBps: 10,
      etaSeconds: 5,
      status: 'downloading'
    })
    assert.deepEqual(parseProgressLine('{"d":NA,"t":NA,"s":NA,"e":NA,"st":"downloading"}'), {
      doneBytes: 0,
      totalBytes: 0,
      speedBps: 0,
      etaSeconds: null,
      status: 'downloading'
    })
    assert.equal(
      parseProgressLine('{"d":100,"t":100,"s":0,"e":0,"st":"finished"}')?.status,
      'finished'
    )
    assert.equal(parseProgressLine('[download] 42.5% of 10.00MiB at 1.23MiB/s ETA 00:04'), null)
    assert.equal(parseProgressLine('some random line'), null)
    assert.equal(parseProgressLine('{"d":50,'), null)
  })

  it('ytdlpPartFiles takes the save path; finds .part/.ytdl + per-format temps by stem', async () => {
    const { ytdlpPartFiles } = await import('../src/main/engines/ytdlp.ts')
    const dir = mkdtempSync(join(tmpdir(), 'dovira-parts-'))
    try {
      writeFileSync(join(dir, 'Film.f399.mp4.part'), 'x')
      writeFileSync(join(dir, 'Film.f140.m4a.part'), 'x')
      writeFileSync(join(dir, 'Film.mp4'), 'x')
      writeFileSync(join(dir, 'Film.mp4.ytdl'), 'x')
      writeFileSync(join(dir, 'Other.mp4.part'), 'x')
      const found = ytdlpPartFiles(join(dir, 'Film.mp4'))
      // readdir order is not guaranteed — compare as a sorted set.
      assert.deepEqual(found.map((f) => basename(f)).sort(), [
        'Film.f140.m4a.part',
        'Film.f399.mp4.part',
        'Film.mp4.ytdl'
      ])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('ytdlp buildArgs (pure, no spawn)', () => {
  it('video: format + merge container + progress template + output', async () => {
    const m = await makeManager()
    const args = m.buildArgs(baseOpts())
    // baseArgs: [network..., --no-warnings, --no-playlist, --ffmpeg-location, dir, --js-runtimes, deno:...]
    assert.equal(args[0], '--no-warnings')
    assert.equal(args[1], '--no-playlist')
    assert.equal(args[2], '--ffmpeg-location')
    assert.equal(args[3], 'C:\\bin')
    assert.ok(args.includes('--newline'))
    assert.ok(args.includes('--progress-template'))
    assert.ok(args.includes('-f'))
    assert.ok(args.includes('bv*[height<=1080]+ba/b[height<=1080]'))
    assert.ok(args.includes('--merge-output-format'))
    assert.ok(args.includes('mp4'))
    assert.equal(args[args.length - 4], '-o')
    assert.equal(args[args.length - 3], 'C:\\DL\\Film.mp4')
    assert.equal(args[args.length - 2], '--')
    assert.equal(args[args.length - 1], 'https://youtu.be/abc123')
  })

  it('video: --no-playlist from baseArgs; audio: -x + bitrate (capital K), no format/merge', async () => {
    const m = await makeManager()
    const videoArgs = m.buildArgs(baseOpts())
    assert.ok(videoArgs.includes('--no-playlist'))
    const audioArgs = m.buildArgs(baseOpts({ kind: 'audio' }))
    assert.ok(audioArgs.includes('-x'))
    assert.ok(audioArgs.includes('--audio-format'))
    assert.ok(audioArgs.includes('mp3'))
    assert.ok(audioArgs.includes('--audio-quality'))
    assert.ok(audioArgs.includes('320K'))
    assert.ok(!audioArgs.includes('-f'))
    assert.ok(!audioArgs.includes('--merge-output-format'))
  })

  it('buildPlainArgs: positional (url, savePath, limit); no format selection, limit-rate when set', async () => {
    const m = await makeManager()
    const args = m.buildPlainArgs('https://x.example/f.zip', 'C:\\DL\\f.zip', 512)
    assert.ok(!args.includes('-f'))
    assert.ok(args.includes('--limit-rate'))
    assert.ok(args.includes('512K'))
    assert.equal(args[args.length - 4], '-o')
    assert.equal(args[args.length - 3], 'C:\\DL\\f.zip')
    assert.equal(args[args.length - 2], '--')
    assert.equal(args[args.length - 1], 'https://x.example/f.zip')
    const noLimit = m.buildPlainArgs('https://x.example/f.zip', 'C:\\DL\\f.zip')
    assert.ok(!noLimit.includes('--limit-rate'))
  })

  it('clip: --download-sections + force-keyframes; subs: --write-subs + langs + --embed-subs; embedThumbnail', async () => {
    const m = await makeManager()
    const clip = m.buildArgs(baseOpts({ clipStart: '00:00:10', clipEnd: '00:00:30' }))
    assert.ok(clip.includes('--download-sections'))
    assert.ok(clip.includes('*00:00:10-00:00:30'))
    assert.ok(clip.includes('--force-keyframes-at-cuts'))
    const subs = m.buildArgs(
      baseOpts({ subtitles: true, subLang: 'en', subMode: 'both', embedThumbnail: true })
    )
    assert.ok(subs.includes('--write-subs'))
    assert.ok(subs.includes('--sub-langs'))
    assert.ok(subs.includes('en'))
    assert.ok(subs.includes('--sub-format'))
    assert.ok(subs.includes('srt/best'))
    assert.ok(subs.includes('--embed-subs'))
    assert.ok(subs.includes('--embed-thumbnail'))
  })

  it('network overrides: cookies from browser, cookies file, proxy, download archive (useArchive)', async () => {
    const m = await makeManager(() => ({
      cookieBrowser: 'chrome',
      cookiesFile: null,
      proxyUrl: 'http://proxy.example:8080',
      downloadArchive: 'C:\\DL\\archive.txt'
    }))
    const args = m.buildArgs(baseOpts({ useArchive: true }))
    assert.ok(args.includes('--cookies-from-browser'))
    assert.ok(args.includes('chrome'))
    assert.ok(args.includes('--proxy'))
    assert.ok(args.includes('http://proxy.example:8080'))
    assert.ok(args.includes('--download-archive'))
    assert.ok(args.includes('C:\\DL\\archive.txt'))
    // Fix 2(c): --cookies is only passed for a real, valid file — a
    // missing/corrupt path is skipped, so the test writes one.
    const cookiesDir = mkdtempSync(join(tmpdir(), 'dovira-cookies-override-'))
    const cookiesPath = join(cookiesDir, 'cookies.txt')
    const future = Math.floor(Date.now() / 1000) + 3600
    writeFileSync(
      cookiesPath,
      `# Netscape HTTP Cookie File\n.example.com\tTRUE\t/\tFALSE\t${future}\tsession\tabc123\n`
    )
    try {
      const fileCookies = await makeManager(() => ({
        cookieBrowser: 'none',
        cookiesFile: cookiesPath,
        proxyUrl: '',
        downloadArchive: null
      }))
      const args2 = fileCookies.buildArgs(baseOpts())
      assert.ok(args2.includes('--cookies'))
      assert.ok(args2.includes(cookiesPath))
      assert.ok(!args2.includes('--cookies-from-browser'))
    } finally {
      rmSync(cookiesDir, { recursive: true, force: true })
    }
  })
})

describe('ytdlp fetchInfo / fetchPlaylist (spawn mocked)', () => {
  const withEntries = {
    id: 'abc123',
    title: 'Test Film',
    uploader: 'Tester',
    duration: 60,
    thumbnail: 'https://i.example/t.jpg',
    webpage_url: 'https://youtu.be/abc123',
    description: 'A test film.',
    categories: ['Education'],
    formats: [
      {
        format_id: '399',
        ext: 'mp4',
        height: 1080,
        filesize: 1000,
        vcodec: 'avc1',
        acodec: 'none'
      },
      { format_id: '140', ext: 'm4a', height: null, filesize: 200, vcodec: 'none', acodec: 'mp4a' }
    ],
    thumbnails: [{ url: 'https://i.example/t2.jpg', width: 640, height: 360 }],
    subtitles: { en: [{ url: 'https://i.example/en.vtt', ext: 'vtt' }] },
    entries: [
      {
        id: 'm1',
        title: 'Photo 1',
        webpage_url: 'https://x.example/m1',
        duration: 5,
        thumbnails: [{ url: 'https://i.example/m1.jpg' }]
      },
      { id: 'm2', title: 'Photo 2', url: 'https://x.example/m2', duration: null }
    ]
  }

  function answerJson(obj: unknown, code = 0): FakeChild {
    const child = makeChild()
    process.nextTick(() => {
      child.stdout.emit('data', Buffer.from(JSON.stringify(obj)))
      child.emit('close', code)
    })
    return child
  }

  beforeEach(() => {
    spawnCalls = []
    nextChild = null
  })

  it('fetchInfo parses formats/thumbnails/subs/categories/mediaItems', async () => {
    const m = await makeManager()
    nextChild = answerJson(withEntries)
    const info = await m.fetchInfo('https://youtu.be/abc123')
    assert.equal(info.title, 'Test Film')
    assert.equal(info.uploader, 'Tester')
    assert.equal(info.duration, 60)
    // The id field is videoId; the thumbnail is the LAST thumbnails[] entry
    // (the top-level thumbnail field is ignored).
    assert.equal(info.videoId, 'abc123')
    assert.equal(info.site, 'youtu.be')
    assert.equal(info.isLive, false)
    assert.equal(info.extractor, null)
    assert.equal(info.formats.length, 2)
    assert.deepEqual(info.formats[0], {
      id: '399',
      height: 1080,
      ext: 'mp4',
      filesize: 1000,
      note: null,
      combined: false
    })
    assert.deepEqual(info.formats[1], {
      id: '140',
      height: null,
      ext: 'm4a',
      filesize: 200,
      note: null,
      combined: false
    })
    assert.equal(info.thumbnail, 'https://i.example/t2.jpg')
    // categories[0] only; subtitles become a language list.
    assert.equal(info.ytCategory, 'Education')
    assert.deepEqual(info.subtitleLangs, ['en'])
    assert.deepEqual(info.autoCaptionLangs, [])
    // Multi-media picker: built from entries[], NOT from chapters.
    assert.equal(info.mediaItems.length, 2)
    assert.equal(info.mediaItems[0].title, 'Photo 1')
    assert.equal(info.mediaItems[0].url, 'https://x.example/m1')
    assert.equal(info.mediaItems[0].thumbnail, 'https://i.example/m1.jpg')
    assert.equal(info.mediaItems[1].url, 'https://x.example/m2')
    assert.equal(spawnCalls.length, 1)
    assert.ok(spawnCalls[0].args.includes('--dump-single-json'))
    assert.ok(spawnCalls[0].args.includes('--no-playlist'))
  })

  it('fetchInfo: spawn error -> engine-missing; non-zero exit -> mapped code; bad JSON -> unknown', async () => {
    const m = await makeManager()
    // YtDlpError carries the code as a property; the message is the raw
    // stderr, so assert on .code, not on the message text.
    const hasCode = (code: string) => (err: unknown) => (err as { code?: string }).code === code
    const errChild = makeChild()
    process.nextTick(() => errChild.emit('error', new Error('spawn ENOENT')))
    nextChild = errChild
    await assert.rejects(() => m.fetchInfo('https://youtu.be/abc123'), hasCode('engine-missing'))
    const failChild = makeChild()
    process.nextTick(() => {
      failChild.stderr.emit('data', Buffer.from('ERROR: This video is unavailable'))
      failChild.emit('close', 1)
    })
    nextChild = failChild
    await assert.rejects(() => m.fetchInfo('https://youtu.be/abc123'), hasCode('unavailable'))
    const badChild = makeChild()
    process.nextTick(() => {
      badChild.stdout.emit('data', Buffer.from('not json'))
      badChild.emit('close', 0)
    })
    nextChild = badChild
    // Empty stderr maps to 'unknown' — there is no 'invalid-json' code.
    await assert.rejects(() => m.fetchInfo('https://youtu.be/abc123'), hasCode('unknown'))
  })

  it('fetchPlaylist maps entries, skips id-less rows, falls back the URL/thumbnail', async () => {
    const m = await makeManager()
    const playlist = {
      title: 'My Playlist',
      uploader: 'Tester',
      entries: [
        {
          id: 'v1',
          title: 'One',
          duration: 10,
          thumbnail: 'https://i.example/1.jpg',
          webpage_url: 'https://youtu.be/v1'
        },
        { id: 'v2', title: 'Two', duration: 20, url: 'https://youtu.be/v2' },
        { title: 'No id here' },
        { id: 'v3', title: 'Three', duration: 30 }
      ]
    }
    nextChild = answerJson(playlist)
    const out = await m.fetchPlaylist('https://youtube.com/playlist?list=PL1')
    assert.equal(out.title, 'My Playlist')
    // The field is entries, not items.
    assert.equal(out.entries.length, 3)
    assert.equal(out.entries[0].id, 'v1')
    assert.equal(out.entries[0].thumbnail, 'https://i.example/1.jpg')
    assert.equal(out.entries[0].url, 'https://www.youtube.com/watch?v=v1')
    assert.equal(out.entries[1].url, 'https://youtu.be/v2')
    assert.equal(out.entries[1].thumbnail, null)
    assert.equal(out.entries[2].url, 'https://www.youtube.com/watch?v=v3')
    assert.ok(!spawnCalls[0].args.includes('--no-playlist'))
  })

  it('isValidNetscapeCookiesText: comments/blank lines ok, 7 fields + numeric expiry, muse. invalid', async () => {
    const { isValidNetscapeCookiesText, isValidNetscapeCookiesFile } =
      await import('../src/main/util/fetchInfoCache.ts')
    const future = Math.floor(Date.now() / 1000) + 3600
    const good = `# Netscape HTTP Cookie File\n.example.com\tTRUE\t/\tFALSE\t${future}\tsession\tabc123\n`
    assert.equal(isValidNetscapeCookiesText(good), true)
    // #HttpOnly_ is a host-only marker, not a comment.
    assert.equal(
      isValidNetscapeCookiesText(
        `# Netscape HTTP Cookie File\n#HttpOnly_.example.com\tTRUE\t/\tFALSE\t${future}\tsession\tabc123\n`
      ),
      true
    )
    assert.equal(isValidNetscapeCookiesText('muse.'), false)
    assert.equal(isValidNetscapeCookiesText(''), false)
    assert.equal(isValidNetscapeCookiesText('# only comments\n# nothing else\n'), false)
    assert.equal(
      isValidNetscapeCookiesText(`.example.com\tTRUE\t/\tFALSE\tnot-a-number\tsession\tabc123\n`),
      false
    )
    assert.equal(
      isValidNetscapeCookiesText(`.example.com\tTRUE\t/\tFALSE\t${future}\tsession\n`),
      false
    )
    assert.equal(isValidNetscapeCookiesText(`${good}short\tline\n`), false)
    // File form: a missing file is invalid.
    const dir = mkdtempSync(join(tmpdir(), 'dovira-cookies-valid-'))
    try {
      const f = join(dir, 'good.txt')
      writeFileSync(f, good)
      assert.equal(isValidNetscapeCookiesFile(f), true)
      assert.equal(isValidNetscapeCookiesFile(join(dir, 'missing.txt')), false)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('networkArgs: valid cookies passed; corrupt file skipped, managed file deleted, settings file kept', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dovira-cookies-'))
    const managedDir = join(dir, 'ext-cookies')
    mkdirSync(managedDir, { recursive: true })
    const future = Math.floor(Date.now() / 1000) + 3600
    const goodFile = join(dir, 'good.txt')
    const badManaged = join(managedDir, 'bad.txt')
    const badSettings = join(dir, 'settings-bad.txt')
    writeFileSync(
      goodFile,
      `# Netscape HTTP Cookie File\n.example.com\tTRUE\t/\tFALSE\t${future}\tsession\tabc123\n`
    )
    writeFileSync(badManaged, 'muse.')
    writeFileSync(badSettings, 'muse.')
    const cookiesValue = (args: string[]): string | null => {
      const i = args.indexOf('--cookies')
      return i >= 0 ? args[i + 1] : null
    }
    try {
      // Settings path, valid file -> --cookies present.
      let m = await makeManager(
        () => ({
          cookieBrowser: 'none',
          cookiesFile: goodFile,
          proxyUrl: '',
          downloadArchive: null
        }),
        managedDir
      )
      nextChild = answerJson(withEntries)
      await m.fetchInfo('https://youtu.be/abc123')
      assert.equal(cookiesValue(spawnCalls[0].args), goodFile)
      // Settings path, corrupt file -> skipped, file KEPT (user's own file).
      spawnCalls = []
      m = await makeManager(
        () => ({
          cookieBrowser: 'none',
          cookiesFile: badSettings,
          proxyUrl: '',
          downloadArchive: null
        }),
        managedDir
      )
      nextChild = answerJson(withEntries)
      await m.fetchInfo('https://youtu.be/abc123')
      assert.equal(cookiesValue(spawnCalls[0].args), null)
      assert.equal(existsSync(badSettings), true)
      // Override path, corrupt managed file -> skipped AND deleted.
      spawnCalls = []
      m = await makeManager(undefined, managedDir)
      nextChild = answerJson(withEntries)
      await m.fetchInfo('https://youtu.be/abc123', { cookiesFile: badManaged })
      assert.equal(cookiesValue(spawnCalls[0].args), null)
      assert.equal(existsSync(badManaged), false)
      // Override path, valid file -> --cookies present.
      spawnCalls = []
      m = await makeManager(undefined, managedDir)
      nextChild = answerJson(withEntries)
      await m.fetchInfo('https://youtu.be/abc123', { cookiesFile: goodFile })
      assert.equal(cookiesValue(spawnCalls[0].args), goodFile)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('ytdlp YtDlpDownload (spawn mocked)', () => {
  beforeEach(() => {
    spawnCalls = []
    nextChild = null
  })

  it('progress JSON lines -> onProgress; other stdout -> stderr tail; stderr -> onLog', async () => {
    const m = await makeManager()
    const child = makeChild()
    nextChild = child
    const progress: {
      doneBytes: number
      totalBytes: number
      speedBps: number
      etaSeconds: number | null
      status: string
    }[] = []
    const logs: string[] = []
    // The manager API is runDownload(args, callbacks) -> {job, done};
    // there is no startDownload method.
    const { job, done } = m.runDownload(m.buildArgs(baseOpts()), {
      onProgress: (p) => progress.push(p),
      onLog: (l) => logs.push(l)
    })
    // Short-key progress template JSON, as yt-dlp actually prints it.
    child.stdout.emit('data', Buffer.from('{"d":50,"t":100,"s":10,"e":5,"st":"downloading"}\n'))
    child.stdout.emit('data', Buffer.from('[download] some plain line\n'))
    child.stderr.emit('data', Buffer.from('yt-dlp: a warning\n'))
    child.emit('close', 0)
    const result = await done
    assert.equal(result.code, 0)
    assert.deepEqual(progress, [
      { doneBytes: 50, totalBytes: 100, speedBps: 10, etaSeconds: 5, status: 'downloading' }
    ])
    assert.ok(logs.some((l) => l.includes('yt-dlp: a warning')))
    assert.ok(job.getStderr().includes('[download] some plain line'))
  })

  it('kill() sends SIGTERM to the live process', async () => {
    const m = await makeManager()
    const child = makeChild()
    nextChild = child
    const { job, done } = m.runDownload(m.buildArgs(baseOpts()), {
      onProgress: () => undefined,
      onLog: () => undefined
    })
    job.kill()
    assert.deepEqual(child.killCalls, ['SIGTERM'])
    child.emit('close', null)
    const result = await done
    assert.equal(result.code, null)
  })
})

describe('ytdlp recoverYtDlpRename (execFile mocked)', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'dovira-recover-'))
    execFileCalls = []
    execFileMode = 'ok'
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('merges video+audio temps into the save path and cleans up', async () => {
    const { recoverYtDlpRename } = await import('../src/main/engines/ytdlp.ts')
    writeFileSync(join(dir, FFMPEG_FILE), 'fake-ffmpeg')
    writeFileSync(join(dir, 'Film.f399.mp4.part'), 'video-bytes')
    writeFileSync(join(dir, 'Film.f140.m4a.part'), 'audio-bytes')
    const ok = await recoverYtDlpRename(dir, join(dir, 'Film.mp4'), 'video', '320')
    assert.equal(ok, true)
    assert.equal(existsSync(join(dir, 'Film.mp4')), true)
    assert.equal(existsSync(join(dir, 'Film.f399.mp4')), false)
    assert.equal(existsSync(join(dir, 'Film.f140.m4a')), false)
    assert.ok(readdirSync(dir).every((f) => f === FFMPEG_FILE || f === 'Film.mp4'))
  })

  it('false when ffmpeg is missing, when there are no temps, or when a probe finds no streams', async () => {
    const { recoverYtDlpRename } = await import('../src/main/engines/ytdlp.ts')
    // The first two cases return before any execFile call; the third needs
    // the no-streams probe. One mock install for the whole test.
    execFileMode = 'no-streams'
    assert.equal(
      await recoverYtDlpRename(join(dir, 'no-ffmpeg-dir'), join(dir, 'x.mp4'), 'video', '320'),
      false
    )
    assert.equal(await recoverYtDlpRename(dir, join(dir, 'Empty.mp4'), 'video', '320'), false)
    writeFileSync(join(dir, FFMPEG_FILE), 'fake-ffmpeg')
    writeFileSync(join(dir, 'Film.f399.mp4.part'), 'video-bytes')
    assert.equal(await recoverYtDlpRename(dir, join(dir, 'Film.mp4'), 'video', '320'), false)
  })

  it('false when the ffmpeg merge itself fails', async () => {
    const { recoverYtDlpRename } = await import('../src/main/engines/ytdlp.ts')
    execFileMode = 'merge-fail'
    writeFileSync(join(dir, FFMPEG_FILE), 'fake-ffmpeg')
    writeFileSync(join(dir, 'Film.f399.mp4.part'), 'video-bytes')
    writeFileSync(join(dir, 'Film.f140.m4a.part'), 'audio-bytes')
    assert.equal(await recoverYtDlpRename(dir, join(dir, 'Film.mp4'), 'video', '320'), false)
  })
})

describe('ytdlp self-heal (fetchInfo retry after engine update)', () => {
  function answerJson(obj: unknown, code = 0): FakeChild {
    const child = makeChild()
    process.nextTick(() => {
      child.stdout.emit('data', Buffer.from(JSON.stringify(obj)))
      child.emit('close', code)
    })
    return child
  }

  function badJsonChild(): FakeChild {
    const child = makeChild()
    process.nextTick(() => {
      child.stdout.emit('data', Buffer.from('not json'))
      child.emit('close', 0)
    })
    return child
  }

  async function managerWithHeal(
    hook: () => Promise<boolean>
  ): Promise<import('../src/main/engines/ytdlp.ts').YtDlpManager> {
    const { YtDlpManager } = await import('../src/main/engines/ytdlp.ts')
    return new YtDlpManager(
      'C:\\bin\\yt-dlp.exe',
      'C:\\bin',
      'C:\\bin\\deno.exe',
      () => ({ cookieBrowser: 'none', cookiesFile: null, proxyUrl: '', downloadArchive: null }),
      hook
    )
  }

  beforeEach(() => {
    spawnCalls = []
    nextChild = null
  })

  it("'unknown' failure + hook updates -> retry succeeds, hook called once, 2 spawns", async () => {
    let hookCalls = 0
    const m = await managerWithHeal(async () => {
      hookCalls++
      nextChild = answerJson({ id: 'abc123', title: 'Healed', formats: [], thumbnails: [] })
      return true
    })
    nextChild = badJsonChild()
    const info = await m.fetchInfo('https://youtu.be/abc123')
    assert.equal(info.title, 'Healed')
    assert.equal(hookCalls, 1)
    assert.equal(spawnCalls.length, 2)
  })

  it("'unavailable' failure -> no heal, hook never called", async () => {
    let hookCalls = 0
    const m = await managerWithHeal(async () => {
      hookCalls++
      return true
    })
    const failChild = makeChild()
    process.nextTick(() => {
      failChild.stderr.emit('data', Buffer.from('ERROR: This video is unavailable'))
      failChild.emit('close', 1)
    })
    nextChild = failChild
    await assert.rejects(
      () => m.fetchInfo('https://youtu.be/abc123'),
      (err: unknown) => {
        assert.equal((err as { code?: string }).code, 'unavailable')
        return true
      }
    )
    assert.equal(hookCalls, 0)
    assert.equal(spawnCalls.length, 1)
  })

  it('hook returns false -> original error surfaces, 1 spawn', async () => {
    const m = await managerWithHeal(async () => false)
    nextChild = badJsonChild()
    await assert.rejects(
      () => m.fetchInfo('https://youtu.be/abc123'),
      (err: unknown) => {
        assert.equal((err as { code?: string }).code, 'unknown')
        return true
      }
    )
    assert.equal(spawnCalls.length, 1)
  })

  it('no hook -> unchanged behavior (rejects, 1 spawn)', async () => {
    const m = await makeManager()
    nextChild = badJsonChild()
    await assert.rejects(
      () => m.fetchInfo('https://youtu.be/abc123'),
      (err: unknown) => {
        assert.equal((err as { code?: string }).code, 'unknown')
        return true
      }
    )
    assert.equal(spawnCalls.length, 1)
  })

  it('fetchPlaylist heals the same way', async () => {
    let hookCalls = 0
    const m = await managerWithHeal(async () => {
      hookCalls++
      nextChild = answerJson({
        title: 'Pl',
        entries: [
          { id: 'a', title: 'A' },
          { id: 'b', title: 'B' }
        ]
      })
      return true
    })
    nextChild = badJsonChild()
    const pl = await m.fetchPlaylist('https://www.youtube.com/playlist?list=PLx')
    assert.equal(pl.entries.length, 2)
    assert.equal(hookCalls, 1)
    assert.equal(spawnCalls.length, 2)
  })
})
