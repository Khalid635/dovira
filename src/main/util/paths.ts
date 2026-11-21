import { homedir } from 'node:os'
import { join, dirname } from 'node:path'
import { existsSync, statfsSync } from 'node:fs'

export function getDefaultDownloadDir(): string {
  return join(homedir(), 'Downloads', 'DOVIRA')
}

/**
 * Find the bundled aria2 binary.
 * Dev: <project>/resources/bin/win/aria2c.exe
 * Packaged: <resources>/bin/win/aria2c.exe (extraResources) or
 *            <resources>/resources/bin/win/aria2c.exe
 * Returns null when not found anywhere.
 */
export function findAria2Binary(appPath: string, resourcesPath: string): string | null {
  const candidates = [
    join(appPath, 'resources', 'bin', 'win', 'aria2c.exe'),
    join(resourcesPath, 'bin', 'win', 'aria2c.exe'),
    join(resourcesPath, 'resources', 'bin', 'win', 'aria2c.exe')
  ]
  for (const c of candidates) {
    if (existsSync(c)) return c
  }
  return null
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
