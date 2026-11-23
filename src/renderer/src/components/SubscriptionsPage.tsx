// Next-level: channel subscriptions — a local list of channels /
// playlists polled in the background. New videos show up as pending
// and can be downloaded one by one. No server, no account.
import { useState } from 'react'
import { useStore, useT } from '../store'
import { IconBell, IconCheck, IconDownload, IconPlay, IconTrash } from './icons'

function addErrorKey(error: string | undefined): string {
  switch (error) {
    case 'invalid-url':
      return 'subs.addErrorInvalid'
    case 'unsupported-url':
      return 'subs.addErrorUnsupported'
    case 'not-playlist':
      return 'subs.addErrorNotPlaylist'
    case 'duplicate':
      return 'subs.addErrorDuplicate'
    case 'engine-missing':
      return 'subs.addErrorEngine'
    case 'fetch-failed':
    default:
      return 'subs.addErrorFetch'
  }
}

export default function SubscriptionsPage(): React.JSX.Element {
  const t = useT()
  const subscriptions = useStore((s) => s.subscriptions)
  const subscriptionsLoading = useStore((s) => s.subscriptionsLoading)
  const addSubscription = useStore((s) => s.addSubscription)
  const removeSubscription = useStore((s) => s.removeSubscription)
  const checkSubscriptions = useStore((s) => s.checkSubscriptions)
  const checkSubscription = useStore((s) => s.checkSubscription)
  const downloadSubscriptionVideo = useStore((s) => s.downloadSubscriptionVideo)
  const [url, setUrl] = useState('')
  const [adding, setAdding] = useState(false)
  const [addError, setAddError] = useState<string | null>(null)
  const [downloadingId, setDownloadingId] = useState<string | null>(null)

  const handleAdd = async (): Promise<void> => {
    const trimmed = url.trim()
    if (!trimmed) return
    setAdding(true)
    setAddError(null)
    try {
      const res = await addSubscription(trimmed)
      if (res.ok) {
        setUrl('')
      } else {
        setAddError(addErrorKey(res.error))
      }
    } finally {
      setAdding(false)
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-[18px] font-semibold">{t('subs.title')}</h2>
        <p className="mt-1 text-[13px] text-[var(--muted)]">{t('subs.hint')}</p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <input
          className="input min-w-0 flex-1"
          type="text"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void handleAdd()
          }}
          placeholder={t('subs.addPlaceholder')}
          aria-label={t('subs.addPlaceholder')}
        />
        <button
          type="button"
          className="btn btn-primary"
          disabled={adding || !url.trim()}
          onClick={() => void handleAdd()}
        >
          {adding ? t('subs.adding') : t('subs.add')}
        </button>
        <button
          type="button"
          className="btn"
          disabled={subscriptionsLoading}
          onClick={() => void checkSubscriptions()}
        >
          {subscriptionsLoading ? t('subs.checking') : t('subs.checkNow')}
        </button>
      </div>
      {addError && <div className="text-[13px] text-[var(--danger)]">{t(addError)}</div>}

      {subscriptions.length === 0 ? (
        <div className="card flex flex-col items-center gap-2 py-10 text-center text-[var(--muted)]">
          <IconBell size={28} />
          <div>{t('subs.empty')}</div>
        </div>
      ) : (
        subscriptions.map((sub) => (
          <div key={sub.id} className="card space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="truncate text-[14px] font-medium">{sub.title}</div>
                <div className="truncate text-[12px] text-[var(--muted)]">{sub.url}</div>
                <div className="mt-0.5 text-[12px] text-[var(--muted)]">
                  {sub.lastCheckedAt
                    ? t('subs.lastChecked', { time: new Date(sub.lastCheckedAt).toLocaleString() })
                    : t('subs.neverChecked')}
                  {sub.pending.length > 0 && (
                    <span className="ml-2 font-semibold text-[var(--accent)]">
                      {t('subs.newVideos', { n: sub.pending.length })}
                    </span>
                  )}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <button
                  type="button"
                  className="icon-btn"
                  title={t('subs.checkNow')}
                  disabled={subscriptionsLoading}
                  onClick={() => void checkSubscription(sub.id)}
                >
                  <IconCheck size={15} />
                </button>
                <button
                  type="button"
                  className="icon-btn icon-btn-danger"
                  title={t('subs.remove')}
                  onClick={() => void removeSubscription(sub.id)}
                >
                  <IconTrash size={15} />
                </button>
              </div>
            </div>
            {sub.pending.length === 0 ? (
              <div className="text-[13px] text-[var(--muted)]">{t('subs.noPending')}</div>
            ) : (
              <ul className="space-y-2">
                {sub.pending.map((video) => (
                  <li key={video.id} className="flex items-center gap-3">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--surface-2)] text-[var(--accent)]">
                      <IconPlay size={14} />
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[13px]" title={video.title}>
                      {video.title}
                    </span>
                    <button
                      type="button"
                      className="btn shrink-0"
                      disabled={downloadingId === video.id}
                      onClick={() => {
                        setDownloadingId(video.id)
                        void downloadSubscriptionVideo(sub.id, video).finally(() =>
                          setDownloadingId(null)
                        )
                      }}
                    >
                      <IconDownload size={14} />
                      {t('subs.download')}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))
      )}
    </div>
  )
}
