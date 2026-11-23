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
{ "ok": true, "app": "dovira", "version": "1.2.0" }
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
{ "ok": true, "id": "…" }
```

Request body (JSON, max 1 MB):

| Field | Type | Notes |
| --- | --- | --- |
| `url` | string | Required. `http(s)://…` or `magnet:` — anything else is `unsupported-url`. |
| `kind` | string | `video` or `audio`; anything else (or omitted) means auto — video when the link has video, audio otherwise. |
| `quality` | string | e.g. `"1080"`, `"720"`, `"320"`. Max 8 characters; omitted = the app's Settings default. |
| `cookies` | string | Netscape `cookies.txt` text for this link (max 64 KB). Used for login-walled pages; only cookies matching the URL's host/path are sent. |
| `userAgent` | string | Sent with the download request. Max 512 characters. |
| `referer` | string | Must start with `http://` or `https://`. Max 2048 characters. |

Notes:

- Playlist/channel URLs are refused with
  `400 { "ok": false, "error": "playlist" }` — pick entries in the
  app's Add dialog instead.
- The app's own rules apply: duplicate check, disk-space check, smart
  naming/organizer, and the Settings quality default.
- Cookies are written to a temp file the download references and
  deleted when it finishes (or fails). Cookies and the URL's query
  string are never written to logs — only the host is logged.

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

| HTTP | `error` | Meaning |
| --- | --- | --- |
| 400 | `invalid-json` | The body is not valid JSON. |
| 400 | `invalid-url` | `url` is missing or not a URL. |
| 400 | `unsupported-url` | Not `http(s)://` or `magnet:`. |
| 400 | `playlist` | Playlist/channel URLs are refused — use the app's Add dialog. |
| 400 | `duplicate` | Already downloaded (same URL + quality). |
| 400 | `no-space` | Not enough free disk space. |
| 400 | `unknown` | The download could not be added (see the app log). |
| 401 | `unauthorized` | Missing or wrong Bearer token. |
| 403 | `forbidden-origin` | The request came from a web page. |
| 404 | `not-found` | No such route. |
| 413 | `body-too-large` | Body over 1 MB. |
| 500 | `unknown` | Unexpected server error. |

## Limits

- Body: 1 MB. Cookies: 64 KB. Quality: 8 characters. User-Agent: 512
  characters. Referer: 2048 characters.
- The API is for one machine only — it never leaves `127.0.0.1`, so it
  cannot be reached from another device on your network.
