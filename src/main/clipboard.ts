import { clipboard } from 'electron'
import type { QueueManager } from './queue'

/**
 * Phase 3: clipboard watch (AI Link Detection). Polls the clipboard once
 * a second; when a new downloadable URL appears, the renderer gets a
 * toast with an Add action. It NEVER downloads anything by itself and
 * NEVER spawns yt-dlp — it only looks at the text. OFF by default.
 */
export class ClipboardWatcher {
  private timer: ReturnType<typeof setInterval> | null = null
  private lastSeen = ''
  // No parameter properties — Node's strip-only test runner cannot
  // parse them; explicit fields instead.
  private queue: QueueManager
  private onLink: (url: string) => void
  private log: (line: string) => void

  constructor(queue: QueueManager, onLink: (url: string) => void, log: (line: string) => void) {
    this.queue = queue
    this.onLink = onLink
    this.log = log
  }

  start(): void {
    if (this.timer) return
    void this.seedLastSeen()
    this.timer = setInterval(() => this.tick(), 1000)
    this.log('clipboard: watch started')
  }

  private async seedLastSeen(): Promise<void> {
    try {
      // readText is typed async in this Electron build — await works
      // whether it returns a string or a Promise<string>.
      this.lastSeen = await clipboard.readText()
    } catch {
      this.lastSeen = ''
    }
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
    this.log('clipboard: watch stopped')
  }

  isRunning(): boolean {
    return this.timer !== null
  }

  private async tick(): Promise<void> {
    let text: string
    try {
      text = (await clipboard.readText()).trim()
    } catch {
      return
    }
    if (!text || text === this.lastSeen) return
    this.lastSeen = text
    if (!looksLikeDownloadUrl(text)) return
    if (this.queue.getByUrl(text)) return // Already in the queue.
    this.onLink(text)
  }
}

/** Pure predicate, exported for the Phase 3 test. */
export function looksLikeDownloadUrl(text: string): boolean {
  if (text.length > 2048 || /\s/.test(text)) return false
  let u: URL
  try {
    u = new URL(text)
  } catch {
    return false
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return false
  // A bare homepage is not a download.
  if (u.pathname === '/' || u.pathname === '') return false
  // Our own repo page is not a download.
  if (u.hostname === 'github.com' && u.pathname.startsWith('/Khalid635/dovira')) return false
  return true
}
