import { useEffect, useMemo } from 'react'
import { useStore, useT } from '../store'
import { formatBytes, formatEta, formatSpeed, errorKey } from '../util/format'
import { IconDownload } from './icons'

const STATUS_BADGE: Record<string, string> = {
  downloading: 'badge-downloading',
  paused: 'badge-paused',
  queued: 'badge-queued',
  processing: 'badge-processing',
  completed: 'badge-completed',
  failed: 'badge-failed',
  cancelled: 'badge-cancelled'
}

/**
 * IDM-style download progress window — one small window per download.
 *
 * Rendered instead of the whole app when the renderer URL carries
 * ?progress=<id> (see App.tsx). Shows filename, total/downloaded,
 * %, speed, ETA and Pause/Resume/Cancel; on completion it stays open
 * IDM-like with Open / Show in folder / Close (no auto-close — the
 * user acts on the finished file, then closes it).
 *
 * Live updates come from the store (the queue's progress/status
 * events reach every window via ipc.ts); the 2s refresh poll only
 * covers the row-removed edge — removing a download from the main
 * window emits no event, so without it this window would show a stale
 * row forever.
 */
export default function ProgressWindow({
  downloadId
}: {
  downloadId: string
}): React.JSX.Element {
  const t = useT()
  const init = useStore((s) => s.init)
  const loaded = useStore((s) => s.loaded)
  const settings = useStore((s) => s.settings)
  const downloads = useStore((s) => s.downloads)
  const refresh = useStore((s) => s.refresh)
  const pause = useStore((s) => s.pause)
  const resume = useStore((s) => s.resume)
  const cancel = useStore((s) => s.cancel)
  const retry = useStore((s) => s.retry)

  useEffect(() => {
    void init()
  }, [init])

  useEffect(() => {
    const timer = setInterval(() => {
      void refresh()
    }, 2000)
    return () => clearInterval(timer)
  }, [refresh])

  // Theme — same as App (Mint light default; 'system' resolves from the OS).
  const effectiveTheme = useMemo(() => {
    const theme = settings?.theme ?? 'light'
    return theme === 'system'
      ? window.matchMedia('(prefers-color-scheme: dark)').matches
        ? 'dark'
        : 'light'
      : theme
  }, [settings?.theme])

  useEffect(() => {
    document.documentElement.dataset.theme = effectiveTheme
  }, [effectiveTheme])

  const d = downloads.find((x) => x.id === downloadId)
  const pct =
    d && d.totalBytes > 0 ? Math.min(100, Math.round((d.doneBytes / d.totalBytes) * 100)) : 0

  // Window title shows the live percentage, like IDM.
  useEffect(() => {
    document.title =
      d && (d.status === 'downloading' || d.status === 'processing')
        ? `${pct}% — ${d.filename}`
        : (d?.filename ?? 'DOVIRA')
  }, [d, pct])

  const close = (): void => window.close()

  if (!loaded) {
    return (
      <div className="flex h-screen items-center justify-center text-[14px] text-[var(--muted)]">
        {t('app.loading')}
      </div>
    )
  }

  if (!d) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-3 p-4 text-center">
        <div className="text-[14px] text-[var(--muted)]">{t('progress.notFound')}</div>
        <button type="button" className="btn" onClick={close}>
          {t('progress.close')}
        </button>
      </div>
    )
  }

  // The i18n key for fetching_info is camelCase (status.fetchingInfo).
  const statusKey = `status.${d.status === 'fetching_info' ? 'fetchingInfo' : d.status}`

  return (
    <div className="flex h-screen flex-col gap-3 p-4">
      <div className="flex items-center gap-2">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[var(--surface-2)] text-[var(--accent)]">
          <IconDownload size={18} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[14px] font-medium" title={d.filename}>
            {d.filename}
          </div>
          <div className="mt-0.5 truncate text-[12px] text-[var(--muted)]">{d.site ?? d.url}</div>
        </div>
        <span className={`badge ${STATUS_BADGE[d.status] ?? ''}`}>{t(statusKey)}</span>
      </div>

      <div className="progress-track">
        <div
          className={`progress-fill ${d.status === 'paused' ? 'progress-fill-paused' : ''} ${
            d.status === 'failed' ? 'progress-fill-failed' : ''
          } ${d.totalBytes === 0 && d.status === 'downloading' ? 'progress-fill-indeterminate' : ''}`}
          style={{
            width: d.totalBytes > 0 ? `${pct}%` : d.status === 'downloading' ? '30%' : '0%'
          }}
        />
      </div>

      <div className="flex items-center justify-between gap-2 text-[12px] tabular-nums text-[var(--muted)]">
        <span>
          {d.totalBytes > 0 ? (
            <>
              {pct}% · {formatBytes(d.doneBytes)} / {formatBytes(d.totalBytes)}
            </>
          ) : (
            <>
              {formatBytes(d.doneBytes)} · {t('status.unknownSize')}
            </>
          )}
        </span>
        {d.status === 'downloading' && (
          <span>
            {formatSpeed(d.speedBps)} · ETA {formatEta(d.etaSeconds)}
          </span>
        )}
      </div>

      {d.status === 'failed' && d.errorCode && (
        <div className="text-[12px] text-[var(--danger)]">{t(errorKey(d.errorCode))}</div>
      )}

      <div className="mt-auto flex items-center justify-end gap-2">
        {d.status === 'downloading' && (
          <>
            <button type="button" className="btn" onClick={() => void pause(d.id)}>
              {t('card.pause')}
            </button>
            <button type="button" className="btn" onClick={() => void cancel(d.id)}>
              {t('card.cancel')}
            </button>
          </>
        )}
        {d.status === 'paused' && (
          <>
            <button type="button" className="btn btn-accent" onClick={() => void resume(d.id)}>
              {t('card.resume')}
            </button>
            <button type="button" className="btn" onClick={() => void cancel(d.id)}>
              {t('card.cancel')}
            </button>
          </>
        )}
        {(d.status === 'queued' || d.status === 'fetching_info' || d.status === 'processing') && (
          <button type="button" className="btn" onClick={() => void cancel(d.id)}>
            {t('card.cancel')}
          </button>
        )}
        {d.status === 'completed' && (
          <>
            <button
              type="button"
              className="btn"
              onClick={() => void window.dovira.openFile(d.id)}
            >
              {t('card.open')}
            </button>
            <button
              type="button"
              className="btn"
              onClick={() => void window.dovira.showInFolder(d.id)}
            >
              {t('card.showInFolder')}
            </button>
            <button type="button" className="btn btn-accent" onClick={close}>
              {t('progress.close')}
            </button>
          </>
        )}
        {d.status === 'failed' && (
          <>
            <button type="button" className="btn btn-accent" onClick={() => void retry(d.id)}>
              {t('card.retry')}
            </button>
            <button type="button" className="btn" onClick={close}>
              {t('progress.close')}
            </button>
          </>
        )}
        {d.status === 'cancelled' && (
          <button type="button" className="btn" onClick={close}>
            {t('progress.close')}
          </button>
        )}
      </div>
    </div>
  )
}
