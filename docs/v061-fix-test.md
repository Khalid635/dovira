# DOVIRA v0.6.1 fix test — radio/mix URLs fail with bare 'unknown' (2026-11-22)

## The bug (user report, installed v0.6.0)
The Add Download dialog failed with "ডাউনলোড ব্যর্থ হয়েছে। code: unknown"
plus the toast "ভিডিওর তথ্য আনা যায়নি।" — for BOTH of these URLs:
- mix/radio: https://www.youtube.com/watch?v=UHxTJ91SJIU&list=RDGMEMCMFH2exzjBeE_zAHHJOdxgVMUHxTJ91SJIU&start_radio=1
- plain: https://www.youtube.com/watch?v=UHxTJ91SJIU

Nothing about either failure was written to dovira.log, and no downloads
row was created. The plain URL worked instantly via raw yt-dlp CLI, so the
difference had to be inside the app's runtime path.

## Root cause (proven, not inferred)
`findBinary` in `src/main/util/paths.ts` checked
`<appPath>/resources/bin/win/<file>` FIRST, where appPath in the packaged
app is `.../resources/app.asar`. electron-builder's `asarUnpack:
resources/**` duplicates `resources/bin` — the files exist BOTH inside
`app.asar` and under `app.asar.unpacked`. Electron's asar-patched
`fs.existsSync` returns true for the asar-internal path, so the app
resolved all four engine binaries (yt-dlp, aria2, ffmpeg, deno) to paths
inside the archive. Windows cannot execute a file from inside an asar, so
every spawn failed with ENOENT. `runCapture` folded that into stderr,
`mapYtDlpError` found no mapped phrase and returned 'unknown', and nothing
was logged anywhere.

Proof (Electron runtime, dev electron binary, minimal main script):
- `existsSync('.../app.asar/resources/bin/win/yt-dlp.exe')` → true
- spawn of that path → `ENOENT` ("spawn ... ENOENT")
- spawn of `.../app.asar.unpacked/resources/bin/win/yt-dlp.exe` → exit 0,
  yt-dlp 2026.10.26

Reproduction through the REAL path (installed v0.6.0, CDP,
`window.dovira.fetchInfo`, temp profile):
- plain URL → `{"ok":false,"error":"unknown"}`
- mix URL → `{"ok":false,"error":"unknown"}`
- temp profile's dovira.log: startup/bridge lines only, zero fetch lines.

Secondary bug (real, found while reading the code): `looksLikePlaylist`
returned true for ANY URL with a `list` param, so a watch URL with a radio/
mix context went through the flat-playlist fetch first. Raw yt-dlp without
`--no-playlist` hangs >110s resolving the whole RDGMEM mix.

## The fix (v0.6.1)
1. `src/main/util/paths.ts` — `findBinary` skips any candidate inside an
   `.asar` archive (`isInsideAsar`); the unpacked copy wins. This fixes all
   four engine binaries, not just yt-dlp. If no usable copy exists it now
   returns null and the app shows the honest "Engine missing" dialog.
2. `src/main/queue.ts` — `looksLikePlaylist` returns false for watch URLs
   carrying a `v` param (single video, even with list=/start_radio=).
   Real playlist/channel URLs (no `v`) still go through fetchPlaylist.
3. Diagnostics (the v0.6.0 failure was unobservable after the fact):
   - `src/main/index.ts` logs the resolved engine paths at startup
     (`engines resolved: yt-dlp=... aria2=... ffmpeg=... deno=...`).
   - `src/main/engines/ytdlp.ts` logs the exact spawn args for fetchInfo/
     fetchPlaylist and, on failure, the kind (timeout / spawn-error /
     json-parse / exit N) plus the stderr excerpt.
   - `src/main/queue.ts` logs every fetchInfo failure (code + detail) and
     the playlist-first fallback at warn level.
   - `mapYtDlpError`: ENOENT now maps to 'engine-missing' instead of
     'unknown'.
4. The dialog shows the real error: `fetchInfo`/`addWithOptions`/
   `addFromExtension` return an optional `errorDetail` (yt-dlp stderr
   excerpt, ≤300 chars); the store sets `dialogErrorDetail` from it and the
   dialog renders `code: <code> — <detail>`. Submit errors carry the detail
   the same way. No new i18n keys were needed (detail is raw technical
   text); en/bn stay 320/320.
5. Version bump: `package.json` 0.6.1 + `extension/manifest.json` 0.6.1
   (the extension build fails the build when they differ).

## Regression evidence (fixed packaged build, dist/win-unpacked, CDP,
`window.dovira.fetchInfo`, temp profiles — the REAL path, not raw CLI)
- (a) mix URL → `ok:true`, info, title "Shudhu Tomake (Lyrics) Song |
  FRANKLIN | শুধু তোমাকে | Soft Song Lyrics |", duration 276. Resolved as
  a SINGLE video, not a playlist.
- (b) plain URL → `ok:true`, info, same title, duration 276.
- (c) real playlist/channel URL https://www.youtube.com/@SoftSongLyrics
  → `ok:true`, playlist "Soft Song Lyrics - Videos", 45 entries.
- (d) invalid URL `not-a-url` → `ok:false`, error `invalid-url`.
- (e) nonexistent video https://www.youtube.com/watch?v=INVALIDID12 →
  `ok:false`, error `unavailable`, errorDetail "ERROR: [youtube]
  INVALIDID12: This video is unavailable", with matching log lines.
- Real download (360p, plain URL, via `addWithOptions` to a temp dir):
  `ok:true`, status `completed`, file 6,975,685 B on disk — the full
  engine path (yt-dlp + ffmpeg merge) works in the packaged app.
- Log (temp profile): `engines resolved:` lists all four binaries under
  `app.asar.unpacked`; `ytdlp fetchInfo/fetchPlaylist spawn:` lines show
  the unpacked yt-dlp path; failure lines carry kind + stderr.
- Known YouTube-side limitation (NOT an app bug): the RDGMEM mix as a
  bare `/playlist?list=RDGMEM...` URL is unviewable — yt-dlp exit 1,
  "YouTube said: This playlist type is unviewable." The app now surfaces
  that message with errorDetail + log lines instead of bare 'unknown'.

## Static checks
- `npm run typecheck` (node + web): 0 errors. (One error found and fixed
  during the work: the `errorDetail` pass-through initially landed in
  `addFromExtension`, whose return type lacked the field.)
- `npm run lint`: 0 errors.
- `npm run build` (extension + typecheck + electron-vite): pass.
- `npm run build:win`: installer `dist/dovira-0.6.1-setup.exe`,
  237,358,601 B.
- Prettier clean on all touched files; 0 CRLF in touched files; i18n
  320/320 unchanged.

## Files changed
- src/main/util/paths.ts (isInsideAsar + skip in findBinary)
- src/main/queue.ts (looksLikePlaylist v-param rule, errorDetail threading,
  failure logging)
- src/main/engines/ytdlp.ts (spawn/failure logging, ENOENT → engine-missing)
- src/main/index.ts (engines-resolved startup log line)
- src/preload/index.ts (errorDetail in fetchInfo/addWithOptions types)
- src/renderer/src/store.ts (dialogErrorDetail from res.errorDetail)
- src/renderer/src/components/AddDownloadDialog.tsx (submit detail line)
- package.json, extension/manifest.json (0.6.1)
- docs/v061-fix-test.md (this note)

## What was NOT tested here — Khalid's / real-machine checks
- The v0.6.1 release installer from CI (tag + release are a separate step).
- Real auto-update flow to v0.6.1 on the user's installed app.
- In-app visual check of the dialog's new detail line (dark + light).
