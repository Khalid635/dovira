# AI Assistant (v1.1.0) — Test Report

Rule-based chat helper (plan §16) with an optional local model (Ollama / LM Studio).
No API keys, no paid API, no data leaves the machine. Chat history is in-memory
only (last 50 messages, resets on restart).

## 1. Static checks — PASS

- `npm run typecheck` (node + web): exit 0
- ESLint on all 12 touched source files: exit 0
- Prettier `--check` on all 17 touched files (source + i18n + package.json +
  extension/manifest.json + CHANGELOG.md): all matched
- i18n parity: 414 keys in en.json and bn.json, identical key sets (was 367).
  47 new keys (`assistant.*`, `settings.assistant*`, `sidebar.assistant`,
  `status.processing`).
- 0 CRLF in all touched files (LF only).

One fix during the run: `answerQuestion` took an unused `_lang` parameter
(eslint error) — removed; lines are i18n keys, the renderer translates them.
Prettier reformatted `assistant.ts` (5 spots).

## 2. Unit tests — 60/60 PASS

`D:\temp\assistant-unit-test.cjs` against `assistant.ts` compiled standalone
with `npx tsc` to `D:\temp\assistant-unit`:

- Intent matching (en + bn): status, failed, find, howto (all 10 topics),
  greeting, fallback — including token boundaries ("hi" never matches inside
  "this", "file" never matches inside "profile"), and matching order
  find → failed → status → howto → greeting → fallback.
- Date filters (en + bn, incl. inflected forms `গত সপ্তাহের`, `এই সপ্তাহের`,
  `আজকের`, `গতকালের`): today / yesterday / last week / this week.
- Answer generation: status counts + active rows with %/speed/ETA, failed
  rows with human error text + advice, find top-5 newest-first, how-to
  pointers, empty-queue and no-match cases.
- Model prompt: contains counts + recent titles, contains NO file paths and
  NO URLs, long questions capped.
- One test-expectation fix during the run: `formatSize(155343423)` is
  `'148 MB'` (the formatter rounds ≥100 to whole numbers), not `'148.2 MB'`.
- One real test-driven fix: Bangla inflected date forms added (see above).

## 3. Functional driver — 31/31 PASS

`D:\temp\probe-assistant-func.mjs` — packaged build
(`dist\win-unpacked\dovira.exe`), fresh profile
`D:\temp\dovira-assistant-profile`, fresh download dir
`D:\temp\dovira-assistant-downloads`, CDP port 9228, raw WebSocket, PASS/FAIL
counters, renderer-error capture. Log: `D:\temp\assistant-func2.log`.

- A1 app hydrates. A2 sidebar has the "AI অ্যাসিস্ট্যান্ট" entry. A3 panel
  opens. A4 empty state renders (4 suggestion chips).
- A5 assistant on by default (`assistantEnabled: true`). A6 local-model mode
  off by default (`assistantLocalModel: false`).
- A6b/c download dir pointed at the fresh test dir + app re-hydrates.
- A7 empty-queue status via IPC: `statusSummary` downloading 0. A8 find
  no-match → `findNone`. A9 how-to speed → `howtoSpeed`. A10 greeting.
- A11 dialog thumbnail loads (naturalWidth 1278). A12 Node zip queued via
  aria2.
- A13 mid-download status: downloading 1, queued 1, names "Big Buck Bunny
  60fps 4K - Official Blender Foundation Short Film" with pct/speed/ETA.
- A14 BBB 360p completes → `Video\Big Buck Bunny 60fps 4K - Official
  Blender Foundation Short Film [360p].mp4` (29.3 MB). A15 Node zip
  completes → `Archives\node-v24.21.0-win-x64.zip`. A16/A18 both files exist
  on disk. A17 BBB in the Video folder with the `[360p]` smart name.
- A19 completed count 2 after downloads. A20 find "Big Buck Bunny" →
  `findFound` n=1 + `findOne` (completed, 29.3 MB, 2026-11-23). A21 find
  no-match still `findNone`.
- A22 UI send (typed "What's downloading?" in the panel, clicked পাঠাও) →
  assistant bubble renders the live summary: "0টা ডাউনলোড হচ্ছে · 0টা
  অপেক্ষায় · 2টা শেষ · 0টা fail · 0টা pause — আজ 2টা ডাউনলোড শেষ হয়েছে।"
- A23 real failure: `https://example.com/nope-404-test-file-dovira.zip`
  → status `failed`, errorCode `not-found` → "why did it fail?" answers with
  `failedName` (nope-404-test-file-dovira.zip) + `error.not-found` +
  `assistant.adviceGone`.
