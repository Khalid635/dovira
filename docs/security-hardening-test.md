# DOVIRA security hardening — test notes

Free security hardening (no paid code signing): Defender scan hook,
filename sanitize + path-traversal audit, Mark-of-the-Web, Local API
token in safeStorage, startup binary hash-check, stricter renderer CSP

- npm audit. Verified 2026-11-23 on the laptop (Windows, Electron 44).

## What was built

- **Defender scan hook** (`src/main/security.ts`, `src/main/queue.ts`):
  after any download completes, `runPostDownloadSecurity` scans the
  file with Windows Defender (`MpCmdRun -Scan -ScanType 3 -File <path>
-DisableRemediation`, 180s timeout). Result is logged
  (`post-download security: <file> motw=<bool> defender=<clean|threat|
unavailable|unknown|skipped>`); a threat shows the `toast.defenderThreat`
  warning and is logged — the file is left in place, the download is
  never failed or deleted. Defender missing/unavailable is not an error.
- **Filename sanitize + path traversal** (`src/main/util/filename.ts`):
  `isPathInside(dir, target)` (segment-wise, case-insensitive on win32;
  sibling-prefix `DOVIRA2` is NOT inside `DOVIRA`; `..` escape is false),
  `resolveDownloadPath(dir, filename)` (sanitize + join + containment
  check, throws on escape) and a containment assertion in
  `resolveUniquePath`. `addFromExtension` now builds its savePath via
  `resolveDownloadPath` instead of string concatenation.
- **Mark-of-the-Web** (`src/main/security.ts`): `applyMarkOfTheWeb`
  writes the `Zone.Identifier` alternate data stream
  (`[ZoneTransfer]\r\nZoneId=3\r\n`) to finished downloads on Windows.
- **Local API token in safeStorage** (`src/main/tokenStore.ts`,
  `src/main/localApi.ts`, `src/main/settings.ts`): the bearer token now
  lives in `settings.extensionTokenEncrypted`, encrypted with Electron
  `safeStorage` (DPAPI on Windows). `loadExtensionToken` migrates the
  legacy plaintext token with the SAME value (extension pairing survives),
  falls back to the legacy token if the ciphertext is corrupt or
  encryption is unavailable, and never throws. `engines:update` records
  the new yt-dlp hash override after an in-app update so the startup
  check never mistakes our own update for tampering.
- **Startup binary hash-check** (`src/main/security.ts`,
  `src/main/binary-hashes.json`, `src/main/index.ts`): at startup, after
  engine resolution, every bundled binary is SHA-256-checked against the
  committed manifest and logged (`binary check: <name> ok|mismatch|
missing|unknown`). A mismatch/missing binary shows a warning dialog;
  startup is never blocked. Manifest covers win/mac/linux yt-dlp
  (verified against the published SHA2-256SUMS), win aria2/ffmpeg/ffprobe/
  deno (hashed from the real bundled files); binaries with no published
  checksum report `unknown`, not fail. Regenerate after bumping pinned
  binaries: `npm run generate-hashes` (`scripts/generate-binary-hashes.cjs`).
- **Diagnostics** (`src/main/diagnostics.ts`): 6th check `binaries`
  (missing -> fail, mismatch -> fail, unknown -> warn, all ok -> ok with
  `{n}`); optional deps, skipped when absent.
- **Stricter renderer CSP** (`src/renderer/index.html`, `src/main/index.ts`):
  meta tag `default-src 'self'; script-src 'self'; style-src 'self'
'unsafe-inline'; img-src 'self' data: https:; media-src 'self';
font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri
'self'; form-action 'self'; frame-src 'none'; worker-src 'none'`.
  `'unsafe-inline'` in style-src MUST stay (inline `style=` in main.tsx,
  DownloadCard.tsx, StatsRow.tsx). Same policy enforced as a header on
  `file://` responses in the main process (defence in depth; meta is primary).
- **i18n**: 6 new keys, 501 keys each in en.json + bn.json (identical
  sets): `toast.defenderThreat`, `diag.checkBinaries`,
  `diag.detailBinariesOk`, `diag.detailBinariesMismatch`,
  `diag.detailBinariesUnknown`, `diag.detailBinariesMissing`.

## Static checks — all green

- `npm run typecheck` (node + web): 0 errors.
- eslint on all touched files: 0 errors (1 warning only: the `.cjs`
  generator is eslint-ignored).
- prettier --check on all touched files: clean.
- `npm run build`: green (main 219.41 kB, preload 4.74 kB, renderer
  873.69 kB JS). Built output verified: new CSP meta in
  `out/renderer/index.html`, yt-dlp hash + safeStorage + MpCmdRun +
  Zone.Identifier present in `out/main/index.js`, no
  `@electron-toolkit/preload` anywhere.
