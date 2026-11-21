# Third-Party Notices

DOVIRA's own code is MIT licensed (see LICENSE). The app bundles / depends on
the following third-party software. Binary licenses will be verified against
the exact builds bundled when the engines land (Phase 1–2).

| Software | License | Notes |
|---|---|---|
| Electron | MIT | App framework |
| electron-vite / electron-builder | MIT | Build tooling |
| React, Vite, TypeScript | MIT | UI + build |
| Tailwind CSS | MIT | Styling |
| yt-dlp | The Unlicense | Video/audio extraction engine (bundled binary, Phase 2) |
| aria2 | GPL-2.0-or-later | Multi-connection download engine (bundled binary, Phase 1) |
| ffmpeg | LGPL-2.1-or-later / GPL (build-dependent) | Merge/convert engine (bundled binary, Phase 2) — verify the exact build's license before release |
| Deno | MIT | JavaScript runtime for yt-dlp YouTube support (bundled binary, Phase 2) |

Bundled GPL-licensed binaries (aria2, and ffmpeg if a GPL build is used) are
distributed with their source availability noted here per the GPL.
