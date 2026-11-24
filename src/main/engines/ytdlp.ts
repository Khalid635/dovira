import { execFile, spawn, type ChildProcess } from 'node:child_process'
import { existsSync, readdirSync, renameSync, statSync, unlinkSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { logMain } from '../logger.ts'
import { parseMediaItems, type YtDlpMediaItem } from '../util/mediaItems.ts'

export type { YtDlpMediaItem } from '../util/mediaItems.ts'

export interface YtDlpFormat {
  id: string
  height: number | null
  ext: string
  filesize: number | null
  note: string | null
  combined: boolean
}

export interface YtDlpInfo {
  url: string
  title: string
  thumbnail: string | null
  duration: number | null
  uploader: string | null
  site: string | null
  formats: YtDlpFormat[]
  /** Phase 4: true when the URL is a live stream (duration is null). */
  isLive: boolean
  /** Phase 4: languages with human-made subtitles (from the info JSON). */
  subtitleLangs: string[]
  /** Phase 4: languages with auto-generated captions. */
  autoCaptionLangs: string[]
  /** Phase 7: yt-dlp video id + extractor (duplicate detection via remote_id). */
  videoId: string | null
  extractor: string | null
  /** Phase 7: yt-dlp categories[0], e.g. "Music" (file organizer). */
  ytCategory: string | null
  /** Cobalt-inspired multi-media picker: >1 when the URL is a multi-media post. */
  mediaItems: YtDlpMediaItem[]
}

/** Phase 4: one flat-playlist entry (no formats — quality is chosen once). */
export interface PlaylistEntry {
  id: string
  title: string
  duration: number | null
  url: string
  thumbnail: string | null
}

/** Phase 4: a playlist/channel, fetched with --flat-playlist -J. */
export interface PlaylistInfo {
  url: string
  title: string
  uploader: string | null
  entries: PlaylistEntry[]
}

export interface YtDlpProgress {
  doneBytes: number
  totalBytes: number
  speedBps: number
  etaSeconds: number | null
  status: 'downloading' | 'finished'
}

export interface YtDlpDownloadOpts {
  url: string
  savePath: string
  formatString: string
  kind: 'video' | 'audio'
  audioBitrate?: string
  subtitles?: boolean
  subLang?: string
  embedThumbnail?: boolean
  container?: string
  useAria2?: boolean
  /** Phase 4: clip bounds (HH:MM:SS or seconds), null = no clip. Video only. */
  clipStart?: string | null
  clipEnd?: string | null
  /** Phase 4: --embed-metadata (title/artist). */
  embedMetadata?: boolean
  /** Phase 4: subtitles destination — embed, separate .srt, or both. */
  subMode?: 'embed' | 'file' | 'both'
  /** Phase 4: also take auto-generated captions. */
  autoSubs?: boolean
  /** Phase 4: download only the thumbnail (.jpg), no media. */
  thumbnailOnly?: boolean
  /** Phase 4: skip via --download-archive when already downloaded. */
  useArchive?: boolean
  /** Phase 5: per-link network overrides from the browser extension. */
  cookiesFile?: string | null
  userAgent?: string | null
  referer?: string | null
  /** Phase 7: effective speed limit in KB/s, 0 = unlimited. */
  speedLimitKBps?: number
  /** Phase 7: concurrent fragments (-N) — Smart Download, when > 1. */
  fragments?: number
  /** Next-level: live-stream recording — raw .ts stream, no merge. */
  liveRecord?: boolean
}

/**
 * Phase 5: per-call network overrides (from the browser extension's
 * Local API request). When present they replace the Settings values for
 * this one call — a per-link cookies file beats --cookies-from-browser,
 * and the extension's User-Agent/Referer are used instead of yt-dlp's
 * defaults. Never logged.
 */
export interface NetOverride {
  cookiesFile?: string | null
  userAgent?: string | null
  referer?: string | null
}

export interface YtDlpDownloadCallbacks {
  onProgress: (p: YtDlpProgress) => void
  onLog: (line: string) => void
}

export class YtDlpError extends Error {
  // No parameter properties — Node's strip-only test runner cannot
  // parse them; explicit fields instead.
  code: string

  constructor(code: string, message: string) {
    super(message)
    this.code = code
    this.name = 'YtDlpError'
  }
}

/** Map yt-dlp stderr text to a stable error code (§7.8). */
export function mapYtDlpError(raw: string): string {
  const s = raw.toLowerCase()
  if (
    s.includes('video unavailable') ||
    s.includes('this video is unavailable') ||
    s.includes('private video') ||
    s.includes('this video is private') ||
    s.includes('has been removed') ||
    s.includes('has been deleted')
  ) {
    return 'unavailable'
  }
  if (
    s.includes('sign in') ||
    s.includes('log in') ||
    s.includes('login required') ||
    s.includes('age') ||
    s.includes('confirm your age')
  ) {
    return 'login-required'
  }
  if (s.includes('drm') || s.includes('encrypted')) return 'drm'
  // v0.6.1: a spawn failure (binary missing/unexecutable) used to surface
  // as bare 'unknown' — report it as the engine problem it is.
  if (s.includes('enoent')) return 'engine-missing'
  if (s.includes('unsupported url') || s.includes('no video formats found')) return 'unsupported'
  if (s.includes('requested format is not available') || s.includes('format is not available')) {
    return 'unsupported'
  }
  if (s.includes('403') || s.includes('forbidden')) return 'forbidden'
  if (s.includes('404') || s.includes('not found')) return 'not-found'
  if (s.includes('timed out') || s.includes('etimedout')) return 'network'
  return 'unknown'
}

/**
 * Phase 7: rewrite the --limit-rate value inside an already-built arg list
 * (stored lastArgs reused on resume). Returns a new array; the original is
 * untouched. kbps <= 0 removes the flag (unlimited). The flag is inserted
 * before '-o' so it stays with the other download options.
 */
export function rewriteLimitRate(args: string[], kbps: number): string[] {
  const out: string[] = []
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--limit-rate') {
      i++ // skip the old value too
      continue
    }
    out.push(args[i])
  }
  if (kbps > 0) {
    const flag = ['--limit-rate', `${Math.floor(kbps)}K`]
    const oIdx = out.indexOf('-o')
    if (oIdx === -1) out.push(...flag)
    else out.splice(oIdx, 0, ...flag)
  }
  return out
}

