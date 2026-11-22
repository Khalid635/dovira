# DOVIRA

> **Download Smarter. Go Further.**

DOVIRA is a free, open-source AI download manager for Windows — download videos and audio from the web with quality choice, smart resume, and rule-based smart features. No ads, no tracking, no pro-lock.

## Status

**v0.4.0 — Phases 1–5 (done):** aria2 downloads with pause/resume/cancel/retry, queue (max 3 concurrent), SQLite history with migrations, disk-space checks, Settings, EN/BN interface, dark + light themes, Windows completion notifications. **Phase 2 adds:** yt-dlp video/audio downloads with quality choice (Video 2160p–360p, Audio MP3 320/192/128 kbps), Add Download Dialog with real format list + sizes, subtitles + thumbnail embed options, per-engine version info and yt-dlp one-click update (backup + smoke test + rollback), plain-language error messages, yt-dlp resume with the same format only (never a silent restart). **Phase 3 adds:** History page, cookies support, scheduler and tray. **Phase 4 adds:** playlist/channel download (one quality for all entries, skip already-downloaded via the download archive), batch download (one URL per line, or import a .txt), clip download (a time range of a video), metadata + subtitle options (embed metadata, subtitle mode embed/file/both, auto-generated subtitles), thumbnail-only download, and torrent/magnet support. **Phase 5 adds:** browser extension (Manifest V3, Chrome + Firefox) — right-click "Download with DOVIRA", toolbar popup with the page's links, IDM-style floating download button on video pages, optional browser-download intercept (off by default), and a token-authenticated Local API on 127.0.0.1 in the app (pairing token in Settings > Browser & Cookies). Live-stream recording was NOT built (plan §12).

Phase 6 (next) adds Mac/Linux builds and auto-update. See the master plan in the repo's docs or `ai-download-manager-plan-v2.md`.

## Features

- **Direct file downloads** — multi-connection via aria2 (8 connections), pause/resume that survives app restarts
- **Video & audio downloads** — YouTube and other video sites via yt-dlp: pick Video quality (up to 2160p) or Audio MP3, subtitles and thumbnail included on request
- **Smart Resume** — interrupted downloads resume where they stopped (network drop, app restart, PC reboot). yt-dlp resume always reuses the exact same format; if the partial file is gone, the app says so instead of silently restarting
- **Queue** — max 3 simultaneous downloads, the rest wait their turn
- **History** — every download is stored in local SQLite and survives restarts
- **Playlists & batch** — download a whole playlist/channel (pick the entries, one quality for all) or paste many links at once; already-downloaded videos can be skipped via the download archive
- **Clips, metadata & subtitles** — download just a time range of a video, embed title/artist metadata and thumbnails, or save subtitles as .srt (including auto-generated captions)
- **Torrents** — magnet links and .torrent files via aria2 (DHT on, never seeds after a download finishes)
- **Browser extension** — right-click "Download with DOVIRA", toolbar popup, floating download button on video pages, optional download intercept (off by default). Pairs with the app over a token-authenticated Local API on 127.0.0.1. See `extension/README.md` — Firefox (AMO) first; Chrome via Load unpacked. Do NOT submit the YouTube-download capability to the Chrome Web Store (its policy prohibits it).
- **AI File Organizer (rule-based)** — downloads categorized by type; smart naming and duplicate detection interfaces are in place for Phase 7
- **AI Assistant** — planned after v1.0 (optional local model, off by default)

Engines: aria2, yt-dlp, ffmpeg and Deno (all bundled).

## Limitations (v0.4.0)

- Login-only videos need cookies — set them in Settings > Browser & Cookies (the app says so instead of failing silently).
- DRM-protected sites (Netflix, Prime Video, Disney+) can never be supported.
- The browser extension UI is English-only for now; the app itself is EN/BN.
- Playlist links sent from the extension are refused — pick entries in the app's Add dialog.
- Video quality shown comes only from the site's real format list — if a video has no 1080p, 1080p is not offered.

## Build & run

```bash
npm install
npm run fetch-binaries   # downloads aria2, yt-dlp, ffmpeg, deno into resources/bin/win (git-ignored)
npm run dev              # dev shell (Electron + Vite)
npm run build            # extension build + typecheck + production build
npm run build:extension  # browser extension only (TypeScript -> extension/dist)
npm run build:win        # Windows installer (NSIS)
```

Engine binaries live in `resources/bin/win/` and are **not** committed — a fresh clone runs `npm run fetch-binaries` to get them (pinned versions, verified on install).

> If `npm run dev` fails with `Error: Electron uninstall`, the Electron binary
> didn't download during install — run `node node_modules/electron/install.js`
> once, then try again.

## Project structure

```
src/main/         Electron main: queue, db, settings, ipc, localApi (extension Local API)
  engines/        aria2.ts (JSON-RPC), ytdlp.ts, versions.ts
  smart/          categorize.ts, naming.ts, duplicates.ts (AI-ready, rule-based for now)
  util/           filename.ts, errors.ts, paths.ts
src/preload/      contextBridge API (window.dovira)
src/renderer/     React UI: Home, DownloadCard, Settings, AddDownloadDialog, EN/BN i18n
extension/        browser extension (Manifest V3): background, content script, popup, options
resources/bin/    engine binaries (git-ignored)
scripts/          fetch-binaries.cjs, build-extension.cjs
docs/             phase2-test.md, phase2-ytdlp-resume-test.md, benchmark.md
```

## DRM note

DRM-protected sites (Netflix, Prime Video, Disney+) are **not** supported — no app can download from them, and DOVIRA never tries to break DRM. Users are responsible for following each site's terms and copyright law.

## Torrent note

Torrents are supported only for legal content — e.g. Linux ISOs and public-domain media. DOVIRA never seeds after a download finishes (seed-time 0).

## License

MIT — see LICENSE. Third-party notices: THIRD_PARTY_NOTICES.md.
