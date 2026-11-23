# Winget packaging — DOVIRA

These manifests let users install DOVIRA with `winget install Khalid635.DOVIRA`.
**Human submission only — nothing here is submitted automatically.**

## Files

- `Khalid635.DOVIRA.yaml` — default locale (name, description, license, tags).
- `Khalid635.DOVIRA.installer.yaml` — installer (x64 NSIS setup from the
  v1.2.0 GitHub release, user scope, SHA-256 pinned).

## How to submit (Khalid, by hand)

1. Fork [microsoft/winget-pkgs](https://github.com/microsoft/winget-pkgs).
2. Copy both files to
   `manifests/k/Khalid635/DOVIRA/1.2.0/` in your fork
   (folder names are case-sensitive: `k/Khalid635/DOVIRA/1.2.0`).
3. Run the validator before opening the PR:
   `winget validate --manifest <folder>` (needs the App Installer /
   winget on Windows).
4. Open a PR titled `New package: Khalid635.DOVIRA version 1.2.0`.
   The winget bot checks the URL + hash and runs its own validation;
   fix whatever it flags.
5. After merge, `winget install Khalid635.DOVIRA` works for everyone.
   The installer is the NSIS setup from the GitHub release — it
   installs per-user (no admin prompt) and registers an uninstaller.

## Updating for a new version

- Bump `PackageVersion` in both files.
- Point `InstallerUrl` at the new release's `dovira-<version>-setup.exe`
  and replace `InstallerSha256` with that file's SHA-256
  (`Get-FileHash dovira-<version>-setup.exe -Algorithm SHA256`).
- Submit as a new version PR (same folder, new version subfolder).
- The `InstallerSha256` here is the **v1.2.0** installer hash — do not
  reuse it for another version.

## Notes

- `Scope: user` matches the NSIS installer (per-user install, no
  admin). Do not change it to `machine` — the installer does not
  support it.
- There is no `.version.yaml` file: the version is a plain release
  version with no extra metadata, so the default-locale + installer
  manifests are enough.
