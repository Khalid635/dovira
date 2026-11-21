import { useState } from 'react'
import type { DownloadInfo } from '../../../main/types'
import { useStore, useT } from '../store'
import { formatBytes, formatEta, formatSpeed, formatTime } from '../util/format'
import { speedGraphPolyline } from '../util/graph'
import {
  IconAudio,
  IconCheck,
  IconChevronUp,
  IconClose,
  IconDownload,
  IconExternal,
  IconFolder,
  IconPause,
  IconPlay,
  IconRetry,
  IconTrash,
  IconVideo
} from './icons'

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

interface DownloadCardProps {
  d: DownloadInfo
  /** Phase 3: rank in the start order (queued/paused only) — drives "Waiting #n" + Move to top. */
  queuePosition?: number
  /** Phase 3: drag-and-drop queue reorder (App wires the handlers). */
  draggable?: boolean
  dragging?: boolean
  onDragStart?: () => void
  onDragEnd?: () => void
  onDropOn?: () => void
}

export default function DownloadCard({
  d,
  queuePosition,
  draggable = false,
  dragging = false,
  onDragStart,
  onDragEnd,
  onDropOn
}: DownloadCardProps): React.JSX.Element {
  const t = useT()
  const pause = useStore((s) => s.pause)
  const resume = useStore((s) => s.resume)
  const cancel = useStore((s) => s.cancel)
  const remove = useStore((s) => s.remove)
  const retry = useStore((s) => s.retry)
  const moveToTop = useStore((s) => s.moveToTop)
  // Phase 3: speed samples for the expanded card's graph.
  const samples = useStore((s) => s.speedHistory[d.id] ?? [])
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

  const kindIcon =
    d.kind === 'video' ? (
      <IconVideo size={18} />
    ) : d.kind === 'audio' ? (
      <IconAudio size={18} />
    ) : (
      <IconDownload size={18} />
    )

  return (
    <div
      className={`card card-download ${expanded ? 'card-download-expanded' : ''} ${
        dragging ? 'opacity-50' : ''
      }`}
      draggable={draggable}
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = 'move'
        onDragStart?.()
      }}
      onDragEnd={onDragEnd}
    >
      <div
        className="dl-grid cursor-pointer"
        onClick={() => setExpanded((v) => !v)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') setExpanded((v) => !v)
        }}
        onDragOver={(e) => {
          if (draggable) {
            e.preventDefault()
            e.dataTransfer.dropEffect = 'move'
          }
        }}
        onDrop={(e) => {
          if (draggable) {
            e.preventDefault()
            e.stopPropagation()
            onDropOn?.()
          }
        }}
      >
        {/* Thumbnail (real video art when available) over the kind icon. */}
        <div className="relative h-10 w-10 shrink-0 overflow-hidden rounded-lg bg-[var(--surface-2)]">
          <div className="flex h-full w-full items-center justify-center text-[var(--accent)]">
            {kindIcon}
          </div>
          {d.thumbnailUrl && (
            <img
              src={d.thumbnailUrl}
              alt=""
              className="thumb absolute inset-0 h-full w-full"
              onError={(e) => {
                ;(e.target as HTMLImageElement).style.display = 'none'
              }}
            />
          )}
        </div>
        <div className="min-w-0">
          <div className="truncate text-[14px] font-medium" title={d.filename}>
            {d.filename}
          </div>
          <div className="mt-0.5 truncate text-[12px] text-[var(--muted)]">{d.site ?? d.url}</div>
        </div>
        <div className="text-right text-[12px] tabular-nums text-[var(--muted)]">
          {d.totalBytes > 0 ? formatBytes(d.totalBytes) : t('status.unknownSize')}
        </div>
        <div>
          <span className={`badge ${STATUS_BADGE[d.status] ?? ''}`}>{t(statusKey)}</span>
        </div>
        <div className="text-right text-[12px] tabular-nums text-[var(--muted)]">
          {d.status === 'downloading' ? (
            <span>
              {formatSpeed(d.speedBps)} · ETA {formatEta(d.etaSeconds)}
            </span>
          ) : d.status === 'queued' && queuePosition ? (
            <span>{t('status.waiting', { n: queuePosition })}</span>
          ) : d.status === 'completed' && d.completedAt ? (
            <span className="inline-flex items-center gap-1 text-[var(--success)]">
              <IconCheck size={13} />
              {formatTime(d.completedAt)}
            </span>
          ) : d.totalBytes > 0 ? (
            <span>{pct}%</span>
          ) : (
            <span>—</span>
          )}
        </div>
        <div className="flex items-center justify-end gap-1" onClick={(e) => e.stopPropagation()}>
          {d.status === 'downloading' && (
            <>
              <button className="icon-btn" title={t('card.pause')} onClick={() => void pause(d.id)}>
                <IconPause size={15} />
              </button>
              <button
                className="icon-btn"
                title={t('card.cancel')}
                onClick={() => void cancel(d.id)}
              >
                <IconClose size={15} />
              </button>
            </>
          )}
          {d.status === 'paused' && (
            <>
              <button
                className="icon-btn icon-btn-accent"
                title={t('card.resume')}
                onClick={() => void resume(d.id)}
              >
                <IconPlay size={15} />
              </button>
              {queuePosition !== undefined && queuePosition > 1 && (
                <button
                  className="icon-btn"
                  title={t('card.moveToTop')}
                  onClick={() => void moveToTop(d.id)}
                >
                  <IconChevronUp size={15} />
                </button>
              )}
              <button
                className="icon-btn"
                title={t('card.cancel')}
                onClick={() => void cancel(d.id)}
              >
                <IconClose size={15} />
              </button>
            </>
          )}
          {d.status === 'queued' && (
            <>
              {queuePosition !== undefined && queuePosition > 1 && (
                <button
                  className="icon-btn"
                  title={t('card.moveToTop')}
                  onClick={() => void moveToTop(d.id)}
                >
                  <IconChevronUp size={15} />
                </button>
              )}
              <button
                className="icon-btn"
                title={t('card.cancel')}
                onClick={() => void cancel(d.id)}
              >
                <IconClose size={15} />
              </button>
            </>
          )}
          {d.status === 'failed' && (
            <>
              <button
                className="icon-btn icon-btn-accent"
                title={t('card.retry')}
                onClick={() => void retry(d.id)}
              >
                <IconRetry size={15} />
              </button>
              <button
                className="icon-btn icon-btn-danger"
                title={t('card.remove')}
                onClick={handleRemove}
              >
                <IconTrash size={15} />
              </button>
            </>
          )}
          {d.status === 'completed' && (
            <>
              <button
                className="icon-btn"
                title={t('card.open')}
                onClick={() => void window.dovira.openFile(d.id)}
              >
                <IconExternal size={15} />
              </button>
              <button
                className="icon-btn"
                title={t('card.showInFolder')}
                onClick={() => void window.dovira.showInFolder(d.id)}
              >
                <IconFolder size={15} />
              </button>
              <button
                className="icon-btn icon-btn-danger"
                title={t('card.remove')}
                onClick={handleRemove}
              >
                <IconTrash size={15} />
              </button>
            </>
          )}
          {d.status === 'cancelled' && (
            <>
              <button
                className="icon-btn icon-btn-accent"
                title={t('card.retry')}
                onClick={() => void retry(d.id)}
              >
                <IconRetry size={15} />
              </button>
              <button
                className="icon-btn icon-btn-danger"
                title={t('card.remove')}
                onClick={handleRemove}
              >
                <IconTrash size={15} />
              </button>
            </>
          )}
        </div>
      </div>

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

      <div className="mt-1.5 flex items-center gap-3 text-[12px] tabular-nums text-[var(--muted)]">
        {d.totalBytes > 0 ? (
          <span>
            {pct}% · {formatBytes(d.doneBytes)} / {formatBytes(d.totalBytes)}
          </span>
        ) : (
          <span>
            {formatBytes(d.doneBytes)} · {t('status.unknownSize')}
          </span>
        )}
        {d.status === 'failed' && (
          <span className="text-[var(--danger)]">
            {t(errorKey(d.errorCode))}
            {d.errorCode === 'network' && (
              <span className="block text-[var(--muted)]">{t('error.resumeNote')}</span>
            )}
          </span>
        )}
      </div>

      {expanded && (
        <div className="mt-2 border-t border-[var(--border)] pt-2 text-[12px]">
          {d.title && <div className="mb-1 break-all font-medium">{d.title}</div>}
          {/* Phase 3: speed graph — last 60 samples, only while downloading. */}
          {d.status === 'downloading' && samples.length > 0 && (
            <div className="speed-graph mb-2">
              <div className="mb-1 text-[var(--muted)]">
                {t('card.speedGraph')} · {formatSpeed(d.speedBps)}
              </div>
              <svg
                width="100%"
                height="36"
                viewBox="0 0 100 36"
                preserveAspectRatio="none"
                role="img"
                aria-label={t('card.speedGraph')}
              >
                <polyline
                  points={speedGraphPolyline(samples, 100, 36)}
                  fill="none"
                  stroke="var(--accent)"
                  strokeWidth="1.5"
                  vectorEffect="non-scaling-stroke"
                />
              </svg>
            </div>
          )}
          <div className="grid grid-cols-[110px_minmax(0,1fr)] gap-x-3 gap-y-1 text-[var(--muted)]">
            <span>{t('card.url')}</span>
            <span className="break-all">{d.url}</span>
            <span>{t('dialog.saveTo')}</span>
            <span className="break-all">{d.savePath}</span>
            <span>{t('card.format')}</span>
            <span>{d.formatLabel ?? '—'}</span>
            <span>{t('card.size')}</span>
            <span>{d.totalBytes > 0 ? formatBytes(d.totalBytes) : t('status.unknownSize')}</span>
            <span>{t('card.added')}</span>
            <span>{d.createdAt ? formatTime(d.createdAt) : '—'}</span>
          </div>
        </div>
      )}
    </div>
  )
}
