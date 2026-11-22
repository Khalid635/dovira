/**
 * Phase 7 (v1.0) — AI File Organizer.
 *
 * Rule-based and fully local: nothing leaves the machine. Priority order:
 *   1. user extension overrides (Settings > Smart)
 *   2. the download kind the user picked (video / audio tab)
 *   3. yt-dlp metadata category (e.g. "Music", "Entertainment")
 *   4. the file-extension map below
 *   5. a domain hint (youtube.com -> Video, soundcloud.com -> Music)
 *   6. Others
 * The optional local-model hook (localModel.ts) only runs when every rule
 * above still says Others — and only when the user turned it on.
 */
import { join } from 'node:path'

export type Category =
  'Video' | 'Music' | 'Documents' | 'Archives' | 'Programs' | 'Images' | 'Others'

export const CATEGORIES: readonly Category[] = [
  'Video',
  'Music',
  'Documents',
  'Archives',
  'Programs',
  'Images',
  'Others'
]

const EXTENSION_MAP: Record<string, Category> = {
  // Video
  mp4: 'Video',
  mkv: 'Video',
  webm: 'Video',
  mov: 'Video',
  avi: 'Video',
  flv: 'Video',
  m4v: 'Video',
  wmv: 'Video',
  mpg: 'Video',
  mpeg: 'Video',
  '3gp': 'Video',
  ts: 'Video',
  m2ts: 'Video',
  // Music
  mp3: 'Music',
  m4a: 'Music',
  flac: 'Music',
  wav: 'Music',
  ogg: 'Music',
  opus: 'Music',
  aac: 'Music',
  wma: 'Music',
  aiff: 'Music',
  // Documents
  pdf: 'Documents',
  doc: 'Documents',
  docx: 'Documents',
  xls: 'Documents',
  xlsx: 'Documents',
  ppt: 'Documents',
  pptx: 'Documents',
  txt: 'Documents',
  md: 'Documents',
  csv: 'Documents',
  epub: 'Documents',
  mobi: 'Documents',
  odt: 'Documents',
  ods: 'Documents',
  odp: 'Documents',
  rtf: 'Documents',
  // Archives
  zip: 'Archives',
  rar: 'Archives',
  '7z': 'Archives',
  tar: 'Archives',
  gz: 'Archives',
  bz2: 'Archives',
  xz: 'Archives',
  iso: 'Archives',
  dmg: 'Archives',
  pkg: 'Archives',
  // Programs
  exe: 'Programs',
  msi: 'Programs',
  apk: 'Programs',
  appimage: 'Programs',
  deb: 'Programs',
  rpm: 'Programs',
  // Images
  jpg: 'Images',
  jpeg: 'Images',
  png: 'Images',
  gif: 'Images',
  webp: 'Images',
  bmp: 'Images',
  svg: 'Images',
  ico: 'Images',
  avif: 'Images',
  heic: 'Images'
}

/** yt-dlp `categories[0]` values that map to a DOVIRA category. */
const YT_CATEGORY_MAP: Record<string, Category> = {
  Music: 'Music',
  'Film & Animation': 'Video',
  Entertainment: 'Video',
  Sports: 'Video',
  Gaming: 'Video',
  'News & Politics': 'Video',
  Comedy: 'Video',
  'Howto & Style': 'Video',
  Education: 'Video',
  'Science & Technology': 'Video',
  'Travel & Events': 'Video',
  'Pets & Animals': 'Video',
  'People & Blogs': 'Video',
  'Autos & Vehicles': 'Video',
  'Nonprofits & Activism': 'Video'
}

const VIDEO_DOMAINS = ['youtube.com', 'youtu.be', 'vimeo.com', 'dailymotion.com', 'twitch.tv']
const MUSIC_DOMAINS = ['soundcloud.com', 'spotify.com', 'bandcamp.com']

export interface CategorizeInput {
  filename: string
  /** The tab the user picked in the Add dialog (or 'file' for plain links). */
  kind?: 'video' | 'audio' | 'file'
  /** Hostname of the source URL, e.g. "www.youtube.com". */
  site?: string | null
  /** Video duration in seconds (yt-dlp). */
  duration?: number | null
  /** yt-dlp `categories[0]`, e.g. "Music". */
  ytCategory?: string | null
  /** User extension→category overrides from Settings. */
  overrides?: Record<string, string>
}

export function extensionOf(filename: string): string {
  const base = filename.split(/[\\/]/).pop() ?? filename
  const dot = base.lastIndexOf('.')
  if (dot <= 0) return ''
  return base.slice(dot + 1).toLowerCase()
}

export function categorize(input: CategorizeInput): Category {
  const ext = extensionOf(input.filename)
  // 1. User overrides win over everything.
  if (ext && input.overrides) {
    const cat = input.overrides[ext]
    if (typeof cat === 'string' && (CATEGORIES as readonly string[]).includes(cat)) {
      return cat as Category
    }
  }
  // 2. The kind the user picked.
  if (input.kind === 'audio') return 'Music'
  if (input.kind === 'video') return 'Video'
  // 3. yt-dlp metadata category.
  if (input.ytCategory) {
    const mapped = YT_CATEGORY_MAP[input.ytCategory.trim()]
    if (mapped) return mapped
  }
  // 4. File extension.
  if (ext) {
    const mapped = EXTENSION_MAP[ext]
    if (mapped) return mapped
  }
  // 5. Domain hint (only reached when the extension said nothing).
  if (input.site) {
    const host = input.site.toLowerCase()
    if (VIDEO_DOMAINS.some((d) => host.includes(d))) return 'Video'
    if (MUSIC_DOMAINS.some((d) => host.includes(d))) return 'Music'
  }
  // 6. Give up — Others.
  return 'Others'
}

/** The folder a category lands in: baseDir + the user-named folder. */
export function organizeDir(
  baseDir: string,
  category: Category,
  folders: Record<string, string>
): string {
  const folder = folders[category] ?? category
  return join(baseDir, folder)
}