/**
 * Parse one yt-dlp progress line. The progress template emits JSON, but
 * yt-dlp prints bare `NA` for unknown numbers, which is not valid JSON —
 * so NA is normalized to null first. Returns null for non-progress lines.
 */
export function parseProgressLine(line: string): YtDlpProgress | null {
  const t = line.trim()
  if (!t.startsWith('{') || !t.endsWith('}')) return null
  try {
    const obj = JSON.parse(t.replace(/:NA/g, ':null')) as {
      d?: number | null
      t?: number | null
      s?: number | null
      e?: number | null
      st?: string
    }
    if (typeof obj !== 'object' || obj === null) return null
    return {
      doneBytes: typeof obj.d === 'number' ? obj.d : 0,
      totalBytes: typeof obj.t === 'number' ? obj.t : 0,
      speedBps: typeof obj.s === 'number' ? obj.s : 0,
      etaSeconds: typeof obj.e === 'number' ? Math.round(obj.e) : null,
      status: obj.st === 'finished' ? 'finished' : 'downloading'
    }
  } catch {
    return null
  }
}

const PROGRESS_TEMPLATE =
  '{"d":%(progress.downloaded_bytes)s,"t":%(progress.total_bytes)s,"s":%(progress.speed)s,"e":%(progress.eta)s,"st":"%(progress.status)s"}'

/** The .part / fragment files yt-dlp leaves behind for a given output path. */
export function ytdlpPartFiles(savePath: string): string[] {
  const found: string[] = []
  if (existsSync(`${savePath}.part`)) found.push(`${savePath}.part`)
  if (existsSync(`${savePath}.ytdl`)) found.push(`${savePath}.ytdl`)
  try {
    const dir = dirname(savePath)
    const base = basename(savePath)
    // yt-dlp writes per-format temps next to the output, named from the
    // filename STEM: "<stem>.f<id>.<ext>", with ".part" while downloading.
    // E.g. "Film.mp4" -> "Film.f399.mp4", "Film.f399.mp4.part".
    // (The first version of this helper matched "<base>." — the full
    // filename WITH extension — which never matches those temp names.)
    const stem = base.replace(/\.[^.]+$/, '')
    for (const f of readdirSync(dir)) {
      if (!f.startsWith(`${stem}.f`)) continue
      if (
        f.endsWith('.part') ||
        f.endsWith('.temp') ||
        f.endsWith('.ytdl') ||
        /\.(mp4|webm|mkv|m4a|opus|mp3)$/.test(f)
      ) {
        found.push(join(dir, f))
      }
    }
  } catch {
    // Directory unreadable — report only the direct .part/.ytdl checks.
  }
  return [...new Set(found)]
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

function runTool(
  tool: string,
  args: string[],
  timeoutMs = 120_000
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(tool, args, { timeout: timeoutMs }, (err, stdout, stderr) => {
      if (err) reject(err)
      else resolve({ stdout: stdout.toString(), stderr: stderr.toString() })
    })
  })
}

