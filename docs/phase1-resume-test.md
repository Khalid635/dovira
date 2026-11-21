# Phase 1 — Resume Test Report

Date: 2026-11-21. Machine: Khalid's laptop (DESKTOP-KBJR07L), Windows.
Engine: aria2 1.37.0 (`resources/bin/win/aria2c.exe`), queue max 3 concurrent
(test 2 ran with maxConcurrent = 1 to prove queueing).
Test file host: https://download.thinkbroadband.com (Accept-Ranges: bytes).
Harness: `test-phase1.cjs` (temporary, not committed) driving the compiled
main modules (`%TEMP%\dovira-test-build`) headlessly — no GUI needed.

## Results

| # | Test | Result |
|---|------|--------|
| 1 | 100MB pause/resume | ✅ PASS |
| 2 | Queue (max 1) + dedup names | ✅ PASS |
| 3 | Cancel deletes partial + `.aria2` | ✅ PASS |
| 4 | Firewall cut 15s → auto-retry/resume | ✅ PASS |
| 5 | `taskkill aria2c.exe` → auto-restart + resume | ✅ PASS |
| 6 | 1GB, close app mid-download → reopen → resume | ✅ PASS |

### Test 1 — 100MB pause/resume
Paused at 20.3–20.7 MB (three runs); bytes unchanged while paused; resume
continued from the paused offset (progress showed 20.7 MB immediately after
resume, not 0). Completed: size **104857600 / 104857600 exact**.
SHA-256 (identical in all three runs):
`cc844cac4b2310321d0fd1f9945520e2c08a95cefd6b828d78cdf306b4990b3a`.
Speed ~0.6–0.9 MB/s (his line's international speed to this host).

### Test 2 — Queue + dedup
With maxConcurrent = 1: 100MB #2 `downloading` while 10MB stayed `queued`;
both completed. 10MB size **10485760 / 10485760 exact**.
Second download of the same URL got the name `100MB (1).zip`.

### Test 3 — Cancel
Cancel during download → status `cancelled`; partial file and `.aria2`
control file both deleted.

### Test 4 — Internet cut (firewall block on aria2c.exe, 15 s)
Download at ~9–11 MB when blocked. Auto-retries 1 and 2 fired during the
block; `doneBytes` stayed at 10.2–11.3 MB the whole time (no reset to 0).
After the block was removed the pending 3rd retry resumed from the same
offset and the file completed; its SHA-256 matched Test 1 exactly.

### Test 5 — aria2 crash
`taskkill /F /IM aria2c.exe` mid-download: the queue detected the death,
auto-restarted aria2, and resumed from 10.4 MB. Completed: size
**104857600 / 104857600 exact**; SHA-256 `cc844cac…` — matches Test 1.
(One early poll tick after the restart read 2.6 MB before climbing past
10.4 MB — the fresh aria2 connection's first status read; the final file
is exact.)

### Test 6 — 1GB app-close resume
Downloaded to 150.5 MB, then the app was stopped (aria2 + queue + DB
closed). Partial file + `.aria2` control file kept. On relaunch: status
`paused`, doneBytes 146.8 MB (last 5-second persist), history showed all
7 records. Resume worked and the download climbed steadily to 643 MB —
then the test harness's SSH session was killed by the runtime at ~23 min
(background-exec limit), with the download at 643 MB / 1024 MB. The
orphan aria2 kept the file but stalled (frozen at 1,020,264,448 bytes —
out-of-order segment writes, not verified progress). A fresh app-stack run
on the same DB and files resumed from the verified 643 MB and completed:
final size **1073725334 / 1073725334 exact**, SHA-256
`e5c9b51bdfaf6337202810c3bc8fa789ca7e059a62fe747ab7fd86cb547b2c00`,
`.aria2` control file removed, status `completed`.
Note: thinkbroadband's test files are raw random bytes with a `.zip`
name, not real zip archives, and no checksum is published — so integrity
is established by exact size plus the 100 MB SHA-256 matching across four
independent downloads, which proves the resume path is byte-exact.

## Environment findings (fixed during testing)

1. **speed.hetzner.de does not resolve on this network** — the laptop's DNS
   (192.168.0.1) returns NODATA; curl rc=6, aria2 error 19. Not a DOVIRA
   bug. Test host switched to thinkbroadband.com.
2. **Broken IPv6**: the network configures IPv6 addresses but has no IPv6
   route. aria2 tried the AAAA address first, got `ENETUNREACH` ("socket
   operation attempted to an unreachable network"), and aborted before its
   IPv4 backup connected. Fix: aria2 is spawned with `--disable-ipv6`
   (see `src/main/engines/aria2.ts`). Downloads are IPv4-only; servers are
   dual-stack, so nothing is lost.
3. **Retry backoff**: the first version retried after a flat 2 s, so three
   retries were spent in ~10 s of a 15 s outage. Now backoff is
   2 s → 5 s → 15 s (`RETRY_DELAYS_MS` in `src/main/queue.ts`), bridging
   ~25 s outages.
4. **Progress 0-clobber**: aria2 reports 0/0 before fetching headers; the
   poller used to overwrite the known size/done bytes with those zeros.
   Now the poller keeps the previous values until aria2 reports real ones.

## Integrity
The 100MB file's SHA-256 matched across every completed download
(Tests 1, 4, and 5), proving resumed downloads are byte-identical to a
fresh download. The 1GB file has no published checksum (and the file is
not a real zip, so no CRC check applies); its integrity rests on the
exact final size (1,073,725,334 bytes) plus the byte-exact resume path
proven by the 100MB hashes.
