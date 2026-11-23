import { spawn, type ChildProcess } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { createServer } from 'node:net'

export interface Aria2Status {
  gid: string
  status: string
  totalLength: string
  completedLength: string
  downloadSpeed: string
  uploadSpeed: string
  connections: string
  errorCode?: string
  errorMessage?: string
  /** Magnet links: when the metadata download completes, aria2 starts the
   * real file download under a new GID listed here. */
  followedBy?: string[]
  dir: string
  files?: Array<{
    path: string
    length: string
    completedLength: string
    uris: Array<{ uri: string; status: string }>
  }>
}

interface RpcReply<T> {
  result?: T
  error?: { code: number; message: string }
}

/**
 * Next-level: build the URI list for aria2.addUri — the main URL first,
 * then mirror URLs (de-duplicated, http(s) only, at most 5). Pure, so
 * it is unit-testable standalone. Mirrors only make sense for plain
 * files (one URL = one file); video/audio and torrents never get them.
 */
export function mirrorUris(url: string, mirrors: string[]): string[] {
  const out = [url]
  const seen = new Set([url])
  for (const m of mirrors) {
    if (out.length >= 6) break // main + 5 mirrors
    if (typeof m !== 'string' || seen.has(m)) continue
    try {
      const u = new URL(m)
      if (u.protocol !== 'http:' && u.protocol !== 'https:') continue
    } catch {
      continue
    }
    seen.add(m)
    out.push(m)
  }
  return out
}

/**
 * Owns the aria2c child process (JSON-RPC on localhost, random port + secret).
 * Plain Node — no Electron imports, so it can be tested outside the app.
 */
export class Aria2Manager {
  private proc: ChildProcess | null = null
  private port = 0
  private secret = ''
  private rpcId = 0
  private readyFlag = false
  private stopping = false
  private logTail: string[] = []
  /** Called when the process exits unexpectedly (not via stop()). */
  onUnexpectedExit: (() => void) | null = null

  // No parameter properties — Node's strip-only test runner cannot
  // parse them; explicit fields instead.
  private binaryPath: string
  private defaultDir: string

  constructor(binaryPath: string, defaultDir: string) {
    this.binaryPath = binaryPath
    this.defaultDir = defaultDir
  }

  isReady(): boolean {
    return this.readyFlag && this.proc !== null
  }

  getLastLog(): string {
    return this.logTail.join('\n')
  }

  async start(): Promise<void> {
    if (this.isReady()) return
    this.stopping = false
    this.port = await this.pickFreePort()
    this.secret = randomBytes(16).toString('hex')
    const args = [
      '--enable-rpc',
      `--rpc-listen-port=${this.port}`,
      `--rpc-secret=${this.secret}`,
      '--rpc-listen-all=false',
      `--dir=${this.defaultDir}`,
      '--continue=true',
      '--auto-file-renaming=false',
      '--allow-overwrite=false',
      '--max-concurrent-downloads=10',
      // Next-level: daemon defaults 16/16 (was 8/8) — per-download
      // options still override these at addUri time.
      '--max-connection-per-server=16',
      '--split=16',
      '--min-split-size=1M',
      '--file-allocation=none',
      '--console-log-level=warn',
      // Phase 4: magnet links need DHT (or trackers) to find peers;
      // trackers in the link alone are often not enough. DHT chatter is
      // harmless for normal file downloads. --seed-time=0 stays.
      '--enable-dht=true',
      // Phase 4: Local Peer Discovery is REQUIRED for magnets to work
      // behind a home NAT: DHT returns the public IP (unreachable from
      // inside the NAT, no port-forward), trackers are often absent, and
      // aria2 ignores the magnet x.pe parameter — so without LPD a
      // local seeder is never found and the download stalls at
      // [METADATA] forever. LPD finds peers on the same LAN via
      // multicast. Verified 2026-11-22: app aria2 without this flag
      // stayed conn=0 for 150s against a live local seeder; CLI aria2
      // with LPD on completed the same magnet byte-identical.
      '--bt-enable-lpd=true',
      '--seed-time=0',
      '--max-tries=5',
      '--retry-wait=5',
      // IPv4-only: on networks where IPv6 is configured but has no route
      // to the internet, aria2 tries the AAAA address first, gets
      // ENETUNREACH, and aborts before the IPv4 backup connects. Nearly
      // all servers are dual-stack, so IPv4-only loses nothing.
      '--disable-ipv6'
    ]
    this.proc = spawn(this.binaryPath, args, { windowsHide: true })
    this.proc.on('error', () => {
      // Spawn failed (e.g. binary vanished) — without this listener the
      // unhandled 'error' event would crash the main process.
      this.readyFlag = false
      this.proc = null
      if (!this.stopping && this.onUnexpectedExit) this.onUnexpectedExit()
    })
    this.proc.stderr?.on('data', (chunk: Buffer) => {
      const lines = chunk.toString('utf-8').split(/\r?\n/).filter(Boolean)
      this.logTail.push(...lines)
      if (this.logTail.length > 50) this.logTail.splice(0, this.logTail.length - 50)
    })
    this.proc.on('exit', () => {
      this.readyFlag = false
      this.proc = null
      if (!this.stopping && this.onUnexpectedExit) this.onUnexpectedExit()
    })
    // Wait until the RPC endpoint answers.
    const deadline = Date.now() + 10_000
    for (;;) {
      try {
        await this.rpc<unknown>('aria2.getVersion', [])
        this.readyFlag = true
        return
      } catch {
        if (Date.now() > deadline) {
          throw new Error(`aria2 did not answer RPC within 10s. Last log:\n${this.getLastLog()}`)
        }
        await new Promise((r) => setTimeout(r, 200))
      }
    }
  }