/** Distinct format temp files for a download (final names + .part variants). */
function ytdlpFormatTemps(savePath: string): string[] {
  const dir = dirname(savePath)
  const stem = basename(savePath).replace(/\.[^.]+$/, '')
  const out: string[] = []
  try {
    for (const f of readdirSync(dir)) {
      if (f.startsWith(`${stem}.f`) && /\.(mp4|webm|mkv|m4a|opus|mp3)(\.part|\.temp)?$/.test(f)) {
        out.push(join(dir, f))
      }
    }
  } catch {
    // Directory unreadable — nothing to recover.
  }
  return out
}

/**
 * Next-level: probe a media file with `ffmpeg -i` (ffprobe is no
 * longer bundled — it cost 105 MB in the installer). ffmpeg prints
 * the stream list + duration to stderr and exits non-zero without an
 * output file, so the runner resolves with the output either way.
 */
export interface FfmpegProbe {
  hasVideo: boolean
  hasAudio: boolean
  /** Seconds, null when ffmpeg reports no duration (N/A). */
  duration: number | null
}

/** Parse `ffmpeg -i` output: Stream lines + the Duration line. */
export function parseFfmpegProbe(output: string): FfmpegProbe {
  let hasVideo = false
  let hasAudio = false
  for (const line of output.split(/\r?\n/)) {
    if (/Stream #\d+:\d+.*: Video:/.test(line)) hasVideo = true
    if (/Stream #\d+:\d+.*: Audio:/.test(line)) hasAudio = true
  }
  const m = output.match(/Duration: (\d+):(\d+):(\d+(?:\.\d+)?)/)
  let duration: number | null = null
  if (m) {
    const d = Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3])
    if (Number.isFinite(d)) duration = d
  }
  return { hasVideo, hasAudio, duration }
}

export async function runFfmpegInfo(ffmpeg: string, file: string): Promise<FfmpegProbe | null> {
  try {
    const output = await new Promise<string>((resolve) => {
      execFile(
        ffmpeg,
        ['-hide_banner', '-i', file],
        { timeout: 30_000 },
        (_err, stdout, stderr) => {
          resolve(`${stdout.toString()}\n${stderr.toString()}`)
        }
      )
    })
    const probe = parseFfmpegProbe(output)
    if (!probe.hasVideo && !probe.hasAudio && probe.duration === null) return null
    return probe
  } catch {
    return null
  }
}

/** Stream kinds of a file, ffmpeg-only (replaces ffprobe's probeKind). */
export async function probeFile(
  ffmpeg: string,
  file: string
): Promise<'video' | 'audio' | 'both' | null> {
  const probe = await runFfmpegInfo(ffmpeg, file)
  if (!probe) return null
  if (probe.hasVideo && probe.hasAudio) return 'both'
  if (probe.hasVideo) return 'video'
  if (probe.hasAudio) return 'audio'
  return null
}

