# Firefox AMO listing notes — DOVIRA extension

Firefox Add-ons (AMO) is the primary store channel for the full
extension (YouTube download included). **Human submission only — do
not submit automatically; a person must review the listing and press
submit.**

## What is already done (code side)

- `extension/manifest.json` has `browser_specific_settings.gecko`
  (`id: dovira@khalid635.github.io`, `strict_min_version: 109.0`) —
  required for a signed AMO listing.
- The extension is Manifest V3, works in Firefox 128+.
- `npm run build:extension` produces the loadable folder
  `extension/dist/` (manifest + JS + HTML + icons). The zip for AMO
  is that folder's contents (see below).

## Checklist for Khalid

1. **Build the extension**: `npm run build:extension` in the repo.
   Verify `extension/dist/` has manifest.json, background.js,
   content.js, lib.js, popup.html, popup.js, options.html, options.js,
   icons/icon.png.
2. **Zip it**: zip the _contents_ of `extension/dist/` (not the folder
   itself) — the zip's root must be `manifest.json`. Name it e.g.
   `dovira-extension-1.4.3.zip`.
3. **AMO account**: sign in at
   https://addons.mozilla.org/developers/ with a Firefox account.
   (First listing needs the account's email verified.)
4. **Submit**: Developer Hub → Submit a New Add-on → "On this site"
   (listed). Upload the zip. AMO runs an automated review; fix
   anything it flags (it may ask about the `<all_urls>` host
   permission and the `downloads`/`cookies` permissions — the listing
   description below explains them).
5. **Listing text** (copy/paste, edit as you like):
   - **Name**: DOVIRA — Download with DOVIRA
   - **Summary**: Send links and videos to the DOVIRA desktop app.
   - **Description**: DOVIRA is the browser companion for the
     open-source DOVIRA download manager (Windows). Right-click any
     link to download it with DOVIRA, hover a video for the IDM-style
     floating download button, or use the toolbar popup. Pairing is
     one click from the app — no copy-paste. Downloads run in the
     desktop app (yt-dlp + aria2); the extension only sends the URL
     (+ that page's cookies, for login-walled links) to the app on
     your own PC at 127.0.0.1. No account, no tracking, no data
     leaves your machine.
   - **Homepage**: https://github.com/Khalid635/dovira
   - **Support**: https://github.com/Khalid635/dovira/issues
   - **License**: MIT
   - **Category**: Download Management
   - **Privacy policy**: none needed beyond the description — the
     extension collects nothing; it only talks to the DOVIRA app on
     localhost. (If AMO asks, say so in the notes to reviewers.)
6. **Notes to reviewers** (paste into the reviewer-notes box):
   > The extension talks only to the DOVIRA desktop app on
   > 127.0.0.1:17530 with a per-install pairing token (Bearer <redacted>).
   > `<all_urls>` is needed because the floating download button runs
   > on any page with a video. `cookies` is used to send the page's
   > cookies for one download only (login-walled links); cookies are
   > never logged or sent anywhere else.
7. **After approval**: the listing gets an AMO URL — add it to the
   README's install section and to the app's extension guide. Updates
   are new version uploads (bump `version` in
   `extension/manifest.json` + `package.json` together — the build
   fails if they disagree).

## What NOT to do

- Do **not** submit this extension to the Chrome Web Store: its
  policies prohibit extensions that enable downloading from YouTube.
  See `extension/README.md` → "Distribution policy" for the full
  reasoning. Chrome/Edge/Brave users install via Load unpacked from
  `extension/dist/` (or the installed app's `resources\extension\`).
- Do not submit a zip that contains the `extension/` source folder
  (TypeScript) — AMO needs the built `dist/` output only.
