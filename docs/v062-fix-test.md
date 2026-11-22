# DOVIRA v0.6.2 fix test — Add Download dialog shows no thumbnail (2026-11-22)

## The bug (user report, installed v0.6.1)
The Add Download dialog showed the video title + duration but NO thumbnail —
just a dark box with the duration badge. Screenshot: mix URL
`https://www.youtube.com/watch?v=cnvsbt11zRI&list=RDcnvsb...`
(Vabi Tumi Ashbe Phire), Audio tab, 320 kbps MP3 selected. Title and duration
loaded fine, so fetchInfo itself worked (v0.6.1 fix) — only the image was missing.

## Root cause (proven from code + live renderer)
- `src/renderer/index.html` set a Content-Security-Policy meta:
  `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:`
  — `img-src 'self' data:` blocks ALL remote images.
- `src/main/engines/ytdlp.ts` returns the thumbnail as a remote YouTube URL
  (`https://i.ytimg.com/vi_webp/<id>/maxresdefault.webp`, last entry of yt-dlp's
  `thumbnails` array).
- `src/renderer/src/components/AddDownloadDialog.tsx` renders
  `<img src={dialogInfo.thumbnail}>` — the element rendered, the browser
  refused the load. Text (title/duration) is unaffected by img-src, which is
  exactly the reported symptom.
- Codebase-wide search: this meta tag is the ONLY CSP definition (no
  session/webRequest header CSP in src/main, nothing in the electron-builder
  config). The same block also hit thumbnails anywhere else a remote `<img>`
  is used (e.g. DownloadCard rows) — the fix covers the whole app.

## The fix (v0.6.2)
1. `src/renderer/index.html` — `img-src 'self' data:` →
   `img-src 'self' data: https:` (images only; script/style/default
   unchanged; no new risk — the app already fetches arbitrary URLs via yt-dlp).
2. No local-download / data-URL workaround — the allowlist is the minimal
   intended fix.
3. Version bump: `package.json` 0.6.2 + `extension/manifest.json` 0.6.2.

## Regression evidence (fixed packaged build, dist-v062/win-unpacked, CDP,
`window.dovira.fetchInfo`, temp profile — the REAL path, not raw CLI)
- (a) CSP meta in the LIVE renderer:
  `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:`
  (also confirmed in the packaged asar's `out/renderer/index.html` and in
  `out/renderer/index.html` on disk).
- (b) fetchInfo plain URL `https://www.youtube.com/watch?v=UHxTJ91SJIU` →
  `ok:true`, title "Shudhu Tomake (Lyrics) Song | FRANKLIN | শুধু তোমাকে |
  Soft Song Lyrics |", duration 276, thumbnail
  `https://i.ytimg.com/vi_webp/UHxTJ91SJIU/maxresdefault.webp`.
- (c) Thumbnail Image load in the renderer: `loaded:true`, naturalWidth 1280,
  naturalHeight 720, domain i.ytimg.com — **the thumbnail now loads; the
  reported bug is fixed.**
- (d) fetchInfo mix URL
  `https://www.youtube.com/watch?v=UHxTJ91SJIU&list=RDGMEMCMFH2exzjBeE_zAHHJOdxgVMUHxTJ91SJIU&start_radio=1`
  → `ok:true`, same single-video title/duration/thumbnail, entries null —
  v0.6.1 fix NOT regressed.
- (e) Log (temp profile): `engines resolved:` lists all four binaries under
  `app.asar.unpacked`; fetchInfo spawn lines show the unpacked yt-dlp path
  with `--no-playlist` for both URLs. Updater note: "Update for version 0.6.2
  is not available (latest version: 0.6.1, downgrade is disallowed)" —
  expected, v0.6.2 is not released yet.
- (f) `npm run build:win` (via temp config, see below): installer
  `dist-v062/dovira-0.6.2-setup.exe`, 237,360,731 B (v0.6.1: 237,358,601 B).
- CDP note: Chrome 152 rejects the CDP websocket handshake with 403 unless
  the app is launched with `--remote-allow-origins=*` (first attempt failed
  on this; the test app was killed and relaunched with the flag).

## Packaging gotcha found during this work (fixed, not shipped)
- The live v0.6.1 app locks `dist/win-unpacked`, so plain `npm run build:win`
  failed with EBUSY rmdir. First workaround — a temp config
  `electron-builder-v062.yml` with `directories.output: dist-v062` — produced
  a 3.4 GB asar / 1.88 GB NSIS 7z: redirecting the output dir removed
  electron-builder's default exclusion of `dist/`, so all of `dist/` (old
  installers + unpacked builds, 267 entries) got packed INTO the new asar.
  That build was killed mid-NSIS and its output deleted.
- Fixed by adding `!dist/**`, `!dist-v062/**`, `!electron-builder-v062.yml`
  to the temp config's `files` list and rebuilding. Clean result: asar
  4,236,648 B, 327 files, 0 dist* entries (v0.6.1 asar for reference:
  4,229,527 B, 326 files, 0 dist entries). The temp config was deleted before
  committing and is NOT part of this change.
- Rule for the future: never redirect electron-builder's output dir without
  also excluding the old `dist/` (or build with the stock config when the
  live app is closed).

## Static checks
- `npm run typecheck` (node + web): 0 errors.
- `npm run lint`: 0 errors.
- `npm run build` (extension + typecheck + electron-vite): pass.
- `npm run build:win` (temp config): installer 237,360,731 B.
- Prettier clean on all touched files; 0 CRLF in touched files; i18n 320/320
  unchanged (no UI strings touched).

## Files changed
- src/renderer/index.html (img-src allow https:)
- package.json, extension/manifest.json (0.6.2)
- docs/v062-fix-test.md (this note)

## What was NOT tested here — Khalid's / real-machine checks
- The v0.6.2 release installer from CI (tag + release are a separate step).
- Real auto-update flow to v0.6.2 on the user's installed app.
- In-app visual check: the dialog's thumbnail now visible (dark + light) —
  the Image-load proof above is the renderer-level proof; the eyeball check
  is his.