/** ffmpeg binary name for the platform (the old code hardcoded .exe). */
function ffmpegBinary(ffmpegDir: string): string {
  return join(ffmpegDir, process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg')
}

/**
 * Recover a yt-dlp download that finished downloading but failed at the
 * final rename ("Unable to rename file", WinError 32 — on Windows the file
 * is briefly locked by Defender/the indexer right after it is written, and
 * yt-dlp's 3 rename retries sometimes all lose the race). Re-does the
 * rename with longer pauses, then the merge/convert step yt-dlp never
 * reached, and verifies the result is a real media file. Returns true only
 * when the output file exists and plays (duration > 0).
 */
export async function recoverYtDlpRename(
  ffmpegDir: string,
  savePath: string,
  kind: 'video' | 'audio',
  audioBitrate: string
): Promise<boolean> {
  const ffmpeg = ffmpegBinary(ffmpegDir)
  if (!existsSync(ffmpeg)) return false
  const temps = ytdlpFormatTemps(savePath)
  if (temps.length === 0) return false
  // 1. Rename any .part files to their final names, with patient retries —
  // the lock that beat yt-dlp is transient.
  const finals: string[] = []
  for (const t of temps) {
    const final = t.replace(/\.(part|temp)$/, '')
    if (t !== final) {
      let ok = false
      for (let i = 0; i < 5 && !ok; i++) {
        try {
          renameSync(t, final)
          ok = true
        } catch {
          await sleep(1000)
        }
      }
      if (!ok) return false
    }
    finals.push(final)
  }
  // 2. Classify the format files by their streams (ffmpeg -i).
  const videos: string[] = []
  const audios: string[] = []
  let combined: string | null = null
  for (const f of [...new Set(finals)]) {
    if (!existsSync(f)) return false
    const k = await probeFile(ffmpeg, f)
    if (k === 'video') videos.push(f)
    else if (k === 'audio') audios.push(f)
    else if (k === 'both') combined = f
    else return false
  }
  // 3. Finish the step yt-dlp never reached.
  try {
    if (kind === 'video') {
      if (combined && videos.length === 0 && audios.length === 0) {
        // Single combined format — just remux it into the right container.
        await runTool(ffmpeg, ['-y', '-i', combined, '-c', 'copy', savePath])
      } else if (videos.length === 1 && audios.length === 1) {
        await runTool(ffmpeg, [
          '-y',
          '-i',
          videos[0],
          '-i',
          audios[0],
          '-c',
          'copy',
          '-map',
          '0:v:0',
          '-map',
          '1:a:0',
          savePath
        ])
      } else {
        return false
      }
    } else {
      if (audios.length !== 1 || videos.length !== 0 || combined) return false
      await runTool(ffmpeg, [
        '-y',
        '-i',
        audios[0],
        '-vn',
        '-acodec',
        'libmp3lame',
        '-ab',
        `${audioBitrate}k`,
        savePath
      ])
    }
  } catch {
    return false
  }
  // 4. Verify the output is a real media file, then clean up the temps.
  const probe = await runFfmpegInfo(ffmpeg, savePath)
  if (!probe || probe.duration === null || probe.duration <= 0) return false
  for (const f of [...new Set(finals)]) {
    try {
      unlinkSync(f)
    } catch {
      // Best effort — leftover temps are harmless.
    }
  }
  return existsSync(savePath) && statSync(savePath).size > 0
}

/**
 * Owns yt-dlp as a child process. Plain Node — no Electron imports.
 * ffmpeg lives in `ffmpegDir`; Deno (the JS runtime YouTube needs since
 * yt-dlp 2025.11.12) is passed explicitly via --js-runtimes.
 */
export interface YtDlpNetworkOptions {
  cookieBrowser: string
  cookiesFile: string | null
  proxyUrl: string
  /** Phase 4: path to download-archive.txt, or null when the setting is off. */
  downloadArchive: string | null
}

/**
 * Error codes where a stale yt-dlp is a plausible cause — worth one
 * update + retry. Content/permission failures (unavailable,
 * login-required, drm, unsupported, ...) are never healed: updating
 * the engine cannot fix them, it would only waste a download.
 */
const SELF_HEAL_CODES = new Set(['unknown', 'engine-missing', 'timeout', 'network'])

export class YtDlpManager {
  // No parameter properties — Node's strip-only test runner cannot
  // parse them; explicit fields instead.
  private binaryPath: string
  private ffmpegDir: string
  private denoPath: string | null
  private getNetwork?: () => YtDlpNetworkOptions
  private onStaleEngine?: () => Promise<boolean>

  constructor(
    binaryPath: string,
    ffmpegDir: string,
    denoPath: string | null,
    /**
     * Phase 3: read live from Settings at call time (cookies + proxy).
     * The getter is called on every baseArgs() so a settings change takes
     * effect on the next fetchInfo/download without restarting the app.
     */
    getNetwork?: () => YtDlpNetworkOptions,
    /**
     * Self-heal hook: called ONCE when a fetch fails with a code that
     * plausibly means a stale engine (see SELF_HEAL_CODES). Returns true
     * when yt-dlp was actually updated to a newer release, so a retry is
     * worth attempting. The manager never updates the engine itself.
     */
    onStaleEngine?: () => Promise<boolean>
  ) {
    this.binaryPath = binaryPath
    this.ffmpegDir = ffmpegDir
    this.denoPath = denoPath
    this.getNetwork = getNetwork
    this.onStaleEngine = onStaleEngine
  }

  /**
   * Phase 4: cookies + proxy only, reused everywhere. Split out of
   * baseArgs because the playlist fetch must NOT get --no-playlist.
   * Phase 5: an override (browser extension, per link) replaces the
   * Settings cookies for this one call.
   */
  private networkArgs(override?: NetOverride): string[] {
    // Phase 3: cookies + proxy, wired into every yt-dlp call. A cookies.txt
    // file is used only when no browser is selected; the browser flag takes
    // precedence.
    const args: string[] = []
    const net = this.getNetwork?.()
    if (override?.cookiesFile) {
      args.push('--cookies', override.cookiesFile)
    } else if (net) {
      if (net.cookieBrowser && net.cookieBrowser !== 'none') {
        args.push('--cookies-from-browser', net.cookieBrowser)
      } else if (net.cookiesFile) {
        args.push('--cookies', net.cookiesFile)
      }
      if (net.proxyUrl) args.push('--proxy', net.proxyUrl)
    }
    if (override?.userAgent) args.push('--user-agent', override.userAgent)
    if (override?.referer) args.push('--referer', override.referer)
    return args
  }

  private baseArgs(override?: NetOverride): string[] {
    const args: string[] = [
      ...this.networkArgs(override),
      '--no-warnings',
      '--no-playlist',
      '--ffmpeg-location',
      this.ffmpegDir
    ]
    if (this.denoPath) args.push('--js-runtimes', `deno:${this.denoPath}`)
    return args
  }

  /** Fetch title/thumbnail/duration/formats for a URL (60s timeout). */
  async fetchInfo(url: string, override?: NetOverride): Promise<YtDlpInfo> {
    return this.withSelfHeal('fetchInfo', () => this.fetchInfoOnce(url, override))
  }

  /**
   * One fetch attempt + one bounded self-heal: on a stale-engine failure,
   * update yt-dlp once (through the injected hook) and retry the same
   * call once. The original error surfaces when there is no hook, the
   * hook reports no update, the update fails, or the retry fails too.
   */
  private async withSelfHeal<T>(label: string, fn: () => Promise<T>): Promise<T> {
    try {
      return await fn()
    } catch (err) {
      if (!(err instanceof YtDlpError) || !SELF_HEAL_CODES.has(err.code) || !this.onStaleEngine) {
        throw err
      }
      logMain(
        'warn',
        `ytdlp ${label} failed (${err.code}) — trying engine self-heal (update yt-dlp once + retry)`
      )
      let healed = false
      try {
        healed = await this.onStaleEngine()
      } catch (healErr) {
        logMain(
          'error',
          `engine self-heal failed: ${healErr instanceof Error ? healErr.message : String(healErr)}`
        )
      }
      if (!healed) throw err
      logMain('info', `engine self-heal: yt-dlp updated, retrying ${label} once`)
      return await fn()
    }
  }

  private async fetchInfoOnce(url: string, override?: NetOverride): Promise<YtDlpInfo> {
    let parsed: URL
    try {
      parsed = new URL(url.trim())
    } catch {
      throw new YtDlpError('invalid-url', 'not a URL')
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new YtDlpError('unsupported-url', 'not http(s)')
    }
    // Phase 7: fetchInfo timing — the user reported a 10s fetch (normal
    // 3–5s). Log how long the yt-dlp call itself took so cold-start vs
    // extraction is visible in dovira.log.
    const startedAt = Date.now()
    const args = [...this.baseArgs(override), '--dump-single-json', '--', url.trim()]
    logMain('info', `ytdlp fetchInfo spawn: ${this.binaryPath} ${args.join(' ').slice(0, 600)}`)
    const out = await this.runCapture(args, 60_000)
    // A timeout gets its own code — before, runCapture folded it into
    // stderr "(timed out)" and mapYtDlpError turned it into 'network', so
    // the dialog could not tell a slow fetch from a broken connection.
    if (out.timedOut) {
      logMain(
        'error',
        `ytdlp fetchInfo FAILED (timeout 60s, ${Date.now() - startedAt}ms): ${url.trim()}`
      )
      throw new YtDlpError('timeout', 'fetchInfo timed out after 60s')
    }
    let json: Record<string, unknown>
    try {
      json = JSON.parse(out.stdout) as Record<string, unknown>
    } catch {
      const kind = out.code === null ? 'spawn-error' : 'json-parse'
      logMain(
        'error',
        `ytdlp fetchInfo FAILED (${kind} code=${String(out.code)}): ${url.trim()} stderr=${out.stderr.slice(0, 300)}`
      )
      throw new YtDlpError(mapYtDlpError(out.stderr), out.stderr.slice(0, 300))
    }
    if (out.code !== 0) {
      logMain(
        'error',
        `ytdlp fetchInfo FAILED (exit ${String(out.code)}): ${url.trim()} stderr=${out.stderr.slice(0, 300)}`
      )
      throw new YtDlpError(mapYtDlpError(out.stderr), out.stderr.slice(0, 300))
    }
    const formatsRaw = Array.isArray(json['formats']) ? json['formats'] : []
    const formats: YtDlpFormat[] = []
    for (const f of formatsRaw as Record<string, unknown>[]) {
      const height = typeof f['height'] === 'number' ? (f['height'] as number) : null
      const vcodec = typeof f['vcodec'] === 'string' ? (f['vcodec'] as string) : 'none'
      const acodec = typeof f['acodec'] === 'string' ? (f['acodec'] as string) : 'none'
      const filesize =
        typeof f['filesize'] === 'number'
          ? (f['filesize'] as number)
          : typeof f['filesize_approx'] === 'number'
            ? (f['filesize_approx'] as number)
            : null
      formats.push({
        id: String(f['format_id'] ?? ''),
        height,
        ext: typeof f['ext'] === 'string' ? (f['ext'] as string) : '',
        filesize,
        note: typeof f['format_note'] === 'string' ? (f['format_note'] as string) : null,
        combined: vcodec !== 'none' && acodec !== 'none'
      })
    }
    const thumbnails = Array.isArray(json['thumbnails']) ? json['thumbnails'] : []
    const thumb = thumbnails.length > 0 ? thumbnails[thumbnails.length - 1] : null
    // Phase 7: log the fetch duration (cold-start diagnosis).
    logMain('info', `fetchInfo ok ${Date.now() - startedAt}ms ${url.trim()}`)
    return {
      url: url.trim(),
      title: typeof json['title'] === 'string' ? (json['title'] as string) : url.trim(),
      thumbnail:
        thumb && typeof (thumb as Record<string, unknown>)['url'] === 'string'
          ? ((thumb as Record<string, unknown>)['url'] as string)
          : null,
      duration: typeof json['duration'] === 'number' ? (json['duration'] as number) : null,
      uploader:
        typeof json['uploader'] === 'string'
          ? (json['uploader'] as string)
          : typeof json['channel'] === 'string'
            ? (json['channel'] as string)
            : null,
      site: parsed.hostname,
      formats,
      isLive: json['is_live'] === true,
      subtitleLangs:
        json['subtitles'] && typeof json['subtitles'] === 'object'
          ? Object.keys(json['subtitles'] as Record<string, unknown>)
          : [],
      autoCaptionLangs:
        json['automatic_captions'] && typeof json['automatic_captions'] === 'object'
          ? Object.keys(json['automatic_captions'] as Record<string, unknown>)
          : [],
      videoId: typeof json['id'] === 'string' ? (json['id'] as string) : null,
      extractor:
        typeof json['extractor_key'] === 'string' ? (json['extractor_key'] as string) : null,
      ytCategory:
        Array.isArray(json['categories']) && typeof json['categories'][0] === 'string'
          ? (json['categories'][0] as string)
          : null,
      mediaItems: parseMediaItems(json)
    }
  }

  /**
   * Phase 4: fetch a playlist/channel as flat entries (no formats —
   * quality is chosen once in the dialog and applied to every entry).
   */
  async fetchPlaylist(url: string): Promise<PlaylistInfo> {
    return this.withSelfHeal('fetchPlaylist', () => this.fetchPlaylistOnce(url))
  }

  private async fetchPlaylistOnce(url: string): Promise<PlaylistInfo> {
    let parsed: URL
    try {
      parsed = new URL(url.trim())
    } catch {
      throw new YtDlpError('invalid-url', 'not a URL')
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new YtDlpError('unsupported-url', 'not http(s)')
    }
    const args = [...this.networkArgs(), '--no-warnings', '--flat-playlist', '-J']
    if (this.denoPath) args.push('--js-runtimes', `deno:${this.denoPath}`)
    args.push('--', url.trim())
    logMain('info', `ytdlp fetchPlaylist spawn: ${this.binaryPath} ${args.join(' ').slice(0, 600)}`)
    const out = await this.runCapture(args, 60_000)
    if (out.timedOut) {
      logMain('error', `ytdlp fetchPlaylist FAILED (timeout 60s): ${url.trim()}`)
      throw new YtDlpError('timeout', 'fetchPlaylist timed out after 60s')
    }
    let json: Record<string, unknown>
    try {
      json = JSON.parse(out.stdout) as Record<string, unknown>
    } catch {
      const kind = out.code === null ? 'spawn-error' : 'json-parse'
      logMain(
        'error',
        `ytdlp fetchPlaylist FAILED (${kind} code=${String(out.code)}): ${url.trim()} stderr=${out.stderr.slice(0, 300)}`
      )
      throw new YtDlpError(mapYtDlpError(out.stderr), out.stderr.slice(0, 300))
    }
    if (out.code !== 0) {
      logMain(
        'error',
        `ytdlp fetchPlaylist FAILED (exit ${String(out.code)}): ${url.trim()} stderr=${out.stderr.slice(0, 300)}`
      )
      throw new YtDlpError(mapYtDlpError(out.stderr), out.stderr.slice(0, 300))
    }
    const entriesRaw = Array.isArray(json['entries']) ? json['entries'] : []
    const entries: PlaylistEntry[] = []
    for (const e of entriesRaw as Record<string, unknown>[]) {
      const id = typeof e['id'] === 'string' ? (e['id'] as string) : ''
      if (!id) continue
      const thumbs = Array.isArray(e['thumbnails']) ? e['thumbnails'] : []
      const thumb = thumbs.length > 0 ? thumbs[thumbs.length - 1] : null
      entries.push({
        id,
        title: typeof e['title'] === 'string' ? (e['title'] as string) : id,
        duration: typeof e['duration'] === 'number' ? (e['duration'] as number) : null,
        url:
          typeof e['url'] === 'string' && (e['url'] as string)
            ? (e['url'] as string)
            : `https://www.youtube.com/watch?v=${id}`,
        thumbnail:
          thumb && typeof (thumb as Record<string, unknown>)['url'] === 'string'
            ? ((thumb as Record<string, unknown>)['url'] as string)
            : typeof e['thumbnail'] === 'string'
              ? (e['thumbnail'] as string)
              : null
      })
    }
    return {
      url: url.trim(),
      title: typeof json['title'] === 'string' ? (json['title'] as string) : url.trim(),
      uploader:
        typeof json['uploader'] === 'string'
          ? (json['uploader'] as string)
          : typeof json['channel'] === 'string'
            ? (json['channel'] as string)
            : null,
      entries
    }
  }

  /** Build the exact arg list for a download (stored for resume). */
  buildArgs(opts: YtDlpDownloadOpts): string[] {
    // Phase 4: thumbnail-only — no media, no format, no progress template.
    // The run is one quick call; the queue treats it as a no-progress
    // download and completes it on exit 0 + file exists.
    // The -o template MUST contain %(ext)s: with a fixed name yt-dlp
    // refuses ("Fixed output name but more than one file to download").
    // The stem is the row's savePath minus its .jpg extension, so the
    // produced file lands exactly on savePath.
    if (opts.thumbnailOnly) {
      const template = opts.savePath.replace(/\.[^.]+$/, '.%(ext)s')
      return [
        ...this.baseArgs({
          cookiesFile: opts.cookiesFile,
          userAgent: opts.userAgent,
          referer: opts.referer
        }),
        '--write-thumbnail',
        '--skip-download',
        '--convert-thumbnails',
        'jpg',
        '-o',
        template,
        '--',
        opts.url
      ]
    }
    const args = [
      ...this.baseArgs({
        cookiesFile: opts.cookiesFile,
        userAgent: opts.userAgent,
        referer: opts.referer
      }),
      '--newline',
      '--progress-template',
      PROGRESS_TEMPLATE
    ]
    if (opts.kind === 'video') {
      args.push('-f', opts.formatString, '--merge-output-format', opts.container ?? 'mp4')
    } else {
      args.push('-x', '--audio-format', 'mp3', '--audio-quality', `${opts.audioBitrate ?? '320'}K`)
    }
    // Phase 4: clip — a time range of the video (video only; the dialog
    // rejects audio+clip). End may be empty = to the end.
    if (opts.clipStart) {
      args.push(
        '--download-sections',
        `*${opts.clipStart}-${opts.clipEnd ?? ''}`,
        '--force-keyframes-at-cuts'
      )
    }
    if (opts.embedMetadata) args.push('--embed-metadata')
    if (opts.subtitles) {
      args.push('--write-subs', '--sub-langs', opts.subLang ?? 'en')
      if (opts.subMode === 'file' || opts.subMode === 'both') {
        args.push('--sub-format', 'srt/best')
      }
      if (opts.subMode !== 'file') args.push('--embed-subs')
      if (opts.autoSubs) args.push('--write-auto-subs')
    }
    if (opts.embedThumbnail) args.push('--embed-thumbnail')
    if (opts.useAria2) {
      args.push(
        '--downloader',
        'aria2c',
        '--downloader-args',
        'aria2c:-x 8 -s 8 --disable-ipv6 --file-allocation=none'
      )
    }
    // Phase 4: skip videos already recorded in the download archive
    // (playlist/batch items only — never single re-downloads from History).
    if (opts.useArchive) {
      const archive = this.getNetwork?.().downloadArchive
      if (archive) args.push('--download-archive', archive)
    }
    // Phase 7: speed limit — yt-dlp's own downloader obeys --limit-rate.
    if (opts.speedLimitKBps && opts.speedLimitKBps > 0) {
      args.push('--limit-rate', `${Math.floor(opts.speedLimitKBps)}K`)
    }
    // Phase 7: concurrent fragments (Smart Download) — only for video/audio
    // downloads with more than one fragment stream; thumbnail-only returns
    // early above, and plain files use buildPlainArgs (single stream).
    if (opts.fragments && opts.fragments > 1 && !opts.thumbnailOnly) {
      args.push('-N', String(opts.fragments))
    }
    // Next-level: live-stream recording — save the raw HLS/DASH stream
    // as .ts (playable even when stopped mid-stream: no moov atom to
    // finish). The .ts filename comes from the Add dialog.
    if (opts.liveRecord) {
      args.push('--hls-use-mpegts')
    }
    args.push('-o', opts.savePath, '--', opts.url)
    return args
  }

  /**
   * Phase 6: plain-file download (the aria2-missing fallback on macOS /
   * Linux). No format selection — yt-dlp downloads the URL straight to
   * savePath with the same progress template, and resumes a .part file
   * on a rerun (yt-dlp continues partial downloads by default).
   */
  buildPlainArgs(url: string, savePath: string, speedLimitKBps = 0): string[] {
    const args = [...this.baseArgs(), '--newline', '--progress-template', PROGRESS_TEMPLATE]
    // Phase 7: speed limit, same as buildArgs.
    if (speedLimitKBps > 0) args.push('--limit-rate', `${Math.floor(speedLimitKBps)}K`)
    args.push('-o', savePath, '--', url)
    return args
  }

  /**
   * Run a download with an exact arg list (built by buildArgs, or a stored
   * lastArgs for resume — the SAME command, never a rebuilt one).
   * Resolves with the exit code; progress and log lines arrive through the
   * callbacks. The returned job supports kill().
   */
  runDownload(
    args: string[],
    cb: YtDlpDownloadCallbacks
  ): { job: YtDlpDownload; done: Promise<{ code: number | null; stderr: string }> } {
    const job = new YtDlpDownload(this.binaryPath, args, cb)
    const done = job.start()
    return { job, done }
  }

  /**
   * Finish a download yt-dlp left half-done because its final rename hit
   * a transient Windows file lock (WinError 32). See recoverYtDlpRename.
   */
  async recoverRenameRace(
    savePath: string,
    kind: 'video' | 'audio',
    audioBitrate: string
  ): Promise<boolean> {
    return recoverYtDlpRename(this.ffmpegDir, savePath, kind, audioBitrate)
  }

  private runCapture(
    args: string[],
    timeoutMs: number
  ): Promise<{ code: number | null; stdout: string; stderr: string; timedOut: boolean }> {
    return new Promise((resolve) => {
      const child = spawn(this.binaryPath, args, { windowsHide: true })
      let stdout = ''
      let stderr = ''
      let settled = false
      const timer = setTimeout(() => {
        if (!settled) {
          settled = true
          try {
            child.kill('SIGKILL')
          } catch {
            // Already gone.
          }
          resolve({ code: null, stdout, stderr: stderr + '\n(timed out)', timedOut: true })
        }
      }, timeoutMs)
      child.stdout?.on('data', (c: Buffer) => {
        stdout += c.toString('utf-8')
      })
      child.stderr?.on('data', (c: Buffer) => {
        stderr += c.toString('utf-8')
      })
      child.on('error', (err) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        resolve({ code: null, stdout, stderr: stderr + `\n${err.message}`, timedOut: false })
      })
      child.on('close', (code) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        resolve({ code, stdout, stderr, timedOut: false })
      })
    })
  }
}

