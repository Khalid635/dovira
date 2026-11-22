import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { basename } from 'node:path'

/**
 * Phase 6: SHA-256 checksum verification — the gate between "an update
 * was downloaded" and "the update may be installed". Pure functions, no
 * Electron dependency, so the same code is unit-testable from plain Node.
 *
 * checksums.txt format (GNU sha256sum, one line per release file):
 *   <sha256>  <filename>
 * Lines with a `*` before the filename (binary mode) are accepted too.
 */

export function sha256File(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256')
    const stream = createReadStream(filePath)
    stream.on('data', (chunk) => hash.update(chunk as Buffer))
    stream.on('end', () => resolve(hash.digest('hex')))
    stream.on('error', reject)
  })
}

/** Parse a checksums.txt body into filename → lowercase hex hash. */
export function parseChecksums(text: string): Map<string, string> {
  const out = new Map<string, string>()
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line) continue
    // "<hash>  <filename>" or "<hash> *<filename>"
    const m = /^([0-9a-fA-F]{64})\s+\*?(\S+)$/.exec(line)
    if (!m) continue
    out.set(m[2], m[1].toLowerCase())
  }
  return out
}

export interface ChecksumResult {
  /** True when the file's hash matches the published one. */
  ok: boolean
  /** The hash published in checksums.txt (undefined when the file is not listed). */
  expected?: string
  /** The hash actually computed from the downloaded file. */
  actual: string
}

/**
 * Verify a downloaded file against a checksums.txt body. The lookup key
 * is the file's own basename (the release publishes one checksum per
 * installer file). Returns ok:false when the file is not listed at all —
 * an unlisted file is never installed.
 */
export async function verifyFileAgainstChecksums(
  filePath: string,
  checksumsText: string
): Promise<ChecksumResult> {
  const actual = (await sha256File(filePath)).toLowerCase()
  const sums = parseChecksums(checksumsText)
  const expected = sums.get(basename(filePath))
  if (!expected) return { ok: false, actual }
  return { ok: expected === actual, expected, actual }
}
