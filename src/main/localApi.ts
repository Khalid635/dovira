import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import {
  createReadStream,
  existsSync,
  mkdirSync,
  statSync,
  unlinkSync,
  writeFileSync
} from 'node:fs'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { extname, join } from 'node:path'
import { app } from 'electron'
import { safeStorage } from 'electron'
import { loadExtensionToken, storeExtensionToken, type TokenCrypto } from './tokenStore.ts'
import type { QueueManager } from './queue.ts'
import type { SettingsManager } from './settings.ts'
import type { ExtensionApiStatus, ExtensionDownloadRequest, LocalApiHooks } from './types.ts'
import { discardPendingExtensionRequest, setExtensionRequest } from './extensionRequests.ts'
import { logMain } from './logger.ts'
import { isValidExtensionOptionsUrl } from './util/extensionOptions.ts'

/**
 * Phase 5 — Local API for the browser extension (plan §9).
 *
 * Listens ONLY on 127.0.0.1 (never 0.0.0.0), on a fixed port with a
 * small fallback range. Every request needs `Authorization: Bearer
 * <token>`; the token lives in Settings (extensionToken) and is shown
 * in Settings > Browser & Cookies so the user can pair the extension.
 *
 * Two layers of defence, because a Bearer token alone is not enough
 * against a malicious website:
 *   1. Token auth — constant-time comparison, required on every route.
 *   2. Origin check — requests from a web page (Origin: http(s)://…)
 *      are rejected. Only extension origins (chrome-extension://,
 *      moz-extension://) or no Origin at all (curl, scripts) are
 *      accepted. Note the extension's content script must NOT call
 *      this API directly — its Origin would be the page's origin, so
 *      it sends the URL to the background service worker, which makes
 *      the request (Origin: chrome-extension://…).
 *
 * Cookies, User-Agent and Referer arrive per link from the extension
 * and are NEVER written to logs — only the URL's host is logged, and
 * never the query string.
 */
export const LOCAL_API_PORT_BASE = 17530
const MAX_PORT_TRIES = 11
const MAX_BODY_BYTES = 1024 * 1024
const MAX_COOKIES_BYTES = 64 * 1024

/** host + path only — the query string (tokens, session ids) is stripped. */
export function maskUrl(raw: string): string {
  try {
    const u = new URL(raw)
    return `${u.protocol}//${u.host}${u.pathname}`
  } catch {
    return '(invalid url)'
  }
}

function sha256Hex(s: string): string {
  return createHash('sha256').update(s, 'utf-8').digest('hex')
}

/**
 * Netscape cookies.txt → a single `Cookie:` header value for one URL.
 * Only cookies whose domain matches the URL host (leading-dot suffix
 * match) and whose path is a prefix of the URL path are kept; expired
 * cookies are skipped. Pure function — no I/O, no logging.
 */
export function netscapeCookiesToHeader(cookiesText: string, url: string): string | null {
  let host: string
  let path: string
  try {
    const u = new URL(url)
    host = u.hostname.toLowerCase()
    path = u.pathname || '/'
  } catch {
    return null
  }
  const now = Math.floor(Date.now() / 1000)
  const pairs: string[] = []
  for (const rawLine of cookiesText.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const parts = line.split('\t')
    if (parts.length < 7) continue
    const [domain, , cookiePath, , expiresRaw, name, value] = parts as [
      string,
      string,
      string,
      string,
      string,
      string,
      string
    ]
    if (!domain || !name) continue
    const d = domain.toLowerCase()
    const domainOk = host === d || (d.startsWith('.') && host.endsWith(d))
    if (!domainOk) continue
    if (cookiePath && !path.startsWith(cookiePath)) continue
    const expires = Number(expiresRaw)
    if (Number.isFinite(expires) && expires > 0 && expires < now) continue
    if (/[;\r\n]/.test(name) || /[;\r\n]/.test(value)) continue
    pairs.push(`${name}=${value}`)
  }
  return pairs.length > 0 ? pairs.join('; ') : null
}

interface DownloadRequest {
  url?: unknown
  kind?: unknown
  quality?: unknown
  cookies?: unknown
  userAgent?: unknown
  referer?: unknown
  /** Direct download (floating button): start at once, no Add dialog. */
  direct?: unknown
  /** Next-level: mirror URLs for a plain-file download (max 5, http(s) only). */
  mirrors?: unknown
}

