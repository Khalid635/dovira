# Phase 7 Smart (v1.0.0) — Test Report

Date: 2026-11-23. App: DOVIRA 1.0.0 (Electron 44.11.5), packaged build
`dist\win-unpacked\dovira.exe` + installer `dist\dovira-1.0.0-setup.exe`
(237,719,807 bytes). Test machine: Khalid's laptop (DESKTOP-KBJR07L) via SSH.
Drivers (kept on the VM for re-runs): `~/workspace/dovira-phase7-smart/`
`probe-p7-func.mjs`, `probe-p7-dup.mjs`, `probe-p7-360.mjs`, `probe-p7-ui.mjs`
— all drive the packaged app over CDP (port 9224–9227) with fresh profiles
under `D:\temp\dovira-p7-*-profile`.

## 1. Static checks — PASS

- `npx tsc --noEmit`: 0 errors (also `npm run typecheck` as part of the build).
- `npx eslint .`: 0 errors.
- `npx prettier --check` on all touched files + new docs: clean.
- 0 CRLF in every touched/new file (LF only, verified after each edit).
- i18n: 41 new keys, en + bn, 368 keys each, parity OK.
- `git status`: 17 files modified + 8 new files (2 smart modules, 5 docs,
  3 screenshots). See §6.

## 2. Unit tests — 45/45 PASS

`src/main/smart/*.ts` compiled standalone (`npx tsc`, CommonJS, outDir
`D:\temp\smart-unit`) and exercised with Node's `assert` (`test.cjs`):

| Module     | Checks                                                                                                                                                           | Result |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| categorize | overrides > kind > ytCategory > extension > domain > Others; organizeDir join + custom name                                                                      | 15/15  |
| naming     | cleanTitle (Official Video/Music Video, [HD], emoji, ` - YouTube`, whitespace), applyTemplate (video/audio/uploader/date), suggestName (video/audio/ext/unicode) | 12/12  |
| duplicates | same name+size hit, different size miss, missing file, unknown-size name-only hit                                                                                | 4/4    |
| adaptive   | no-samples=medium 8/4, fast 16/8, slow 4/2 + long retries, 1 MB/s boundary, 2 failures=unstable, CV>0.6=unstable, zero/negative ignored, reset                   | 8/8    |
| localModel | fake Ollama (test ok, askCategory Music, garbage→null, unreachable→null/{ok:false}, disabled→null), LM Studio shape (Video)                                      | 6/6    |

**Bug found by these tests and fixed:** `applyTemplate('{title} [{height}p]')`
with no height produced `T [p]` — the `p` survived the empty-bracket cleanup.
Fixed in `naming.ts`: the whole `[{height}p]` / `({height}p)` segment is
dropped before substitution when height is missing. Re-ran: 45/45.

## 3. fetchInfo timing — measured, pre-warm verified, 2nd fetch NOT faster

Khalid's report (2026-11-22 ~23:40): a YouTube fetch took 10 s; normal is 3–5 s.

| Measurement                                                               | Result                                                                        |
| ------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `yt-dlp.exe --version` (cold spawn)                                       | 4,439 ms / 2,602 ms / 3,115 ms                                                |
| Direct `yt-dlp --dump-single-json` (Big Buck Bunny)                       | 7,805 ms / 7,838 ms (clean runs); 10,200 ms first run of the session          |
| App `fetchInfo` via IPC + dialog (from `dovira.log`, `fetchInfo ok <ms>`) | 9,281 / 10,598 / 12,571 / 13,270 / 9,306 / 10,240 / 8,991 / 9,139 / 13,344 ms |
| Pre-warm at startup                                                       | logged: `yt-dlp pre-warmed: 2026.10.26` before the first fetch                |

**Finding:** the ~10 s is the normal extraction time for this video, not an
anomaly — cold start is only ~3 s of it, and the 2nd fetch takes the same
~8–13 s (no fetch cache; YouTube extraction dominates and varies run to
run). The pre-warm removes the cold-start slice from the first fetch after
app launch. A fetch-result cache would make repeat fetches instant — NOT
built (out of scope for the bounded fix); noted as a follow-up idea.

## 4. Functional driver — 24 pass / 11 fail on the first run, ALL 11 were driver bugs

First run (`probe-p7-func.mjs`, 35 checks): 24 PASS, 11 FAIL. Every failure
was traced to the driver, not the app, and re-verified with corrected
drivers (see §5):

