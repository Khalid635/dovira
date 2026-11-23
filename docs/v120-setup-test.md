# DOVIRA v1.2.0 — guided setup test notes

First-run wizard + guided in-app extension install + in-app diagnostics,
Bangla + English. Verified 2026-11-23 on the laptop (Windows, Electron 44).

## What was built

- **First-run wizard** (`src/renderer/src/components/SetupWizard.tsx`):
  welcome (language picker) → download folder (free-space display) →
  guided extension install → done. Skippable; finishing or skipping sets
  `setupCompleted: true`; re-openable from Settings > Setup & diagnostics.
- **Extension section** (`ExtensionSetup.tsx`, shared by wizard + Settings):
  live status (Local API running? extension last seen?), 4-step guided
  install (copy folder path / open folder, copy `chrome://extensions`,
  Load unpacked, copy token), Test connection, token regenerate, and the
  floating-button + download-intercept switches. The app is the single
  source of truth for both switches; both default OFF.
- **Diagnostics** (`src/main/diagnostics.ts`, `DiagnosticsSection.tsx`):
  Local API, yt-dlp (version + latest), aria2, extension connection,
  download folder (missing folder is created, < 1 GB free warns). Each
  check has a plain-language Bangla/English explanation and a one-click
  fix where one exists (update yt-dlp, open setup, choose folder).
- **Extension** (`extension/src/`): `chrome.alarms` 1-minute ping to
  `/status` (so the app sees it) + `/extension-settings` sync on every
  ping; floating button gated on the app switch; options page lost the
  intercept checkbox; manifest version 1.2.0 + `alarms` permission.
- **Local API** (`src/main/localApi.ts`): `extensionSeenAt` recorded only
  on extension-origin authorized requests; new `GET /extension-settings`
  (token-authenticated) returns the two switches.
- **AI Assistant**: new `diagnose` howto topic (last in the list, so
  specific topics win — "extension is not working" stays an extension
  question). Answers with `assistant.howtoDiagnose`, pointing at
  Settings > Setup & diagnostics.

## Static checks — all green

- `npm run typecheck` (node + web): 0 errors.
- `npx eslint` on all touched files: 0 problems (4 errors fixed during
  the build: a useless initializer in `diagnostics.ts`, a synchronous
  setState in an effect and `Date.now()` during render in
  `ExtensionSetup.tsx`, plus a missing `extensionSeenAt` in a
  `SettingsPage.tsx` fallback literal).
- `npx prettier --check` on all touched files: clean.
- i18n parity: 495 keys in `en.json` and `bn.json`, identical sets
  (81 new: `wizard.*` 16, `extension.*` 27, `diag.*` 33,
  `settings.navSetup`/`setupTitle`/`setupRerun`/`setupRerunHint` 4,
  `assistant.howtoDiagnose` 1).
- 0 CRLF in all 26 changed files (LF-only, as the repo requires).

## Unit tests — 44/44 + 60/60 regressions

Harness: `D:\temp\v120-unit-test.cjs` (compiles `diagnostics.ts` +
`assistant.ts` standalone with `npx tsc`, CommonJS, outDir
`D:\temp\v120-unit`):

```cmd
npx tsc src\main\diagnostics.ts src\main\smart\assistant.ts --outDir D:\temp\v120-unit --module commonjs --target es2022 --moduleResolution node --esModuleInterop --skipLibCheck
node D:\temp\v120-unit-test.cjs
```

- `formatSize`: 7 checks (0, 1023, 1.5 KB, 148 MB, 1.0 GB, negative, NaN).
- `runDiagnostics` with fake deps + the real bundled binaries
  (`resources\bin\win\yt-dlp.exe`, `aria2c.exe`), `checkLatest: false`:
  all-ok (5 checks, in order, every one ok), API stopped, extension
  never/stale (10 min → `minutes: 10`), yt-dlp missing / wrong binary,
  aria2 missing on Windows / running, download folder created when
  missing / low space warn / uncreatable → `chooseFolder` fix.