/**
 * Next-level: media types the in-app preview player can play.
 * Anything else is 415 — the player never serves an arbitrary file.
 */
const PREVIEW_MIME: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mkv': 'video/x-matroska',
  '.mov': 'video/quicktime',
  '.m4v': 'video/x-m4v',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.opus': 'audio/opus',
  '.flac': 'audio/flac'
}

export function mimeForPreview(savePath: string): string | null {
  return PREVIEW_MIME[extname(savePath).toLowerCase()] ?? null
}

export class LocalApiServer {
  private server: Server | null = null
  private port: number | null = null
  private token = ''
  /** v1.2.0: epoch ms of the last request from the extension (null = never seen). */
  private lastExtensionSeenAt: number | null = null
  /**
   * Next-level: the extension's own Options page URL, as reported by
   * the extension on its status ping (chrome-extension://…/options.html
   * or moz-extension://…/options.html). Null until the extension has
   * checked in — the one-click Pair button needs it.
   */
  private lastExtensionOptionsUrl: string | null = null

  // No parameter properties — Node's strip-only test runner cannot
  // parse them; explicit fields instead.
  private settings: SettingsManager
  private queue: QueueManager
  private userData: string
  /** Dialog-first handoff (optional — the API works without a UI). */
  private hooks: LocalApiHooks | undefined
  /**
   * v1.3.1: resolved path of the bundled setup-guide video (or null when
   * the file is missing). Injected so tests can point at a temp file.
   */
  private setupGuidePath: string | null

  constructor(
    settings: SettingsManager,
    queue: QueueManager,
    userData: string,
    hooks?: LocalApiHooks,
    setupGuidePath?: string | null
  ) {
    this.settings = settings
    this.queue = queue
    this.userData = userData
    this.hooks = hooks
    this.setupGuidePath = setupGuidePath ?? null
  }

  /** safeStorage adapter for tokenStore (DPAPI on Windows). */
  private tokenCrypto(): TokenCrypto {
    return {
      isAvailable: () => safeStorage.isEncryptionAvailable(),
      encrypt: (plain: string): string => {
        const buf = safeStorage.encryptString(plain)
        if (!buf || buf.length === 0) throw new Error('safeStorage encryption failed')
        return buf.toString('base64')
      },
      decrypt: (ciphertext: string): string => {
        const plain = safeStorage.decryptString(Buffer.from(ciphertext, 'base64'))
        if (!plain) throw new Error('safeStorage decryption failed')
        return plain
      }
    }
  }

  /** Start listening. Never throws — a bind failure is logged and the API stays down. */
  async start(): Promise<void> {
    // Security: the pairing token lives encrypted (safeStorage/DPAPI)
    // when the OS offers it. A legacy plaintext token migrates on first
    // sight with the SAME value, so a paired extension keeps working.
    const loaded = loadExtensionToken(this.settings, this.tokenCrypto())
    this.token = loaded.token
    if (loaded.migrated) {
      logMain('info', 'local-api: pairing token moved to encrypted storage (same token)')
    } else if (loaded.storage === 'legacy') {
      logMain('warn', 'local-api: pairing token stored in plaintext — OS encryption unavailable')
    }
    this.server = createServer((req, res) => {
      void this.handle(req, res)
    })
    this.server.on('error', (err) => {
      logMain('error', `local-api: server error: ${(err as Error).message}`)
    })
    for (let i = 0; i < MAX_PORT_TRIES; i++) {
      const port = LOCAL_API_PORT_BASE + i
      try {
        await new Promise<void>((resolve, reject) => {
          const onError = (err: Error): void => {
            this.server?.removeListener('listening', onListening)
            reject(err)
          }
          const onListening = (): void => {
            this.server?.removeListener('error', onError)
            resolve()
          }
          this.server?.once('error', onError)
          this.server?.once('listening', onListening)
          this.server?.listen(port, '127.0.0.1')
        })
        this.port = port
        logMain('info', `local-api: listening on 127.0.0.1:${port}`)
        return
      } catch {
        // Port taken — try the next one.
      }
    }
    logMain(
      'error',
      `local-api: could not bind any port ${LOCAL_API_PORT_BASE}-${LOCAL_API_PORT_BASE + MAX_PORT_TRIES - 1} — extension pairing is unavailable`
    )
    this.server = null
    this.port = null
  }

