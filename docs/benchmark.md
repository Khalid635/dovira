# Benchmark: yt-dlp native vs aria2 external downloader

Same video both runs: Big Buck Bunny 60fps 4K
(https://www.youtube.com/watch?v=aqz-KE-bpKQ), 1080p MP4, final size
155,343,423 bytes, duration 634.624 s. Run 2026-11-22 on Khalid's laptop.
Wall time includes info fetch (~6 s) + download + merge.

| Downloader | Wall time | Avg speed | Exit | Size | Duration |
| --- | --- | --- | --- | --- | --- |
| yt-dlp native (`-N 4`) | **19.5 s** | **7.6 MB/s** | 0 | 155,343,423 | 634.624 s |
| aria2 external (`--downloader aria2c`, `-x 8 -s 8`) | 55.6 s | 2.66 MB/s | 0 | 155,343,423 | 634.624 s |

**Winner: yt-dlp native (`-N 4`) — ~2.9× faster.** `YTDLP_USE_ARIA2` stays
`false` (the default in `src/main/queue.ts`).

Notes:
- The first native attempt failed with YouTube `HTTP 403: Forbidden` (the
  same transient rate-limit seen during the other tests — many repeated
  requests to one video from one IP). The retry minutes later succeeded in
  19.5 s. The 403 is not a native-downloader problem.
- The aria2 leg worked with just `--downloader aria2c` — yt-dlp finds
  `aria2c.exe` next to itself, no PATH change needed.
- Both outputs are byte-size-identical (155,343,423) with the same duration.
