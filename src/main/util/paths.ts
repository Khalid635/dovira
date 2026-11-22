import { homedir } from 'node:os'
import { join, dirname } from 'node:path'
import { chmodSync, existsSync, statfsSync } from 'node:fs'

export function getDefaultDownloadDir(): string {
  return join(homedir(), 'Downloads', 'DOVIRA')
}

/** The platform the app is running on — one of the three build targets. */
export type DoviraPlatform = 'win' | 'mac' | 'linux'

export function currentPlatform(): DoviraPlatform {
  if (process.platform === 'darwin') return 'mac'
  if (process.platform === 'linux') return 'linux'
  return 'win'
}

/**
 * Engine binary filenames per OS. Windows uses .exe; macOS/Linux use the
 * bare name (and need the executable bit — see ensureExecutable).
 * Phase 6: the same engine set on all three platforms. aria2 has no
 * prebuilt mac/linux binary — on those platforms it is built from source
 * (scripts/build-aria2.sh) and may be absent; the queue falls back to
 * yt-dlp for plain files when it is.
 */
export const ENGINE_FILES_BY_PLATFORM: Record<DoviraPlatform, Record<string, string>> = {
  win: {
    aria2: 'aria2c.exe',
    'yt-dlp': 'yt-dlp.exe',
    ffmpeg: 'ffmpeg.exe',
    ffprobe: 'ffprobe.exe',
    deno: 'deno.exe'
  },
  mac: {
    aria2: 'aria2c',
    'yt-dlp': 'yt-dlp_macos',
    ffmpeg: 'ffmpeg',
    ffprobe: 'ffprobe',
    deno: 'deno'
  },
  linux: {
    aria2: 'aria2c',
    'yt-dlp': 'yt-dlp_linux',
    ffmpeg: 'ffmpeg',
    ffprobe: 'ffprobe',
    deno: 'deno'
  }
}

/** Engine filenames for the platform this app is running on. */
export const ENGINE_FILES: Record<string, string> = ENGINE_FILES_BY_PLATFORM[currentPlatform()]

/** The platform's binary directory name under resources/bin/. */
export function platformDirName(platform: DoviraPlatform = currentPlatform()): string {
  return platform
}

/**
 * Find a bundled engine binary.
 * Dev: <project>/resources/bin/<platform>/<file>
 * Packaged (asarUnpack: resources/**): <resources>/app.asar.unpacked/resources/bin/<platform>/<file>
 * Packaged (extraResources): <resources>/bin/<platform>/<file> or <resources>/resources/bin/<platform>/<file>
 * Returns null when not found anywhere.
 */
export function findBinary(name: string, appPath: string, resourcesPath: string): string | null {
  const file = ENGINE_FILES[name]
  if (!file) return null
  const dir = platformDirName()
  const candidates = [
    join(appPath, 'resources', 'bin', dir, file),
    join(resourcesPath, 'app.asar.unpacked', 'resources', 'bin', dir, file),
    join(resourcesPath, 'bin', dir, file),
    join(resourcesPath, 'resources', 'bin', dir, file)
  ]
  for (const c of candidates) {
    if (existsSync(c)) return c
  }
  return null
}

export function findAria2Binary(appPath: string, resourcesPath: string): string | null {
  return findBinary('aria2', appPath, resourcesPath)
}

/**
 * Best-effort chmod 755 on a binary (macOS/Linux only — Windows has no
 * executable bit). A missing file or a failed chmod is a no-op: callers
 * re-check existence before using the path.
 */
export function ensureExecutable(filePath: string): void {
  if (process.platform === 'win32') return
  if (!existsSync(filePath)) return
  try {
    chmodSync(filePath, 0o755)
  } catch {
    // Best effort — a read-only install dir must not break startup.
  }
}

/** Free bytes on the volume holding `dir`. Null when it cannot be determined. */
export function diskFreeBytes(dir: string): number | null {
  try {
    const st = statfsSync(dir)
    return st.bavail * st.bsize
  } catch {
    try {
      const st = statfsSync(dirname(dir))
      return st.bavail * st.bsize
    } catch {
      return null
    }
  }
}
