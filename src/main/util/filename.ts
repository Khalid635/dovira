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

/** First free path in `dir` for `filename`; appends " (1)", " (2)", ... on clash. */
export function resolveUniquePath(dir: string, filename: string): string {
  const clean = sanitizeFilename(filename)
  let candidate = join(dir, clean)
  if (!existsSync(candidate)) return candidate
  const p = parse(clean)
  let i = 1
  while (existsSync(candidate)) {
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
