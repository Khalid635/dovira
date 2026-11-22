# DOVIRA Phase 5 — Test Report (v0.4.0)

Date: 2026-11-22. All tests ran on Khalid's laptop (DESKTOP-KBJR07L) from
SSH Session 0, using the real LocalApiServer / QueueManager / DoviraDb /
SettingsManager / YtDlpManager / Aria2Manager code bundled from the repo
sources, the real aria2 + yt-dlp binaries, and real downloads. Nothing here
is mocked. The extension's compiled lib (`extension/dist/lib.js`, pure
functions) was tested by direct import; the browser-side flows (context
menu click, popup, floating button, pairing, intercept) were NOT tested
headlessly — see §5, they are Khalid's click-through.

Static checks: `npm run typecheck` 0 errors (node + web), extension
`tsc -p extension/tsconfig.json` 0 errors, `npm run lint` 0 errors /
0 warnings, `npm run build` passes (main 124.88 kB, preload 3.38 kB,
renderer JS 746.12 kB), 0 CRLF in all changed files. Preload still only
requires the `electron` built-in — `@electron-toolkit/preload` is gone.
`sandbox: true` kept. `npm run build:extension` passes and verifies the
manifest version matches package.json (0.4.0).

Test files (kept in the harness dir, not the repo):
`~/workspace/dovira-phase5-harness/` — `test-phase5.mjs` (driver),
`test-headless.ps1` (headless launch), `entry.ts` + `electron-stub.mjs`
(bundle entry; the stub only provides `app.getVersion()` — the one
electron call the bundled code makes — because plain Node has no
Electron runtime).
(laptop copies in `D:\\temp\\dovira-phase5-harness\\`.)

Test video: Big Buck Bunny 60fps 4K,
`https://www.youtube.com/watch?v=aqz-KE-bpKQ` (635 s). Playlist:
"Mango Open Movie", `https://www.youtube.com/playlist?list=PL0BAFA2DA294B0900`
(10 entries). Plain file: Node.js 24.21.0 Windows zip, 37,618,919 B.

## 1. Headless app launch — all checks pass

`test-headless.ps1`, run 2026-11-22 ~07:24 (18 s wait). The built app
(`out/main/index.js`, Electron 44) launched in Session 0 and was killed
after 18 s.

- bridge object: True (`typeof window.dovira = object`)
- fatal screen shown=false: True
- home state line present: True (`home state after 3s = empty`, `12s = empty`)
- local-api listening: True (`local-api: listening on 127.0.0.1:17530`)
- preload ran: True (`preload ran: bridge exposed to renderer`)
- electron processes left: 0, aria2 processes left: 0
- First launch also logged `local-api: pairing token generated (see
  Settings > Browser & Cookies)` — the token is generated once and
  persisted in Settings.

## 2. Driver — 46 passed, 0 failed

`test-phase5.mjs`, final run 2026-11-22 ~07:30 (42 s).
`RESULT: 46 passed, 0 failed`. The same driver ran once before with
42 passed / 2 failed — both failures were harness bugs, not app bugs
(see §3); the re-run is green end to end, and the download sizes
reproduced exactly (Node zip 37,618,919 B, BBB 46,283,921 B both runs).

- **A. Token + startup:** A1 token is 64 hex chars; A2 token persisted
  in settings; A3 API running on 127.0.0.1:17530.
- **B. Auth + origin:** B1 `/status` valid token → 200
  `{ok:true, app:'dovira', version:'0.4.0'}`; B2 `/downloads` valid
  token → 200, empty list; B3 wrong token → 401 `unauthorized`; B4
  missing token → 401; B5 web-page Origin (`https://evil.example.com`)
  + valid token → 403 `forbidden-origin`; B6 `chrome-extension://`
  Origin → 200; B7 `moz-extension://` Origin → 200; B8 localhost web
  Origin (`http://localhost:3000`) → 403.
- **C. Validation:** C1 playlist URL → 400 `playlist`; C2 invalid JSON
  → 400 `invalid-json`; C3 empty url → 400 `invalid-url`; C4 `ftp://`
  → 400 `unsupported-url`; C5 unknown route → 404 `not-found`.
- **D. Plain file + per-link cookies/UA/Referer:** D1 POST Node zip
  with dummy Netscape cookies + `User-Agent: DOVIRA-test/1.0` +
  Referer → 200 `ok` + id; D2 completed, done=total=37,618,919; D3
  file on disk exact 37,618,919 B; D4 `ext-cookies/` temp file deleted
  after the download (0 files left); D5 GET `/downloads` lists the
  completed row (`node-v24.21.0-win-x64.zip 37618919/37618919`).
