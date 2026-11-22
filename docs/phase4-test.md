# DOVIRA Phase 4 — Test Report (v0.3.0)

Date: 2026-11-22. All tests ran on Khalid's laptop (DESKTOP-KBJR07L) from
SSH Session 0, using the real QueueManager / DoviraDb / SettingsManager /
YtDlpManager / Aria2Manager code bundled from the repo sources, the real
aria2 + yt-dlp binaries, and real downloads. Nothing here is mocked.

Static checks: `npm run typecheck` 0 errors (node + web), `npm run lint`
0 errors / 0 warnings, `npm run build` passes (main 108.88 kB, preload
3.20 kB, renderer JS 740.25 kB), 0 CRLF in all 17 changed files. Preload
still only requires the `electron` built-in — `@electron-toolkit/preload`
is gone. `sandbox: true` kept.

Test files (kept in the harness dir, not the repo):
`~/workspace/dovira-phase4/harness/` — `test-phase4.mjs` (driver 1),
`test-phase4b.mjs` (driver 2), `test-phase4c.mjs` (driver 3),
`make-torrent.py`, `test-headless.ps1`, `entry.ts`
(laptop copies in `D:\temp\dovira-phase4-harness\`).

Test video: Big Buck Bunny 60fps 4K,
`https://www.youtube.com/watch?v=aqz-KE-bpKQ` (635 s). Playlist:
"Mango Open Movie", `https://www.youtube.com/playlist?list=PL0BAFA2DA294B0900`
(10 entries). Subtitle video: Kurzgesagt Fermi Paradox,
`https://www.youtube.com/watch?v=sNhhvQGsMEc` (380 s). Plain file:
Node.js 24.21.0 Windows zip, 37,618,919 B (speed.hetzner.de is
unreachable from this network, as in Phase 3).

## 1. Driver 1 — 27 passed, 2 failed (both harness bugs), aborted at I1

`test-phase4.mjs`, run 2026-11-22 ~06:00 (235 s). `RESULT: 27 passed,
2 failed`, then the harness aborted at the thumbnail-only wait.

- **A. Settings:** A1 defaults; A2 update sticks.
- **B. yt-dlp args:** B1 clip args (`--download-sections *10-20`,
  `*00:01:00-` open end); B2 metadata args; B3a/b/c subtitle modes
  (embed / file / both); B4 thumbnail-only args; B5a/b archive flag
  on/off; B6 cookies-from-browser chrome + proxy preserved.
- **C. fetchInfo:** C1 playlist fetch, 10 entries, "Mango Open Movie";
  C2 BBB: isLive=false, 0 subs, 0 auto-captions, 61 formats; C4 magnet →
  name "Test File" from `dn=`; C5 `.torrent` URL → torrent
  "ubuntu.iso.torrent"; C6 plain file: Node zip size 37,618,919.
- **D. Playlist:** D0–D2, 3 of 10 downloaded, sizes 188,585 /
  255,991 / 1,604,213 B.
- **E. Batch:** E1–E3, 3 lines resolve, 3 added, all complete, Node zip
  exact 37,618,919 B.
- **F. Clip:** F0–F1, BBB 10s–20s → ffprobe duration exactly 10.
- **G. Metadata:** G0–G1, BBB audio MP3 title tag "Big Buck Bunny 60fps
  4K - Official Blender Foundation Short Film" + attached_pic stream
  true.
- **H. Subtitles:** H2 auto-subs, auto-only language 'ab' `.srt`
  written, 13,437 B.
- **I. Thumbnail-only:** I0 add queued OK. I1 ABORTED — see §2a.
- **C3 / H1 FAILED — harness bugs, not app bugs** (see §4): both
  checked for `'en'` manual subtitles, but the Fermi video has 51
  manual-subtitle languages and `'en'` is NOT one of them (English
  video, no English subs). Fixed in driver 2 by using a language that
  exists (`'de'`).

## 2. Driver 2 — 5 passed, 2 failed (both the seeder, not the app)

`test-phase4b.mjs`, run 2026-11-22 ~06:05. `RESULT: 5 passed, 2 failed`.

- **B4t** thumbnail `-o` template contains `%(ext)s` (the §2a fix).
- **C3r** Fermi fetchInfo: manual subs present (51 langs, 'en' NOT
  included), auto captions present (166 langs).
- **H1r** subtitles file mode: `fermi-subs.de.srt` exists with cues,
  10,324 B.
- **I0r / I1r** thumbnail-only: `.jpg` exists, valid JPEG magic
  (FF D8 FF), 69,265 B. The §2a fix works end to end.
- **J1r FAILED — seeder bug, not the app** (see §4): the local aria2
  seeder never actually held the file (0% — fresh control file, empty
  bitfield). K1 then cascaded: the stuck torrent row blocked the queue
  (maxConcurrent=1), so the Node zip never started.

## 3. Driver 3 — 10 passed, 0 failed

`test-phase4c.mjs`, final run 2026-11-22 ~06:36. `RESULT: 10 passed,
0 failed`.

- **J0c / J1c torrent (local seed):** magnet accepted; the app
  downloaded the seeded 1 MiB file byte-identical (SHA-256 match,
  1,048,576 B). Seeder: standalone aria2c, `--seed-time=300
  --enable-dht=true --listen-port=6999 --bt-enable-lpd=true
  --seed-ratio=0 --allow-overwrite=true --check-integrity=true`,
  magnet with `&x.pe=127.0.0.1:6999`.
- **K1a/b/c pause/resume (regression):** Node zip queued; paused at
  3,981,312 B with bytes kept; resumed to exact 37,618,919 B.
- **K2a/b History:** `historyMissing` empty while files exist;
  redownload of the completed row creates a new row.
- **K3c scheduler:** status enabled + future nextRunAt
  (`2026-11-22T00:42:00.000Z`).
- **K4a/b download archive:** archive file created with the video id
  recorded (21 bytes, `youtube dJrbw5zTh8k`); second add of the same
  video fails `already-downloaded`.

## 4. Bugs found by the Phase 4 tests — all fixed, all re-tested

### 4a. Thumbnail-only: yt-dlp refuses a fixed output name — FIXED
`buildArgs` passed `-o <stem>.jpg` for thumbnail-only. yt-dlp errors
`Fixed output name but more than one file to download` (it writes the
thumbnail as a second file). **Fix:** the `-o` value is now the row's
save-path stem + `%(ext)s`, so the produced `.jpg` lands exactly on
savePath. Repro'd by CLI first (exit 0, `bbb.jpg` 69,265 B), then
proven by I1r. (`src/main/engines/ytdlp.ts`)

### 4b. Magnet downloads stall at `[METADATA]` forever — FIXED
Two separate causes, both in the app:
1. **No peer discovery behind a home NAT.** aria2 ignores the magnet
   `x.pe` parameter (proven: x.pe-only CLI downloader, DHT+LPD off,
   timed out at 90 s with no file); DHT returns the public IP, which
   is unreachable from inside the NAT without a port-forward; and the
   app never enabled Local Peer Discovery. The app's aria2 stayed
   `conn=0, seeders=0` for 150 s against a live local seeder.
   **Fix:** `--bt-enable-lpd=true` in `Aria2Manager.start()`. After
   the fix the metadata download completed within 5 s. Verified with
   the app's own `Aria2Manager` over RPC before the queue fix landed.
2. **The queue marked the metadata download as the real one.** aria2
   first completes a ~165-byte metadata download, then starts the real
   file under a new GID (`followedBy`). `pollTick` treated the
   metadata GID's `complete` as the download finishing — the row
   would have shown "completed" with a 165-byte metadata file.
   **Fix:** when `tellStatus` reports `complete` with a non-empty
   `followedBy`, the poller switches `entry.gid` to the new GID
   (removing the metadata result best-effort) instead of completing
   the row. `Aria2Status` gained the `followedBy?: string[]` field.
   Proven by J1c (byte-identical file, not the metadata blob).
   (`src/main/engines/aria2.ts`, `src/main/queue.ts`)

### 4c. Archive skip failed as `unknown`, not `already-downloaded` — FIXED
yt-dlp writes `has already been recorded in the archive` to **stdout**,
not stderr (proven by CLI repro: exit 0, stdout holds the line, stderr
empty). The download job only retained stderr, so the queue's
exit-0 archive check could never match and the skip failed with
`yt-dlp exited 0 but no output file` / `unknown`. **Fix:**
`YtDlpDownload` now also keeps non-progress stdout lines in the job
tail. Proven by K4b. (`src/main/engines/ytdlp.ts`)

### 4d. Harness bugs (test only, not the app)
- **C3/H1** checked for `'en'` manual subs on a video that has none
  (§1). Fixed by using `'de'`.
- **Torrent seeder recipe:** aria2 does NOT verify a foreign complete
  file on load — a fresh `.aria2` control file means an empty bitfield,
  so the "seeder" sat at 0% and served nothing (runs 1–2). The working
  recipe is `--allow-overwrite=true --check-integrity=true` (plus
  `--enable-dht=true --bt-enable-lpd=true`). The seeder log showing
  `SEED(0.0) CN:0` vs `SEED(0.0) CN:1` is the tell.

## 5. Headless app launch — all 8 checks pass

`test-headless.ps1`, run 2026-11-22 ~06:41–06:42 (built app, Session 0).
From `dovira.log` for this launch only (version 0.3.0):

- `preload ran: bridge exposed to renderer`.
- `renderer mounted: typeof window.dovira = object` — bridge alive.
- `renderer mounted: fatal bridge screen shown = false`.
- `renderer mounted: home state after 3s = empty` and `after 12s =
  empty`.
- `tray: created`.
- `renderer mounted: speed graph present = false` — the probe ran;
  false is the CORRECT value here (no download active, home empty).
- Cleanup: 0 electron processes left, 0 aria2 processes left (no
  orphans).

## 6. What was NOT verified (stays Khalid's)

- **In-app visual / click checks** — the renderer cannot be inspected
  from SSH Session 0 (no DevTools/CDP; GUI apps launched from SSH never
  appear on the desktop). The new dialog UI (Single | Batch tabs,
  playlist checkbox list, clip inputs, subtitle mode select,
  thumbnail-only checkbox, torrent view), the Settings additions
  (playlist skip-downloaded switch, embed-metadata default, Clear
  download archive button), and the sidebar "Phase 4" label all need
  his eyes in the real app.
- **Chrome cookies from the browser** (DPAPI — cookies decrypt only in
  the interactive logon session, see Phase 3 report §3) and any truly
  login-walled video.
- **Real-world torrent with a public tracker** — only the local-seed
  test ran (a public torrent would also depend on the tracker's peers,
  not just the app). Magnet acceptance + local-seed download are
  proven; a real public magnet is his check if he wants it.
- **Playlist per-entry quality choice** — not built (plan §12).
