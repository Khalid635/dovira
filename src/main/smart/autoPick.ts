/**
 * Next-level: AI auto quality / subtitle pick.
 *
 * When a download starts, the engine picks the best quality and
 * subtitles automatically from the user's Settings defaults and the
 * video's available options — the choice is shown to the user (the
 * Add dialog pre-checks it, the queue uses it for extension and
 * one-click downloads). Pure functions — no I/O, unit-tested in
 * tests/auto-pick.test.ts. The renderer carries a mirror
 * (src/renderer/src/util/autoPick.ts) — keep them in sync.
 */

export interface SubtitlePick {
  /** The subtitle language code (e.g. 'bn', 'en'). */
  lang: string
  /** True when the pick is an auto-generated caption, not a manual subtitle. */
  autoSubs: boolean
}

/**
 * Best video height: the highest available height at or below the
 * Settings cap. When every available height is above the cap, the
 * lowest available (closest to the cap). Null when the video has no
 * height rows at all (audio-only).
 */
export function pickHeight(heights: number[], cap: number): number | null {
  const uniq = [...new Set(heights.filter((h) => Number.isFinite(h) && h > 0))]
  if (uniq.length === 0) return null
  const below = uniq.filter((h) => h <= cap)
  if (below.length > 0) return Math.max(...below)
  return Math.min(...uniq)
}

/**
 * Best subtitles, by ladder — the user's subtitle language first,
 * English next, then the first manual subtitle; the same ladder again
 * for auto-generated captions (flagged autoSubs). Null when the
 * setting is off or nothing exists at all.
 */
export function pickSubtitles(
  subtitleLangs: string[],
  autoCaptionLangs: string[],
  preferredLang: string,
  autoSubtitles: boolean
): SubtitlePick | null {
  if (!autoSubtitles) return null
  const manual = pickFromList(subtitleLangs, preferredLang)
  if (manual) return { lang: manual, autoSubs: false }
  const auto = pickFromList(autoCaptionLangs, preferredLang)
  if (auto) return { lang: auto, autoSubs: true }
  return null
}

function pickFromList(langs: string[], preferredLang: string): string | null {
  if (langs.length === 0) return null
  const lower = langs.map((l) => l.toLowerCase())
  const pref = preferredLang.toLowerCase()
  if (lower.includes(pref)) return langs[lower.indexOf(pref)]
  if (lower.includes('en')) return langs[lower.indexOf('en')]
  return langs[0]
}
