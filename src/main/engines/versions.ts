import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  createReadStream,
  createWriteStream,
  existsSync,
  readFileSync,
  renameSync,
  rmSync
} from 'node:fs'
import { join } from 'node:path'
import { get } from 'node:https'
import type { EngineInfo } from '../types.ts'
import { currentPlatform, ENGINE_FILES, ensureExecutable } from '../util/paths.ts'

function runVersion(binaryPath: string, args: string[], re: RegExp): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(binaryPath, args, { timeout: 10_000 }, (err, stdout) => {
      if (err) return resolve(null)
      const m = stdout.match(re)
      resolve(m ? m[1] : null)
    })
  })
}

/** `aria2 version 1.37.0` → "1.37.0". Null when the binary cannot run. */
export function getAria2Version(binaryPath: string): Promise<string | null> {
  return runVersion(binaryPath, ['--version'], /aria2 version ([0-9.]+)/)
}

/** `yt-dlp --version` prints just the version, e.g. "2026.11.23". */
export function getYtDlpVersion(binaryPath: string): Promise<string | null> {
  return runVersion(binaryPath, ['--version'], /([0-9]{4}\.[0-9]{2}\.[0-9]{2})/)
}

/** `ffmpeg version 9.0.2 ...` → "9.0.2". BtbN prints `n9.0.2-...` — allow the 'n' prefix. */
export function getFfmpegVersion(binaryPath: string): Promise<string | null> {
  return runVersion(binaryPath, ['-version'], /ffmpeg version n?([0-9.]+)/)
}

/** `deno 2.9.8 ...` → "2.9.8". */
export function getDenoVersion(binaryPath: string): Promise<string | null> {
  return runVersion(binaryPath, ['--version'], /deno ([0-9.]+)/)
}

const LATEST_URLS: Record<string, string> = {
  'yt-dlp': 'https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest',
  aria2: 'https://api.github.com/repos/aria2/aria2/releases/latest',
  deno: 'https://api.github.com/repos/denoland/deno/releases/latest'
}

/** Best-effort latest-version check. Null when it cannot be determined. */
export async function checkLatest(name: string): Promise<string | null> {
  try {
    if (name === 'ffmpeg') {
      // Phase 6: the ffmpeg source differs per platform — Windows is
      // gyan.dev, macOS is evermeet, Linux is BtbN.
      const platform = currentPlatform()
      if (platform === 'mac') {
        const res = await fetch('https://evermeet.cx/ffmpeg/info/ffmpeg/release', {
          signal: AbortSignal.timeout(10_000)
        })
        if (!res.ok) return null
        const json = (await res.json()) as { version?: string }
        return typeof json.version === 'string' ? json.version : null
      }
      if (platform === 'linux') {
        const res = await fetch('https://api.github.com/repos/BtbN/FFmpeg-Builds/releases/latest', {
          headers: { 'User-Agent': 'DOVIRA-version-check/1.0' },
          signal: AbortSignal.timeout(10_000)
        })
        if (!res.ok) return null
        const json = (await res.json()) as { assets?: { name: string }[] }
        const asset = (json.assets ?? []).find((a) =>
          /^ffmpeg-n[0-9.]+-latest-linux64-gpl-/.test(a.name)
        )
        const m = asset ? asset.name.match(/^ffmpeg-n([0-9.]+)-latest-linux64-gpl-/) : null
        return m ? m[1] : null
      }
      const res = await fetch('https://www.gyan.dev/ffmpeg/builds/', {
        signal: AbortSignal.timeout(10_000)
      })
      if (!res.ok) return null
      const html = await res.text()
      const m = html.match(/ffmpeg-([0-9]+\.[0-9]+\.[0-9]+)-essentials_build\.zip/)
      return m ? m[1] : null
    }
    const url = LATEST_URLS[name]
    if (!url) return null
    const res = await fetch(url, {
      headers: { 'User-Agent': 'DOVIRA-version-check/1.0' },
      signal: AbortSignal.timeout(10_000)
    })
    if (!res.ok) return null
    const json = (await res.json()) as { tag_name?: string }
    const tag = json.tag_name ?? ''
    if (name === 'deno') return tag.replace(/^v/, '')
    if (name === 'aria2') {
      const m = tag.match(/release-([0-9.]+)/)
      return m ? m[1] : tag
    }
    return tag || null
  } catch {
    return null
  }
}

export interface EngineSpec {
  name: string
  path: string | null
  getVersion: (p: string) => Promise<string | null>
}

