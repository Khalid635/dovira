# SignPath Foundation — Free Code Signing Application (DRAFT)

> **DRAFT ONLY — NOT SUBMITTED.** Prepared 2026-11-22 for Khalid's review.
> Nothing here has been sent to SignPath, and no account has been created.
> Submitting is Khalid's decision; this file only holds the text so the
> application can be filed in one go when he says so.

## Why

DOVIRA's Windows installer is unsigned, so Windows SmartScreen warns on
every install. SignPath Foundation
(https://about.signpath.io/product/open-source) offers free code signing
for open-source projects. Signing the NSIS installer (and, later, the
Windows binaries) removes the warning without any payment.

## Draft application text

- **Project name:** DOVIRA
- **Project description:** A free, open-source AI download manager for
  Windows, macOS and Linux — direct-file downloads (aria2), video/audio
  downloads with quality choice (yt-dlp), playlists, batch downloads,
  clips, subtitles, torrents and a browser extension. No ads, no
  tracking, no paid tier.
- **License:** MIT (see LICENSE in the repo).
- **Repository:** https://github.com/Khalid635/dovira (public)
- **Website / releases:** https://github.com/Khalid635/dovira/releases
- **Programming language / build:** TypeScript + Electron 44,
  electron-builder (NSIS on Windows, dmg on macOS, AppImage/deb on
  Linux). Builds run on GitHub Actions (`.github/workflows/build.yml`)
  on every tag push; releases are pre-releases with SHA-256 checksums
  (`checksums.txt`) published next to the installers.
- **Maintainer:** Khalid Bin Masud (https://github.com/Khalid635) —
  CSE student, Presidency University, Dhaka, Bangladesh. Sole
  maintainer; the project is non-commercial.
- **What needs signing:** the Windows NSIS installer
  (`dovira-<version>-setup.exe`) and the installed `dovira.exe`.
  (macOS notarization is a separate, paid Apple Developer account and
  is NOT part of this application.)
- **Release cadence:** irregular, roughly monthly (v0.1.0–v0.5.0 so far).

## What SignPath will ask for (when filing)

1. A SignPath account + organization for the project.
2. The repository URL (public, MIT — already satisfies the
   open-source requirement).
3. A description of the build — point them at
   `.github/workflows/build.yml` (the build is fully reproducible from
   the public repo).
4. Agreement to their terms (no malware, no adware — DOVIRA has
   neither).

## Notes

- Do NOT pay for any signing certificate elsewhere — the whole point of
  this route is that it is free for open-source projects.
- Until signing is in place, the installer stays unsigned and the
  README says so; every release still ships `checksums.txt` so users
  can verify the download themselves.
