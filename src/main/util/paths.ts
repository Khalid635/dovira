import { homedir } from 'node:os'
import { join, dirname } from 'node:path'
import { existsSync, statfsSync } from 'node:fs'

export function getDefaultDownloadDir(): string {
  return join(homedir(), 'Downloads', 'DOVIRA')
}

/**
 * Find a bundled engine binary.
 * Dev: <project>/resources/bin/win/<file>
 * Packaged (asarUnpack: resources/**): <resources>/app.asar.unpacked/resources/bin/win/<file>
 * Packaged (extraResources): <resources>/bin/win/<file> or <resources>/resources/bin/win/<file>
 * Returns null when not found anywhere.
 */
export const ENGINE_FILES: Record<string, string> = {
  aria2: 'aria2c.exe',
  'yt-dlp': 'yt-dlp.exe',
  ffmpeg: 'ffmpeg.exe',
  ffprobe: 'ffprobe.exe',
  deno: 'deno.exe'
}

export function findBinary(name: string, appPath: string, resourcesPath: string): string | null {
  const file = ENGINE_FILES[name]
  if (!file) return null
  const candidates = [
    join(appPath, 'resources', 'bin', 'win', file),
    join(resourcesPath, 'app.asar.unpacked', 'resources', 'bin', 'win', file),
    join(resourcesPath, 'bin', 'win', file),
    join(resourcesPath, 'resources', 'bin', 'win', file)
  ]
  for (const c of candidates) {
    if (existsSync(c)) return c
  }
  return null
}

export function findAria2Binary(appPath: string, resourcesPath: string): string | null {
  return findBinary('aria2', appPath, resourcesPath)
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
