import type { AddOptions, Settings, VideoInfo } from '../../../main/types'
import { pickSubtitles } from './autoPick.ts'

/**
 * One-click paste-and-download + the multi-media picker share one
 * "sane defaults" builder: the Settings quality (or the best available
 * row), MP3 for audio-only, smart naming left to main (applySmartName
 * stays unset, so main applies the filename template with the real
 * title / height / uploader). Pure functions, unit-tested in
 * tests/quick-add.test.ts.
 */

/** A bare homepage is not a download; only http(s) links count. */
export function looksLikeUrl(text: string): boolean {
  if (!text || text.length > 2048 || /\s/.test(text)) return false
  let u: URL
  try {
    u = new URL(text)
  } catch {
    return false
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return false
  if (u.pathname === '/' || u.pathname === '') return false
  return true
}

const ILLEGAL_FILENAME_CHARS = new Set(['<', '>', ':', '"', '/', '\\', '|', '?', '*'])

/** The Add dialog's sanitizeName, shared: strip illegal chars, cap length. */
export function sanitizeStem(name: string): string {
  const cleaned = name
    .split('')
    .filter((c) => c.charCodeAt(0) >= 32 && !ILLEGAL_FILENAME_CHARS.has(c))
    .join('')
    .trim()
  return (cleaned || 'download').slice(0, 120)
}

/**
 * Default video height: the Settings quality when the video has it, else
 * the highest available row at or below 1080p (same rule as the dialog).
 */
export function defaultHeightFor(info: VideoInfo, settings: Settings | null): number {
  const heights = [
    ...new Set(info.formats.filter((f) => f.height !== null).map((f) => f.height as number))
  ]
  if (heights.length === 0) return Number(settings?.defaultVideoQuality ?? '1080')
  const wanted = Number(settings?.defaultVideoQuality ?? '1080')
  if (heights.includes(wanted)) return wanted
  const below = heights.filter((h) => h <= 1080).sort((a, b) => b - a)
  return below[0] ?? Math.max(...heights)
}

export interface MediaOptionsInput {
  info: VideoInfo
  settings: Settings | null
  /** Height for video (dialog choice or Settings default). */
  height: number
  /** Bitrate for audio. */
  bitrate: string
  /** Destination folder (Settings download dir when empty). */
  saveDir: string
  /** Force video/audio; default = auto (video when the info has a video format). */
  kind?: 'video' | 'audio'
}

/** AddOptions with the app's defaults — what one-click paste and the media picker submit. */
export function buildMediaOptions(input: MediaOptionsInput): AddOptions {
  const { info, settings, height, bitrate, saveDir } = input
  const hasVideo = info.formats.some((f) => f.height !== null)
  const kind = input.kind ?? (hasVideo ? 'video' : 'audio')
  const container = settings?.videoContainer ?? 'mp4'
  const filename =
    kind === 'video'
      ? `${sanitizeStem(info.title)}.${container}`
      : `${sanitizeStem(info.title)}.mp3`
  // Next-level: AI auto subtitles — the Settings language first,
  // English next, auto-captions as a fallback. Only when the setting
  // is on; the Add dialog's manual choice still overrides this.
  const subPick = pickSubtitles(
    info.subtitleLangs ?? [],
    info.autoCaptionLangs ?? [],
    settings?.subtitleLang ?? 'en',
    settings?.autoSubtitles ?? false
  )
  return {
    url: info.url,
    kind,
    formatId: kind === 'video' ? `${height}p` : `mp3-${bitrate}`,
    formatString: kind === 'video' ? `bv*[height<=${height}]+ba/b[height<=${height}]` : 'bestaudio',
    qualityLabel: kind === 'video' ? `${height}p` : `${bitrate} kbps`,
    subtitles: subPick !== null,
    subLang: subPick?.lang ?? settings?.subtitleLang ?? 'en',
    embedThumbnail: false,
    embedMetadata: settings?.embedMetadataDefault ?? false,
    clipStart: null,
    clipEnd: null,
    subMode: 'embed',
    autoSubs: subPick?.autoSubs ?? false,
    thumbnailOnly: false,
    useArchive: false,
    savePath: saveDir ? `${saveDir}\\${filename}` : filename,
    filename,
    title: info.title,
    thumbnailUrl: info.thumbnail,
    videoId: info.videoId,
    extractor: info.extractor,
    height: kind === 'video' ? height : null,
    uploader: info.uploader
  }
}