- Assistant `diagnose`: fires on "how do I diagnose a problem?",
  "how to fix this problem?", "how do I check diagnostics?", Bangla
  "ডাউনলোডে সমস্যা, কিভাবে ঠিক করবো?", "how do I fix my broken
  download?"; extension/speed/failed topics still win over it; a bare
  "my download is not working" (no how-word) stays `fallback` — the
  diagnose topic only fires on how/where questions, like every other
  howto topic. Answer key `assistant.howtoDiagnose` verified twice.
- i18n: identical sets, per-prefix counts, sample values non-empty.

Regression: the v1.1.0 harness re-run against freshly compiled
`assistant.ts` — `node D:\temp\assistant-unit-test.cjs` — **60/60**.

## Functional probe — 36/36

Driver: `D:\temp\probe-v120-func.mjs` (unpacked build, fresh profile,
CDP port 9228, screenshots in `D:\temp\dovira-v120-test\func\`):

- Wizard pops on a fresh profile; defaults are `setupCompleted: false`,
  both switches off, language `bn`.
- Local API running on 17530 with a token; `extensionSeenAt: null`.
- Extension folder resolves to `dist\win-unpacked\resources\extension`.
- Wizard step-through: folder step shows `C:\Users\Khalid\Downloads\DOVIRA`,
  extension step renders 9 buttons, done step names the download dir,
  Finish closes it and sets `setupCompleted: true`.
- Diagnostics (IPC) before any ping: 5 checks in order, Local API ok,
  extension warn `detailExtNever` + `openSetup` fix; yt-dlp warn
  `detailYtdlpUnknown` (latest-version lookup could not reach GitHub —
  best-effort, not a failure).
- Fake-extension ping (`GET /status`, `Origin: chrome-extension://…` +
  Bearer token): HTTP 200, then `extensionSeenAt` set; diagnostics now
  report the extension `ok` / `detailExtConnected`.
- `GET /extension-settings` returns off/off, then on/on after toggling
  both switches, then off/off again.
- Assistant `askAssistant('how to diagnose a problem?')` returns
  `assistant.howtoDiagnose`.
- Settings > Setup & diagnostics (`#settings-setup`): the Run button
  renders 5 check rows; re-run re-opens the wizard; Skip closes it and
  `setupCompleted` stays true; no wizard after a reload.
- One real plain-file download (Node v24.21.0 zip, ~24 MB) completes
  into the fresh download dir and exists on disk.
- Zero renderer exceptions / console errors.

## UI audit — 48/48

Driver: `D:\temp\probe-v120-ui.mjs` (fresh profile, CDP port 9229,
screenshots in `D:\temp\dovira-v120-test\ui\`):

- Wizard (welcome + extension step) × light/dark × Bangla/English ×
  1280×800: renders, correct `data-theme`, no horizontal overflow.
- 960×640 dark-Bangla wizard extension step: no overflow.
- Wizard finishes cleanly; Settings > Setup & diagnostics × the same
  4 combos: section renders, Run renders 5 check rows, no overflow.
- 960×640 dark-Bangla setup section: no overflow.
- Zero renderer exceptions / console errors.

## Build

- `npm run build`: green (extension dist v1.2.0, typecheck node + web,
  main 202.78 kB, preload 4.74 kB, renderer JS 872.06 kB).
- `npm run build:unpack`: green.
- `npm run build:win`: green — `dist\dovira-1.2.0-setup.exe`,
  237,741,496 bytes (~237 MB, same size class as v1.1.0).

## Notes / not covered here

- The yt-dlp "latest version" lookup is best-effort: when GitHub is
  unreachable it reports `warn` / `detailYtdlpUnknown` instead of
  failing the check.
- The extension's 1-minute ping and the settings sync were verified
  through the Local API with a fake extension origin; a real Chrome
  install + Load unpacked click-through still needs Khalid's browser.
- The wizard's visuals (Bangla wording, spacing) were screenshot-checked
  by the probes, not eyeballed — see `D:\temp\dovira-v120-test\`.
- No git tag was created for v1.2.0 (tagging happens after verification).
