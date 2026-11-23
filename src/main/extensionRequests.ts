/**
 * Dialog-first extension handoff — the pending-request slot.
 *
 * The Local API stores an extension send here instead of running
 * yt-dlp extraction inline (which blocked the extension POST for
 * ~7–11 s). The renderer opens the Add dialog the moment the request
 * arrives and runs fetchInfo in the background; the IPC handlers take
 * the request when the user confirms, so the download runs with the
 * browser's per-link cookies / User-Agent / Referer.
 *
 * One slot at a time — the dialog shows a single URL. A second send
 * replaces the first (its temp cookies file is deleted: that download
 * never started). Pure module (node:fs only, no Electron imports) so
 * it is unit-testable in tests/extension-dialog-handoff.test.ts.
 */
import { existsSync, unlinkSync } from 'node:fs'
import type { ExtensionDownloadRequest } from './types'

export type { ExtensionDownloadRequest }

let pending: ExtensionDownloadRequest | null = null

function deleteCookiesFile(file: string | null): void {
  if (!file) return
  try {
    if (existsSync(file)) unlinkSync(file)
  } catch {
    // Stale temp file — harmless.
  }
}

/**
 * Store a new request, discarding any previous one. The previous
 * request's temp cookies file is deleted — its download never started.
 */
export function setExtensionRequest(req: ExtensionDownloadRequest): void {
  if (pending) deleteCookiesFile(pending.cookiesFile)
  pending = req
}

/** Read the pending request for this URL without consuming it (the dialog's fetchInfo uses it). */
export function peekExtensionRequest(url: string): ExtensionDownloadRequest | null {
  return pending && pending.url === url.trim() ? pending : null
}

/** Read whatever is pending (any URL) — the renderer's startup pull. */
export function peekAnyExtensionRequest(): ExtensionDownloadRequest | null {
  return pending
}

/**
 * Consume the pending request for this URL. The temp cookies file is
 * NOT deleted — the queue owns it from here (it deletes the file when
 * the download completes or is removed).
 */
export function takeExtensionRequest(url: string): ExtensionDownloadRequest | null {
  const req = peekExtensionRequest(url)
  if (req) pending = null
  return req
}

/**
 * Discard the pending request for this URL (the user cancelled the
 * dialog). Its temp cookies file IS deleted — the download never
 * started, so nothing needs it.
 */
export function discardExtensionRequest(url: string): void {
  const req = peekExtensionRequest(url)
  if (req) {
    pending = null
    deleteCookiesFile(req.cookiesFile)
  }
}

/** Discard whatever is pending (app shutdown) — its temp file goes too. */
export function discardPendingExtensionRequest(): void {
  if (pending) {
    deleteCookiesFile(pending.cookiesFile)
    pending = null
  }
}
