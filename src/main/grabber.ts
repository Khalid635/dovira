import { filenameFromUrl } from './util/filename'
import type { GrabberItem, GrabberKind, GrabberScanResult } from './types'

const MAX_ITEMS = 200
const MAX_PAGE_BYTES = 5 * 1024 * 1024
const FETCH_TIMEOUT_MS = 30_000
const HEAD_TIMEOUT_MS = 5_000
const HEAD_CONCURRENCY = 6

/** Downloadable extensions by kind. Anything else is not a file link. */
const EXT_KIND: Record<string, GrabberKind> = {
  // images
  png: 'image',
  jpg: 'image',
  jpeg: 'image',
  gif: 'image',
  webp: 'image',
  svg: 'image',
  bmp: 'image',
  ico: 'image',
  avif: 'image',
  // videos
  mp4: 'video',
  mkv: 'video',
  webm: 'video',
  mov: 'video',
  avi: 'video',
  // audio
  mp3: 'audio',
  wav: 'audio',
  flac: 'audio',
  ogg: 'audio',
  opus: 'audio',
  m4a: 'audio',
  // documents
  pdf: 'document',
  doc: 'document',
  docx: 'document',
  xls: 'document',
  xlsx: 'document',
  ppt: 'document',
  pptx: 'document',
  epub: 'document',
  txt: 'document',
  csv: 'document',
  json: 'document',
  // archives / programs
  zip: 'archive',
  '7z': 'archive',
  rar: 'archive',
  tar: 'archive',
  gz: 'archive',
  iso: 'archive',
  dmg: 'archive',
  apk: 'archive',
  exe: 'archive',
  msi: 'archive'
}

/** Content-types that count as downloadable (for extension-less links). */
function kindFromContentType(ct: string): GrabberKind | null {
  const c = ct.split(';')[0].trim().toLowerCase()
  if (c.startsWith('image/')) return 'image'
  if (c.startsWith('video/')) return 'video'
  if (c.startsWith('audio/')) return 'audio'
  if (
    c === 'application/pdf' ||
    c === 'application/msword' ||
    c === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    c === 'application/vnd.ms-excel' ||
    c === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
    c === 'application/vnd.ms-powerpoint' ||
    c === 'application/vnd.openxmlformats-officedocument.presentationml.presentation' ||
    c === 'application/epub+zip' ||
    c === 'text/plain' ||
    c === 'text/csv' ||
    c === 'application/json'
  ) {
    return 'document'
  }
  if (
    c === 'application/zip' ||
    c === 'application/x-7z-compressed' ||
    c === 'application/x-rar-compressed' ||
    c === 'application/x-tar' ||
    c === 'application/gzip' ||
    c === 'application/x-iso9660-image' ||
    c === 'application/vnd.android.package-archive' ||
    c === 'application/x-msdownload' ||
    c === 'application/octet-stream'
  ) {
    return 'archive'
  }
  return null
}

/** Extension of a URL's path (lowercase, no dot), '' when none. */
export function extOf(url: string): string {
  try {
    const path = new URL(url).pathname
    const last = path.split('/').pop() ?? ''
    const dot = last.lastIndexOf('.')
    if (dot <= 0 || dot === last.length - 1) return ''
    return last.slice(dot + 1).toLowerCase()
  } catch {
    return ''
  }
}

/** Kind of a URL by extension, null when the extension is not a known file type. */
export function classifyKind(url: string): GrabberKind | null {
  return EXT_KIND[extOf(url)] ?? null
}

/**
 * Extract candidate link URLs from HTML: <a href>, <img src> (+ the first
 * srcset candidate), <video>/<audio>/<source> src. Relative URLs are
 * resolved against the page URL. data:/javascript:/mailto: links and pure
 * fragments are skipped. Pure function — no network.
 */
export function extractLinks(html: string, baseUrl: string): string[] {
  const out: string[] = []
  const push = (raw: string | null | undefined): void => {
    if (!raw) return
    const href = raw.trim()
    if (!href || href.startsWith('#')) return
    const lower = href.toLowerCase()
    if (
      lower.startsWith('data:') ||
      lower.startsWith('javascript:') ||
      lower.startsWith('mailto:') ||
      lower.startsWith('tel:')
    ) {
      return
    }
    try {
      const resolved = new URL(href, baseUrl)
      if (resolved.protocol !== 'http:' && resolved.protocol !== 'https:') return
      resolved.hash = ''
      out.push(resolved.toString())
    } catch {
      // Not a URL — skip it.
    }
  }
  // <a href="..."> and <img src="..."> / <video src> / <audio src> /
  // <source src="..."> — attribute order in the tag does not matter.
  const attrRe =
    /<(?:a|img|video|audio|source)\b[^>]*?\s(?:href|src)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi
  let m: RegExpExecArray | null
  while ((m = attrRe.exec(html)) !== null) {
    push(m[1] ?? m[2] ?? m[3])
  }
  // <img srcset="url1 1x, url2 2x"> — take every candidate (deduped later).
  const srcsetRe = /<img\b[^>]*?\ssrcset\s*=\s*(?:"([^"]*)"|'([^']*)')/gi
  while ((m = srcsetRe.exec(html)) !== null) {
    const raw = m[1] ?? m[2] ?? ''
    for (const part of raw.split(',')) {
      push(part.trim().split(/\s+/)[0])
    }
  }
  return out
}

/** Dedupe items by URL (first wins), preserving scan order. Pure function. */
export function dedupeItems(items: GrabberItem[]): GrabberItem[] {
  const seen = new Set<string>()
  const out: GrabberItem[] = []
  for (const item of items) {
    const key = item.url.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(item)
  }
  return out
}

