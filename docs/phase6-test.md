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

## 7. GitHub Actions (tag v0.5.0) — runs 44979642131 and 44984348473

- Workflow file added via the GitHub web UI (Khalid's browser session —
  the PAT lacks `workflow` scope, so it cannot push workflow files) as
  **4ee1e76** ("ci: add GitHub Actions build + release workflow (Phase
  6)"). Annotated tag v0.5.0 created on 4ee1e76 and pushed. The tag push
  triggered run **44979642131**
  (https://github.com/Khalid635/dovira/actions/runs/44979642131):
  **all three build jobs failed at "Fetch engine binaries"**; publish
  skipped; no v0.5.0 release exists.
- Win job log: `Expected .../resources/bin/win/aria2-1.37.0-win-64bit-build1/aria2c.exe
  after extraction — layout changed upstream?` — the script assumed a
  fixed extracted layout. Mac/Linux failed at the same step (same
  aria2 issue, plus two more latent causes found while fixing — §10).
- Fix commit **5d73268** ("fix: fetch-binaries aria2 layout
  (recursive search, mac ffprobe, n-prefixed ffmpeg versions)"):
  `findInTree()` searches the extracted tree recursively (zipSubdir is
  only a hint); extraction goes to a temp dir (`.extract-<name>`,
  cleaned up); failures print the extracted tree; downloads get a 120s
  stall timeout + an empty-file check; macOS ffprobe is its own
  evermeet spec (`ffmpeg-9.1.zip` contains ffmpeg only); version
  regexes accept the `n9.0.2`-style prefix BtbN prints, and
  `getFfmpegVersion()` in `src/main/engines/versions.ts` parses it too.
  Laptop verification of the fix is in §10.
- Tag v0.5.0 MOVED to the fix commit: remote tag deleted, annotated tag
  re-created on **5d73268** (tag object `c40b6522c7859682698bf31bb1c487510b6b9e30`,
  `refs/tags/v0.5.0^{} = 5d73268b0bb0c5ca44ae838cbeef45a31b14573c`),
  pushed. This triggered run **44984348473**
  (https://github.com/Khalid635/dovira/actions/runs/44984348473),
  2026-11-22 ~04:16–04:24 UTC — **FAILED again, differently**:
  - **build win** (job 137091536594): "Fetch engine binaries" failed
    in ~4 s: `Downloading aria2 1.37.0...` then
    `aria2: aria2c.exe not found after extraction. Extracted tree:
    (empty)`. The download returned HTTP 200 and a non-empty file, and
    `Expand-Archive` exited 0 — yet the extract dir is empty. The
    first run's win error proves the same zip DID extract on the runner
    (files existed, wrong path), so this is environmental/transient,
    not the layout bug: candidates are Windows Defender quarantining
    aria2c.exe mid-extraction, or a corrupt/truncated download that
    Expand-Archive silently accepted. The script does not log the zip
    size or magic bytes, so the log cannot distinguish them.
  - **build mac** (job 137091536733): "Fetch engine binaries"
    **SUCCEEDED** (the fix works on macOS — evermeet flat
    ffmpeg/ffprobe + recursive search). "Build aria2 from source"
    outcome **failure** (inner error not isolated from the 12,625-line
    log; masked by `continue-on-error: true`). "Record aria2 status"
    then **FAILED**: `dist/aria2-status-mac.txt: No such file or
    directory` — `dist/` does not exist yet at that step (see below).
  - **build linux** (job 137091536763): "Fetch engine binaries"
    **SUCCEEDED** (the fix works on Linux — BtbN `n9.0.2` regex).
    "Build aria2 from source" failed: `autoreconf: error: autopoint
    failed with exit status: 2` (the ubuntu runner lacks `autopoint`;
    masked by `continue-on-error: true`, outcome `failure`).
    "Record aria2 status" then **FAILED**:
    `dist/aria2-status-linux.txt: No such file or directory` — same
    missing-`dist/` cause as mac.
  - **create pre-release**: skipped. **NO v0.5.0 release exists.**
- Root cause of the mac/linux failures (workflow bug, not the app):
  the "Record aria2 status" step runs BEFORE `npm run build` and
  before electron-builder, so `dist/` does not exist yet;
  `echo ... > dist/aria2-status-<platform>.txt` fails. Fix for a
  third attempt: `mkdir -p dist` in that step (or move it after
  "Build installer").
- What a third attempt also needs: (a) win fetch diagnostics — log
  the downloaded zip size + first magic bytes, log the extracted tree
  count after Expand-Archive, and fall back to `tar -xf` (ships with
  Windows Server 2025) if Expand-Archive yields an empty tree;
  (b) install `autopoint` (gettext) on the ubuntu runner before the
  aria2 source build (or accept `aria2=failure` there — torrents then
  need aria2, plain downloads fall back to yt-dlp, per the release
  notes); (c) isolate the mac aria2-build failure from the mac log.
- The EXPECTED release assets once a run goes green
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

## 10. Fix verification on the laptop (commit 5d73268, 2026-11-22 ~09:44–10:15)

- Win end-to-end `npm run fetch-binaries -- --platform win`: the first
  run installed aria2 1.37.0, yt-dlp 2026.10.26, ffmpeg/ffprobe 9.0.2
  (gyan.dev is very slow/bursty from this network — the 109 MB ffmpeg
  zip took ~30 min; the 120s stall timeout never fired because data
  kept trickling). The run was cut short by the harness's own 600 s
  wrapper timeout while deno was downloading; the orphaned node
  process finished the job (deno 2.9.8 installed). Direct version
  checks afterwards, all rc 0: aria2 1.37.0, yt-dlp 2026.10.26,
  ffmpeg 9.0.2, ffprobe 9.0.2, deno 2.9.8. A clean re-run exits 0 in
  ~13 s with all five "already present - skipping" + "All binaries
  ready."
- Recursive-search test with the REAL `findInTree`/`listTree` code
  sliced out of the script, against real zips: aria2 zip extracted
  with its top folder RENAMED to `some-new-folder-name-v2` → aria2c.exe
  still found; evermeet ffmpeg/ffprobe zips extracted flat → both
  found; missing file → null. Proves the fix is layout-independent.
- Static checks on the fix commit: `npm run typecheck` **0 errors**;
  `npm run lint` **0 errors** (7 pre-existing prettier warnings);
  `npm run build` **passes**; `node --check` on the script **0**;
  **0 CRLF** in both changed files; preload imports only `electron`;
  `sandbox: true` kept (`src/main/index.ts:68`).
- Mac/Linux fetch logic verified as far as Windows allows: the
  mac/linux download + layout + SHA checks from §6 still hold, and the
  CI runs above prove the mac/linux fetch itself (both green in run
  44984348473). No claim is made that a mac/linux binary runs on
  Windows.

## 11. Attempt 3 fixes (commit 91c76c6, 2026-11-22 ~10:35-11:00)

Code fixes for run 44984348473, pushed to main as **91c76c6**
("fix: win fetch diagnostics + tar fallback, mac dylib bundling,
linux gettext (Phase 6 attempt 3)"). The tag was NOT moved for this
commit — the parent moves v0.5.0 after the workflow edit below.

### Mac aria2-build root cause (from the mac job log, 12,625 lines)

The build itself succeeded (configure + make, `CXXLD aria2c`), but
the script's sanitized-environment gate failed with exit 3:
`ERROR: aria2c does not run with a sanitized environment (missing
bundled dylib?)`. Two defects in `scripts/build-aria2.sh`, either one
alone enough to fail the gate:

1. **Dylib-to-dylib references pointed at `lib/lib/`.** The bundled
   libs live in `resources/bin/mac/lib/`; the transitive-deps loop
   rewrote references inside them to `@loader_path/lib/<name>`, which
   resolves correctly from the main binary (in `mac/`) but from inside
   `lib/` resolves to `lib/lib/<name>` — nonexistent. The log proves
   such a reference exists: the 6 bundled dylibs are libxml2.16,
   libsqlite3, libssh2.1, libcares.2, libcrypto.4, libssl.4, and
   libssl necessarily links libcrypto. The `otool` gate could not catch
   it (no `/opt/homebrew/` string remains after the rewrite).
   Fix: references inside bundled dylibs are now `@loader_path/<name>`;
   references in the main binary stay `@loader_path/lib/<name>`.
2. **Bundled dylibs were never re-signed.** `install_name_tool -id`
   invalidated their Homebrew signatures (the log shows 6 warnings,
   one per dylib: "changes being made to the file will invalidate the
   code signature"), and arm64 dyld refuses to load a dylib whose
   signature is invalid. Only the main binary was signed. Fix: every
   bundled dylib is now ad-hoc signed after all `install_name_tool`
   changes, before the binary is signed.

Diagnostics added so the next failure is diagnosable from the log
alone: a gate that rejects any `@loader_path/lib/` dependency inside
a bundled dylib (each dylib's own LC_ID_DYLIB is `@loader_path/lib/`
by design, so the check skips header + id lines); an `otool -L`
dump before the gate; and the sanitized run's stdout+stderr is now
captured and printed on failure (the old gate swallowed stderr with
`2>/dev/null`, which is why run 44984348473 showed no dyld error).

### Windows fetch diagnostics + tar fallback (`scripts/fetch-binaries.cjs`)

- `installZip` now logs the downloaded zip's size + first magic bytes
  (`aria2: downloaded 2475379 bytes, magic 504b0304`) and the
  extracted file count right after `Expand-Archive`.
- A non-`PK` magic fails fast (the "zip" is an error page, not an
  archive).
- An empty tree on Windows is retried with `tar -xf` (ships on
  Windows Server 2025) before failing; the failure message names zip
  size, magic bytes, and both counts, so the next diagnosis needs no
  guessing. (If the zip is valid and both extractors yield 0 files,
  antivirus quarantine — e.g. Defender removing aria2c.exe on write —
  is the remaining suspect.)
- Laptop verification: `tar -xf` on the real aria2 zip extracts all 8
  files and `aria2c.exe --version` prints 1.37.0. Targeted re-run
  (aria2c.exe deleted, rest present): new log lines appear,
  aria2 1.37.0 reinstalled, yt-dlp/ffmpeg/deno skipped as present,
  "All binaries ready."

### Linux gettext — fixed in the script, NO workflow change needed

`scripts/build-aria2.sh` already owns the `apt-get install` step, so
`gettext` was added to that list (it provides `autopoint`, which
`autoreconf -i` needs). The ubuntu runner failure
(`Can't exec "autopoint"`, `autoreconf: error: autopoint failed with
exit status: 2`, linux job log lines 251-252) is fixed by this commit
alone — no workflow edit is required for Linux.

### Static checks on 91c76c6

- `npm run typecheck`: **0 errors**. `npm run lint`: **0 errors**
  (7 pre-existing prettier warnings, same set as section 10 — none in
  the changed files). `npm run build`: **passes**. `node --check` on
  the script: **0**. `bash -n` on `build-aria2.sh`: **OK**. **0 CRLF**
  in both changed files. Preload imports only `electron`;
  `sandbox: true` kept.

### Still open — parent's steps (NOT done here)

- **Workflow edit (web UI — the PAT has no `workflow` scope):**
  `.github/workflows/build.yml`, step "Record aria2 status" — it runs
  before `npm run build`, so `dist/` does not exist yet and
  `echo ... > dist/aria2-status-<platform>.txt` fails on all three
  runners. Exact diff (one line):
  ```diff
       - name: Record aria2 status
         shell: bash
  -        run: echo "aria2=${{ steps.aria2.outcome }}" > "dist/aria2-status-${{ matrix.platform }}.txt"
  +        run: mkdir -p dist && echo "aria2=${{ steps.aria2.outcome }}" > "dist/aria2-status-${{ matrix.platform }}.txt"
  ```
  (Moving the step after "Build installer" would also work, but
  `mkdir -p dist` keeps the step where the publish job's artifact
  upload expects the file.)
- **Move tag v0.5.0** to 91c76c6 and push it (triggers a fresh run).
- **Watch the new run** and verify the v0.5.0 pre-release assets
  (section 7 list). The mac aria2 build and the win fetch fallback
  cannot be proven on the laptop — the CI run is the proof.
