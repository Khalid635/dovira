/**
 * Next-level: AI auto quality / subtitle pick (renderer mirror).
 *
 * Same pure functions as src/main/smart/autoPick.ts — the renderer
 * cannot import main modules at runtime, so this file duplicates
 * them. Keep in sync.
 */

export interface SubtitlePick {
  lang: string
  autoSubs: boolean
}

export function pickHeight(heights: number[], cap: number): number | null {
  const uniq = [...new Set(heights.filter((h) => Number.isFinite(h) && h > 0))]
  if (uniq.length === 0) return null
  const below = uniq.filter((h) => h <= cap)
  if (below.length > 0) return Math.max(...below)
  return Math.min(...uniq)
}

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