export class YtDlpDownload {
  private proc: ChildProcess | null = null
  private stderrTail: string[] = []

  // No parameter properties — Node's strip-only test runner cannot
  // parse them; explicit fields instead.
  private binaryPath: string
  private args: string[]
  private cb: YtDlpDownloadCallbacks

  constructor(binaryPath: string, args: string[], cb: YtDlpDownloadCallbacks) {
    this.binaryPath = binaryPath
    this.args = args
    this.cb = cb
  }

  getStderr(): string {
    return this.stderrTail.join('\n')
  }

  start(): Promise<{ code: number | null; stderr: string }> {
    return new Promise((resolve) => {
      const child = spawn(this.binaryPath, this.args, { windowsHide: true })
      this.proc = child
      child.stdout?.on('data', (chunk: Buffer) => {
        for (const line of chunk.toString('utf-8').split(/\r?\n/)) {
          if (!line.trim()) continue
          const p = parseProgressLine(line)
          if (p) {
            this.cb.onProgress(p)
          } else {
            // Phase 4: yt-dlp writes status lines to stdout, not stderr —
            // including the download-archive skip notice ("has already
            // been recorded in the archive"). Keep non-progress stdout
            // lines in the tail too, or the queue's archive check can
            // never match and a skip fails as 'unknown' instead of
            // 'already-downloaded'.
            this.stderrTail.push(line)
            if (this.stderrTail.length > 50) {
              this.stderrTail.splice(0, this.stderrTail.length - 50)
            }
          }
        }
      })
      child.stderr?.on('data', (chunk: Buffer) => {
        for (const line of chunk.toString('utf-8').split(/\r?\n/).filter(Boolean)) {
          this.stderrTail.push(line)
          if (this.stderrTail.length > 50) {
            this.stderrTail.splice(0, this.stderrTail.length - 50)
          }
          this.cb.onLog(line)
        }
      })
      child.on('error', () => {
        this.proc = null
        resolve({ code: null, stderr: this.getStderr() })
      })
      child.on('close', (code) => {
        this.proc = null
        resolve({ code, stderr: this.getStderr() })
      })
    })
  }

  kill(): void {
    const proc = this.proc
    if (!proc || proc.killed) return
    try {
      proc.kill('SIGTERM')
    } catch {
      // Already gone.
    }
    setTimeout(() => {
      try {
        if (!proc.killed) proc.kill('SIGKILL')
      } catch {
        // Already gone.
      }
    }, 2000)
  }
}
