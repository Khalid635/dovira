# Next-level features — manual test report

Step 6 of the DOVIRA serial. Automated checks (laptop, `npm run typecheck`

- `npm test` + `npm run lint` + `npm run build`) — see §0. The rest of
  this report is the manual / live verification, probed 2026-11-23 evening
  with CDP: the dev app launched as `electron .` (repo root) and the
  extension loaded in headless Brave. Items marked [x] were seen live;
  items still [ ] need Khalid's in-app check or a live run that was not
  possible in the probe.

Probe caveat (read first): Khalid's installed v0.7.0 app was running
throughout, holding Local API port 17530 — so every probe app fell back
to 17531, and the extension was pointed at 17531 explicitly for the
extension tests. The two plain-file test URLs first used were bad hosts
(file-examples.com → 403, w3.org dummy.pdf → 404); aria2 itself works —
flower.mp4 and a Rick Astley video both downloaded fine. Test rows were
removed from the download list at cleanup; `flower.mp4` remains in
`C:\Users\Khalid\Downloads\DOVIRA\`.

## 0. Automated checks

- `npm run typecheck`: PASS — 0 errors (2026-11-23, after the
  extension check-in fix).
- `npm test`: PASS — 96/96, 18 suites (2026-11-23). New suites:
  assistant-commands, auto-pick, mirrors, subscriptions, ffmpeg-probe,
  extension-dir, extension-lib, extension-checkin (plus the existing 6).
- `npm run lint`: PASS — clean, 0 problems (2026-11-23).
- `npm run build` (incl. `build:extension`): PASS — 0 errors
  (2026-11-23). `extension/dist` rebuilt with the duplicate button text.

## 1. AI assistant commands (feature 1)

- [x] Assistant chat: paste `https://…` + "ডাউনলোড করো" → download starts
      (probe 3: flower.mp4 completed; probe 5: Rick Astley video row
      appeared downloading).
- [ ] "download this <url>" (English) → download starts (Bangla form
      probed; English form unit-tested only).
- [ ] Bare pasted URL (no verb) → info answer, NOT a download
      (unit-tested only).
- [ ] "why did the download fail?" → question, not a command
      (unit-tested only).
- [x] "pause <name>" with no matching download → "couldn't find" reply
      (probe 1). Other control verbs (resume/cancel/retry/moveToTop)
      unit-tested only.
- [ ] Ambiguous name (two matches) → "couldn't find" reply, no action
      (unit-tested only).
- [x] Re-download of a file already on disk → honest "already
      downloaded" line (`assistant.commandDuplicate`, probe 6).

## 2. Auto quality / subtitles (feature 2)

