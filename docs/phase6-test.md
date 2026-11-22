# DOVIRA Phase 6 — Test Report (v0.5.0)

Mac/Linux installers + app auto-update. Run 2026-11-22 on the laptop
(DESKTOP-KBJR07L) unless stated otherwise. Harness:
`~/workspace/dovira-phase6-harness/` (VM copy) /
`D:\temp\dovira-phase6-harness\` (laptop copy) — `test-phase6.mjs`
(driver), `test-headless.ps1` (headless launch), `entry.ts` +
`bundle.mjs` (esbuild bundle of the real sources).

## 1. Static checks (laptop, 2026-11-22 ~08:02–08:16)

- `npm run typecheck` (node + web): **0 errors**.
- `npm run lint`: **0 errors / 0 warnings**.
- `npm run build` (extension + typecheck + electron-vite): **passes**.
- i18n parity: **281 keys en + 281 keys bn, 0 missing either way**,
  both files sorted; 17 new `settings.appUpdate*` / `downloadUpdate` /
  `navAppUpdate` / `restartAndInstall` keys.
- Line endings: **0 CRLF** in every changed file (verified on the
  laptop after sync).
- Workflow YAML (`.github/workflows/build.yml`): parsed OK (PyYAML) —
  triggers push main / tags `v*` / PR main; jobs ci / build (3-OS
  matrix) / publish (needs build).
- electron-updater **6.8.11** installed; `update-downloaded` event
  carries `downloadedFile` (verified from the installed `.d.ts`).

## 2. Functional driver — aria2 = null (the macOS/Linux configuration)

`D:\temp\dovira-phase6-harness\test-phase6.mjs`, run twice
(2026-11-22 ~08:09 and ~08:11). **RESULT: 23 passed, 0 failed,
0 skipped** (both runs identical).

Checksum module (pure, `src/main/checksum.ts`):

- A1 sha256File("abc") = `ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad`
  (the known SHA-256 test vector).
- A2 parseChecksums reads GNU + `*` binary-marker lines, skips blanks.
- A3 parseChecksums value for abc.txt correct.
- A4 verifyFileAgainstChecksums: real Node zip + its real hash → ok.
- A5 tampered file (1 byte appended) → ok:false, expected
  `158f7685b44d…`, actual `105599f611c8…`.
- A6 unlisted file → ok:false, expected undefined.

yt-dlp fallback (QueueManager with `aria2 = null` — no Aria2Manager
at all):

- B1 queue.add(Node zip) ok.
- B2 row keeps engine label `aria2` (routing is decided at start time).
- B3 Node zip completed through the yt-dlp fallback —
  done=37,618,919 total=37,618,919.
- B4 Node zip exact size **37,618,919 B**.
- B5 **no aria2c.exe process** exists after the fallback download.
- B6 second Node zip add ok.
- B7 pause() returns true mid-download (paused at .part > 256 KB).
- B8 status `paused`, the `.part` file survives.
- B9 resume() returns true.
- B10 second download completes at the exact size after pause/resume —
  size=37,618,919.
- B11 queue.add(magnet) accepted the row.
- B12 magnet without aria2 fails with `engine-missing` (yt-dlp cannot
  do torrents — honest failure, not a silent hang).
- C1 fetchInfo(Big Buck Bunny) returns a title + formats.
- C2 addWithOptions(BBB audio) ok.
- C3 BBB audio completes (MP3 320 kbps, **25,387,343 B** — the same
  size as the Phase 2 test).
- D1 checkLatest(ffmpeg) → `9.0.2` (gyan.dev scrape, Windows).
- D2 checkLatest(yt-dlp) → `2026.10.26` (GitHub API).

## 3. Headless app launch (built app, Session 0)

`test-headless.ps1`, run 2026-11-22 ~08:12–08:13 (18 s wait), twice.

- `typeof window.dovira = object` — bridge alive.
- Fatal bridge screen shown = **false**.
- Home state after 3 s = **empty**, after 12 s = **empty** (settled,
  not stuck).
- Preload ran: bridge exposed.
- Local API listening on 127.0.0.1:17530.
- Updater startup check ran: `[updater] checking for updates…` at
  ~10 s after launch.
- Updater result: **error — `Cannot find latest.yml in the latest
  release artifacts (https://github.com/Khalid635/dovira/releases/download/v0.4.0/latest.yml): HttpError: 404`**.
  This is EXPECTED and proves the check path works end to end: v0.4.0
  was created via the API without a `latest.yml`, so there is nothing
  for the updater to read yet. The first release that ships one is
  v0.5.0 (created by the CI workflow) — after that the check returns
  not-available / available normally. The app itself is unaffected
  (the error is only the Settings > App updates state).
- Electron processes left: **0**. aria2 processes left: **0**.

## 4. Windows installer

- `npm run build:win` → `dovira-0.5.0-setup.exe`, **237,336,238 B**
  (first build 237,334,981 B; the final build from the tagged state is
  1,257 B larger — the `desktopName` field added to `package.json`
  for the Linux fix in §5. v0.4.0 was 237,005,734 B; the +330,504 B
  vs v0.4.0 is electron-updater.)
  `latest.yml` generated alongside (version 0.5.0, sha512 + size +
  releaseDate 2026-11-22T02:16:48Z). The local build did NOT publish
  anything (no publish lines in the build log; electron-builder only
  publishes on a tag push, and HEAD is untagged for 0.5.0).
- Silent install (`/S`) on the laptop: OK. Installed
  `dovira.exe` = **246,582,272 B, FileVersion 0.5.0**.
- Installed app launched (Session 0, 20 s): version 0.5.0 in the log,
  bridge object, fatal screen false, home state empty at 3 s and
  12 s, Local API listening, updater check ran (same expected 404 as
  §3 — the PACKAGED app needs no dev flag for the check to run).
  Electron processes left: **0**. aria2 processes left: **0**.
- Phase 2 smoke checks (plain file + BBB video/audio) are covered by
  the driver in §2, which runs the same bundled code; the installed
  app was not driven through a real download (no UI in Session 0).

## 5. Linux cross-build attempt (from Windows)

**Result: Linux installers CANNOT be built on a Windows host with
this setup — the real Linux build is the CI ubuntu runner (§7).**
Both failures are host-tooling limits, not app bugs:

- `electron-builder --linux` (AppImage first): packaging + Electron
  extraction OK, then `failed to build AppImage` — electron-builder
  picked the `darwin/mksquashfs` binary from its AppImage tool cache
  and `spawn ... darwin\mksquashfs ENOENT`. No `.AppImage` produced.
- `electron-builder --linux deb` (deb only): packaging OK, then
  `fpm process failed ENOENT` — the .deb target needs `fpm` (a Ruby
  gem) which is not installed on Windows. No `.deb` produced.
- Side fix from the AppImage attempt: electron-builder warned
  `desktopName is not set in package.json` (Linux window
  association). Fixed with top-level `"desktopName": "dovira"` in
  `package.json` + `linux.syncDesktopName: true` in
  `electron-builder.yml` — the warning is gone in the deb attempt.
  (First try put `desktopName` at the yml top level; electron-builder
  26.18.0 rejected it as an unknown property — it belongs in
  `package.json`, not the builder config.)
- No Linux artifact exists from the laptop; none was claimed. The
  ubuntu CI runner builds AppImage + deb on tag push (§7).

## 6. fetch-binaries cross-platform probes (laptop, Windows host)

macOS/Linux binaries cannot RUN on Windows, so these probes verify
platform selection + URLs + checksums only; the real fetch runs on
the CI runners.

- `--platform mac` (2026-11-22 ~08:20): `yt-dlp_macos` downloaded,
  **37,466,304 B** (exact published size), SHA-256 verified against
  `SHA2-256SUMS` (no mismatch error). Then the version check failed
  with `spawn ... yt-dlp_macos ENOENT` — expected: a macOS binary
  cannot execute on Windows. Platform selection + URL + checksum
  verification all work.
- `--platform linux` (2026-11-22 ~08:22): `yt-dlp_linux` downloaded,
  **41,166,968 B** (exact published size), SHA-256 verified, then the
  version check failed with ENOENT — same expected reason.
- The ffmpeg (evermeet zip / BtbN tar.xz) and Deno steps were NOT
  reached on the Windows host (the script stops at the first version
  check it cannot run). Their URLs were verified live before
  implementation (evermeet 9.1 zip 26,555,632 B; BtbN n9.0 tar.xz
  154,009,712 B; Deno .sha256sum files exist for both platforms); the
  full mac/linux fetch runs on the CI runners (§7).
- `resources/bin/mac` and `resources/bin/linux` were removed after
  the probes (git-ignored; they must not leak into any installer).

## 7. GitHub Actions (tag v0.5.0)

- **BLOCKED — the push token lacks `workflow` scope.** The first
  push (commit b7011a2, which included `.github/workflows/build.yml`)
  was rejected by GitHub: "refusing to allow a Personal Access Token
  to create or update workflow `.github/workflows/build.yml` without
  `workflow` scope". The PAT (`muse-mcp-vscode`, classic, repo +
  read:user) cannot create workflow files. Nothing was pushed by
  that attempt; the remote URL was reset to plain https.