  stop(): void {
    try {
      this.server?.closeAllConnections()
    } catch {
      // Older Node — close() below still works.
    }
    try {
      this.server?.close()
    } catch {
      // Already closed.
    }
    this.server = null
    this.port = null
    // A pending dialog request dies with the app — its temp cookies
    // file must not leak into userData/ext-cookies.
    discardPendingExtensionRequest()
  }

  isRunning(): boolean {
    return this.server !== null && this.port !== null
  }

  getPort(): number | null {
    return this.port
  }

  getStatus(): ExtensionApiStatus {
    return {
      running: this.isRunning(),
      port: this.port,
      token: this.token,
      extensionSeenAt: this.lastExtensionSeenAt,
      extensionOptionsUrl: this.lastExtensionOptionsUrl
    }
  }

  /**
   * v1.3.1: the bundled setup-guide video, when the file exists — the
   * Settings section offers it, and the ipc setupGuide:url handler builds
   * the Local API URL from it. Null when the file is missing.
   */
  getSetupGuidePath(): string | null {
    if (!this.setupGuidePath) return null
    try {
      if (existsSync(this.setupGuidePath)) return this.setupGuidePath
    } catch {
      // Unreadable path — treat as missing.
    }
    return null
  }

  /** New token (Settings > Regenerate). Persisted; the old one stops working at once. */
  regenerateToken(): string {
    this.token = randomBytes(32).toString('hex')
    storeExtensionToken(this.settings, this.token, this.tokenCrypto())
    logMain('info', 'local-api: pairing token regenerated')
    return this.token
  }

  private send(res: ServerResponse, status: number, body: unknown): void {
    const text = JSON.stringify(body)
    res.writeHead(status, { 'Content-Type': 'application/json' })
    res.end(text)
  }

  private isAuthorized(req: IncomingMessage): boolean {
    const header = req.headers['authorization']
    if (typeof header !== 'string' || !header.startsWith('Bearer ')) return false
    const presented = header.slice('Bearer '.length).trim()
    return this.tokenMatches(presented)
  }

  /** Constant-time token comparison (shared by Bearer auth and /preview's query token). */
  private tokenMatches(presented: string): boolean {
    if (!presented || !this.token) return false
    const a = Buffer.from(sha256Hex(presented), 'utf-8')
    const b = Buffer.from(sha256Hex(this.token), 'utf-8')
    return a.length === b.length && timingSafeEqual(a, b)
  }

  /** Reject web-page origins; extension origins and no-Origin are fine. */
  private isAllowedOrigin(req: IncomingMessage): boolean {
    const origin = req.headers['origin']
    if (typeof origin !== 'string' || origin.length === 0) return true
    return origin.startsWith('chrome-extension://') || origin.startsWith('moz-extension://')
  }

