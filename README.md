# DOVIRA

> **Download Smarter. Go Further.**

DOVIRA is a free, open-source AI download manager for Windows — download videos and audio from the web with quality choice, smart resume, and rule-based smart features. No ads, no tracking, no pro-lock.

## Features

- **Video / Audio tabs** — download video (1080p, 720p, 480p, 360p…) or audio-only MP3 (320 / 192 / 128 kbps) with quality choice
- **AI Link Detection** — downloadable links detected from clipboard and browser
- **Smart Download** — the right engine per file type; connection count adapts to network speed
- **AI File Organizer** — downloads auto-categorized into Video, Music, Documents, Archives, Programs, Images, Others
- **Smart Resume** — interrupted downloads resume where they stopped (network drop, app restart, PC reboot)
- **Duplicate Detection** — warns before downloading the same file or link twice
- **AI Assistant** — planned after v1.0 (optional local model, off by default)

Engines: yt-dlp, aria2, ffmpeg, Deno (bundled with the app).

## Status

Phase 0 — project scaffold (Electron + React + TypeScript + Tailwind). Download engine lands in Phase 1–2.

## Build & run

```bash
npm install
npm run dev      # dev shell (Electron + Vite)
npm run build    # typecheck + production build
npm run build:win  # Windows installer (NSIS)
```

## DRM note

DRM-protected sites (Netflix, Prime Video, Disney+) are **not** supported — no app can download from them, and DOVIRA never tries to break DRM. Users are responsible for following each site's terms and copyright law.

## License

MIT — see [LICENSE](LICENSE). Third-party notices: [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
