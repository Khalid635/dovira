# Changelog

All notable changes to DOVIRA. Dates are the release dates on GitHub.

## [Unreleased]

### Fixed

- fetchInfo results are now cached in memory for 5 minutes, so re-opening
  the Add dialog for the same link is instant; the cache is bypassed by the
  dialog's Retry button and cleared when a download for that URL starts
  (#1, #8).
- `listDownloads` totalBytes for yt-dlp items now reflects the real
  merged-file size on disk instead of the last per-format progress total
  (which was the audio stream's size) (#3).
- The duplicate panel now appears for plain-file re-adds too, with working
  Re-download / Skip / Keep both, and an Open folder button for the
  existing file (#2, #4).
- Settings > Smart local-model Test now reports what it tested — provider,
  host, model — and the failure reason (unreachable / timeout / bad
  answer) (#5).
- Ctrl+Enter (Cmd+Enter on macOS) now submits the Add dialog, except while
  the duplicate panel is open or a fetch is running (#6).
- The status bar shows the current Smart Download network class (fast /
  medium / slow / unstable) while a download is active (#7).

## [1.2.0]

### Added

- First-run setup wizard (Bangla + English): welcome with language picker, download
  folder pick with free-space display, guided browser-extension install, done screen.
  Skippable; re-openable from Settings > Setup & diagnostics.
- Guided in-app extension install: live connection status (extension last seen), copy
  folder path / open folder, copy `chrome://extensions` address, load-unpacked
  walkthrough, token copy + regenerate, Test connection button. The extension now
  checks in with the app every minute (chrome.alarms) and syncs the floating-button
  and download-intercept switches from the app — the app is the single source of
  truth; both default OFF.
- In-app diagnostics (Settings > Setup & diagnostics): Local API, yt-dlp (version +
  update available), aria2, extension connection, and download folder (missing folder
  is created, under 1 GB free space warns), each with a plain-language Bangla/English
  explanation and a one-click fix where one exists (update yt-dlp, open setup,
  choose folder).
- New `dovira:diagnostics:run`, `dovira:extension:folderPath`, and
  `dovira:extension:openFolder` IPC channels; Local API `GET /extension-settings`
  (floating button + intercept, token-authenticated); `ExtensionApiStatus` now
  includes `extensionSeenAt`.
- AI Assistant: new "diagnose" topic — "my download is not working / সমস্যা" points
  at Settings > Setup & diagnostics and its one-click fixes.
- Settings now include `setupCompleted`, `extensionFloatingButton`, and
  `extensionIntercept` (all default false/off).

### Changed

- Extension options page no longer has the download-intercept checkbox — the switch
  lives in the app and syncs to the extension. The floating button is also gated on
  the app switch (default off); a page already open needs a reload after enabling.
- Extension version 1.2.0.

## [1.1.0] - 2026-11-23

AI Assistant (post-v1.0, plan §16) — chat helper in the sidebar.

### Added

- **AI Assistant**: answers download questions from live app state — what's downloading, why something failed (plain-language error + what to do next), history search by keyword/kind/date, and how-to guidance for every feature. Rule-based and fully local: no API keys, no paid API, nothing leaves the machine.
- **Optional local model**: questions the rules can't answer can go to a local Ollama or LM Studio model (Settings > Smart features > Assistant uses local model, default off). Reuses the Phase 7 endpoint settings; 5s timeout, silent fallback to rules. No Ollama/LM Studio runs on the test machine — verified against a fake local endpoint.
- Chat history is in-memory only (last 50 messages, resets on restart).

## [1.0.0] - 2026-11-23

Smart features + v1.0 launch (Phase 7 Smart).

### Added

- **AI File Organizer** (Settings > Smart): downloads sorted into Video, Music, Documents, Archives, Programs, Images or Others — from file extension, yt-dlp metadata (category, duration) and source domain. Folder names editable; extension overrides supported.
- **Smart filenames**: strips `(Official Video)`, `[HD]`, emoji and extra spaces; user-editable template (default `{title} [{height}p]`) with a live preview in Settings and a one-click preview + revert in the Add dialog.
- **Duplicate Detection**: history check (same URL or same video + format) + destination-folder check (same name + size). The Add dialog offers Re-download / Skip / Keep both; a safety net in the queue catches races and extension adds.
- **Smart Download**: rolling speed measurement adapts aria2 connections (fast 16 / medium 8 / slow 4) and yt-dlp fragments (`-N 8/4/2`), live-retunes running aria2 downloads every ~10s, and stretches retry gaps when slow/unstable.
- **Local AI model hook** (optional, off by default): Ollama or LM Studio endpoint in Settings for downloads the rules cannot categorize — one call per download max, 5s timeout, silent fallback to rules. No bundled model.
- **fetchInfo timing**: duration logged to `dovira.log`; yt-dlp is pre-warmed at startup (the first fetch after a cold start was reported at 10s).
- README refresh (screenshots, Smart features, v1.0 limitations), CONTRIBUTING.md, Code of Conduct, issue + PR templates, this changelog.

### Changed

- Version 1.0.0 in `package.json` and the browser extension manifest.
- i18n: 41 new keys (en + bn, 368 each).

### Fixed

- `remote_id` (`<extractor>:<videoId>`) is now stored for every yt-dlp download — duplicate detection by video identity works instead of URL only.

## [0.7.0] - 2026-11-22

V22-style redesign: Mint light theme is now the default (one-time migration from dark), emerald sidebar + banner, orange Add CTA, 4-card stats row (Today / Current speed / Active / Total size), Site Grabber button in the empty state, theme toggle moved to the sidebar bottom (reachable from every view). Fixed a React #185 blank-app crash (fresh array identity in a Zustand selector) and a stale `0.6.0` version fallback in the sidebar.

## [0.6.2] - 2026-11-22

Fixed: dialog thumbnails were blocked by the Content Security Policy (`img-src 'self' data:`) — remote `https:` images are now allowed.

## [0.6.1] - 2026-11-22

Fixed: engine binaries were resolved inside `app.asar`, so every spawn failed with ENOENT and the dialog reported `code: unknown`. Also: YouTube watch URLs carrying `list=` (radio/mix) now resolve as a single video instead of hanging in a flat-playlist fetch.

## [0.6.0] - 2026-11-22

Phase 7 (site grabber + speed limiter): scan a page for downloadable files and queue the picks; global + per-download speed limits applied live (aria2 resumes apply a changed limit; yt-dlp resumes keep the original throttle — a changed limit takes effect on the next fresh download).

## [0.5.0] - 2026-11-22

Phase 6: macOS (.dmg) + Linux (AppImage/.deb) installers built by GitHub Actions, per-OS engine binaries, app auto-update via electron-updater with mandatory SHA-256 checksum verification. CI saga: aria2 zip-layout change, macOS dylib signing, Linux `autopoint` — all fixed across three runs.

## [0.4.0] - 2026-11-22

Phase 5: browser extension (Manifest V3) — right-click "Download with DOVIRA", popup, IDM-style floating button, optional intercept (off by default), token-authenticated Local API on 127.0.0.1:17530.

## [0.3.0] - 2026-11-22

Phase 4: playlist/channel, batch, clip, metadata embed, subtitles (51 manual + 166 auto languages), thumbnail-only, torrent/magnet via aria2.

## [0.2.0] - 2026-11-22

Phase 3: cookies (`--cookies-from-browser` + cookies.txt), History page, Settings completion, Scheduler, queue reorder, tray, speed graph, clipboard watch (off by default).

## [0.1.0] - 2026-11-22

Phase 2: yt-dlp engine, Video/Audio download dialog with real format list, MP3 quality choice, engine binaries (aria2 1.37.0, yt-dlp, ffmpeg 9.0.2, Deno), one-click yt-dlp update with backup + rollback. (Phase 1 — aria2 core engine, queue, SQLite, resume — and Phase 0 — the scaffold — were built 2026-11-21 and released together as v0.1.0.)

[1.0.0]: https://github.com/Khalid635/dovira/releases/tag/v1.0.0
[0.7.0]: https://github.com/Khalid635/dovira/releases/tag/v0.7.0
[0.6.2]: https://github.com/Khalid635/dovira/releases/tag/v0.6.2
[0.6.1]: https://github.com/Khalid635/dovira/releases/tag/v0.6.1
[0.6.0]: https://github.com/Khalid635/dovira/releases/tag/v0.6.0
[0.5.0]: https://github.com/Khalid635/dovira/releases/tag/v0.5.0
[0.4.0]: https://github.com/Khalid635/dovira/releases/tag/v0.4.0
[0.3.0]: https://github.com/Khalid635/dovira/releases/tag/v0.3.0
[0.2.0]: https://github.com/Khalid635/dovira/releases/tag/v0.2.0
[0.1.0]: https://github.com/Khalid635/dovira/releases/tag/v0.1.0
