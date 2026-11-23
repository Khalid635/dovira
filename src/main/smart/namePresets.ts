/**
 * Filename style presets (Cobalt-inspired: Cobalt's filename styles are
 * classic / pretty / basic / nerdy — these are DOVIRA's own, built on the
 * existing {title} / {height} / {uploader} / {date} template variables).
 *
 * A preset is just a nameTemplate value. Picking one in Settings > Smart
 * writes both nameTemplatePreset and nameTemplate; editing the template
 * by hand re-derives the preset ('custom' when it matches none).
 * Pure module — no I/O, unit-tested in tests/name-presets.test.ts.
 *
 * NOTE: the renderer has its own copy of this map
 * (src/renderer/src/util/namePresets.ts) because tsconfig.web.json does
 * not include src/main — keep the two in sync.
 */

export const NAME_PRESETS = {
  'title-quality': '{title} [{height}p]',
  title: '{title}',
  'title-uploader': '{title} - {uploader}',
  'uploader-title-quality': '{uploader} - {title} [{height}p]',
  'title-date': '{title} ({date})'
} as const

export type NamePresetId = keyof typeof NAME_PRESETS | 'custom'

const PRESET_IDS = new Set<string>(Object.keys(NAME_PRESETS))

export function isNamePresetId(v: unknown): v is NamePresetId {
  return typeof v === 'string' && (PRESET_IDS.has(v) || v === 'custom')
}

/** The template a preset stands for ('custom' has none — keep the text). */
export function presetTemplate(id: Exclude<NamePresetId, 'custom'>): string {
  return NAME_PRESETS[id]
}

/** Which preset a template matches, or 'custom' when it matches none. */
export function presetIdForTemplate(template: string): NamePresetId {
  for (const id of Object.keys(NAME_PRESETS) as (keyof typeof NAME_PRESETS)[]) {
    if (NAME_PRESETS[id] === template) return id
  }
  return 'custom'
}
