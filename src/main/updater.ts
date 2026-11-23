import { app } from 'electron'
import { autoUpdater, type UpdateDownloadedEvent } from 'electron-updater'
import { logMain } from './logger'
import { verifyFileAgainstChecksums } from './checksum'
import type { AppUpdateState, Settings } from './types'

/**
 * Phase 6: app auto-update via electron-updater + GitHub Releases.
 *
 * MANDATORY SECURITY GATE: an update is NEVER installed on the word of
 * the download alone. After electron-updater finishes downloading, the
 * file's SHA-256 is compared against the checksums.txt published with
 * the same release. Only a match reaches the 'install-ready' state, and
 * only 'install-ready' may call quitAndInstall(). On any verification
 * failure the update is cancelled, the app stays on the old version,
 * and the user is told why (Settings > App updates).
 *
 * Releases are pre-releases (allowPrerelease = true). Downloads never
 * start on their own (autoDownload = false) unless the user enabled
 * Settings > appUpdateAutoDownload.
 */

const CHECKSUMS_TIMEOUT_MS = 15_000

function checksumsUrl(version: string): string {
  return `https://github.com/Khalid635/dovira/releases/download/v${version}/checksums.txt`
}

/** Trim an updater error for display — never log a full URL query string. */
function errorText(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err)
  return msg.replace(/[?&][^\s]*/g, '').slice(0, 200)
}

export class AppUpdater {
  private state: AppUpdateState = { state: 'idle', version: null, progress: null, error: null }
  private downloadedFile: string | null = null
  // No parameter properties — Node's strip-only test runner cannot
  // parse them; explicit fields instead.
  private getSettings: () => Settings
  private emit: (s: AppUpdateState) => void

  constructor(getSettings: () => Settings, emit: (s: AppUpdateState) => void) {
    this.getSettings = getSettings
    this.emit = emit
    // Dev builds skip update checks unless forced — dev-app-update.yml
    // exists precisely so the updater can be exercised before packaging.
    if (!app.isPackaged) autoUpdater.forceDevUpdateConfig = true
    autoUpdater.allowPrerelease = true
    autoUpdater.autoDownload = false
    autoUpdater.autoInstallOnAppQuit = false
    autoUpdater.logger = {
      info: (message?: unknown) => logMain('info', `[updater] ${String(message)}`),
      warn: (message?: unknown) => logMain('warn', `[updater] ${String(message)}`),
      error: (message?: unknown) => logMain('error', `[updater] ${String(message)}`)
    }
    autoUpdater.on('checking-for-update', () => {
      this.setState({ state: 'checking', version: null, progress: null, error: null })
    })
    autoUpdater.on('update-available', (info) => {
      this.setState({ state: 'available', version: info.version, progress: null, error: null })
      logMain('info', `[updater] update available: ${info.version}`)
      if (this.getSettings().appUpdateAutoDownload) void this.download()
    })
    autoUpdater.on('update-not-available', (info) => {
      logMain('info', '[updater] no update available')
      this.setState({ state: 'not-available', version: info.version, progress: null, error: null })
    })
    autoUpdater.on('error', (err) => {
      logMain('error', `[updater] error: ${errorText(err)}`)
      this.setState({ state: 'error', version: null, progress: null, error: errorText(err) })
    })
    autoUpdater.on('download-progress', (p) => {
      this.setState({ state: 'downloading', progress: Math.round(p.percent), error: null })
    })
    autoUpdater.on('update-downloaded', (event) => {
      void this.verifyAndStage(event)
    })
  }

  getState(): AppUpdateState {
    return { ...this.state }
  }

  /** Start a check (no-op while a check/download/verification is running). */
  async check(): Promise<AppUpdateState> {
    if (['checking', 'downloading', 'verifying'].includes(this.state.state)) {
      return this.getState()
    }
    this.downloadedFile = null
    logMain('info', '[updater] checking for updates…')
    try {
      await autoUpdater.checkForUpdates()
    } catch (err) {
      logMain('error', `[updater] check failed: ${errorText(err)}`)
      this.setState({ state: 'error', version: null, progress: null, error: errorText(err) })
    }
    return this.getState()
  }

  /** Download the available update (only from the 'available' state). */
  async download(): Promise<AppUpdateState> {
    if (this.state.state !== 'available') return this.getState()
    try {
      await autoUpdater.downloadUpdate()
    } catch (err) {
      logMain('error', `[updater] download failed: ${errorText(err)}`)
      this.setState({ state: 'error', version: null, progress: null, error: errorText(err) })
    }
    return this.getState()
  }

  /**
   * The verification gate. Runs after electron-updater reports the
   * download complete: fetch the release's checksums.txt, compare the
   * downloaded file's SHA-256, and stage the install ONLY on a match.
   */
  private async verifyAndStage(event: UpdateDownloadedEvent): Promise<void> {
    this.setState({ state: 'verifying', version: event.version, progress: 100, error: null })
    logMain('info', `[updater] downloaded ${event.version}, verifying checksum…`)
    let sumsText: string
    try {
      const res = await fetch(checksumsUrl(event.version), {
        signal: AbortSignal.timeout(CHECKSUMS_TIMEOUT_MS)
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      sumsText = await res.text()
    } catch (err) {
      logMain('error', `[updater] checksums.txt unreachable: ${errorText(err)}`)
      this.setState({
        state: 'checksum-failed',
        version: event.version,
        progress: null,
        error: 'checksums-unavailable'
      })
      return
    }
    const result = await verifyFileAgainstChecksums(event.downloadedFile, sumsText)
    if (!result.ok) {
      logMain(
        'error',
        `[updater] CHECKSUM MISMATCH for ${event.version}: ` +
          `expected ${result.expected ?? '(not listed)'}, got ${result.actual} — update cancelled`
      )
      this.setState({
        state: 'checksum-failed',
        version: event.version,
        progress: null,
        error: result.expected ? 'checksum-mismatch' : 'checksums-missing'
      })
      return
    }
    logMain('info', `[updater] checksum verified for ${event.version} (${result.actual})`)
    this.downloadedFile = event.downloadedFile
    this.setState({ state: 'install-ready', version: event.version, progress: 100, error: null })
  }

  /**
   * Restart + install — ONLY from the 'install-ready' state (i.e. only
   * after the checksum gate passed). Returns false in every other state.
   */
  install(): boolean {
    if (this.state.state !== 'install-ready' || !this.downloadedFile) {
      logMain('warn', `[updater] install refused — state is ${this.state.state}`)
      return false
    }
    autoUpdater.quitAndInstall()
    return true
  }

  /** One delayed startup check, only when the setting is on. */
  startStartupCheck(delayMs: number): void {
    setTimeout(() => {
      if (this.getSettings().appUpdateCheck) void this.check()
    }, delayMs)
  }

  private setState(patch: Partial<AppUpdateState> & { state: AppUpdateState['state'] }): void {
    this.state = { ...this.state, ...patch }
    this.emit({ ...this.state })
  }
}
