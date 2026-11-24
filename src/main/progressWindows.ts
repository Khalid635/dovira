/**
 * IDM-style download progress window — one small window per download.
 *
 * The main process opens a window the moment a download's status
 * becomes 'downloading' (any trigger: Add dialog, extension, AI
 * Assistant) and focuses it again if the same download starts a
 * second time. The window is just another renderer (same entry, same
 * preload) showing the ProgressWindow component for one download id —
 * the queue's progress / status events already reach every window via
 * ipc.ts, so no extra forwarding is needed here.
 *
 * Pure module (no Electron runtime imports), so it is unit-testable in
 * tests/progress-window.test.ts with fake windows. index.ts wires it
 * to real BrowserWindows.
 */
import type { DownloadStatus } from './types.ts'

/** The slice of BrowserWindow the manager needs — real or fake. */
export interface ProgressWindowLike {
  isDestroyed(): boolean
  focus(): void
  close(): void
  on(event: 'closed', listener: () => void): void
}

export class ProgressWindowManager {
  private windows = new Map<string, ProgressWindowLike>()
  // No parameter properties — Node's strip-only test runner cannot
  // parse them; explicit field instead.
  private createWindow: (id: string) => ProgressWindowLike

  constructor(createWindow: (id: string) => ProgressWindowLike) {
    this.createWindow = createWindow
  }

  /** Queue status hook — open the window when a download starts. Idempotent. */
  onStatus(id: string, status: DownloadStatus): void {
    if (status === 'downloading') this.open(id)
  }

  /** Open (or focus, if already open) the progress window for a download. */
  open(id: string): void {
    const existing = this.windows.get(id)
    if (existing && !existing.isDestroyed()) {
      existing.focus()
      return
    }
    const win = this.createWindow(id)
    this.windows.set(id, win)
    win.on('closed', () => {
      if (this.windows.get(id) === win) this.windows.delete(id)
    })
  }

  /** True while a live window exists for this download. */
  has(id: string): boolean {
    const win = this.windows.get(id)
    return !!win && !win.isDestroyed()
  }

  /** Close the window for a download, if one is open. */
  close(id: string): void {
    const win = this.windows.get(id)
    if (win && !win.isDestroyed()) win.close()
  }

  /** Live window count (tests + diagnostics). */
  count(): number {
    return this.windows.size
  }
}