  async stop(): Promise<void> {
    this.stopping = true
    this.readyFlag = false
    const proc = this.proc
    this.proc = null
    if (proc) {
      proc.kill()
      await new Promise((r) => setTimeout(r, 300))
      if (!proc.killed) proc.kill('SIGKILL')
    }
  }

  private async rpc<T>(method: string, params: unknown[] = []): Promise<T> {
    const body = JSON.stringify({
      jsonrpc: '2.0',
      id: ++this.rpcId,
      method,
      params: [`token:${this.secret}`, ...params]
    })
    const res = await fetch(`http://127.0.0.1:${this.port}/jsonrpc`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body
    })
    const json = (await res.json()) as RpcReply<T>
    if (json.error) throw new Error(json.error.message)
    return json.result as T
  }

  async addUri(url: string, options: Record<string, string | string[]>): Promise<string> {
    return this.rpc<string>('aria2.addUri', [[url], options])
  }

  /**
   * Next-level: add a download with mirror URLs — aria2 tries the
   * mirrors for the same file when the main URL stalls or fails.
   * The first URI is the main URL; mirrors are de-duplicated, http(s)
   * only, at most 5. aria2.addUri takes the whole URI list at once.
   */
  async addUris(
    url: string,
    mirrors: string[],
    options: Record<string, string | string[]>
  ): Promise<string> {
    const uris = mirrorUris(url, mirrors)
    return this.rpc<string>('aria2.addUri', [uris, options])
  }

  async tellStatus(gid: string): Promise<Aria2Status> {
    return this.rpc<Aria2Status>('aria2.tellStatus', [gid])
  }

  async pause(gid: string): Promise<string> {
    return this.rpc<string>('aria2.pause', [gid])
  }

  async unpause(gid: string): Promise<string> {
    return this.rpc<string>('aria2.unpause', [gid])
  }

  async remove(gid: string): Promise<string> {
    return this.rpc<string>('aria2.remove', [gid])
  }

  async removeDownloadResult(gid: string): Promise<string> {
    return this.rpc<string>('aria2.removeDownloadResult', [gid])
  }

  /**
   * Phase 7: change options of one active download — used to apply a new
   * speed limit live (e.g. {'max-download-limit': '512000'}; '0' =
   * unlimited). The gid must belong to an active download.
   */
  async changeOption(gid: string, options: Record<string, string>): Promise<string> {
    return this.rpc<string>('aria2.changeOption', [gid, options])
  }

  /**
   * Phase 7: change the global options — used to apply a new global speed
   * limit live (e.g. {'max-overall-download-limit': '512000'}).
   */
  async changeGlobalOption(options: Record<string, string>): Promise<string> {
    return this.rpc<string>('aria2.changeGlobalOption', [options])
  }

  private pickFreePort(): Promise<number> {
    return new Promise((resolve, reject) => {
      const server = createServer()
      server.once('error', reject)
      server.listen(0, '127.0.0.1', () => {
        const port = (server.address() as { port: number }).port
        server.close(() => resolve(port))
      })
    })
  }
}
