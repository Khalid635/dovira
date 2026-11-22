export interface FriendlyError {
  /** Stable code the UI maps to a localized message (see i18n error.* keys). */
  code: string
  /** Raw engine message, kept for "Copy details". */
  raw: string
}

/**
 * Map a raw engine/network error to a stable code.
 * The UI never shows raw aria2 output directly (§7.8).
 */
export function mapEngineError(raw: string): FriendlyError {
  const s = raw.toLowerCase()
  if (
    s.includes('no space') ||
    s.includes('not enough space') ||
    s.includes('disk full') ||
    s.includes('no space left')
  ) {
    return { code: 'no-space', raw }
  }
  // Phase 4: yt-dlp skipped a video already in the download archive.
  if (s.includes('has already been recorded in the archive')) {
    return { code: 'already-downloaded', raw }
  }
  if (s.includes('aria2c.exe') && s.includes('not found')) {
    return { code: 'engine-missing', raw }
  }
  // yt-dlp finished downloading but Windows locked the file while it was
  // being renamed into place (Defender/indexer). The queue retries the
  // rename itself; this code is only reached when that also fails.
  if (s.includes('unable to rename file')) {
    return { code: 'rename-locked', raw }
  }
  // yt-dlp video errors (§7.8).
  if (
    s.includes('video unavailable') ||
    s.includes('this video is unavailable') ||
    s.includes('private video') ||
    s.includes('this video is private') ||
    s.includes('has been removed') ||
    s.includes('has been deleted')
  ) {
    return { code: 'unavailable', raw }
  }
  if (
    s.includes('sign in') ||
    s.includes('log in') ||
    s.includes('login required') ||
    s.includes('confirm your age') ||
    s.includes('age-restricted') ||
    s.includes('age restricted')
  ) {
    return { code: 'login-required', raw }
  }
  if (s.includes('drm') || s.includes('encrypted')) return { code: 'drm', raw }
  if (
    s.includes('unsupported url') ||
    s.includes('no video formats found') ||
    s.includes('requested format is not available') ||
    s.includes('format is not available')
  ) {
    return { code: 'unsupported', raw }
  }
  if (
    s.includes('econnreset') ||
    s.includes('etimedout') ||
    s.includes('enotfound') ||
    s.includes('econnrefused') ||
    s.includes('econnaborted') ||
    s.includes('network') ||
    s.includes('unable to connect') ||
    s.includes('connection') ||
    s.includes('timed out') ||
    s.includes('name resolution') ||
    s.includes('remote host')
  ) {
    return { code: 'network', raw }
  }
  if (s.includes('404') || s.includes('not found')) {
    return { code: 'not-found', raw }
  }
  if (s.includes('403') || s.includes('forbidden')) {
    return { code: 'forbidden', raw }
  }
  if (s.includes('401') || s.includes('unauthorized')) {
    return { code: 'auth', raw }
  }
  return { code: 'unknown', raw }
}
