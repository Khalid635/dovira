# DOVIRA

> **Download Smarter. Go Further.**

DOVIRA is a free, open-source AI download manager for Windows — download videos and audio from the web with quality choice, smart resume, and rule-based smart features. No ads, no tracking, no pro-lock.

## Status

Phase 1 — Core Engine (done): aria2 downloads with pause/resume/cancel/retry, queue (max 3 concurrent), SQLite history with migrations, disk-space checks, minimal Settings, EN/BN interface, dark + light themes, Windows completion notifications.

Phase 2 (next) adds yt-dlp video/audio with quality choice. See the master plan in the repo's docs or `ai-download-manager-plan-v2.md`.

## Features

- **Direct file downloads** — multi-connection via aria2 (8 connections), pause/resume that survives app restarts
- **Smart Resume** — interrupted downloads resume where they stopped (network drop, app restart, PC reboot)
- **Queue** — max 3 simultaneous downloads, the rest wait their turn
- **History** — every download is stored in local SQLite and survives restarts
- **AI File Organizer (rule-based)** — downloads categorized by type; smart naming and duplicate detection interfaces are in place for Phase 7
- **AI Assistant** — planned after v1.0 (optional local model, off by default)

Engines: aria2 (bundled). yt-dlp, ffmpeg and Deno arrive in Phase 2.

## Build & run

```
npm install
npm run fetch-binaries   # downloads aria2 into resources/bin/win (git-ignored)
npm run dev              # dev shell (Electron + Vite)
npm run build            # typecheck + production build
npm run build:win        # Windows installer (NSIS)
```

Engine binaries live in `resources/bin/win/` and are **not** committed — a fresh clone runs `npm run fetch-binaries` to get them (pinned versions, verified on install).

> If `npm run dev` fails with `Error: Electron uninstall`, the Electron binary
> didn't download during install — run `node node_modules/electron/install.js`
> once, then try again.

## Project structure

```
src/main/         Electron main: queue, db, settings, ipc
  engines/        aria2.ts (JSON-RPC), versions.ts
  smart/          categorize.ts, naming.ts, duplicates.ts (AI-ready, rule-based for now)
  util/           filename.ts, errors.ts, paths.ts
src/preload/      contextBridge API (window.dovira)
src/renderer/     React UI: Home, DownloadCard, Settings, EN/BN i18n
resources/bin/    engine binaries (git-ignored)
scripts/          fetch-binaries.ts
```

## DRM note

DRM-protected sites (Netflix, Prime Video, Disney+) are **not** supported — no app can download from them, and DOVIRA never tries to break DRM. Users are responsible for following each site's terms and copyright law.

## License

MIT — see LICENSE. Third-party notices: THIRD_PARTY_NOTICES.md.
