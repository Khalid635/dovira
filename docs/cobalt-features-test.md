# Cobalt-inspired features — test report

Date: 2026-11-23. Commit: (see git log — "Cobalt-inspired improvements").
Ideas only — no Cobalt code was copied (AGPL-3.0 vs DOVIRA's MIT), and the
app stays fully local (no server-proxy model).

## Unit + typecheck + build (all green)

- `npm run typecheck` — exit 0 (node + web).
- `npm test` — **30/30 pass, 0 fail** (9 suites). New: `tests/name-presets.test.ts`
  (5), `tests/media-items.test.ts` (4), `tests/quick-add.test.ts` (8),
  `tests/i18n.test.ts` (3 — identical en/bn key sets, all 15 new keys present).
- `npm run build` — exit 0 (extension + typecheck + electron-vite).

Two fixes during the run (both in tests, not product code, except the move):
- `parseMediaItems` moved from `engines/ytdlp.ts` to `util/mediaItems.ts` —
  ytdlp.ts uses parameter properties, which Node's TS type-stripping cannot
  parse, so `node --test` could not import it. ytdlp.ts re-exports the type.
- `tests/quick-add.test.ts` fixtures forgot the `...overrides` spread.

## Functional probe (CDP, unpacked build, live)

Launched with `electron . --remote-debugging-port=9222` (repo root, so the
bundled engines resolve). Note: `electron out/main/index.js` does NOT work
for probing — `app.getAppPath()` misses `resources/bin`, the app shows a
blocking error box, and in Session 0 that box can never be dismissed (the
main thread stalls and DevTools never answers). The installed app is
unaffected — this is a probe-launch quirk only.

1. **One-click paste-and-download — VERIFIED.**
   - Plain file: clipboard `googlelogo_color_272x92dp.png` → toolbar
     "Paste & download" → row appeared, `downloading` → `completed`,
     then removed (file deleted). Post-download security log:
     `motw=true defender=clean`.
   - Video: clipboard YouTube `dQw4w9WgXcQ` → row appeared as
     `Rick Astley - Never Gonna Give You Up (4K Remaster) [1080p].mp4`,
     status `downloading` (smart naming applied the `{title} [{height}p]`
     template), then cancelled + removed (file deleted).
   - Probe note: the toolbar button's label flips Bangla → English ~4s
     after launch (store default 'bn' until init loads settings). A click
     before store init no-ops (settings null) — the first two PNG attempts
     hit exactly that and showed no row; after waiting for the flip, the
     same flow worked. Pre-existing init window, not a bug in this change.
2. **Filename style presets — VERIFIED.**
   - Settings > Smart select renders with all 6 options
     (`title-quality`, `title`, `title-uploader`,
     `uploader-title-quality`, `title-date`, `custom`), default
     `title-quality`. Picking `title-uploader` set
     `nameTemplatePreset: 'title-uploader'` and
     `nameTemplate: '{title} - {uploader}'` in live settings; restored to
     `title-quality` / `'{title} [{height}p]'` afterwards.
3. **Multi-media picker — PARTIALLY VERIFIED.**
   - Parsing + dialog UI + submit are unit-tested, typechecked and built.
   - Live gallery end-to-end NOT verified: no public gallery URL was
     available. The one candidate (Imgur album `Ay7fG2s` from a web
     article) 404s in yt-dlp; a second yt-dlp call timed out on Imgur's
     API. Whether a real carousel still returns `entries` under the app's
     `--no-playlist` flag is therefore unconfirmed live.
   - Needs Khalid's in-app check: paste a real Instagram carousel or an
     X post with several photos and confirm the picker lists the items.
4. **Local API docs — VERIFIED.**
   - `docs/local-api.md` written (endpoints, Bearer auth, Origin rule,
     examples, error codes — all checked against `src/main/localApi.ts`).
   - "Local API docs" button renders in Settings > Setup & diagnostics
     (Browser extension section). Not clicked in the probe (it opens the
     GitHub page in the browser).

## Cleanup after the probe

- Both probe downloads were removed with file deletion; the preset was
  restored to `title-quality`; no settings were left changed.
- Probe scripts (`cobalt-probe.mjs`, `cobalt-probe2.mjs`) deleted from the
  repo before commit; `ws` was installed with `--no-save` (package.json
  untouched).

## Known limitations (for Khalid)

- The picker shows only when yt-dlp returns >1 `entries` for the URL.
  Single videos, playlists (refused as `playlist`) and torrents never
  reach it. A partially-failed picker submit closes the dialog when at
  least one item was added and reports only the added count.
- Quick-paste uses the Settings default quality / audio bitrate and the
  download folder; subtitles, clip and metadata options stay off (use the
  Add dialog for those).
- Session 0 note: in the probe runs the log showed
  `local-api: pairing token stored in plaintext — OS encryption
  unavailable` (DPAPI needs an interactive session). On Khalid's real
  desktop session the token encrypts normally — pre-existing behaviour.
