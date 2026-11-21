import { Menu, Tray, type BrowserWindow } from 'electron'
import type { QueueManager } from './queue'

/**
 * Phase 3: system tray. Double-click shows the window; the menu has
 * Pause all / Resume all / Show DOVIRA / Quit. The tray is created once
 * at startup and lives until quit — close-to-tray (minimizeToTray) is a
 * separate setting handled by the window's 'close' event in index.ts.
 */
export class TrayManager {
  private tray: Tray | null = null

  constructor(
    private getWindow: () => BrowserWindow | null,
    private queue: QueueManager,
    private log: (line: string) => void,
    private onQuitRequested: () => void
  ) {}

  create(iconPath: string): void {
    try {
      this.tray = new Tray(iconPath)
    } catch (err) {
      // Headless / Session 0 launches have no tray — log and continue
      // without one; the app must never crash over a missing tray.
      this.log(`tray: could not create — ${(err as Error).message}`)
      return
    }
    this.tray.setToolTip('DOVIRA')
    this.tray.on('double-click', () => this.showWindow())
    this.rebuildMenu()
    this.log('tray: created')
  }

  rebuildMenu(): void {
    if (!this.tray) return
    const menu = Menu.buildFromTemplate([
      {
        label: 'Pause all',
        click: () => {
          void this.queue.pauseAll().then((n) => this.log(`tray: paused ${n} download(s)`))
        }
      },
      {
        label: 'Resume all',
        click: () => {
          void this.queue.resumeAll().then((n) => this.log(`tray: resumed ${n} download(s)`))
        }
      },
      { type: 'separator' },
      { label: 'Show DOVIRA', click: () => this.showWindow() },
      { type: 'separator' },
      { label: 'Quit', click: () => this.onQuitRequested() }
    ])
    this.tray.setContextMenu(menu)
  }

  /** True when a tray icon actually exists (headless launches have none). */
  isCreated(): boolean {
    return this.tray !== null
  }

  showWindow(): void {
    const win = this.getWindow()
    if (!win) return
    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()
  }

  destroy(): void {
    this.tray?.destroy()
    this.tray = null
  }
}
