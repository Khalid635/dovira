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

  constructor(
    private binaryPath: string,
    private defaultDir: string
  ) {}

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
      '--max-connection-per-server=8',
      '--split=8',
      '--min-split-size=1M',
      '--file-allocation=none',
      '--console-log-level=warn',
      '--enable-dht=false',
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

  async addUri(url: string, options: Record<string, string>): Promise<string> {
    return this.rpc<string>('aria2.addUri', [[url], options])
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
