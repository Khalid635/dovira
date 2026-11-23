import { homedir } from 'node:os'
import { join, dirname } from 'node:path'
import { chmodSync, existsSync, readFileSync, statfsSync } from 'node:fs'

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
    deno: 'deno.exe'
  },
  mac: {
    aria2: 'aria2c',
    'yt-dlp': 'yt-dlp_macos',
    ffmpeg: 'ffmpeg',
    deno: 'deno'
  },
  linux: {
    aria2: 'aria2c',
    'yt-dlp': 'yt-dlp_linux',
    ffmpeg: 'ffmpeg',
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
 * True when `p` points inside an .asar archive (a path segment ending in
 * `.asar`). Such paths are readable through Electron's patched fs but can
 * never be executed — Windows cannot spawn a binary from inside an archive.
 */
function isInsideAsar(p: string): boolean {
  return /(^|[\\/])[^\\/]+\.asar[\\/]/.test(p)
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
    // v0.6.1: a candidate inside app.asar MUST be skipped. asarUnpack
    // duplicates resources/bin into the asar as well as unpacking it, so
    // existsSync() says the asar-internal path exists — but spawning it
    // fails with ENOENT, and every engine call in the installed app
    // surfaced as a bare 'unknown' (v0.6.0 bug). The unpacked copy wins.
    if (isInsideAsar(c)) continue
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

/**
 * Is this folder actually loadable as an unpacked extension? A folder is
 * loadable only when its manifest.json parses AND every file the
 * manifest references (service worker, content scripts, popup, options
 * page) exists next to it.
 *
 * This is the guard for the 2026-11-23 trap: the repo's extension/
 * SOURCE folder has a manifest.json that references content.js,
 * background.js, popup.html and options.html at the folder root — but
 * those built files only exist in extension/dist/. Loading extension/
 * itself fails with Brave's "Could not load javascript 'content.js'
 * for script. Could not load manifest." A folder that fails this
 * check is never offered to the user.
 */
export function isLoadableExtensionDir(dir: string): boolean {
  try {
    const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf-8')) as {
      background?: { service_worker?: string }
      content_scripts?: { js?: string[] }[]
      action?: { default_popup?: string }
      options_page?: string
    }
    const files = new Set<string>(['manifest.json'])
    if (manifest.background?.service_worker) files.add(manifest.background.service_worker)
    for (const cs of manifest.content_scripts ?? []) {
      for (const f of cs.js ?? []) files.add(f)
    }
    if (manifest.action?.default_popup) files.add(manifest.action.default_popup)
    if (manifest.options_page) files.add(manifest.options_page)
    return [...files].every((f) => existsSync(join(dir, f)))
  } catch {
    return false
  }
}

/**
 * v1.2.0: the built browser extension folder the user loads unpacked.
 * Dev: <project>/extension/dist. Packaged: <resources>/extension
 * (electron-builder extraResources). Null when neither exists — or
 * when a candidate exists but is not actually loadable (see
 * isLoadableExtensionDir). The source folder extension/ is NEVER
 * returned: its manifest references files that only exist after the
 * build, in extension/dist/.
 */
export function getExtensionDir(appPath: string, resourcesPath: string): string | null {
  const candidates = [join(appPath, 'extension', 'dist'), join(resourcesPath, 'extension')]
  for (const c of candidates) {
    if (existsSync(c) && isLoadableExtensionDir(c)) return c
  }
  return null
}
