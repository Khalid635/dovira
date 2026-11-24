# DOVIRA Local API

The app runs a small HTTP API on your own machine so the browser
extension (and your own scripts) can talk to it. It is **local-only**:
it listens on `127.0.0.1` and never on your network, and every request
needs the pairing token.

- Base URL: `http://127.0.0.1:17530`. If the port is taken, the app tries
  17531–17540 — the port actually in use is shown in Settings > Browser
  & Cookies (Browser extension pairing).
- The API starts with the app. If it cannot bind any port, extension
  pairing is unavailable until the app restarts.
- Find the token in Settings > Browser & Cookies: Show / Copy, and
  Regenerate. Regenerating invalidates the old token immediately — the
  extension must be re-paired afterwards.
- The token is stored encrypted on your machine (Windows: DPAPI via
  Electron safeStorage). Never paste it into a chat, a screenshot, or
  a public file.

## Authentication

Every request needs:

```
Authorization: Bearer <token>
```

Without it (or with a wrong token):
`401 { "ok": false, "error": "unauthorized" }`.

## Origin rule

Requests from a web page (`Origin: http://…` / `https://…`) are
rejected with `403 { "ok": false, "error": "forbidden-origin" }` — a
malicious site cannot drive your downloads even if it somehow learned
the token. Only extension origins (`chrome-extension://…`,
`moz-extension://…`) or no `Origin` at all (curl, scripts) are
accepted. The extension's content script must not call the API
directly — its background service worker makes the request.

## Endpoints

### GET /status

```bash
curl -H "Authorization: Bearer $DOVIRA_TOKEN" http://127.0.0.1:17530/status
```

```json
{ "ok": true, "app": "dovira", "version": "1.3.1" }
```

### GET /downloads

Lists every download in the queue/history:

```bash
curl -H "Authorization: Bearer $DOVIRA_TOKEN" http://127.0.0.1:17530/downloads
```

```json
{
  "ok": true,
  "downloads": [
    { "id": "…", "filename": "…", "status": "downloading", "doneBytes": 123, "totalBytes": 456 }
  ]
}
```

`status` is one of `queued`, `fetching_info`, `downloading`, `paused`,
`processing`, `completed`, `failed`, `cancelled`.

### POST /downloads

Add a download:

```bash
curl -X POST -H "Authorization: Bearer $DOVIRA_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"url": "https://www.youtube.com/watch?v=…", "kind": "video", "quality": "1080"}' \
  http://127.0.0.1:17530/downloads
```

```json
{ "ok": true, "dialog": true }
```

With `"direct": true` the response is `{ "ok": true, "direct": true, "id": "…" }` instead — see below.

Request body (JSON, max 1 MB):

| Field       | Type     | Notes                                                                                                                                                       |
| ----------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `url`       | string   | Required. `http(s)://…` or `magnet:` — anything else is `unsupported-url`.                                                                                  |
| `kind`      | string   | `video` or `audio`; anything else (or omitted) means auto — video when the link has video, audio otherwise. Direct mode only — the dialog lets the user pick. |
| `quality`   | string   | e.g. `"1080"`, `"720"`, `"320"`. Max 8 characters; omitted = the app's Settings default. Direct mode only — the dialog lets the user pick.              |
| `direct`    | boolean  | `true` = start the download at once (floating button), no Add dialog. Omitted/false = open the Add dialog.                                                     |
| `cookies`   | string   | Netscape `cookies.txt` text for this link (max 64 KB). Used for login-walled pages; only cookies matching the URL's host/path are sent.                     |
| `userAgent` | string   | Sent with the download request. Max 512 characters.                                                                                                         |
| `referer`   | string   | Must start with `http://` or `https://`. Max 2048 characters.                                                                                               |
| `mirrors`   | string[] | Optional mirror URLs for a plain-file download (max 5, `http(s)` only — anything else is silently dropped). aria2 tries them all; the main URL stays first. |

