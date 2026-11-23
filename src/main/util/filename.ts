import { existsSync } from 'node:fs'
import { join, parse } from 'node:path'

const RESERVED_NAMES = new Set([
  'CON',
  'PRN',
  'AUX',
  'NUL',
  'COM1',
  'COM2',
  'COM3',
  'COM4',
  'COM5',
  'COM6',
  'COM7',
  'COM8',
  'COM9',
  'LPT1',
  'LPT2',
  'LPT3',
  'LPT4',
  'LPT5',
  'LPT6',
  'LPT7',
  'LPT8',
  'LPT9'
])

// Control characters (U+0000–U+001F) as a runtime-built pattern — a regex
// literal with those escapes trips the no-control-regex lint rule.
const CONTROL_CHARS = new RegExp(`[${String.fromCharCode(0)}-${String.fromCharCode(31)}]`, 'g')

/**
 * Make a filename safe for Windows: strip illegal chars (< > : " / \ | ? *)
 * and control chars, drop trailing dots/spaces, guard reserved device names,
 * and cap the length so the full path stays well under MAX_PATH.
 */
export function sanitizeFilename(name: string): string {
  let s = name.replace(/[<>:"/\\|?*]/g, '_').replace(CONTROL_CHARS, '_')
  s = s.replace(/[. ]+$/, '')
  if (!s) s = 'download'
  const { name: base } = parse(s)
  if (RESERVED_NAMES.has(base.toUpperCase())) s = `_${s}`
  if (s.length > 180) {
    const p = parse(s)
    s = p.name.slice(0, 180 - p.ext.length) + p.ext
  }
  return s
}

/**
 * True when `target` is `dir` itself or lives inside it. The comparison
 * is on whole path segments (so `DOVIRA2` is NOT inside `DOVIRA`), and on
 * Windows it is case-insensitive. A `..` that climbs out of `dir` returns
 * false. Used by the security audit: no download path may escape the
 * folder it was resolved against.
 */
export function isPathInside(dir: string, target: string): boolean {
  const norm = (p: string): string[] => {
    const parts = p.split(/[\\/]/).filter((s) => s.length > 0 && s !== '.')
    const out: string[] = []
    for (const part of parts) {
      if (part === '..') {
        if (out.length > 0 && out[out.length - 1] !== '..') out.pop()
        else out.push(part)
      } else {
        out.push(part)
      }
    }
    return out
  }
  const d = norm(dir)
  const t = norm(target)
  if (t.length < d.length) return false
  const ci = process.platform === 'win32'
  for (let i = 0; i < d.length; i++) {
    const a = d[i]
    const b = t[i]
    if (ci ? a.toLowerCase() !== b.toLowerCase() : a !== b) return false
  }
  return true
}

/**
 * Join `dir` + `filename` for a download, proving the result stays inside
 * `dir`. The filename is sanitized first (no separators survive), so a
 * hostile name like `../../evil.exe` or `C:\\Windows\\evil.exe` collapses
 * to a plain file inside `dir`. Throws when the result would escape `dir`
 * (defence in depth — callers must never write outside the folder they
 * were given).
 */
export function resolveDownloadPath(dir: string, filename: string): string {
  const clean = sanitizeFilename(filename)
  const target = join(dir, clean)
  if (!isPathInside(dir, target)) {
    throw new Error(`refusing to write outside the download folder: ${filename}`)
  }
  return target
}

/**
 * First free path in `dir` for `filename`; appends " (1)", " (2)", ... on clash.
 * `isTaken` is an extra clash check beyond the disk — the queue passes its
 * in-use save paths, because a queued download whose file doesn't exist
 * yet would otherwise collide with a later one of the same name (found by
 * the Phase 3 test: two node-zip downloads both resolved to " (1)", and
 * cancelling one deleted the other's finished file).
 */
export function resolveUniquePath(
  dir: string,
  filename: string,
  isTaken?: (candidate: string) => boolean
): string {
  const clean = sanitizeFilename(filename)
  const taken = (c: string): boolean => existsSync(c) || (isTaken?.(c) ?? false)
  let candidate = join(dir, clean)
  if (!isPathInside(dir, candidate)) {
    throw new Error(`refusing to write outside the download folder: ${filename}`)
  }
  if (!taken(candidate)) return candidate
  const p = parse(clean)
  let i = 1
  while (taken(candidate)) {
    candidate = join(dir, `${p.name} (${i})${p.ext}`)
    i++
  }
  return candidate
}

/**
 * Best filename for a URL. Prefers Content-Disposition (RFC 5987 / quoted),
 * then the last URL path segment, then a generic fallback.
 */
export function filenameFromUrl(url: string, contentDisposition?: string | null): string {
  if (contentDisposition) {
    const utf8 = contentDisposition.match(/filename\*=UTF-8''([^;]+)/i)
    if (utf8?.[1]) {
      try {
        return decodeURIComponent(utf8[1].trim())
      } catch {
        return utf8[1].trim()
      }
    }
    const quoted = contentDisposition.match(/filename="([^"]+)"/i)
    if (quoted?.[1]) return quoted[1]
    const plain = contentDisposition.match(/filename=([^;]+)/i)
    if (plain?.[1]) return plain[1].trim()
  }
  try {
    const u = new URL(url)
    const seg = u.pathname.split('/').filter(Boolean).pop()
    if (seg) return decodeURIComponent(seg)
  } catch {
    // fall through
  }
  return 'download'
}