- A24 fake Ollama server (in-driver, 127.0.0.1:11435, `/api/generate` canned
  reply) + `assistantLocalModel: true` → unmatched question returns the
  canned sentence with `source: 'model'`. A25 server stopped → same question
  falls back to rules (`source: 'rules'`, `assistant.fallback`).
- A26 assistant off (via the Settings UI toggle) → IPC answer is
  `assistant.disabled`. A27 panel shows the disabled state. A28 toggled back
  on.
- A29 zero renderer errors.

First run was 20/31 — all 6 failures were driver bugs, not app bugs: the
fresh profile's DB was empty but the real `Downloads\DOVIRA` still held
Phase 7's files, so the duplicate guard blocked both downloads. Fixed by
using a fresh download dir (+ reload so the renderer store picks it up).
Re-run with the corrected driver: 31/31.

## 4. UI audit — 23/23 PASS + visual spot-check

`D:\temp\probe-assistant-ui.mjs` — Assistant panel × Dark/Light ×
Bangla/English × 1280×800, plus a 960×640 dark-Bangla pass with a real
conversation. Log: `D:\temp\assistant-ui.log`. Screenshots:
`D:\temp\dovira-assistant-test\ui\`.

- U1–U5 per combo (light-en, dark-en, light-bn, dark-bn): app hydrates,
  assistant nav opens, panel renders, no horizontal overflow
  (scrollW == clientW), correct `data-theme`.
- U6 960×640 dark-bn conversation renders (user bubble + assistant bubble
  with the live summary). U7 no horizontal overflow at 960 (scrollW 960).
- U8 zero renderer errors.

Visual spot-check (2 screenshots read by eye): dark-bn empty state — clean
centered card, 4 suggestion chips, input + পাঠাও button, sidebar counts
correct (সব 3, শেষ 2, ভিডিও 1, ফাইল 2). 960×640 dark-bn conversation —
bubbles render correctly, no clipping, no overflow.

One fix from the visual check: the sidebar footer read
`v1.1.0 · Phase 7` (stale label from the v0.7.0 redesign). Dropped the
"· Phase 7" suffix — it now reads `v1.1.0`. Static checks re-run green
(typecheck 0, eslint 0, prettier 0) and the installer was rebuilt after the
fix.

## 5. What changed (git)

15 files modified + 2 new files (240 insertions, 7 deletions):

- New: `src/main/smart/assistant.ts` (rules engine + model prompt builder),
  `src/renderer/src/components/AssistantPage.tsx` (chat UI).
- Main: `queue.ts` (`askAssistant` + snapshot/model wiring), `ipc.ts`
  (`dovira:assistant:ask`, input validated, capped at 500 chars),
  `types.ts` (+2 settings fields), `settings.ts` (defaults + normalize),
  `preload/index.ts` (`askAssistant` on `DoviraAPI`).
- Renderer: `store.ts` (View += `'assistant'`), `App.tsx` (render branch),
  `Sidebar.tsx` (Tools entry + `IconChat` + version-label fix),
  `icons.tsx` (`IconChat`), `SettingsPage.tsx` (assistant toggles in the
  Smart section, before the local-model block), `i18n/en.json` + `i18n/bn.json`
  (+47 keys each).
- `package.json` + `extension/manifest.json`: 1.0.0 → 1.1.0. `CHANGELOG.md`:
  `## [1.1.0]` entry.

## 6. Installer

`dist\dovira-1.1.0-setup.exe` — **237,730,893 B** (rebuilt after the
sidebar-label fix; first build was 237,730,875 B).
Unpacked build `dist\win-unpacked\dovira.exe` exists and is what the drivers
ran. Smoke check on the rebuilt unpacked build: hydrates, sidebar shows
`v1.1.0`, no "Phase 7" anywhere on screen. NOT installed over the live app;
NO tag or release created (parent does that).

## 7. NOT verified / known limitations

- Real Ollama / LM Studio was NOT tested — only a fake endpoint returning a
  canned reply (A24/A25). The app side of the hook (Phase 7 `askLocalModel`,
  5s timeout, silent fallback) is the same code path the fake server
  exercised.
- The "Local model" badge in the chat UI renders when `source === 'model'`
  (code path), but no screenshot was taken of a model answer in the panel —
  the model answers were verified via IPC only.
- Silent install + installed-app run NOT done (same reason as Phase 7 — the
  installed v0.7.0/v1.0.0 holds the Local API port; test instances fall back).
- Chat history is in-memory only by design — it resets on restart.
- Separate Help page (§1k mentions one for v1.0) NOT built — the assistant's
  how-to answers cover it.
- His in-app check still pending (sidebar entry, panel, Settings toggles,
  a real local-model run if he uses Ollama/LM Studio).
