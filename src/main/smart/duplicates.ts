import type { DownloadInfo } from '../types'

export interface DuplicateCheck {
  duplicate: boolean
  existingId?: string
}

/**
 * Duplicate detection lands in Phase 7 (same URL / same name+size checks).
 * Phase 1 keeps the interface and always reports no duplicate (no-op) —
 * the space is reserved, the work is not done yet (§2).
 */
export function isDuplicate(_download: Pick<DownloadInfo, 'url' | 'filename'>): DuplicateCheck {
  void _download
  return { duplicate: false }
}
