/**
 * Bring a window to the front reliably — used when the browser
 * extension asks the app to open the Add dialog (or starts a direct
 * download) while the user is looking at another app (e.g. Brave).
 *
 * Plain show() + focus() is not enough on Windows: the OS blocks a
 * background app from stealing focus (foreground lock), and show()
 * on an already-visible window does not change its z-order — so the
 * dialog opened in a window sitting behind the browser (found live
 * 2026-11-24: the dialog was open with formats loaded, Khalid just
 * never saw it). The fix is a brief always-on-top pulse: raising the
 * window above the foreground app, taking focus, then clearing the
 * flag at once so the window never stays topmost. moveTop() puts it
 * at the top of the normal z-order as well.
 *
 * Pure module (no Electron runtime imports): the window is passed in
 * as a BringToFrontLike, so it is unit-testable with a fake window.
 */
export interface BringToFrontLike {
  isDestroyed(): boolean
  isMinimized(): boolean
  restore(): void
  show(): void
  setAlwaysOnTop(flag: boolean): void
  focus(): void
  moveTop(): void
}

/**
 * Bring `win` to the front. Returns false (and does nothing) when
 * there is no usable window. show() also revives a window hidden to
 * the tray (close hides instead of quitting), and restore() revives
 * a minimized one.
 */
export function bringToFront(win: BringToFrontLike | null | undefined): boolean {
  if (!win || win.isDestroyed()) return false
  if (win.isMinimized()) win.restore()
  win.show()
  win.setAlwaysOnTop(true)
  win.focus()
  win.moveTop()
  win.setAlwaysOnTop(false)
  return true
}
