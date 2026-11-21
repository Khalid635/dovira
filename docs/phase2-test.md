# Phase 2 test results

Test video (all runs): **Big Buck Bunny 60fps 4K — Official Blender Foundation Short Film**
(Blender Foundation), https://www.youtube.com/watch?v=aqz-KE-bpKQ, duration 635 s.
Run on 2026-11-21/22 on Khalid's laptop (Windows 11, ~33 Mbps line) with the
exact args the queue builds (`--ffmpeg-location <bin> --js-runtimes deno:<deno>`).

## Engines (verified)

| Engine | Version | How verified |
| --- | --- | --- |
| aria2 | 1.37.0 | `aria2c.exe --version`, fetch script skip-check |
| yt-dlp | 2026.10.26 | `--version`, SHA-256 verified against release SHA2-256SUMS |
| ffmpeg | 9.0.2-essentials_build (gyan.dev) | `-version`; **GPL build** (`--enable-gpl` in configuration) — see THIRD_PARTY_NOTICES.md |
| ffprobe | 9.0.2 | `-version` |
| Deno | 2.9.8 | `--version`, SHA-256 verified against release `.sha256sum` (PowerShell Get-FileHash format) |

## Video 1080p MP4 — PASS

- Command: `-f 'bv*[height<=1080]+ba/b[height<=1080]' --merge-output-format mp4`
- Result: exit 0, **155,343,423 bytes**, ffprobe: video **AV1 1920×1080** @1.56 Mbps,
  audio **AAC** @386 kbps, **duration 634.624 s**.
- Formats seen for this video include 2160/1440/1080/720/480/360 — the dialog
  only offers heights the site really has.

## Audio MP3 320 kbps — PASS

- Command: `-f bestaudio -x --audio-format mp3 --audio-quality 320K`
- Result: exit 0, **25,387,343 bytes**, ffprobe: codec **mp3, 320000 bps**,
  **duration 634.624 s**.

## Info fetch — PASS

- `--dump-single-json --no-playlist` returns title, duration 635, uploader
  "Blender", and the real format list (heights 2160–27). Used by the Add
  Download dialog; sizes come from `filesize` or show as "unknown" when the
  site omits it (formats 312/617 for this video).

## Known transient: YouTube HTTP 403

YouTube returned `HTTP Error 403: Forbidden` on the video data twice during
testing, after many repeated requests to the same video from one IP. It
clears on its own (the very next run succeeded). The app maps 403 to the
`forbidden` message and the queue retries with backoff; it is YouTube
rate-limiting, not a DOVIRA bug.

## Not verified from SSH (needs Khalid's interactive session)

- Opening the Add Download dialog and picking Video/Audio in the real UI.
- Opening Settings and seeing the full form (see the Settings-fix note in
  phase2-ytdlp-resume-test.md — GUI apps launched over SSH run in Session 0,
  where the window never pumps and CDP never serves, so the renderer cannot
  be inspected remotely).