export async function listEngines(
  specs: EngineSpec[],
  checkForUpdates: boolean
): Promise<EngineInfo[]> {
  const out: EngineInfo[] = []
  for (const spec of specs) {
    const version = spec.path ? await spec.getVersion(spec.path) : null
    let latest: string | null = null
    if (checkForUpdates) latest = await checkLatest(spec.name)
    out.push({
      name: spec.name,
      version,
      latest,
      updateAvailable: version !== null && latest !== null && version !== latest,
      path: spec.path
    })
  }
  return out
}

function downloadFile(url: string, dest: string): Promise<void> {
  return new Promise((resolve, reject) => {
    get(url, { headers: { 'User-Agent': 'DOVIRA-engine-update/1.0' } }, (res) => {
      const status = res.statusCode ?? 0
      if (status >= 300 && status < 400 && res.headers.location) {
        res.resume()
        return void downloadFile(res.headers.location, dest).then(resolve, reject)
      }
      if (status !== 200) {
        res.resume()
        return reject(new Error(`Download failed: HTTP ${status}`))
      }
      const out = createWriteStream(dest)
      res.pipe(out)
      out.on('finish', () => {
        out.close()
        resolve()
      })
      out.on('error', reject)
    }).on('error', reject)
  })
}

function sha256File(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256')
    const stream = createReadStream(path)
    stream.on('data', (chunk) => hash.update(chunk as Buffer))
    stream.on('end', () => resolve(hash.digest('hex')))
    stream.on('error', reject)
  })
}

/**
 * Update yt-dlp in place: download latest binary → verify against the
 * release's SHA2-256SUMS → backup old → replace → smoke test. Any failure
 * restores the backup and reports { ok:false }; the old version keeps
 * running. Phase 6: the asset name is per-platform (yt-dlp.exe on
 * Windows, yt-dlp_macos / yt-dlp_linux elsewhere).
 */
export async function updateYtDlp(
  binDir: string
): Promise<{ ok: boolean; version?: string; error?: string }> {
  const file = ENGINE_FILES['yt-dlp']
  const target = join(binDir, file)
  const backup = `${target}.bak`
  const tmpExe = join(binDir, `${file}.new`)
  const tmpSums = join(binDir, 'SHA2-256SUMS.new')
  try {
    const res = await fetch('https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest', {
      headers: { 'User-Agent': 'DOVIRA-engine-update/1.0' },
      signal: AbortSignal.timeout(15_000)
    })
    if (!res.ok) throw new Error(`GitHub API HTTP ${res.status}`)
    const json = (await res.json()) as { tag_name?: string }
    const tag = json.tag_name
    if (!tag) throw new Error('no release tag')
    await downloadFile(`https://github.com/yt-dlp/yt-dlp/releases/download/${tag}/${file}`, tmpExe)
    await downloadFile(
      `https://github.com/yt-dlp/yt-dlp/releases/download/${tag}/SHA2-256SUMS`,
      tmpSums
    )
    const sums = readFileSync(tmpSums, 'utf-8')
    const line = sums.split(/\r?\n/).find((l) => l.trim().endsWith(file))
    if (!line) throw new Error(`${file} missing from SHA2-256SUMS`)
    const expected = line.split(/\s+/)[0]
    const actual = await sha256File(tmpExe)
    if (expected.toLowerCase() !== actual.toLowerCase()) {
      throw new Error('checksum mismatch')
    }
    if (existsSync(target)) renameSync(target, backup)
    try {
      renameSync(tmpExe, target)
      // macOS/Linux need the executable bit on the new binary.
      ensureExecutable(target)
      const version = await getYtDlpVersion(target)
      if (!version) throw new Error('smoke test failed: --version printed nothing')
      rmSync(tmpSums, { force: true })
      rmSync(backup, { force: true })
      return { ok: true, version }
    } catch (err) {
      // Roll back to the backed-up binary.
      try {
        rmSync(target, { force: true })
        if (existsSync(backup)) renameSync(backup, target)
      } catch {
        // Best effort — the old binary path is reported in the error.
      }
      throw err
    }
  } catch (err) {
    try {
      rmSync(tmpExe, { force: true })
      rmSync(tmpSums, { force: true })
    } catch {
      // Cleanup is best-effort.
    }
    const msg = (err as Error).message
    if (msg.includes('HTTP 403')) return { ok: false, error: 'update-forbidden' }
    return { ok: false, error: msg }
  }
}
