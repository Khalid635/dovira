export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '0 B'
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let v = bytes
  let i = -1
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  return `${v.toFixed(v >= 100 ? 0 : 1)} ${units[i]}`
}

export function formatSpeed(bps: number): string {
  if (!Number.isFinite(bps) || bps <= 0) return '0 KB/s'
  return `${formatBytes(bps)}/s`
}

export function formatEta(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds) || seconds < 0) return '—'
  if (seconds < 60) return `${seconds}s`
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  if (m < 60) return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  const h = Math.floor(m / 60)
  return `${h}:${String(m % 60).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

export function formatTime(ts: number | null): string {
  if (!ts) return ''
  return new Date(ts).toLocaleString()
}

/** Download error-code → i18n key (shared by DownloadCard + ProgressWindow). */
export function errorKey(code: string | null): string {
  switch (code) {
    case 'no-space':
      return 'error.no-space'
    case 'network':
      return 'error.network'
    case 'not-found':
      return 'error.not-found'
    case 'forbidden':
      return 'error.forbidden'
    case 'auth':
      return 'error.auth'
    case 'engine-missing':
      return 'error.engine-missing'
    case 'invalid-url':
      return 'error.invalid-url'
    case 'unsupported-url':
      return 'error.unsupported-url'
    case 'unavailable':
      return 'error.unavailable'
    case 'login-required':
      return 'error.loginRequired'
    case 'unsupported':
      return 'error.unsupported'
    case 'drm':
      return 'error.drm'
    case 'resume-state-mismatch':
      return 'error.resumeMismatch'
    case 'rename-locked':
      return 'error.renameLocked'
    default:
      return 'error.unknown'
  }
}

/**
 * The timestamp History shows for a finished row: when it completed —
 * the same time Home shows for the row — falling back to when it was
 * added for rows that never completed (failed / cancelled, or a
 * completed row with no completion time recorded). Using createdAt
 * here made the same download show two different times (Home 1:52:52
 * vs History 1:52:29 for a 21s download).
 */
export function historyTime(d: {
  status: string
  createdAt: number
  completedAt: number | null
}): number {
  return d.status === 'completed' && d.completedAt ? d.completedAt : d.createdAt
}
