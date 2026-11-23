/**
 * Cobalt-inspired multi-media picker: one item of a multi-media post
 * (e.g. an Instagram carousel, an X post with several photos).
 *
 * Lives in util/ (not engines/ytdlp.ts) so node --test can import it —
 * ytdlp.ts uses parameter properties, which Node's TypeScript
 * type-stripping cannot parse. Pure module — no I/O, unit-tested in
 * tests/media-items.test.ts.
 */
export interface YtDlpMediaItem {
  id: string
  title: string
  thumbnail: string | null
  url: string
  duration: number | null
}

/**
 * Pull the per-item list out of a yt-dlp info JSON. Returns [] for a
 * plain single video (no entries, or a single entry) — the picker only
 * shows when there is actually a choice to make.
 */
export function parseMediaItems(json: Record<string, unknown>): YtDlpMediaItem[] {
  const entries = Array.isArray(json['entries']) ? json['entries'] : []
  if (entries.length <= 1) return []
  const out: YtDlpMediaItem[] = []
  for (const e of entries as Record<string, unknown>[]) {
    const id = typeof e['id'] === 'string' ? (e['id'] as string) : ''
    if (!id) continue
    const url =
      typeof e['webpage_url'] === 'string' && (e['webpage_url'] as string)
        ? (e['webpage_url'] as string)
        : typeof e['url'] === 'string'
          ? (e['url'] as string)
          : ''
    if (!url) continue
    const thumbs = Array.isArray(e['thumbnails']) ? e['thumbnails'] : []
    const thumb = thumbs.length > 0 ? thumbs[thumbs.length - 1] : null
    out.push({
      id,
      title: typeof e['title'] === 'string' ? (e['title'] as string) : id,
      thumbnail:
        thumb && typeof (thumb as Record<string, unknown>)['url'] === 'string'
          ? ((thumb as Record<string, unknown>)['url'] as string)
          : null,
      url,
      duration: typeof e['duration'] === 'number' ? (e['duration'] as number) : null
    })
  }
  return out
}
