# Issues #1–#8 — test notes

Manual verification for the eight good-first-issues, fixed together.
Automated coverage: `npm test` (node:test, no new dependencies) covers the
fetchInfo cache (`tests/fetch-info-cache.test.ts`) and the local-model Test
error classifier (`tests/local-model-errors.test.ts`). Everything below is
checked in the running app by hand.

## #1 — fetchInfo cache (5-min TTL)

- Paste a YouTube link in the Add dialog, wait for the formats to load.
- Close the dialog, paste the same link again: the formats must appear in
  under ~1 s (no second 9–13 s yt-dlp run).
- Start the download, then paste the same link again: the cache entry is
  gone, so the dialog fetches fresh info (the duplicate panel appears).

## #2 — duplicate panel for plain-file re-adds

- Download the Node.js .zip once (plain file, aria2).
- Paste the same link again: the duplicate panel must appear (not just the
  duplicate error text).
- Skip closes the dialog; Keep both downloads as `… (1).zip`; Re-download
  starts a fresh download.

## #3 — listDownloads totalBytes for yt-dlp items

- Download one video (e.g. Big Buck Bunny 1080p), let it finish.
- `listDownloads` totalBytes must equal the file size on disk (earlier both
  the 1080p and 360p rows wrongly reported 30767611 — the audio stream's
  size). The progress percentage must also not jump backwards mid-download
  when yt-dlp switches from the video to the audio stream.

## #4 — Open folder button in the duplicate panel

- Re-add an already-downloaded link so the duplicate panel appears.
- The panel has an Open folder button: it opens the existing file's folder
  (Explorer, file selected). Works for history duplicates (by id) and for
  disk-only duplicates (by path).

## #5 — local-model Test says what it tested

- Settings > Smart, local model on (Ollama at 127.0.0.1:11434, llama3.2):
  with the server running, Test shows
  `Ollama at 127.0.0.1:11434 (llama3.2): reachable`.
- With the server stopped, Test shows the same line with the reason
  (`unreachable`); a hanging server shows `timed out`; no model name set
  shows `no model name set`.

## #6 — Ctrl+Enter submits the Add dialog

- Open the dialog, pick a quality, press Ctrl+Enter (Cmd+Enter on macOS):
  the download starts.
- With the duplicate panel open, Ctrl+Enter does nothing (the panel's own
  answers apply). While a fetch is still running, Ctrl+Enter does nothing.

## #7 — Smart Download class in the status bar

- Start a download: the footer shows one word next to the total speed —
  fast / medium / slow / unstable — matching the current connection.
- When nothing is downloading, the word is hidden.

## #8 — Retry with fresh fetch on fetchInfo failure

- Paste a bad URL (or cut the network): the error state shows Retry.
- Restore the network, press Retry: the fetch runs again bypassing the
  cache and the formats load (no need to close the dialog and re-paste).