Direct download — the floating button's one-click flow: send
`"direct": true` and the app starts the download at once with the
auto quality/subtitle pick (Settings defaults, `kind`/`quality`
override them) — no Add dialog, and the app window opens over the
download in progress. The request waits for format resolution
(~10 s typical, 60 s worst case) so the caller gets the real
outcome: `{ "ok": true, "direct": true, "id": "…" }` on success,
`{ "ok": false, "error": "…" }` when it could not start. A playlist
URL falls back to the Add dialog (`{ "ok": true, "dialog": true }`)
so entries can be picked. The popup, right-click menu and download
intercept keep the dialog flow (no `direct` flag).

Notes:

- The app's own rules apply: duplicate check, disk-space check, smart
  naming/organizer, and the Settings quality default.
- Cookies are written to a temp file the download references and
  deleted when it finishes (or fails). Cookies and the URL's query
  string are never written to logs — only the host is logged.

### GET /preview

Streams a completed download back to the app's own preview player
(`<video>` / `<audio>` with seeking). It is the only endpoint that
runs **before** the Origin check: a media element cannot send an
`Authorization` header, so the token travels in the query string
instead (compared in constant time, exactly like the Bearer token).

```bash
curl "http://127.0.0.1:17530/preview?id=<download-id>&token=$DOVIRA_TOKEN" -o out.mp4
```

```bash
# Seeking works — the player sends Range headers, the API answers 206:
curl -H "Range: bytes=0-1023" "http://127.0.0.1:17530/preview?id=<download-id>&token=$DOVIRA_TOKEN" -o part.bin
```

- Only a **completed** video/audio row from the app's database is
  ever served — arbitrary paths are never served, and the file must
  still exist on disk (`404` otherwise).
- Only playable media types are served: mp4, webm, mkv, mov, m4v,
  mp3, m4a, wav, ogg, opus, flac. Anything else is `415`.
- A malformed or unsatisfiable `Range` is `416` with
  `Content-Range: bytes */<size>`.
- Do not put this URL in a browser address bar or a shared link: the
  token in the query string would land in history. The app's preview
  player is the only caller.

### GET /extension-settings

What the extension syncs from the app (its behaviour switches live
here, not in the extension's own options page):

```bash
curl -H "Authorization: Bearer $DOVIRA_TOKEN" http://127.0.0.1:17530/extension-settings
```

```json
{ "ok": true, "floatingButton": true, "interceptDownloads": false }
```

## Errors

All errors are JSON: `{ "ok": false, "error": "<code>" }`.

| HTTP | `error`             | Meaning                                                         |
| ---- | ------------------- | --------------------------------------------------------------- |
| 400  | `invalid-json`      | The body is not valid JSON.                                     |
| 400  | `invalid-url`       | `url` is missing or not a URL.                                  |
| 400  | `unsupported-url`   | Not `http(s)://` or `magnet:`.                                  |
| 400  | `duplicate`         | Already downloaded (same URL + quality).                        |
| 400  | `no-space`          | Not enough free disk space.                                     |
| 400  | `unknown`           | The download could not be added (see the app log).              |
| 401  | `unauthorized`      | Missing or wrong Bearer token.                                  |
| 403  | `forbidden-origin`  | The request came from a web page.                               |
| 404  | `not-found`         | No such route (or, for `/preview`, no such completed download). |
| 413  | `body-too-large`    | Body over 1 MB.                                                 |
| 415  | `unsupported-media` | `/preview`: the file is not a playable media type.              |
| 416  | `invalid-range`     | `/preview`: malformed or unsatisfiable `Range` header.          |
| 500  | `unknown`           | Unexpected server error.                                        |

The extension also reports its own Options page URL to the app on
its `/status` ping (`X-Dovira-Options-Url: chrome-extension://…/options.html`
or `moz-extension://…/options.html`) — that is how the app's one-click
"Pair extension" button knows which page to open with the token. The
app only ever stores a value that is an extension origin ending in
`/options.html`, and re-validates it before opening.

## Limits

- Body: 1 MB. Cookies: 64 KB. Quality: 8 characters. User-Agent: 512
  characters. Referer: 2048 characters.
- The API is for one machine only — it never leaves `127.0.0.1`, so it
  cannot be reached from another device on your network.
