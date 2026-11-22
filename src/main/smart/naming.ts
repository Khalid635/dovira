/**
 * Phase 7 (v1.0) — Smart filenames.
 *
 * Strips the junk uploaders put in titles — "(Official Video)", "[HD]",
 * emoji, " - YouTube", extra spaces — then applies the user's template
 * (default "{title} [{height}p]") and sanitizes for Windows filenames.
 * Pure functions; the template is applied in main and previewed in the
 * Add dialog before anything is downloaded.
 */
import { sanitizeFilename } from '../util/filename'

export interface NameTemplateVars {
  title: string
  height?: number | null
  ext?: string
  uploader?: string | null
  date?: string | null
}

/** Remove "(Official Video)" / "[HD]" / emoji / " - YouTube" / extra spaces. */
export function cleanTitle(raw: string): string {
  let s = raw
  // "(Official Video)", "(Official Music Video)", "(Official Audio)",
  // "(Lyric Video)" — in parens or square brackets.
  s = s.replace(/\((?:official\s+)?(?:music\s+)?(?:lyric\s+)?(?:video|audio)\)/gi, '')
  s = s.replace(/\[(?:official\s+)?(?:music\s+)?(?:lyric\s+)?(?:video|audio)\]/gi, '')
  // Quality tags the template re-adds from the real height: [HD] [HQ] [4K] [1080p]...
  s = s.replace(/\[(?:HD|HQ|UHD|4K|8K|2160p|1440p|1080p|720p|480p|360p|240p)\]/gi, '')
  // " - YouTube" / " | YouTube" at the end.
  s = s.replace(/[-|–—]\s*YouTube\s*$/i, '')
  // Emoji + variation selectors + zero-width joiners.
  s = s.replace(/\p{Extended_Pictographic}/gu, '')
  s = s.replace(/[\uFE0F\u200D]/g, '')
  // Collapse whitespace, trim stray separators at the edges.
  s = s.replace(/\s+/g, ' ').trim()
  s = s.replace(/^[-–—_|]+|[-–—_|]+$/g, '').trim()
  return s
}

/** Apply "{title} [{height}p]" style templates. Missing values vanish cleanly. */
export function applyTemplate(template: string, vars: NameTemplateVars): string {
  const date = vars.date ?? new Date().toISOString().slice(0, 10)
  let out = template
  // A missing height must drop the whole "[{height}p]" segment — replacing
  // {height} with '' first would leave a stray "[p]".
  if (!vars.height) {
    // eslint-disable-next-line no-useless-escape -- [ and ] need escaping outside a class, not inside; the class form reads best here
    out = out.replace(/[\[(]\s*\{height\}\s*p\s*[\])]/gi, '')
  }
  out = out.replace(/\{title\}/g, vars.title)
  out = out.replace(/\{height\}/g, vars.height ? String(vars.height) : '')
  out = out.replace(/\{ext\}/g, vars.ext ?? '')
  out = out.replace(/\{uploader\}/g, vars.uploader ?? '')
  out = out.replace(/\{date\}/g, date)
  // Empty "[]" / "()" left by a missing value (e.g. "[{height}p]" for audio).
  out = out.replace(/\[\s*\]/g, '').replace(/\(\s*\)/g, '')
  out = out.replace(/\s+/g, ' ').trim()
  out = out.replace(/^[-–—_|]+|[-–—_|]+$/g, '').trim()
  return out
}

export interface SuggestNameInput {
  /** Current filename with extension, e.g. "Best PayPal Alternative (Official Video) [HD].mp4" */
  filename: string
  title?: string | null
  height?: number | null
  uploader?: string | null
  template: string
}

/** The smart filename for a download: cleaned title + template + extension. */
export function suggestName(input: SuggestNameInput): string {
  const dot = input.filename.lastIndexOf('.')
  const ext = dot > 0 ? input.filename.slice(dot + 1).toLowerCase() : ''
  const bare = dot > 0 ? input.filename.slice(0, dot) : input.filename
  const title = cleanTitle(input.title ?? bare)
  let base = applyTemplate(input.template, {
    title: title || 'download',
    height: input.height ?? null,
    ext,
    uploader: input.uploader ?? null
  })
  if (ext && !base.toLowerCase().endsWith(`.${ext}`)) base = `${base}.${ext}`
  return sanitizeFilename(base)
}