  private async readBody(req: IncomingMessage): Promise<string | null> {
    const chunks: Buffer[] = []
    let size = 0
    for await (const chunk of req) {
      const buf = chunk as Buffer
      size += buf.length
      if (size > MAX_BODY_BYTES) return null
      chunks.push(buf)
    }
    return Buffer.concat(chunks).toString('utf-8')
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const rawUrl = req.url ?? '/'
    const path = rawUrl.split('?')[0]
    const method = req.method ?? 'GET'
    // Next-level: /preview runs BEFORE the Origin check — a <video> /
    // <audio> element cannot send an Authorization header, and the
    // renderer sends Origin: null. The token travels in the query
    // string instead (constant-time compared, same as Bearer auth).
    if (method === 'GET' && path === '/preview') {
      await this.handlePreview(req, res)
      return
    }
    // v1.3.1: /setup-guide streams the BUNDLED setup-guide video (a fixed
    // file, never an arbitrary path) — same position as /preview: a
    // <video> element cannot send an Authorization header, and the
    // renderer sends Origin: null, so the token travels in the query
    // string (constant-time compared, same as Bearer <redacted>).
    if (method === 'GET' && path === '/setup-guide') {
      await this.handleSetupGuide(req, res)
      return
    }
    if (!this.isAllowedOrigin(req)) {
      logMain('warn', `local-api: rejected ${method} ${path} — web-page origin`)
      this.send(res, 403, { ok: false, error: 'forbidden-origin' })
      return
    }
    if (!this.isAuthorized(req)) {
      logMain('warn', `local-api: rejected ${method} ${path} — bad or missing token`)
      this.send(res, 401, { ok: false, error: 'unauthorized' })
      return
    }
    // v1.2.0 (fixed next-level): remember the last time the extension
    // talked to us — the app's Extension section shows "connected"
    // from this timestamp. Any AUTHORIZED request counts: the Bearer
    // token already proves the caller is the paired extension, and a
    // Manifest V3 service worker's fetch sends NO Origin header at
    // all — gating on an extension Origin meant the check-in could
    // never fire (verified live 2026-11-23: /status 200, seenAt stayed
    // null). The options URL itself is still validated (extension
    // scheme + /options.html suffix) and the Pair button validates it
    // again before opening.
    this.lastExtensionSeenAt = Date.now()
    const optionsUrl = req.headers['x-dovira-options-url']
    if (typeof optionsUrl === 'string' && isValidExtensionOptionsUrl(optionsUrl)) {
      this.lastExtensionOptionsUrl = optionsUrl
    }
    if (method === 'GET' && path === '/extension-settings') {
      // v1.2.0: the extension syncs its behaviour switches from the app
      // (single source of truth — the options page no longer owns them).
      const s = this.settings.get()
      this.send(res, 200, {
        ok: true,
        floatingButton: s.extensionFloatingButton,
        interceptDownloads: s.extensionIntercept
      })
      return
    }
    if (method === 'GET' && path === '/status') {
      this.send(res, 200, { ok: true, app: 'dovira', version: app.getVersion() })
      return
    }
    if (method === 'GET' && path === '/downloads') {
      const list = this.queue.list().map((d) => ({
        id: d.id,
        filename: d.filename,
        status: d.status,
        doneBytes: d.doneBytes,
        totalBytes: d.totalBytes
      }))
      this.send(res, 200, { ok: true, downloads: list })
      return
    }
    if (method === 'POST' && path === '/downloads') {
      await this.handleAddDownload(req, res)
      return
    }
    this.send(res, 404, { ok: false, error: 'not-found' })
  }

  /**
   * Next-level: stream a COMPLETED video/audio file for the in-app
   * preview player, with HTTP Range support (206) so seeking works.
   * Auth is the pairing token in the query string (?token=…), compared
   * in constant time. Only a completed video/audio row from the DB is
   * ever served — arbitrary paths are never served, and only playable
   * media types (see mimeForPreview). A malformed or unsatisfiable
   * Range is 416 with Content-Range: bytes * /<size>.
   */
  private async handlePreview(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const query = new URL(req.url ?? '/', 'http://127.0.0.1').searchParams
    const token = query.get('token') ?? ''
    if (!this.tokenMatches(token)) {
      this.send(res, 401, { ok: false, error: 'unauthorized' })
      return
    }
    const id = query.get('id') ?? ''
    const d = id ? this.queue.get(id) : undefined
    if (!d || d.status !== 'completed' || (d.kind !== 'video' && d.kind !== 'audio')) {
      this.send(res, 404, { ok: false, error: 'not-found' })
      return
    }
    const mime = mimeForPreview(d.savePath)
    if (!mime) {
      this.send(res, 415, { ok: false, error: 'unsupported-media' })
      return
    }
    this.streamRangedFile(req, res, d.savePath, mime)
  }

