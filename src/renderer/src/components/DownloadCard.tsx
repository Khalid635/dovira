import { useState } from 'react'
import type { DownloadInfo } from '../../../main/types'
import { useStore, useT } from '../store'
import { formatBytes, formatEta, formatSpeed, formatTime } from '../util/format'

const STATUS_BADGE: Record<string, string> = {
  downloading: 'badge-downloading',
  paused: 'badge-paused',
  queued: 'badge-queued',
  processing: 'badge-processing',
  completed: 'badge-completed',
  failed: 'badge-failed',
  cancelled: 'badge-cancelled'
}

function errorKey(code: string | null): string {
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

export default function DownloadCard({ d }: { d: DownloadInfo }): React.JSX.Element {
  const t = useT()
  const pause = useStore((s) => s.pause)
  const resume = useStore((s) => s.resume)
  const cancel = useStore((s) => s.cancel)
  const remove = useStore((s) => s.remove)
  const retry = useStore((s) => s.retry)
  const [expanded, setExpanded] = useState(false)

  const pct = d.totalBytes > 0 ? Math.min(100, Math.round((d.doneBytes / d.totalBytes) * 100)) : 0
  const statusKey = `status.${d.status}`

  const handleRemove = (): void => {
    if (window.confirm(t('card.confirmDeleteFile'))) {
      void remove(d.id, true)
    } else {
      void remove(d.id, false)
    }
  }

  return (
    <div className="card">
      <div
        className="flex cursor-pointer items-start gap-3"
        onClick={() => setExpanded((v) => !v)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') setExpanded((v) => !v)
        }}
      >
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[var(--surface-2)] text-[18px] font-semibold text-[var(--accent)]">
          {d.kind === 'video' ? '▸' : d.kind === 'audio' ? '♪' : '⤓'}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-[14px] font-medium" title={d.filename}>
              {d.filename}
            </span>
            <span className={`badge ${STATUS_BADGE[d.status] ?? ''}`}>{t(statusKey)}</span>
          </div>
          <div className="mt-0.5 truncate text-[12px] text-[var(--muted)]">{d.site ?? d.url}</div>
          <div className="progress-track mt-2">
            <div
              className={`progress-fill ${d.status === 'paused' ? 'progress-fill-paused' : ''} ${
                d.status === 'failed' ? 'progress-fill-failed' : ''
              } ${d.totalBytes === 0 && d.status === 'downloading' ? 'progress-fill-indeterminate' : ''}`}
              style={{
                width: d.totalBytes > 0 ? `${pct}%` : d.status === 'downloading' ? '30%' : '0%'
              }}
            />
          </div>
          <div className="mt-1 flex items-center gap-3 text-[12px] tabular-nums text-[var(--muted)]">
            {d.totalBytes > 0 ? (
              <span>
                {pct}% · {formatBytes(d.doneBytes)} / {formatBytes(d.totalBytes)}
              </span>
            ) : (
              <span>
                {formatBytes(d.doneBytes)} · {t('status.unknownSize')}
              </span>
            )}
            {d.status === 'downloading' && (
              <span>
                {formatSpeed(d.speedBps)} · ETA {formatEta(d.etaSeconds)}
              </span>
            )}
            {d.status === 'completed' && d.completedAt && <span>{formatTime(d.completedAt)}</span>}
          </div>
          {d.status === 'failed' && (
            <div className="mt-1 text-[12px] text-[var(--danger)]">
              {t(errorKey(d.errorCode))}
              {d.errorCode === 'network' && (
                <span className="block text-[var(--muted)]">{t('error.resumeNote')}</span>
              )}
            </div>
          )}
          {expanded && (
            <div className="mt-2 space-y-0.5 border-t border-[var(--border)] pt-2 text-[12px] text-[var(--muted)]">
              {d.title && <div className="break-all">{d.title}</div>}
              <div className="break-all">URL: {d.url}</div>
              <div className="break-all">Save to: {d.savePath}</div>
              <div>
                {d.formatLabel ? `${d.formatLabel} · ` : ''}
                {d.totalBytes > 0 ? formatBytes(d.totalBytes) : t('status.unknownSize')}
                {d.createdAt ? ` · ${formatTime(d.createdAt)}` : ''}
              </div>
            </div>
          )}
        </div>
        <div className="flex shrink-0 flex-col gap-1.5" onClick={(e) => e.stopPropagation()}>
          {d.status === 'downloading' && (
            <>
              <button className="btn btn-sm" onClick={() => void pause(d.id)}>
                {t('card.pause')}
              </button>
              <button className="btn btn-ghost btn-sm" onClick={() => void cancel(d.id)}>
                {t('card.cancel')}
              </button>
            </>
          )}
          {d.status === 'paused' && (
            <>
              <button className="btn btn-primary btn-sm" onClick={() => void resume(d.id)}>
                {t('card.resume')}
              </button>
              <button className="btn btn-ghost btn-sm" onClick={() => void cancel(d.id)}>
                {t('card.cancel')}
              </button>
            </>
          )}
          {d.status === 'queued' && (
            <button className="btn btn-ghost btn-sm" onClick={() => void cancel(d.id)}>
              {t('card.cancel')}
            </button>
          )}
          {d.status === 'failed' && (
            <>
              <button className="btn btn-primary btn-sm" onClick={() => void retry(d.id)}>
                {t('card.retry')}
              </button>
              <button className="btn btn-ghost btn-sm" onClick={handleRemove}>
                {t('card.remove')}
              </button>
            </>
          )}
          {d.status === 'completed' && (
            <>
              <button className="btn btn-sm" onClick={() => void window.dovira.openFile(d.id)}>
                {t('card.open')}
              </button>
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => void window.dovira.showInFolder(d.id)}
              >
                {t('card.showInFolder')}
              </button>
              <button className="btn btn-ghost btn-sm" onClick={handleRemove}>
                {t('card.remove')}
              </button>
            </>
          )}
          {d.status === 'cancelled' && (
            <>
              <button className="btn btn-primary btn-sm" onClick={() => void retry(d.id)}>
                {t('card.retry')}
              </button>
              <button className="btn btn-ghost btn-sm" onClick={handleRemove}>
                {t('card.remove')}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