- **E. Video:** E1 POST Big Buck Bunny 360p (URL carried
  `&session=SECRET123` for the log-leak check) with dummy YouTube
  cookies → 200 `ok` + id; E2 completed, done=46,283,921; E3 file on
  disk, `Big Buck Bunny 60fps 4K - Official Blender Foundation Short
  Film.mp4`, 46,283,921 B; E4 `ext-cookies/` temp file deleted after
  the video completes (0 files left).
- **F. Regenerate token:** F1 new token differs, 64 hex; F2 old token
  → 401 after regenerate; F3 new token → 200; F4 new token persisted
  in settings.
- **G. Pure helpers (localApi exports + compiled extension lib):**
  G1 `maskUrl` strips the query; G2a `netscapeCookiesToHeader` keeps
  the matching domain (`sessionid=dummy-node-cookie`); G2b drops the
  expired cookie; G3 `isSupportedUrl`: https true, ftp false,
  `javascript:` false, magnet true; G4 `maskUrlForLog` strips the
  query; G5 `formatNetscapeCookies` skips a tab-injection cookie;
  G6 `apiErrorMessage`: TypeError → `app-not-running`, Response 401 →
  `unauthorized`, Response 500 → `failed`.
- **H. No secrets in logs:** H1 the harness log file contains neither
  the old nor the new token; H2 it contains no `SECRET123` (the query
  value from the video URL). The API only logs the URL host, never the
  query string.
- **I. App-not-running path:** I1 `api.stop()` → `isRunning()` false;
  I2 a fetch to the stopped server throws, which is exactly what the
  extension background worker maps to `app-not-running`.

Note (harness-only, not an app issue): Node prints one
`MODULE_TYPELESS_PACKAGE_JSON` warning when the driver imports the
compiled `extension/dist/lib.js` — the repo's package.json has no
`"type": "module"`, so Node reparses the ESM file. Browsers load it
as a module script and are unaffected.

## 3. First-run failures — both harness bugs, not app bugs

- **G6b** called `apiErrorMessage('playlist')` with a string, but the
  helper takes a thrown error / Response, not an error code. The
  playlist message lives in the background worker, which maps the
  API's `playlist` error itself. Fixed by testing the helper with its
  real inputs (TypeError → `app-not-running`, Response 401 →
  `unauthorized`, Response 500 → `failed`).
- **I2** demanded `ECONNREFUSED` specifically, but Node's fetch
  (undici) returned `ECONNRESET` — its keep-alive pool reused a dead
  socket to the stopped server. The server was down either way (I1
  confirms `isRunning()` false), and the background worker maps ANY
  fetch failure to `app-not-running`. Fixed by asserting the fetch
  throws, which is exactly the worker's condition.

## 4. Bugs found by the Phase 5 tests

Two build/config bugs, both found and fixed during this phase (not by
the driver, by the static checks):

- **Extension tsc: `DEFAULT_PORT` redeclared** — `options.ts` is a
  plain script (global scope), so its `DEFAULT_PORT` collided with
  the service worker's. Fixed: renamed to `DEFAULT_API_PORT` and made
  `options.ts` a module (`export {}` — it loads as a module script).
- **Extension tsc emitted to the wrong folder** — `outDir: "../dist"`
  in `extension/tsconfig.json` resolves to the repo's `dist/`, not
  `extension/dist/`. Fixed: `outDir: "./dist"` + `tsBuildInfoFile`
  next to the tsconfig (kept out of the shipped folder), and
  `*.tsbuildinfo` added to `.gitignore`.

## 5. What was NOT tested headlessly — Khalid's click-through

- Load `extension/dist` unpacked in Chrome (Load unpacked) and in
  Firefox (Load Temporary Add-on), and pair it: copy the token from
  Settings > Browser & Cookies, paste into the extension Options,
  Test connection → "Connected".
- Right-click "Download with DOVIRA" on a real link and on a video
  page; toolbar popup "Send to app"; the floating download button on
  a real YouTube page (appears bottom-right, dismissible with ×,
  sends the video to the app).
- The intercept switch in Options (OFF by default): turn it on, start
  a browser download, confirm it is cancelled and lands in the app.
- A login-walled video via the extension (cookies travel per link).
- The Settings > Browser extension block itself (status line, masked
  token Show/Copy, Regenerate).

## 6. NOT built (Phase 5 scope)

- Live-stream recording (plan §12) — not part of this phase's
  deliverable.
- Native Messaging — a later option; v0.4 uses localhost + token.
- Chrome Web Store submission — deliberately NOT done: the store's
  policy prohibits YouTube-download extensions (rejection / removal /
  account ban). Firefox (AMO) is the first store channel; Chrome uses
  Load unpacked (see `extension/README.md`).
- Bangla UI for the extension — English-only in v0.4.0 (follow-up).
- AMO listing itself — the extension is ready to submit; the listing
  is a human step.