- F7/F8: driver read `fetchInfo`'s return as the info object — the IPC
  returns an envelope `{ok, info}`. The fetch itself worked (log: ok 9,281 ms).
- F10/F11: driver compared objects to strings — `smartCategorize` returns
  `{category, folder}`, `smartSuggestName` returns `{name}`.
- F15: driver collected every `<input>` value on the page (URL + toggle
  states) instead of the dialog's save path. The dialog text itself showed
  `C:\Users\Khalid\Downloads\DOVIRA\Video\...`.
- F16/F17/F20: driver regex `/\b360\b/` cannot match `360p` (no word
  boundary between `0` and `p`) — and the file actually had `\\b` (double
  backslash) so it matched nothing at all. The download that completed was
  the default 1080p, correctly named `[1080p]`.
- F22/F23/F24: driver waited for the video title to appear — but the home
  page already shows the completed card, so it clicked rows/buttons before
  the dialog had loaded. Re-run with a dialog-specific wait (§5) passes.
- F29: driver grepped the log for `adaptive|changeOption|retune` — the real
  log line is `smartDownload: live connections -> 16 (fast)`.

What the first run DID prove (all PASS): app hydrates; smart defaults on,
local model off; name template default; pre-warm logged; fetchInfo duration
logged; no duplicate before download; dialog thumbnail loads; smart-name
preview shows; BBB 1080p completes into `Video/` with the smart name and
exists on disk; Node zip queues via aria2, completes into `Archives/` and
exists on disk; `smartNaming` toggles off via IPC and stays off across a
full app restart; 0 renderer errors in that run.

## 5. Re-verification with corrected drivers — ALL PASS

### 5a. Duplicate panel (`probe-p7-dup.mjs`) — 10/10

Precondition: BBB 1080p completed in the profile, file on disk.
Re-add at default quality (1080p, same URL):

- Duplicate panel appears, kind line says URL match.
- **Skip**: dialog closes, download count unchanged (2 → 2).
- **Keep both**: new download appears as
  `Big Buck Bunny 60fps 4K - Official Blender Foundation Short Film [1080p] (1).mp4`
  (status `downloading`); cancelled cleanly afterwards (status `cancelled`).
- 0 renderer errors.

### 5b. 360p + adaptive (`probe-p7-360.mjs`) — 16/16

- Dialog thumbnail loads; 5 quality rows render; 360p row selectable.
- Smart name re-templates to `[360p]` on quality change; save path is the
  `Video` organizer folder.
- Duplicate panel appears for the 360p re-add (URL match — the video was
  already downloaded at 1080p); **Re-download** proceeds.
- **Live proof of adaptive `-N`**: the running yt-dlp process command line
  was captured mid-download:
  `yt-dlp.exe ... -f bv*[height<=360]+ba/b[height<=360] --merge-output-format mp4 -N 4 -o "C:\Users\Khalid\Downloads\DOVIRA\Video\Big Buck Bunny 60fps 4K - Official Blender Foundation Short Film [360p].mp4" -- https://www.youtube.com/watch?v=aqz-KE-bpKQ`
  (`-N 4` = medium class: no speed samples yet at spawn — exactly as designed.)
- BBB 360p completes into `Video/` as `... [360p].mp4`, exists on disk.
- Re-adding the already-downloaded zip via IPC hits the safety net:
  `{ok:false, error:"duplicate", id:"09372b10-..."}`.
- Adaptive live-retune in the log: `smartDownload: live connections -> 16 (fast)`.
- 0 renderer errors.

### 5c. Files on disk (verified by size)