- What was done instead: the 26 non-workflow files were recommitted
  and pushed as **43a654dce999a38f0ea04465c24eddecd12c04c6** (main,
  4e0b930..43a654d). The local tag v0.5.0 was deleted — it pointed at
  the workflow-inclusive commit. The workflow file remains in the
  laptop repo at `.github/workflows/build.yml` (untracked) — it is
  NOT on the remote.
- To finish: add `.github/workflows/build.yml` via the GitHub web UI
  (Khalid's browser session — the web UI is not subject to the PAT
  scope rule), then re-create the annotated tag v0.5.0 on the
  resulting HEAD and push the tag. The tag push triggers the
  workflow: CI + 3-OS matrix build + release creation.
- Until then: NO Actions runs exist for v0.5.0 and NO v0.5.0 release
  exists. The EXPECTED release assets once the workflow runs
  (https://github.com/Khalid635/dovira/releases/tag/v0.5.0):
  `dovira-0.5.0-setup.exe`, `dovira-0.5.0.dmg`,
  `dovira-0.5.0.AppImage`, `dovira_0.5.0_amd64.deb`, `latest.yml`,
  `latest-mac.yml`, `latest-linux.yml`, `checksums.txt`; pre-release
  flag true.
- aria2 bundled per OS (from the release notes): Windows bundled;
  macOS/Linux TBD (CI builds aria2 from source in the workflow).

## 8. What was NOT tested here — Khalid's / real-machine checks

- Real Mac: install the .dmg, Gatekeeper right-click > Open, run a
  plain-file download, a YouTube download, a torrent (if aria2 was
  bundled) — and confirm the app actually launches on Apple Silicon
  (Rosetta 2) and Intel.
- Real Linux: install the AppImage/.deb, same download smoke checks.
- Real auto-update: on v0.5.0, Settings > App updates > Check for
  updates against the published v0.5.0 release (should say
  up-to-date); after a v0.5.1 release, the full download → checksum
  verify → restart-and-install flow.
- In-app visual check of Settings > App updates (new section) and the
  extension pairing (unchanged from v0.4.0, but the Settings page
  changed around it).

## 9. NOT built / deferred

- macOS notarization (needs a paid Apple Developer account, ~$99/yr
  — not agreed). The dmg is unsigned; the README documents the
  Gatekeeper workaround.
- Windows code signing / SignPath submission — draft only, in
  `docs/signpath-application.md`. NOT submitted; Khalid's decision.
- Live-stream recording, per-entry playlist quality, channel
  subscribe (same as v0.4.0 — never in scope).
