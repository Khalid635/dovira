# DOVIRA Phase 3 — Test Report (v0.2.0)

Date: 2026-11-22. All tests ran on Khalid's laptop (DESKTOP-KBJR07L) from
SSH Session 0, using the real QueueManager / DoviraDb / SettingsManager /
YtDlpManager / Aria2Manager code bundled from the repo sources, the real
aria2 + yt-dlp binaries, and real downloads. Nothing here is mocked except
the `electron` module itself (shimmed in the harness bundle) and the
clipboard watcher (its `looksLikeDownloadUrl` predicate is the real code).

Static checks: `npm run typecheck` 0 errors, `npm run lint` 0 errors /
0 warnings, `npm run build` passes (main 96.26 kB, preload 2.91 kB,
renderer JS 706.35 kB), 0 CRLF in all changed files. Preload still only
requires the `electron` built-in — `@electron-toolkit/preload` is gone.

Test files (kept in the harness dir, not the repo):
`~/workspace/dovira-phase3/harness/` — `test-phase3.mjs` (main driver),
`test-scheduler.mjs`, `test-scheduler-repro.mjs`, `test-cookies.mjs`,
`test-headless.ps1`, `set-clipboard-watch.mjs`, `entry.ts`,
`electron-shim.mjs` (laptop copies in `D:\temp\dovira-phase3-harness\`).

## 1. Main driver — 57 passed, 0 failed

`test-phase3.mjs`, final run 2026-11-22 ~02:47 (after the two fixes below).
`RESULT: 57 passed, 0 failed`.

- **A. Migration (fresh DB):** A1 user_version is 3; A2 `sort_order` column exists.
- **B. Defaults:** B1 clipboardWatch OFF; B2 cookieBrowser none; B3 cookiesFile
  null; B4 scheduler off, 02:00, action none; B5 proxy empty, launch/tray off;
  B6 lastSchedulerRun null.
- **C. Settings validation (invalid values keep the previous one):** C1 invalid
  proxyUrl kept; C2 valid proxyUrl applied; C3 invalid schedulerTime kept;
  C4 valid schedulerTime applied; C5 invalid cookieBrowser kept; C6 valid
  cookieBrowser applied; C7/C8 autoRetry clamps to 10 / 0.
- **D. yt-dlp args:** D1 `--cookies-from-browser chrome` + `--proxy
  http://127.0.0.1:8080` present; D2 proxy flag present; D3 cookies.txt used
  only when browser is none; D4 no cookie/proxy flags when both off.
- **E. Speed graph + clipboard predicate:** E1 empty samples → []; E2 single
  sample → flat line; E3 `[0,100,50]` → y 36/0/18 (peak touches top, zero
  touches bottom); E4 polyline string well-formed; E5–E10 clipboard predicate
  6/6 (file URL yes, YouTube watch yes, bare homepage no, own repo page no,
  plain text no, ftp no).
- **F. Queue + reorder + resume (real downloads, maxConcurrent=1):**
  F1 node zip added (37,618,919 B total); A paused at doneBytes 2,686,976.
  F2 B/C/D stayed queued behind A. **F2b all four save paths distinct**
  (`node-v24.21.0-win-x64.zip`, `python-3.12.0-amd64.exe`,
  `node-v24.21.0-win-x64 (1).zip`, `node-v24.21.0-win-x64 (2).zip`) — the
  collision regression check. F3 moveToTop put D first; F4 reorder gave
  D,C,B; F5 A paused with bytes kept (doneBytes 10,158,080); F6 pump started
  D first after pausing A; F7 D completed, exact 37,618,919 B; F8 pump started
  C second; F9 C cancelled; F10 B (python exe) completed, exact 26,507,904 B;
  F11 resume kept doneBytes (10,158,080 ≥ paused 2,686,976); F12 A completed,
  exact 37,618,919 B.
- **G. History:** G1 historyMissing empty while files exist ([]); G2 deleting
  B's file lists only B (`[0bb691c8]`); G3 redownload of completed B creates a
  new row; G4 same URL; G5 redownload of completed A creates a new row;
  G6 no overwrite — new filename `node-v24.21.0-win-x64 (3).zip`; G7 F paused
  for the clear test; G8 clearHistory removed exactly the finished rows
  (removed=6, finished=6); G9 paused row kept; G10 files stay on disk after
  clear; G11 no finished rows left in DB.
- **H. Real-DB migration (copy of
  `C:\Users\Khalid\AppData\Roaming\DOVIRA\dovira.db`):** H1 user_version 3;
  H2 row count preserved (0 → 0 — the real DB had no rows yet); H3 all rows
  got a sort_order (unset=0).

Note: the plan's §10 suggested the 100 MB Phase 1 test file
(speed.hetzner.de) — that host is unreachable from this network
(curl 000, fast fail; Google/YouTube return 200), so the real downloads
above use the Node.js 24.21.0 Windows zip (37,618,919 B) and the Python
3.12.0 amd64 installer (26,507,904 B), both with `accept-ranges: bytes`
and exact-size completion checks.

## 2. Bugs found by the Phase 3 tests — both fixed, both re-tested

### 2a. Save-path collision (pre-existing, from Phase 1) — FIXED
`resolveUniquePath` (src/main/util/filename.ts) only checked whether the
file exists **on disk**. Two queued downloads of the same base filename got
the SAME save path when the first file hadn't been created yet: in the
first harness run C and D both resolved to
`node-v24.21.0-win-x64 (1).zip` (no `(2).zip` ever existed); D completed
into `(1).zip`, then cancelling C deleted D's finished file — G1 reported
both C and D missing. **Fix:** `resolveUniquePath` takes an optional
`isTaken` predicate; the queue passes its in-use save paths
(case-insensitive), so a path is free only if it is free on disk AND not
claimed by any download in the queue. Regression check F2b proves all four
paths distinct. Re-run: 57/57.

### 2b. `historyMissing` counted cancelled rows — FIXED
`historyMissing` included `cancelled` rows, but `cancel()` deliberately
deletes the partial file — so every cancelled row would permanently show
the "File missing" badge (noise, not information). **Fix:** it now covers
only `completed` + `failed` rows — the only ones that ever had a file
worth losing. G1/G2 confirm (G1 empty, G2 lists only the deleted B).

### 2c. Harness bug (test only, not the app) — FIXED
G10 read `queue.get(idA).savePath` AFTER `clearHistory()` had removed A
from the in-memory map (`TypeError: Cannot read properties of undefined`).
Fixed by capturing the paths before clearing.

## 3. Cookies — CLI test 2 passed, 1 limited

`test-cookies.mjs` (yt-dlp direct, exact args the app builds):
- K2 `--cookies <file>` (cookies.txt): exit 0, title "Shudhu Tomake (Lyrics)
  Song | FRANKLIN | শুধু তোমাকে | Soft Song Lyrics |".
- K3 baseline (no cookies): exit 0, same title.
- K1 `--cookies-from-browser chrome`: **LIMITED — flag accepted, but DPAPI
  decryption fails from SSH Session 0** ("Failed to decrypt with DPAPI",
  yt-dlp issue 10927; Chrome cookies are encrypted to the interactive
  logon session). The in-app Chrome-cookie check stays Khalid's
  desktop-session check. The flag itself reaches yt-dlp (D1 proves the
  arg is built).

## 4. Scheduler — 10 passed, 0 failed

`test-scheduler.mjs` (`DOVIRA_SCHEDULER_DRY_RUN=1` — the shutdown/sleep
action is only ever LOGGED, never executed; the laptop was never shut
down or slept in any test). Final run 2026-11-22 ~03:11–03:16:
`RESULT: 10 passed, 0 failed`.
- S1 getStatus reports enabled + future nextRunAt.
- S2 python exe download paused before the fire time.
- S3 scheduler fired at the set time (02:49, 02:58, 03:05 in runs 1–3;
  03:11 in the final run).
- S4 scheduler resumed the paused download (1 resumed).
- S5 countdown started at 60s after the queue went idle.
- S6 Cancel logs "countdown cancelled by user" + ends the countdown.
- S7 no execute line after cancel.
- S8 scheduler fired a second time after re-arming.
- S10 lastSchedulerRun recorded for today (2026-11-22).
- **S9 (countdown runs to zero → dry-run execute line): PASS in the final
  run** — dry-run line "scheduler: dry-run — would execute shutdown now"
  logged at 21:16:18 UTC. It false-failed in runs 1–3 — a harness bug, not
  an app bug. Root cause, proven by the run-3 timestamps: `logLines` was
  never cleared, so phase 2's `waitForLog(logLines, 'scheduler: fired')`
  matched phase 1's stale fire line instantly, starting the 180 s dry-run
  wait ~2.5 min early — it expired 6 s into the countdown (events 60→54 s,
  one per second, heartbeat every 5 s proving the event loop was alive
  the whole time). The scheduler itself was ticking perfectly. Fixed by
  clearing `logLines` at the start of phase 2; the re-run passed 10/10.
- **Isolated repro `test-scheduler-repro.mjs`: PASS.** Stub queue, real
  SchedulerManager: fire → resume → complete → countdown ticked 60→1 with
  no missed tick, dry-run line logged at t=62.5 s ("scheduler: dry-run —
  would execute shutdown now"), exit 0. (This repro is what proved the
  scheduler logic while the S9 harness bug was being chased.)

## 5. Headless app launch — all 8 checks pass

`test-headless.ps1`, run 2026-11-22 ~03:16–03:17 (built app, Session 0;
clipboardWatch toggled on in the real DB for the test, reset to false
afterwards). From `dovira.log` for this launch only:

- `renderer mounted: typeof window.dovira = object` — bridge alive.
- `renderer mounted: fatal bridge screen shown = false`.
- `renderer mounted: home state after 3s = empty` and `after 12s = empty`.
- `tray: created` (the tray was created even headless).
- `clipboard: watch started`, then `clipboard: link detected —
  https://nodejs.org/dist/v24.21.0/node-v24.21.0-win-x64.zip` ~2.5 s after
  the test script set the clipboard — the watcher + detection path works
  end to end in the real app.
- `preload ran: bridge exposed to renderer`.
- `renderer mounted: speed graph present = false` — the probe ran; false
  is the CORRECT value here (no download active, home empty, so no
  expanded card and no graph). The graph math itself is proven by E1–E4;
  the SVG rendering with live samples during a real download stays
  Khalid's visual check.
- Cleanup: 0 electron processes left, 0 aria2 processes left (no orphans).

## 6. What was NOT verified (stays Khalid's)

- **In-app visual / click checks** — the renderer cannot be inspected from
  SSH Session 0 (no DevTools/CDP; GUI apps launched from SSH never appear
  on the desktop). History page rendering, Settings two-pane layout,
  scheduler countdown modal, toast Add action, drag-and-drop reorder,
  speed-graph SVG in an expanded card, tray menu clicks, close-to-tray —
  all need his eyes in the real app.
- **Chrome cookies from the browser** (DPAPI, see §3 K1) and any truly
  login-walled video (needs his own browser session).
- **Real shutdown / sleep execution** — by design; only the dry-run log
  line is verified. The real shutdown test is his call, only with his
  explicit yes.
- **The speed-graph DOM probe** the plan asked for (a `querySelector`
  check inside the renderer) — impossible from Session 0; the headless
  test checks the main-side log probe instead.