| File                                   | Bytes                                  |
| -------------------------------------- | -------------------------------------- |
| `Video\Big Buck Bunny ... [1080p].mp4` | 155,343,423                            |
| `Video\Big Buck Bunny ... [360p].mp4`  | 46,283,921                             |
| `Archives\node-v24.21.0-win-x64.zip`   | 37,618,919 (= the item's totalBytes ✓) |

## 6. What changed (git)

17 modified + 8 new files, +1,401/−53 lines (before the naming fix + docs):

- New: `src/main/smart/adaptive.ts`, `src/main/smart/localModel.ts`,
  `docs/screenshots/` (3 PNGs), `README.md` (rewritten), `CONTRIBUTING.md`,
  `CODE_OF_CONDUCT.md`, `CHANGELOG.md`, `.github/ISSUE_TEMPLATE/bug_report.md`,
  `.github/ISSUE_TEMPLATE/feature_request.md`, `.github/PULL_REQUEST_TEMPLATE.md`.
- Modified: `package.json` + `extension/manifest.json` (0.7.0 → 1.0.0),
  `src/main/{types,settings,db,queue,ipc,index}.ts`,
  `src/main/engines/ytdlp.ts`, `src/main/smart/{categorize,naming,duplicates}.ts`,
  `src/preload/index.ts`, `src/renderer/src/components/{AddDownloadDialog,SettingsPage}.tsx`,
  `src/renderer/src/i18n/{en,bn}.json`.

## 7. UI audit (`probe-p7-ui.mjs`) — 37/37 PASS + visual spot-check

Home / Settings (Smart section) / History × Light + Dark × English + Bangla,
plus 960×640:

- Every combination hydrates and renders (nav present, body text present).
- Smart section present in all 4 combos; exactly 5 toggles each time.
- Home + History empty states present (fresh profile, no downloads).
- No horizontal overflow at 960×640 on any of the three screens
  (`scrollWidth == clientWidth == 960`).
- 0 renderer errors across the whole audit; 15 screenshots saved.
- Visual spot-check of `settings-smart-dark-bn.png` and
  `settings-smart-960x640.png`: clean layout, no clipping/overlap; Bangla
  labels render correctly; the template preview reads
  `প্রিভিউ: Best PayPal Alternative [1080p].mp4`.

## 8. Installer — built, NOT yet installed

- `electron-builder --win` (as part of `npm run build:win`): SUCCESS.
- `dist\dovira-1.0.0-setup.exe`: 237,719,807 bytes; `latest.yml` updated.
- The unpacked build (`dist\win-unpacked\dovira.exe`) is what every driver
  above ran — it is the same code the installer ships.
- Silent install + installed-app run: NOT done here — Khalid's own v0.7.0
  install is currently running on the machine (its processes hold the Local
  API port 17530; test instances fell back to 17531 and worked). The
  installer should be run when he is ready to upgrade; the in-app updater
  already reports `Update for version 1.0.0 is not available (latest version:
0.7.0, downgrade is disallowed)` because no v1.0.0 release exists on
  GitHub yet (tag/release is a separate step, not this commit).

## 9. NOT verified / known limitations

- **Silent install of `dovira-1.0.0-setup.exe` + running the installed app**
  — not done (see §8; needs his upgrade moment, not a test profile).
- **Real Mac/Linux installs + real auto-update flow** — out of scope for this
  phase (CI builds them; no Mac/Linux machine here).
- **Local-model hook end to end** — unit-tested against a fake Ollama/LM
  Studio server (6/6) and the Settings Test button path is wired, but no
  real Ollama/LM Studio instance runs on the laptop, so no live model call
  was observed. Default OFF; rules path covers everything when it is off.
- **Retry-delay stretching under real failure** — verified by unit test
  (slow/unstable → 5s/15s/30s); no live network failure was induced.
- **Plain-file duplicate panel** — the dialog shows the panel for video/audio
  re-adds; a plain file re-add via the dialog shows the duplicate error text
  only (no panel) — v1.0 limitation, documented in the plan notes.
- **Chrome-cookie login-walled video, public-tracker torrent, extension
  click-through** — still his checks, unchanged from v0.7.0.
- **fetchInfo 2nd fetch is NOT faster** (§3) — pre-warm helps only the first
  fetch after launch; a result cache is a follow-up idea, not built.

## 10. Observations (not blockers)

- `listDownloads` `totalBytes` for yt-dlp items reads 30,767,611 for BOTH
  the 1080p and 360p rows, while the files on disk are 155,343,423 and
  46,283,921 bytes. Pre-existing metadata quirk (totalBytes plumbing
  predates Phase 7); it does not affect the duplicate flows (the URL/remote
  match catches yt-dlp re-adds; the on-disk files are correct). The zip's
  totalBytes matches its file exactly.
- The dialog's fetchInfo ran twice for one re-add (two spawns ~1 s apart
  in the log) — the effect re-runs on quality/tab change; harmless, but
  it doubles the ~10 s wait on re-adds. A fetch cache would fix this too.
- Khalid's own Downloads folder already has many `(1)`–`(9)` copies of one
  song from his installed v0.7.0 — the exact pain this phase's duplicate
  detection fixes.
