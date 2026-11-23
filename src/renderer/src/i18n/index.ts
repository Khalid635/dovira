import en from './en.json'
import bn from './bn.json'

export type Language = 'en' | 'bn'

// Next-level (feature 10): the locale registry. A new community locale
// is one Language-union code + one dict file + one line here — the
// Settings language picker reads this, never a hardcoded list.
// See docs/translations.md for the translator guide.
export const AVAILABLE_LOCALES: { code: Language; label: string }[] = [
  { code: 'bn', label: 'বাংলা' },
  { code: 'en', label: 'English' }
]

const dicts: Record<Language, Record<string, string>> = {
  en: en as Record<string, string>,
  bn: bn as Record<string, string>
}

export function t(lang: Language, key: string, params?: Record<string, string | number>): string {
  const dict = dicts[lang]
  let s = dict[key] ?? dicts.en[key] ?? key
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      s = s.replaceAll(`{${k}}`, String(v))
    }
  }
  return s
}