  /**
   * Stream one file to a media element, with HTTP Range support (206) so
   * seeking works. Shared by /preview and /setup-guide. A malformed or
   * unsatisfiable Range is 416 with Content-Range: bytes * /<size>.
   */
  private streamRangedFile(
    req: IncomingMessage,
    res: ServerResponse,
    filePath: string,
    mime: string
  ): void {
    let size: number
    try {
      size = statSync(filePath).size
    } catch {
      this.send(res, 404, { ok: false, error: 'not-found' })
      return
    }
    const range = req.headers['range']
    if (typeof range === 'string' && range.startsWith('bytes=')) {
      const m = range.slice('bytes='.length).match(/^(\d*)-(\d*)$/)
      if (!m) {
        res.writeHead(416, { 'Content-Range': `bytes */${size}` })
        res.end()
        return
      }
      const start = m[1] === '' ? size - Number(m[2] || 0) : Number(m[1])
      let end = m[2] === '' ? size - 1 : Number(m[2])
      if (
        !Number.isFinite(start) ||
        !Number.isFinite(end) ||
        start < 0 ||
        end < start ||
        start >= size
      ) {
        res.writeHead(416, { 'Content-Range': `bytes */${size}` })
        res.end()
        return
      }
      end = Math.min(end, size - 1)
      res.writeHead(206, {
        'Content-Type': mime,
        'Content-Range': `bytes ${start}-${end}/${size}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': end - start + 1
      })
      createReadStream(filePath, { start, end }).pipe(res)
      return
    }
    res.writeHead(200, {
      'Content-Type': mime,
      'Accept-Ranges': 'bytes',
      'Content-Length': size
    })
    createReadStream(filePath).pipe(res)
  }

  /**
   * v1.3.1: stream the bundled setup-guide video for the Settings
   * section. Auth is the pairing token in the query string (?token=<redacted>
   * compared in constant time, same as /preview). Only the one fixed
   * bundled file is ever served — the path comes from the constructor,
   * never from the request. 404 when the file is missing.
   */
  private async handleSetupGuide(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const query = new URL(req.url ?? '/', 'http://127.0.0.1').searchParams
    const token = query.get('token') ?? ''
    if (!this.tokenMatches(token)) {
      this.send(res, 401, { ok: false, error: 'unauthorized' })
      return
    }
    const filePath = this.getSetupGuidePath()
    if (!filePath) {
      this.send(res, 404, { ok: false, error: 'not-found' })
      return
    }
    this.streamRangedFile(req, res, filePath, 'video/mp4')
  }

  /** Delete a temp per-link cookies file, if it still exists. */
  private deleteTempCookiesFile(file: string | null): void {
    if (!file) return
    try {
      if (existsSync(file)) unlinkSync(file)
    } catch {
      // Stale temp file — harmless.
    }
  }

  /**
   * Direct download (POST /downloads with `direct: true`, from the
   * extension's floating button): run queue.addFromExtension, which
   * resolves the link and starts the download with the auto
   * quality/subtitle pick — no Add dialog. On success the hook shows
   * the app window over the download in progress; the queue owns the
   * temp cookies file from here. A playlist falls back to the dialog
   * flow (entries need picking). Any other failure deletes the temp
   * cookies file — the download never started, so nothing needs it.
   */
  private async handleDirectDownload(
    req: ExtensionDownloadRequest,
    res: ServerResponse,
    opts: { kind?: 'video' | 'audio'; quality?: string }
  ): Promise<void> {
    let result: { ok: boolean; id?: string; error?: string; errorDetail?: string }
    try {
      result = await this.queue.addFromExtension(req.url, {
        kind: opts.kind,
        quality: opts.quality,
        cookiesFile: req.cookiesFile,
        userAgent: req.userAgent,
        referer: req.referer,
        headers: req.headers,
        mirrors: req.mirrors
      })
    } catch (err) {
      logMain('error', `local-api: direct download failed: ${(err as Error).message}`)
      this.deleteTempCookiesFile(req.cookiesFile)
      this.send(res, 500, { ok: false, error: 'unknown' })
      return
    }
    if (result.ok && result.id) {
      this.hooks?.onDirectDownloadStarted?.(result.id)
      logMain('info', `local-api: direct download started id=${result.id}`)
      this.send(res, 200, { ok: true, direct: true, id: result.id })
      return
    }
    if (result.error === 'playlist') {
      setExtensionRequest(req)
      this.hooks?.onExtensionDownload(req)
      logMain('info', 'local-api: direct download is a playlist — opened the Add dialog instead')
      this.send(res, 200, { ok: true, dialog: true })
      return
    }
    this.deleteTempCookiesFile(req.cookiesFile)
    logMain('warn', `local-api: direct download failed error=${result.error ?? 'unknown'}`)
    this.send(res, 200, { ok: false, error: result.error ?? 'unknown' })
  }

  private async handleAddDownload(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const raw = await this.readBody(req)
    if (raw === null) {
      this.send(res, 413, { ok: false, error: 'body-too-large' })
      return
    }
    let body: DownloadRequest
    try {
      body = JSON.parse(raw) as DownloadRequest
    } catch {
      this.send(res, 400, { ok: false, error: 'invalid-json' })
      return
    }
    const url = typeof body.url === 'string' ? body.url.trim() : ''
    if (!url) {
      this.send(res, 400, { ok: false, error: 'invalid-url' })
      return
    }
    let parsed: URL
    try {
      parsed = new URL(url)
    } catch {
      this.send(res, 400, { ok: false, error: 'invalid-url' })
      return
    }
    if (
      parsed.protocol !== 'http:' &&
      parsed.protocol !== 'https:' &&
      parsed.protocol !== 'magnet:'
    ) {
      this.send(res, 400, { ok: false, error: 'unsupported-url' })
      return
    }
    const userAgent =
      typeof body.userAgent === 'string' && body.userAgent.length > 0
        ? body.userAgent.slice(0, 512)
        : null
    const referer =
      typeof body.referer === 'string' &&
      /^https?:\/\//.test(body.referer) &&
      body.referer.length <= 2048
        ? body.referer
        : null
    const cookiesText =
      typeof body.cookies === 'string' &&
      body.cookies.length > 0 &&
      body.cookies.length <= MAX_COOKIES_BYTES
        ? body.cookies
        : null
    // Next-level: mirrors — an array of strings, max 5, http(s) only.
    // Anything else is silently dropped (never an error: the main URL
    // still downloads fine without mirrors).
    const mirrors: string[] = Array.isArray(body.mirrors)
      ? (body.mirrors as unknown[])
          .filter((m): m is string => typeof m === 'string')
          .filter((m) => {
            try {
              const u = new URL(m)
              return u.protocol === 'http:' || u.protocol === 'https:'
            } catch {
              return false
            }
          })
          .slice(0, 5)
      : []

    // Per-link cookies: written to a temp Netscape file the download
    // references. The queue deletes it when the download completes or
    // is removed; on any early failure it is deleted right here. The
    // file content (the cookies themselves) is never logged.
    let cookiesFile: string | null = null
    try {
      if (cookiesText) {
        const dir = join(this.userData, 'ext-cookies')
        mkdirSync(dir, { recursive: true })
        cookiesFile = join(dir, `${randomBytes(8).toString('hex')}.txt`)
        writeFileSync(cookiesFile, cookiesText, 'utf-8')
      }
      const headers: string[] = []
      if (userAgent) headers.push(`User-Agent: ${userAgent}`)
      if (referer) headers.push(`Referer: ${referer}`)
      if (cookiesText) {
        const cookieHeader = netscapeCookiesToHeader(cookiesText, url)
        if (cookieHeader) headers.push(`Cookie: ${cookieHeader}`)
      }
      // Dialog-first handoff (IDM-fast): store the request and open the
      // Add dialog — do NOT run fetchInfo here. The old code awaited
      // queue.addFromExtension, whose full yt-dlp extraction (~7–11 s)
      // blocked this response, so the extension's button sat on
      // "Sending…" and the app showed nothing meanwhile (measured
      // 2026-11-24: POST 6,892 ms, fetchInfo ok 6,872 ms). The dialog
      // runs fetchInfo in the background and fills in the Video/Audio
      // options when ready; the download itself starts only when the
      // user confirms. addFromExtension stays for the AI assistant's
      // download command, which needs the blocking auto-add.
      const req: ExtensionDownloadRequest = {
        url,
        cookiesFile,
        userAgent,
        referer,
        headers,
        mirrors: mirrors.length > 0 ? mirrors : []
      }
      // Direct download (floating button): start at once with the auto
      // quality/subtitle pick — no Add dialog. The POST waits for format
      // resolution (~10 s typical, 60 s worst case), so the extension
      // gets the real outcome (started / failed) instead of a blind ack.
      // A playlist falls back to the dialog flow — picking entries needs
      // the user. kind/quality only apply here; the dialog lets the user
      // pick, so they are ignored on the dialog path, as before.
      if (body.direct === true) {
        await this.handleDirectDownload(req, res, {
          kind: body.kind === 'video' || body.kind === 'audio' ? body.kind : undefined,
          quality: typeof body.quality === 'string' ? body.quality : undefined
        })
        return
      }
      setExtensionRequest(req)
      this.hooks?.onExtensionDownload(req)
      logMain('info', `local-api: extension download queued for dialog host=${parsed.hostname}`)
      this.send(res, 200, { ok: true, dialog: true })
    } catch (err) {
      this.deleteTempCookiesFile(cookiesFile)
      logMain('error', `local-api: add failed: ${(err as Error).message}`)
      this.send(res, 500, { ok: false, error: 'unknown' })
    }
  }
}