- `npm run build:unpack`: green (dovira.exe 246,582,272 B, app.asar
  4,809,527 B).

## Unit tests

- `D:\temp\security-unit-test.cjs` — **35/35 passed**. Compiled
  standalone (`npx tsc src\main\security.ts src\main\tokenStore.ts
src\main\util\filename.ts src\main\checksum.ts --outDir
D:\temp\security-unit --module commonjs --target es2022
--moduleResolution node --esModuleInterop --skipLibCheck
--resolveJsonModule`): path containment 9, MOTW 3 (incl. real ADS
  write/read), Defender 5 (incl. a LIVE benign-file scan -> clean),
  binaries 8 (incl. manifest-vs-real-files + published SHA2-256SUMS),
  token migration 7 (fake crypto adapter), i18n/CSP 3.
- Regression `D:\temp\v120-unit-test.cjs` — **44/44 passed**
  (recompiled with `--resolveJsonModule`; its diag-count expectation was
  updated 33 -> 38 for the 5 new diag keys).
- Regression `D:\temp\assistant-unit-test.cjs` — **60/60 passed**.
- Note: the v1.2.0 functional probe's F10/F17 expectations (5 checks)
  are now stale — the app has 6 checks; the security probe below asserts 6.

## Functional probe — 21/21 passed

`D:\temp\probe-sec-func.mjs` — unpacked build, fresh profile, CDP
(port 9230), real Node v24.21.0 zip download. All passed, exit 0:

- S1/S2 app hydrates, wizard pops on a fresh profile.
- S3 startup binary check: all 5 log lines (`binary check: <name> ok`)
  appear in dovira.log (hashing lags engine resolution by ~6s; the
  probe polls up to 60s — a single immediate read misses them).
- S4/S4b fresh token stored encrypted (encLen=128), legacy token empty.
- S5/S5b Local API running; Bearer token from encrypted storage accepted
  by `GET /status` (http 200) — pairing not broken.
- S6 wizard finishes.
- S7/S7b diagnostics via IPC: 6 checks in order
  (`localApi,ytdlp,aria2,extension,downloadDir,binaries`), binaries ok.
- S8/S9/S9b Settings > Setup & diagnostics: Run renders 6 check rows,
  binaries row visible (Bangla `ইঞ্জিন ফাইল`).
- S10/S11/S11b/S11c app re-hydrates after downloadDir change; Node zip
  completes; file exists at `D:\temp\dovira-sec-downloads\Archives\
node-v24.21.0-win-x64.zip`.
- S12 MOTW: `Zone.Identifier` ADS reads back exactly
  `[ZoneTransfer]\r\nZoneId=3\r\n`.
- S13 Defender: `post-download security: node-v24.21.0-win-x64.zip
motw=true defender=clean` in dovira.log.
- S14 zero renderer exceptions / console errors.

## npm audit

- **6 moderate vulnerabilities, all one chain**: minimatch 7.0.0–11.0.0
  (DoS via globparts amplification, GHSA-g3hv-75wg-m249) via
  @electron/universal -> app-builder-lib -> electron-builder.
- **Not fixed**: the only fix is `npm audit fix --force`, which installs
  electron-builder@25.1.0 — a breaking toolchain change (repo pins
  26.18.0). The vulnerable code is build-time tooling only; the shipped
  app does not bundle minimatch or electron-builder, and the DoS needs
  attacker-controlled glob patterns (the build's patterns are fixed in
  electron-builder.yml). Revisit when electron-builder 27+ ships a fix.

## Not tested live (by design)

- **Threat path**: no malware sample was downloaded; the threat branch
  (warn + log, file left in place) is covered by code review + the
  `parseMpCmdRunExitCode` unit checks only.
- **macOS / Linux**: MOTW + Defender are Windows-only by design
  (other platforms report skipped/unknown); binary-hash manifest for
  mac/linux ffmpeg/aria2/deno is `unknown` (no published checksums).
- **Existing-install migration**: the token migration is unit-tested with
  a fake adapter and fresh-profile-tested end to end; a real upgrade
  from a v1.2.0 install (legacy plaintext token -> encrypted, same value)
  still needs Khalid's in-app check after he installs the new build.

## Still needs Khalid's in-app check

- Install the build from this commit (no release/tag yet — that comes
  after verification): no startup warning dialog, Settings > Setup &
  diagnostics shows 6 rows with `ইঞ্জিন ফাইল` ok, download any file and
  confirm it lands + the extension still pairs without re-copying the token.