interface HeadInfo {
  finalUrl: string
  size: number | null
  contentType: string | null
  filename: string | null
}

/** Best-effort HEAD: follows redirects, returns size + content-type. */
async function headUrl(url: string): Promise<HeadInfo | null> {
  try {
    const res = await fetch(url, {
      method: 'HEAD',
      redirect: 'follow',
      signal: AbortSignal.timeout(HEAD_TIMEOUT_MS)
    })
    if (!res.ok) return null
    const len = Number(res.headers.get('content-length') ?? 0)
    return {
      finalUrl: res.url || url,
      size: Number.isFinite(len) && len > 0 ? len : null,
      contentType: res.headers.get('content-type'),
      filename: null
    }
  } catch {
    return null
  }
}

/** Run async jobs with a concurrency cap, keeping input order. */
async function mapLimit<T, R>(items: T[], limit: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let next = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const i = next++
      if (i >= items.length) return
      out[i] = await fn(items[i])
    }
  })
  await Promise.all(workers)
  return out
}

function mapScanError(err: unknown): string {
  const msg = err instanceof Error ? err.message.toLowerCase() : ''
  if (msg.includes('timed out') || msg.includes('timeout') || msg.includes('aborted')) {
    return 'network'
  }
  return 'unknown'
}

/**
 * Scan one page for downloadable links (IDM-style site grabber).
 * Login-walled pages are out of scope for v0.6.0: the fetch carries no
 * credentials, so a 401/403 comes back as an honest 'forbidden' error.
 */
export async function scanPage(pageUrl: string): Promise<GrabberScanResult> {
  const trimmed = pageUrl.trim()
  let parsed: URL
  try {
    parsed = new URL(trimmed)
  } catch {
    return { ok: false, pageUrl: trimmed, title: null, items: [], error: 'invalid-url' }
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { ok: false, pageUrl: trimmed, title: null, items: [], error: 'invalid-url' }
  }
  let res: Response
  try {
    res = await fetch(trimmed, {
      redirect: 'follow',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { 'User-Agent': 'DOVIRA/0.6.0 (site grabber)' }
    })
  } catch (err) {
    return {
      ok: false,
      pageUrl: trimmed,
      title: null,
      items: [],
      error: mapScanError(err)
    }
  }
  const finalUrl = res.url || trimmed
  if (res.status === 401 || res.status === 403) {
    return { ok: false, pageUrl: finalUrl, title: null, items: [], error: 'forbidden' }
  }
  if (res.status === 404) {
    return { ok: false, pageUrl: finalUrl, title: null, items: [], error: 'not-found' }
  }
  if (!res.ok) {
    return { ok: false, pageUrl: finalUrl, title: null, items: [], error: 'network' }
  }
  const contentType = res.headers.get('content-type') ?? ''
  if (contentType && !contentType.includes('text/html')) {
    return { ok: false, pageUrl: finalUrl, title: null, items: [], error: 'not-html' }
  }
  const len = Number(res.headers.get('content-length') ?? 0)
  if (Number.isFinite(len) && len > MAX_PAGE_BYTES) {
    return { ok: false, pageUrl: finalUrl, title: null, items: [], error: 'page-too-large' }
  }
  let html: string
  try {
    html = await res.text()
  } catch (err) {
    return {
      ok: false,
      pageUrl: finalUrl,
      title: null,
      items: [],
      error: mapScanError(err)
    }
  }
  if (html.length > MAX_PAGE_BYTES) {
    return { ok: false, pageUrl: finalUrl, title: null, items: [], error: 'page-too-large' }
  }
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)
  const title = titleMatch
    ? titleMatch[1]
        .replace(/<[^>]+>/g, '')
        .replace(/\s+/g, ' ')
        .trim() || null
    : null

  // Phase 1: every distinct link on the page, in page order.
  const seen = new Set<string>()
  const links: string[] = []
  for (const u of extractLinks(html, finalUrl)) {
    const key = u.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    links.push(u)
  }

  // Phase 2: extension-known links are files already; the rest get a HEAD
  // and only count when the content-type is a downloadable type.
  const known: GrabberItem[] = []
  const unknown: string[] = []
  for (const u of links) {
    const kind = classifyKind(u)
    if (kind) {
      known.push({
        url: u,
        filename: filenameFromUrl(u),
        ext: extOf(u),
        kind,
        sizeBytes: null
      })
    } else {
      unknown.push(u)
    }
  }
  const headResults = await mapLimit(unknown, HEAD_CONCURRENCY, headUrl)
  for (let i = 0; i < unknown.length; i++) {
    const h = headResults[i]
    if (!h || !h.contentType) continue
    const kind = kindFromContentType(h.contentType)
    if (!kind) continue
    known.push({
      url: h.finalUrl,
      filename: filenameFromUrl(h.finalUrl),
      ext: extOf(h.finalUrl),
      kind,
      sizeBytes: h.size
    })
  }

  // Phase 3: HEAD the extension-known links too, for sizes (best-effort,
  // same concurrency cap). A failed HEAD keeps size null, never drops the item.
  const knownHeads = await mapLimit(known, HEAD_CONCURRENCY, (item) => headUrl(item.url))
  for (let i = 0; i < known.length; i++) {
    const h = knownHeads[i]
    if (!h) continue
    known[i].url = h.finalUrl
    if (h.size !== null) known[i].sizeBytes = h.size
  }

  const items = dedupeItems(known).slice(0, MAX_ITEMS)
  return { ok: true, pageUrl: finalUrl, title, items }
}
