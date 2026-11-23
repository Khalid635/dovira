/**
 * Filename style presets — renderer copy of src/main/smart/namePresets.ts.
 * tsconfig.web.json does not include src/main, so the renderer cannot
 * import the main module; keep the two maps in sync.
 */

export const NAME_PRESETS = {
  'title-quality': '{title} [{height}p]',
  title: '{title}',
  'title-uploader': '{title} - {uploader}',
  'uploader-title-quality': '{uploader} - {title} [{height}p]',
  'title-date': '{title} ({date})'
} as const

export type NamePresetId = keyof typeof NAME_PRESETS | 'custom'

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
