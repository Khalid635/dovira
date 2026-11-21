import type { DownloadInfo } from '../types'

/**
 * Smart filename suggestions land in Phase 7. Phase 1 keeps the interface
 * and returns the filename unchanged (no-op) — the space is reserved, the
 * work is not done yet (§2 AI-ready architecture).
 */
export function suggestName(download: Pick<DownloadInfo, 'filename'>): string {
  return download.filename
}
