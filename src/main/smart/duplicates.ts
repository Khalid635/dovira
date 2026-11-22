/**
 * Phase 7 (v1.0) — Duplicate Detection.
 *
 * Two checks, both local:
 *   (a) the database: same URL, or same extractor+video-id+format, among
 *       COMPLETED downloads only (live rows already resume instead);
 *   (b) the destination folder: a file with the same name and size.
 * The queue owns the actual lookups (it has the db + fs); this module
 * holds the shared types and the on-disk check.
 */
import { existsSync, statSync } from 'node:fs'
import { join } from 'node:path'

export interface DuplicateQuery {
  url: string
  filename: string
  saveDir: string
  totalBytes: number | null
  remoteId?: string | null
  formatId?: string | null
}

export interface DuplicateInfo {
  duplicate: boolean
  /** Which check hit: 'url' | 'remote' (extractor+id+format) | 'file' (name+size). */
  kind?: 'url' | 'remote' | 'file'
  existingId?: string
  existingName?: string
  existingSize?: number | null
  existingCompletedAt?: number | null
}

export const NO_DUPLICATE: DuplicateInfo = { duplicate: false }

/** On-disk check: same name + same size in the destination folder. */
export function findFileDuplicate(
  saveDir: string,
  filename: string,
  totalBytes: number | null
): { name: string; size: number; mtimeMs: number } | null {
  if (!filename) return null
  const full = join(saveDir, filename)
  try {
    if (!existsSync(full)) return null
    const st = statSync(full)
    if (!st.isFile()) return null
    // totalBytes unknown (no size from the source): name alone is enough
    // to warn — the dialog shows the size so the user can judge.
    if (totalBytes === null || totalBytes <= 0) {
      return { name: filename, size: st.size, mtimeMs: st.mtimeMs }
    }
    if (st.size === totalBytes) {
      return { name: filename, size: st.size, mtimeMs: st.mtimeMs }
    }
    return null
  } catch {
    return null
  }
}
