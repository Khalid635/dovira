# Translating DOVIRA

DOVIRA ships in English and Bangla. Any community member can add a
new language — no code changes beyond one dictionary file and one
registry line. **Do not machine-translate whole locales**: a partial,
human translation is better than a full machine one. Translate what
you can, leave the rest in English (the app falls back to English for
any missing key).

## What a locale is

- `src/renderer/src/i18n/<code>.json` — one flat JSON object:
  `"key": "translated string"`. Keys are dotted paths
  (`settings.autoQuality`, `dialog.liveRecord`); `{name}` placeholders
  must stay exactly as-is, including the braces.
- One entry in `AVAILABLE_LOCALES` in
  `src/renderer/src/i18n/index.ts` — `{ code: '<code>', label: '<name in that language>' }`.
- One line in the `Language` union in the same file:
  `export type Language = 'en' | 'bn' | '<code>'`.

That is all it takes. The Settings language picker reads the registry,
so the new language appears there automatically.

## How to add a language

1. Copy `src/renderer/src/i18n/en.json` to
   `src/renderer/src/i18n/<code>.json` (use the ISO 639-1 code, e.g.
   `hi`, `es`, `fr`, `de`, `ja`, `ar`).
2. Translate the strings. Tips:
   - Keep it short — buttons and badges have little room.
   - Keep `{...}` placeholders untouched and in the same sentence
     position where the language allows.
   - Keep product names (`DOVIRA`, `YouTube`, `yt-dlp`, `aria2`) and
     technical words (`token`, `URL`) untranslated.
   - Match the tone: plain, direct, friendly — no formal or stiff
     wording.
3. Add the `Language` union code and the `AVAILABLE_LOCALES` line.
4. Run `npm test` — `tests/i18n.test.ts` asserts that every locale
   has exactly the same key set as English. A missing or extra key
   fails the build.
5. Open a PR with the new locale file + the two registry lines. Say
   in the PR description which strings you translated and which you
   left in English (if any) — a reviewer who speaks the language will
   check the wording.

## Updating an existing locale

- New features add new keys to `en.json` (and `bn.json`). Translators:
  copy the new English strings into your locale file and translate
  them; until you do, the app shows the English text for those keys.
- Never rename or delete a key in one locale only — the key sets must
  stay identical across all locales (`npm test` enforces this).

## What NOT to do

- Do not paste a whole machine-translated file and call it done.
- Do not translate the keys themselves, only the values.
- Do not add a locale with only a handful of strings translated and
  the rest machine-translated — translate what you can, leave the
  rest English.
