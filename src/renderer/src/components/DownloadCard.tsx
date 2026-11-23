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
  IconGauge,
  IconPause,
  IconPin,
  IconPlay,
  IconRetry,
  IconStop,
  IconTrash,
  IconVideo
} from './icons'
import PreviewPlayer from './PreviewPlayer'

// Stable empty speed history — the selector below MUST return the same
// reference when a download has no samples yet. `?? []` allocates a new
// array on every call, and useSyncExternalStore treats each one as a
// changed snapshot, forcing re-renders until React throws #185
// (maximum update depth) and unmounts the whole tree. That blanked the
// app the moment any download was added (found 2026-11-22 in the v0.7.0
// verification; the bug predates the redesign — it was never caught
// because no earlier check rendered a download card in the UI).
const EMPTY_SPEED_SAMPLES: number[] = []

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
  // Next-level: pin / stop-recording / preview.
  const togglePin = useStore((s) => s.togglePin)
  const stopRecording = useStore((s) => s.stopRecording)
  const getPreviewUrl = useStore((s) => s.previewUrl)
  const [previewSrc, setPreviewSrc] = useState<string | null>(null)
  // Next-level: a live-stream recording is a yt-dlp row whose state
  // has liveRecord set — it gets a Stop button (keep the .ts file)
  // and a red REC badge instead of the normal Pause.
  const isLiveRecord = (() => {
    try {
      return (JSON.parse(d.ytdlpState ?? '{}') as { liveRecord?: boolean }).liveRecord === true
    } catch {
      return false
    }
  })()
  const isPreviewable = d.status === 'completed' && (d.kind === 'video' || d.kind === 'audio')
  // Phase 3: speed samples for the expanded card's graph.
  const samples = useStore((s) => s.speedHistory[d.id] ?? EMPTY_SPEED_SAMPLES)
  const [expanded, setExpanded] = useState(false)
  // Phase 7: effective limit — the card's own limit wins, else the global one.
  const settings = useStore((s) => s.settings)
  const setDownloadSpeedLimit = useStore((s) => s.setDownloadSpeedLimit)
  const effLimit = d.speedLimitKBps > 0 ? d.speedLimitKBps : (settings?.speedLimitKBps ?? 0)
  // Phase 7: torrents are aria2 rows whose URL is a magnet: link or a
  // .torrent file — the per-download limit is untested for them, so the
  // control stays hidden (the global limit still applies via aria2).
  const isTorrent =
    d.url.startsWith('magnet:') || d.url.toLowerCase().split('?')[0].endsWith('.torrent')

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
          {d.pinned && (
            <span className="badge badge-pinned ml-1" title={t('card.pinned')}>
              <IconPin size={11} />
            </span>
          )}
          {isLiveRecord && (d.status === 'downloading' || d.status === 'processing') && (
            <span className="badge badge-rec ml-1">● {t('card.recording')}</span>
          )}
        </div>
        <div className="text-right text-[12px] tabular-nums text-[var(--muted)]">
          {d.status === 'downloading' ? (
            <span>
              {effLimit > 0 && (
                <span className="badge badge-downloading mr-1">{t('status.limited')}</span>
              )}
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
              {isLiveRecord ? (
                <button
                  className="icon-btn icon-btn-danger"
                  title={t('card.stopRecording')}
                  onClick={() => void stopRecording(d.id)}
                >
                  <IconStop size={15} />
                </button>
              ) : (
                <button
                  className="icon-btn"
                  title={t('card.pause')}
                  onClick={() => void pause(d.id)}
                >
                  <IconPause size={15} />
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
          {d.status === 'processing' && isLiveRecord && (
            <button
              className="icon-btn icon-btn-danger"
              title={t('card.stopRecording')}
              onClick={() => void stopRecording(d.id)}
            >
              <IconStop size={15} />
            </button>
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
              <button
                className={`icon-btn ${d.pinned ? 'icon-btn-accent' : ''}`}
                title={d.pinned ? t('card.unpin') : t('card.pin')}
                onClick={() => void togglePin(d.id)}
              >
                <IconPin size={15} />
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
              <button
                className={`icon-btn ${d.pinned ? 'icon-btn-accent' : ''}`}
                title={d.pinned ? t('card.unpin') : t('card.pin')}
                onClick={() => void togglePin(d.id)}
              >
                <IconPin size={15} />
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
              {isPreviewable && (
                <button
                  className="icon-btn icon-btn-accent"
                  title={t('preview.title')}
                  onClick={() => {
                    void getPreviewUrl(d.id).then((url) => {
                      if (url) setPreviewSrc(url)
                    })
                  }}
                >
                  <IconPlay size={15} />
                </button>
              )}
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
          {/* Phase 7: per-download speed limit — torrents excluded (untested). */}
          {!isTorrent && (
            <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-[var(--border)] pt-3">
              <span className="inline-flex items-center gap-1.5 text-[var(--muted)]">
                <IconGauge size={13} />
                {t('download.speedLimit')}
              </span>
              <div className="seg-tabs" role="group" aria-label={t('download.speedLimit')}>
                <button
                  type="button"
                  className={`seg-tab ${d.speedLimitKBps === 0 ? 'seg-tab-active' : ''}`}
                  onClick={() => void setDownloadSpeedLimit(d.id, 0)}
                >
                  {t('download.speedLimitGlobal')}
                </button>
                {[100, 500, 1024].map((kbps) => (
                  <button
                    key={kbps}
                    type="button"
                    className={`seg-tab ${d.speedLimitKBps === kbps ? 'seg-tab-active' : ''}`}
                    onClick={() => void setDownloadSpeedLimit(d.id, kbps)}
                  >
                    {formatSpeed(kbps * 1024)}
                  </button>
                ))}
              </div>
              <label className="flex items-center gap-1 text-[12px] text-[var(--muted)]">
                <input
                  key={d.speedLimitKBps}
                  className="input w-20 py-1 text-[12px]"
                  type="number"
                  min={0}
                  max={1_000_000}
                  defaultValue={
                    ![0, 100, 500, 1024].includes(d.speedLimitKBps) && d.speedLimitKBps > 0
                      ? d.speedLimitKBps
                      : undefined
                  }
                  placeholder={t('settings.speedLimitCustom')}
                  onBlur={(e) => {
                    const v = Math.max(
                      0,
                      Math.min(1_000_000, Math.floor(Number(e.target.value) || 0))
                    )
                    void setDownloadSpeedLimit(d.id, v)
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
                  }}
                  aria-label={t('settings.speedLimitCustom')}
                />
                KB/s
              </label>
              {effLimit > 0 && (
                <span className="badge badge-downloading">
                  {t('status.limited')} · {formatSpeed(effLimit * 1024)}
                </span>
              )}
            </div>
          )}
        </div>
      )}
      {previewSrc && (
        <PreviewPlayer
          src={previewSrc}
          kind={d.kind}
          title={d.title ?? d.filename}
          onClose={() => setPreviewSrc(null)}
        />
      )}
    </div>
  )
}
