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
  if (s.includes('aria2c.exe') && s.includes('not found')) {
    return { code: 'engine-missing', raw }
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
