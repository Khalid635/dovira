/**
 * Auto-start on Windows login (IDM-style) — ALWAYS ON, no toggle.
 *
 * Khalid's decision (2026-11-24): DOVIRA always starts with Windows
 * login. There is no on/off switch anywhere in Settings — the old
 * `launchAtStartup` setting is gone. The only escape hatch is Windows
 * itself (Task Manager → Startup can disable it).
 *
 * How it works: at startup the login item is applied unconditionally
 * (Electron writes the Windows Run key with the `--autostart` arg).
 * When that arg is present, the main window is created hidden to the
 * tray instead of popping up on every login; a normal manual launch
 * shows the window as before. The tray icon (double-click / Show
 * DOVIRA) and the extension hooks (which bringToFront the window)
 * are the way back in.
 *
 * Pure module (no Electron runtime imports): the app object is passed
 * in as AutoStartAppLike, so it is unit-testable with a fake app.
 */
export const AUTO_START_ARG = '--autostart'

export interface AutoStartAppLike {
  setLoginItemSettings(settings: { openAtLogin: boolean; args?: string[] }): void
  getLoginItemSettings(): { openAtLogin: boolean; executableWillLaunchAtLogin?: boolean }
}

/**
 * True when this launch came from the Windows login item (or any
 * launcher passing the flag). Defaults to the real process.argv.
 */
export function isAutoLaunched(argv: readonly string[] = process.argv): boolean {
  return argv.includes(AUTO_START_ARG)
}

/**
 * Apply the always-on login item. Returns true only when a read-back
 * confirms the login item is on; never throws — a failure is logged
 * by the caller and the app runs on without auto-start.
 *
 * Read-back quirk (verified live 2026-11-25 with a minimal Electron
 * app): on Windows, getLoginItemSettings().openAtLogin stays FALSE
 * when the login item carries args — Electron compares the bare exe
 * path — even though the entry is written and enabled. The reliable
 * signal is executableWillLaunchAtLogin (true in the same call).
 * The registry value itself is named after the AppUserModelId
 * (com.khalid635.dovira), not the app name, and holds
 * "<exe>" --autostart. Fall back to openAtLogin only when the field
 * is absent (older Electron).
 */
export function applyAutoStart(app: AutoStartAppLike): boolean {
  try {
    app.setLoginItemSettings({ openAtLogin: true, args: [AUTO_START_ARG] })
  } catch {
    return false
  }
  try {
    const s = app.getLoginItemSettings()
    return s.executableWillLaunchAtLogin ?? s.openAtLogin
  } catch {
    return false
  }
}