- [ ] Quick-paste a 1080p+ video with auto quality ON → best height at or
      below the Settings cap is chosen (shown in the row's quality label).
      Auto-pick itself is unit-tested (`pickHeight`); the live
      quality-label check was not done.
- [ ] Same video with auto quality OFF → Settings cap verbatim
      (unit-tested only).
- [x] Video with subtitles + auto subtitles ON → subtitles pre-checked
      in the Add dialog (probe 4: Rick Astley, manual `en` subs —
      checkbox `checked` once dialog info loaded).
- [ ] Manual uncheck in the dialog is NOT re-applied when info reloads
      (guard is in the code; not probed live).

## 3. Smart queue (feature 3)

- [x] Pin a queued download → pinned flag persisted on the row
      (probe 1/2: `pinned: true` after toggle). The pinned-first
      ordering and the pinned badge are in the code; the visual order
      in the list was not compared live.
- [ ] Unpin → order returns to normal.
- [ ] Pin persists across app restart.

## 4. Adaptive connections + mirrors (feature 4)

- [ ] Fast connection: aria2 starts with up to 32 connections
      (check the aria2 log / download speed on a fast server).
      Connection tiers (32/16/8/4) are unit-tested; the live count was
      not observed.
- [ ] Settings connections field accepts up to 32.
- [ ] Local API `POST /downloads` with a `mirrors` array → plain-file
      download uses the mirrors (aria2 addUris). Unit-tested
      (`mirrorUris`); no live mirror source was available to probe.

## 5. Live-stream recording (feature 5)

- [x] Add dialog on a live stream shows the Record panel (probe 3:
      NASASpaceflight Starbase Live `Jm8wRjD3xVA` — "লাইভ স্ট্রিম"
      panel shown).
- [ ] Recording row shows a red REC badge; Stop keeps the `.ts` file
      (non-empty) and marks the download complete. (No recording was
      started in the probe — needs a real session.)
- [ ] Clips are forced off and the thumbnail checkbox is disabled while
      recording.

## 6. Channel subscriptions (feature 6)

- [x] Subscribe to a real channel URL → baseline set (probe 1:
      `@YouTube`, baseline `UCBR8-60-B28hp2BmDPdntcQ`).
- [ ] Invalid URL / plain video URL / duplicate → matching error text
      (unit-tested only).
- [x] "Check now" on a channel with no new video → `ok: true,
    found: 0` (probe 1). The pending-list flow (new video appears →
      Download button → sidebar badge) was not probed — no new video
      appeared during the probe.
- [ ] Download a pending video → it leaves the pending list; the
      quality + subtitle auto-pick applies.
- [ ] Background check (60s after startup) refreshes the list + toasts.

## 7. Preview player (feature 7)

- [x] Completed video row → Play button opens the player (probe 3:
      flower.mp4 — `<video>` with `http://127.0.0.1:17531/preview?id=…`).
- [x] Range/206 works: `GET /preview` with `Range: bytes=0-99` → 206,
      `Content-Range: bytes 0-99/1128375`, 100 bytes (probe 3). The
      seek-bar drag itself was not exercised in the UI.
- [ ] Completed audio row → audio player (video path probed; audio
      path shares the same player/endpoint).
- [ ] Esc / backdrop click closes; audio stops on close.
- [ ] Non-media completed file (e.g. .zip) → no Play button.

## 8. Smaller installer (feature 8)

- Before: installer `dovira-1.2.0-setup.exe` = 237,741,496 B
  (ffprobe.exe 105,221,120 B unpacked).
- After (local rebuild 2026-11-23, same version number — NO release/tag
  made): `dovira-1.2.0-setup.exe` = **208,442,169 B** (29,299,327 B
  smaller, ~12%), SHA256
  `8762d5737ac22e922f8c7925bc8e8a86a3ac6f542ec0158efd9282e3563fd17e`.
  Unpacked `resources` total: 238,545,924 B (was 343,472,456 B).
  NOTE: the local file was overwritten by the rebuild — it is NOT the
  released v1.2.0 artifact (same name, new content). The next real
  release needs a version bump + tag, which is a separate decision.
- [x] `resources\bin\win\ffprobe.exe` is gone from the laptop repo AND
      from the new `dist/win-unpacked/resources/app.asar.unpacked/
    resources/bin/win/` (only aria2c, deno, ffmpeg, yt-dlp remain).
- [ ] Downloads still complete normally (rename recovery now uses
      ffmpeg probing — no ffprobe). (Rename recovery itself was not
      exercised in the probe; the ffmpeg probe is unit-tested.)

## 9. Listing prep (feature 9)

- [ ] Winget manifests validate: `winget validate --manifest packaging/winget`
      (Khalid, on his PC — human submission only, NOT submitted here).
- [ ] Firefox AMO: `extension/dist` zips cleanly; listing checklist in
      `docs/firefox-amo-notes.md` followed by hand.

## 10. Community translations (feature 10)

- [ ] Settings language picker lists Bangla + English from the registry.
- [ ] `docs/translations.md` reads correctly; no machine-translated locale
      was added.

## Extension load-path fix

- [ ] Settings > Setup & diagnostics shows the BUILT folder path
      (`…\resources\extension`), never the source folder (code done;
      visual check pending).
- [x] Load unpacked from `extension\dist` in Brave/Chrome succeeds
      (probes 1–6: service worker running, id
      `pghibcmjdgijggaomobijgdamabdpken`).
- [x] Load unpacked from `extension\` (source) still fails in the
      browser (probe 3/6: no extension target appears on the debug
      port — expected, the app never points at it).
- [ ] `extension\README.md` warns about the dist folder (written;
      read-check pending).

## IDM floating button

- [ ] YouTube video page: hover the video → Download button appears
      over the top-right corner. (Probed on a direct mp4 page instead —
      same content script; a real YouTube page hover still needs his
      browser.)
- [x] Click → the video URL reaches the app (probe 6: fresh flower.mp4
      row in the probe app, status `downloading`; probe 2: the click
      completed the download in the installed app).
- [x] Direct mp4 page: the real media URL is sent, not the page URL.
- [ ] Tiny video / ad → no button (thresholds unit-tested in
      `extension-lib.test.ts`).
- [ ] Fullscreen video → button still appears, does not block controls.
- [x] Extension not paired → button says "Pair DOVIRA" (code path;
      the paired path was probed instead — button showed "Download").
- [ ] App toggle off → no button (after page reload).

## One-click pairing

- [ ] Settings > Setup & diagnostics → "Pair extension" → Options page
      opens in the browser with the token filled and "Paired" shown.
      (The Options-page half is probed — see below. The app-button half
      opens the system default browser, which the headless probe cannot
      observe; the handler itself returned `{ok: true}` in probe 6.)
- [x] Extension status shows connected without a manual token paste
      (probe 6: alarm ping recorded `extensionSeenAt` +
      `extensionOptionsUrl`; this needed a real fix — see below).
- [x] Manual copy-paste still works as fallback (options page keeps
      the manual fields).
- [ ] First-run wizard's extension step offers the same one-click flow
      (shares ExtensionSetup; visual check pending).

## Extension check-in fix (found by the probe, 2026-11-23)

- The v1.2.0 check-in recorded `lastExtensionSeenAt` /
  `lastExtensionOptionsUrl` only when the request carried an
  extension `Origin` header. A Manifest V3 service worker's `fetch`
  sends **no `Origin` header at all** (verified with a local echo
  server: `Origin:` absent, `/status` still 200) — so the check-in
  could never fire, the app never showed the extension as connected,
  and the Pair button always answered `{ok: false, error: "not-seen"}`.
- Fix (`src/main/localApi.ts`): any AUTHORIZED request now counts —
  the Bearer token already proves the caller is the paired extension.
  The options-URL header value is still validated (extension scheme +
  `/options.html` suffix, ≤512 chars) by the new pure helper
  `isValidExtensionOptionsUrl` (`src/main/util/extensionOptions.ts`,
  unit-tested in `tests/extension-checkin.test.ts`).
- Verified live (probe 6): alarm ping → options URL + seenAt recorded;
  `pairExtension()` → `{ok: true}`.
- Side fix from the same probe runs: re-adding a file that is already
  on disk now says so honestly instead of "failed" — the floating
  button shows "Already downloaded" (`extension/src/content.ts`) and
  the assistant answers with `assistant.commandDuplicate`
  (`en`/`bn` keys added).
