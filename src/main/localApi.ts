import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { existsSync, mkdirSync, unlinkSync, writeFileSync } from 'node:fs'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { join } from 'node:path'
import { app } from 'electron'
import type { QueueManager } from './queue'
import type { SettingsManager } from './settings'
import type { ExtensionApiStatus } from './types'
import { logMain } from './logger'

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
}

export class LocalApiServer {
  private server: Server | null = null
  private port: number | null = null
  private token = ''
  /** v1.2.0: epoch ms of the last request from the extension (null = never seen). */
  private lastExtensionSeenAt: number | null = null

  constructor(
    private settings: SettingsManager,
    private queue: QueueManager,
    private userData: string
  ) {}

  /** Start listening. Never throws — a bind failure is logged and the API stays down. */
  async start(): Promise<void> {
    this.token = this.settings.get().extensionToken
    if (!this.token) {
      this.token = randomBytes(32).toString('hex')
      this.settings.update({ extensionToken: this.token })
      logMain('info', 'local-api: pairing token generated (see Settings > Browser & Cookies)')
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
      extensionSeenAt: this.lastExtensionSeenAt
    }
  }

  /** New token (Settings > Regenerate). Persisted; the old one stops working at once. */
  regenerateToken(): string {
    this.token = randomBytes(32).toString('hex')
    this.settings.update({ extensionToken: this.token })
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
    const path = (req.url ?? '/').split('?')[0]
    const method = req.method ?? 'GET'
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
    // v1.2.0: remember the last time the extension talked to us — the
    // app's Extension section shows "connected" from this timestamp.
    // Only extension origins count (a curl probe must not fake it).
    const origin = req.headers['origin']
    if (
      typeof origin === 'string' &&
      (origin.startsWith('chrome-extension://') || origin.startsWith('moz-extension://'))
    ) {
      this.lastExtensionSeenAt = Date.now()
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
    const kind = body.kind === 'video' || body.kind === 'audio' ? body.kind : ('auto' as const)
    const quality =
      typeof body.quality === 'string' && body.quality.length <= 8 ? body.quality : undefined
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
      const result = await this.queue.addFromExtension(url, {
        kind,
        quality,
        cookiesFile,
        userAgent,
        referer,
        headers
      })
      if (!result.ok) {
        if (cookiesFile && existsSync(cookiesFile)) {
          try {
            unlinkSync(cookiesFile)
          } catch {
            // Stale temp file — harmless.
          }
        }
        this.send(res, 400, { ok: false, error: result.error ?? 'unknown' })
        return
      }
      logMain('info', `local-api: download added ${result.id ?? ''} host=${parsed.hostname}`)
      this.send(res, 200, { ok: true, id: result.id })
    } catch (err) {
      if (cookiesFile && existsSync(cookiesFile)) {
        try {
          unlinkSync(cookiesFile)
        } catch {
          // Stale temp file — harmless.
        }
      }
      logMain('error', `local-api: add failed: ${(err as Error).message}`)
      this.send(res, 500, { ok: false, error: 'unknown' })
    }
  }
}
