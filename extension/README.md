# DOVIRA Browser Extension (Phase 5 — v0.4.0)

Send links and videos from the browser to the DOVIRA desktop app — right-click menu, toolbar popup, and an IDM-style floating download button on video pages.

## How it works

```
Browser extension ──POST http://127.0.0.1:17530/downloads──> DOVIRA app
                    Authorization: Bearer <pairing token>
```

The app runs a Local API on **127.0.0.1 only** (never on the network). Every request needs the pairing token, and requests from a web page (Origin: `http(s)://…`) are rejected — only extension origins are accepted. The extension's content script never calls the API directly; it sends the URL to the background service worker, which makes the request.

What the extension sends per link: the URL, the page's cookies for that URL (Netscape format), the browser's User-Agent, and the page URL as Referer. Cookies are used for that one download only and are never written to any log.

## Pairing (2 minutes)

1. Open the DOVIRA app → **Settings → Setup & diagnostics** — the guided extension install there walks you through pairing (copy folder path, load unpacked, copy token) and shows the live connection status.
2. Copy the **pairing token** (Show → Copy).
3. Open the extension's **Options** page and paste the token. Port is 17530 by default — change it only if the app reports a different port in Settings.
4. Click **Test connection** — it should say "Connected to the DOVIRA app".

If the token ever leaks, press **Regenerate token** in the app and paste the new one into the extension options — the old token stops working immediately.

## Features

- **Right-click menu** — "Download with DOVIRA" on links, and "Download this page with DOVIRA" on pages/videos.
- **Toolbar popup** — lists the current page's links (max 50) with a "Send to app" button per link, plus the app-connected status.
- **Floating download button** — on any page with a `<video>` element (YouTube etc.), a small button appears at the bottom-right. Click it to send that page's video to the app. Dismissible with the × (hidden for the rest of the tab session). It never changes the page layout — one fixed-position element, nothing else. Turn it on in the app: **Settings → Setup & diagnostics** (off by default); a page already open needs a reload after you turn it on.
- **Intercept downloads (optional, OFF by default)** — in the app (**Settings → Setup & diagnostics**), turn on "Send browser downloads to DOVIRA instead". Every download the browser starts is then cancelled and sent to the app. Both switches live in the app and sync to the extension automatically — they are not set in the extension options page.
- **Playlist links** — the extension refuses playlist URLs with a clear message; picking entries needs the app's Add dialog.

The extension UI is English-only in v0.4.0 (Bangla support is a follow-up).

## Install

### From the repo (development)

```bash
npm run build:extension   # compiles TypeScript -> extension/dist
```

Then load `extension/dist` as an unpacked extension (see below). The folder is also shipped inside the installed app at `<install dir>\resources\extension` — load that folder unpacked if you installed DOVIRA from the setup file.

### Firefox (recommended first)

Firefox Add-ons (AMO) is the first distribution channel. Until the AMO listing is live, load it temporarily:

1. Open `about:debugging#/runtime/this-firefox`.
2. Click **Load Temporary Add-on…** and pick `extension/dist/manifest.json`.
3. Temporary add-ons are removed when Firefox restarts — reinstall after a restart, or wait for the AMO listing.

### Chrome / Edge / Brave (Load unpacked)

1. Open `chrome://extensions` (or `edge://extensions`).
2. Turn on **Developer mode** (top-right).
3. Click **Load unpacked** and pick the `extension/dist` folder.

## Distribution policy — read this before submitting anywhere

**Chrome Web Store: do NOT submit the YouTube-download capability.** Chrome Web Store Developer Program Policies explicitly prohibit extensions that enable downloading content from YouTube — an extension that ships it is rejected on review, pulled if discovered later, and the developer account can be banned. This is confirmed by multiple 2026 sources (Chrome's policy + YouTube's own Terms, which prohibit downloading unless YouTube itself offers a download for that video). The same restriction is why every legitimate video-downloader listing explicitly excludes YouTube.

So for the Chrome Web Store, either submit a build with YouTube support removed, or do not submit at all and distribute via Load unpacked (above) instead. Firefox (AMO) is the primary store channel for the full extension.

## Files

```
extension/
  manifest.json          Manifest V3 (Chrome + Firefox)
  src/
    background.ts        Service worker: context menu, popup messages, intercept
    content.ts           Floating download button (video pages)
    popup.html/.ts       Toolbar popup: page links + Send to app
    options.html/.ts     Pairing token, port (floating button + intercept live in the app)
    lib.ts               Shared pure helpers (cookies, URL checks)
    chrome.d.ts          Minimal typed chrome.* declarations
  icons/icon.png         App logo
  dist/                  Built extension (npm run build:extension) — load this unpacked
```

## Development

```bash
npm run build:extension   # tsc + copy manifest/HTML/icons into extension/dist
```

The build fails if the manifest version and `package.json` version disagree, or if any expected output file is missing. `npm run build` (and therefore `npm run build:win`) runs the extension build first, so every installer ships the built extension.
