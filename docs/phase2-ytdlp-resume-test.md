# Phase 2 yt-dlp resume test

Test video: Big Buck Bunny 60fps 4K (https://www.youtube.com/watch?v=aqz-KE-bpKQ),
1080p MP4, expected final size **155,343,423 bytes**, duration 634.624 s.
All runs used the exact args the queue builds and stores for resume.

## Pause (kill) + resume — PASS (with a fix, see below)

- Throttled run (`-r 2M`, test-only): killed mid-download at ~54.5% of the
  118.62 MiB video. The process died cleanly (verified: no yt-dlp left
  running); the `.part` state survived.
- Resume with the **same command**: yt-dlp logged
  `Resuming download at byte 47181519` (video) and `Resuming download at
  byte 10135912` (audio) — it continued from the partial files, not from
  zero — and both formats reached 100%.
- The recovered file (via the fix below) is **155,343,423 bytes**,
  duration **634.624 s** — byte-size-identical to a clean download.

## The WinError 32 rename race (found by this test, fixed in the app)

Twice, a resumed download failed at the very last step: yt-dlp downloaded
100% and then could not rename the `.part` file into place:

```
[download] Unable to rename file: [WinError 32] The process cannot access
the file because it is being used by another process:
'...f399.mp4.part' -> '...f399.mp4'. Retrying (3/3)...
ERROR: Unable to rename file: [WinError 32] ...
```

On Windows the just-written file is briefly locked by Defender/the indexer;
yt-dlp's 3 quick rename retries sometimes all lose the race. A later rerun
then fails differently — `HTTP Error 416: Requested range not satisfiable`
— because the `.part` is already full-size and the server refuses a Range
starting at the end.

**Fix (in the app, `src/main/engines/ytdlp.ts` + `src/main/queue.ts`):**
when yt-dlp exits non-zero with "Unable to rename file" and at least one
format verifiably finished, the queue redoes the rename itself (up to 5
tries, 1 s apart), then the ffmpeg merge/convert step, and verifies the
result with ffprobe (duration > 0) before marking the download complete.
If that also fails, the download fails with the new `rename-locked` message
("The download finished, but Windows locked the file while saving it.
Press Retry.") instead of a generic error.

**Recovery proven with the shipped code:** `recoverYtDlpRename()` was run
against the real broken state (complete 124,386,876-byte video `.part` +
complete 30,767,611-byte audio, no output file) — **RECOVERED=true in
884 ms**, output 155,343,423 bytes, duration 634.624 s, temp files cleaned up.

## Mismatch detection — PASS (detector verified with shipped code)

`ytdlpPartFiles()` was tested with the compiled module:
- Temp files present (`.f399.mp4.part` + `.f258.m4a`) → found both.
- Temps deleted → found none → the queue fails the resume with
  `resume-state-mismatch` ("The previous download's state doesn't match,
  so it has to start from the beginning. Press Retry to restart it.")
  instead of silently restarting.

Note: the first version of `ytdlpPartFiles()` matched temp names against the
full filename *with* extension (`Film.mp4.` prefix) — yt-dlp actually names
temps from the filename stem (`Film.f399.mp4`). Fixed and re-tested.

## Settings bug — fix + verification status

Symptom (Khalid, 2026-11-21 ~23:06): Settings showed only "…" forever.
Cause in code: `store.init()` used a bare `Promise.all(...)` with no error
handling — any single IPC rejection left `settings` null and `loaded` false
forever. Fix: `Promise.allSettled` with per-call fallbacks (defaults when
settings fail), `loaded: true` always, an `initError` state, a real error
message + Retry button in SettingsPage, and the same hardening in
`refresh()` and the 5 s app-info interval.

**Live root cause on his machine: NOT pinned down.** The three main-side
handlers (`settings:get`, `downloads:list`, `app:info`) were all read and
are defensive (settings parse has try/catch, version checks resolve null,
row mapping is plain fields) — none of them can throw on normal data. The
renderer could not be inspected remotely: Electron apps launched over SSH
run in Session 0 (no interactive desktop), where the window never pumps
and the DevTools server accepts TCP but never serves HTTP/WebSocket
(verified 3× across two fresh instances, including a direct browser-target
WebSocket). The fix makes the failure class impossible to recur — no single
IPC failure can ever leave the app on a bare "…" again — but the
confirming UI check (open Settings in `npm run dev` and see the full form)
is Khalid's 30-second check, not something provable from SSH.
