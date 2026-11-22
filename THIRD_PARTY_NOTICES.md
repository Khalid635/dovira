# Third-Party Notices

DOVIRA's own code is MIT licensed (see LICENSE). The app bundles / depends on
the following third-party software. Pinned versions are the ones fetched by
`npm run fetch-binaries` and verified at install time (checksum for yt-dlp and
Deno; version output for aria2 and ffmpeg; ffmpeg's GPL status is read from
its own configuration line).

| Software | Version | License | Notes |
|---|---|---|---|
| Electron | 44.x | MIT | App framework |
| electron-vite / electron-builder | — | MIT | Build tooling |
| React, Vite, TypeScript | — | MIT | UI + build |
| Tailwind CSS | 4.x | MIT | Styling |
| yt-dlp | 2026.10.26 | The Unlicense | Video/audio extraction engine (bundled binary) |
| aria2 | 1.37.0 | GPL-2.0-or-later | Multi-connection download engine — Windows: bundled prebuilt binary; macOS/Linux: built from source in CI (scripts/build-aria2.sh) |
| ffmpeg | 9.0.2 Windows (gyan.dev essentials) / 9.1 macOS (evermeet) / 9.0 Linux (BtbN n9.0 GPL static) | GPL-3.0-or-later | Merge/convert engine (bundled binary) — all three builds are GPL: each configuration line shows `--enable-gpl` with libx264/libx265. DOVIRA's own code stays MIT; the GPL covers the ffmpeg binary only (separate process, no linking). |
| Deno | 2.9.8 | MIT | JavaScript runtime for yt-dlp YouTube support (bundled binary) |
| electron-updater | 6.8.11 | MIT | App auto-update (GitHub Releases + SHA-256 verification) |

Bundled GPL-licensed binaries (aria2, ffmpeg) are distributed with their
source availability noted here per the GPL: aria2 source is available at
https://github.com/aria2/aria2; ffmpeg source is available at
https://ffmpeg.org, https://www.gyan.dev/ffmpeg/builds/ (Windows), https://evermeet.cx/ffmpeg/ (macOS) and https://github.com/BtbN/FFmpeg-Builds (Linux).
