import { useMemo, useState } from 'react'
import type { GrabberItem, GrabberKind, GrabberScanResult } from '../../../main/types'
import { useStore, useT } from '../store'
import { formatBytes } from '../util/format'
import { IconAlert, IconClose, IconGlobe } from './icons'

type KindFilter = 'all' | GrabberKind

const KIND_LABEL_KEYS: Record<GrabberKind, string> = {
  image: 'grabber.kindImage',
  video: 'grabber.kindVideo',
  audio: 'grabber.kindAudio',
  document: 'grabber.kindDocument',
  archive: 'grabber.kindArchive',
  other: 'grabber.kindOther'
}

function errorKey(code: string | undefined): string {
  switch (code) {
    case 'invalid-url':
      return 'grabber.invalidUrl'
    case 'not-found':
      return 'grabber.pageNotFound'
    case 'forbidden':
      return 'grabber.forbidden'
    case 'network':
      return 'grabber.networkError'
    case 'not-html':
      return 'grabber.notHtml'
    case 'page-too-large':
      return 'grabber.pageTooLarge'
    default:
      return 'grabber.unknownError'
  }
}

export default function SiteGrabberDialog(): React.JSX.Element | null {
  const t = useT()
  const open = useStore((s) => s.grabberOpen)
  const closeGrabber = useStore((s) => s.closeGrabber)
  const refresh = useStore((s) => s.refresh)
  const showToast = useStore((s) => s.showToast)

  const [url, setUrl] = useState('')
  const [scanning, setScanning] = useState(false)
  const [result, setResult] = useState<GrabberScanResult | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [kindFilter, setKindFilter] = useState<KindFilter>('all')
  const [adding, setAdding] = useState(false)

  // Kind counts for the filter pills.
  const kindCounts = useMemo(() => {
    const counts = new Map<GrabberKind, number>()
    for (const item of result?.items ?? []) {
      counts.set(item.kind, (counts.get(item.kind) ?? 0) + 1)
    }
    return counts
  }, [result])

  const visibleItems = useMemo(() => {
    const items = result?.items ?? []
    if (kindFilter === 'all') return items
    return items.filter((i) => i.kind === kindFilter)
  }, [result, kindFilter])

  const selectedItems = useMemo(
    () => (result?.items ?? []).filter((i) => selected.has(i.url)),
    [result, selected]
  )
  const selectedBytes = selectedItems.reduce((sum, i) => sum + (i.sizeBytes ?? 0), 0)

  if (!open) return null

  const scan = async (): Promise<void> => {
    const value = url.trim()
    if (!value || scanning) return
    setScanning(true)
    setResult(null)
    setSelected(new Set())
    setKindFilter('all')
    try {
      const res = await window.dovira.scanPage(value)
      setResult(res)
      if (res.ok) setSelected(new Set(res.items.map((i) => i.url)))
    } catch {
      setResult({ ok: false, pageUrl: value, title: null, items: [], error: 'unknown' })
    } finally {
      setScanning(false)
    }
  }

  const toggle = (item: GrabberItem): void => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(item.url)) next.delete(item.url)
      else next.add(item.url)
      return next
    })
  }

  const selectVisible = (on: boolean): void => {
    setSelected((prev) => {
      const next = new Set(prev)
      for (const item of visibleItems) {
        if (on) next.add(item.url)
        else next.delete(item.url)
      }
      return next
    })
  }

  const downloadSelected = async (): Promise<void> => {
    if (selectedItems.length === 0 || adding) return
    setAdding(true)
    try {
      const res = await window.dovira.addGrabbedLinks(selectedItems.map((i) => i.url))
      if (res.added > 0) {
        showToast('grabber.added', { count: res.added })
        await refresh()
        closeGrabber()
        setResult(null)
        setSelected(new Set())
        setUrl('')
      }
    } finally {
      setAdding(false)
    }
  }

  const kinds: GrabberKind[] = ['image', 'video', 'audio', 'document', 'archive', 'other']

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4 pt-[8vh]"
      onClick={closeGrabber}
    >
      <div
        className="card w-full max-w-[640px] p-0 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label={t('grabber.title')}
      >
        {/* Header — globe mark + title, same language as the Add dialog. */}
        <div className="flex items-start gap-3 border-b border-[var(--border)] px-5 pb-4 pt-5">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[color-mix(in_srgb,var(--accent)_16%,transparent)] text-[var(--accent)]">
            <IconGlobe size={20} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[16px] font-semibold leading-tight">{t('grabber.title')}</div>
            <div className="mt-0.5 text-[13px] text-[var(--muted)]">{t('grabber.subtitle')}</div>
          </div>
          <button className="icon-btn" onClick={closeGrabber} aria-label={t('dialog.cancel')}>
            <IconClose size={15} />
          </button>
        </div>

        <div className="px-5 py-4">
          {/* URL row */}
          <label className="mb-1 block text-[13px] text-[var(--muted)]">
            {t('grabber.urlLabel')}
          </label>
          <div className="flex gap-2">
            <input
              className="input flex-1"
              type="url"
              value={url}
              placeholder={t('grabber.urlPlaceholder')}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void scan()
              }}
              autoFocus
            />
            <button
              className="btn btn-primary"
              disabled={scanning || !url.trim()}
              onClick={() => void scan()}
            >
              {scanning ? t('grabber.scanning') : t('grabber.scan')}
            </button>
          </div>

          {/* Scanning state */}
          {scanning && (
            <div className="mt-4 flex items-center gap-2 text-[13px] text-[var(--muted)]">
              <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-[var(--border)] border-t-[var(--accent)]" />
              {t('grabber.scanning')}
            </div>
          )}

          {/* Error state — a real message, never a bare spinner. */}
          {!scanning && result && !result.ok && (
            <div className="mt-4 rounded-xl border border-[color-mix(in_srgb,var(--danger)_30%,transparent)] bg-[color-mix(in_srgb,var(--danger)_8%,transparent)] px-4 py-3">
              <div className="flex items-center gap-2 text-[13px] font-medium text-[var(--danger)]">
                <IconAlert size={15} />
                {t(errorKey(result.error))}
              </div>
              {result.error === 'forbidden' && (
                <div className="mt-1 pl-6 text-[12px] text-[var(--muted)]">
                  {t('grabber.loginNeeded')}
                </div>
              )}
            </div>
          )}

          {/* Empty state */}
          {!scanning && result?.ok && result.items.length === 0 && (
            <div className="mt-4 rounded-xl bg-[var(--surface-2)] px-4 py-6 text-center">
              <div className="text-[14px] font-medium">{t('grabber.noResults')}</div>
              {result.title && (
                <div className="mt-1 truncate text-[12px] text-[var(--muted)]">{result.title}</div>
              )}
            </div>
          )}

          {/* Results */}
          {!scanning && result?.ok && result.items.length > 0 && (
            <div className="mt-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[13px] font-medium">
                  {t('grabber.found', { count: result.items.length })}
                </span>
                {result.title && (
                  <span className="min-w-0 flex-1 truncate text-[12px] text-[var(--muted)]">
                    {result.title}
                  </span>
                )}
              </div>

              {/* Kind filter pills with counts. */}
              <div
                className="seg-tabs mt-3 flex flex-wrap"
                role="group"
                aria-label={t('grabber.title')}
              >
                <button
                  type="button"
                  className={`seg-tab ${kindFilter === 'all' ? 'seg-tab-active' : ''}`}
                  onClick={() => setKindFilter('all')}
                >
                  {t('sidebar.all')} ({result.items.length})
                </button>
                {kinds
                  .filter((k) => (kindCounts.get(k) ?? 0) > 0)
                  .map((k) => (
                    <button
                      key={k}
                      type="button"
                      className={`seg-tab ${kindFilter === k ? 'seg-tab-active' : ''}`}
                      onClick={() => setKindFilter(k)}
                    >
                      {t(KIND_LABEL_KEYS[k])} ({kindCounts.get(k)})
                    </button>
                  ))}
              </div>

              {/* File list — checkbox rows, scrollable when long. */}
              <div className="mt-3 max-h-[300px] space-y-1 overflow-y-auto pr-1">
                {visibleItems.map((item) => {
                  const checked = selected.has(item.url)
                  return (
                    <label
                      key={item.url}
                      className={`flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-[13px] transition-colors hover:bg-[var(--surface-2)] ${
                        checked ? 'bg-[color-mix(in_srgb,var(--accent)_8%,transparent)]' : ''
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggle(item)}
                        className="h-4 w-4 shrink-0 accent-[var(--accent)]"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium" title={item.filename}>
                          {item.filename}
                        </span>
                        <span
                          className="block truncate text-[12px] text-[var(--muted)]"
                          title={item.url}
                        >
                          {item.url}
                        </span>
                      </span>
                      <span className="badge shrink-0">
                        {item.kind === 'other'
                          ? item.ext.toUpperCase() || 'FILE'
                          : t(KIND_LABEL_KEYS[item.kind])}
                      </span>
                      <span className="w-16 shrink-0 text-right text-[12px] tabular-nums text-[var(--muted)]">
                        {item.sizeBytes !== null ? formatBytes(item.sizeBytes) : '—'}
                      </span>
                    </label>
                  )
                })}
              </div>
            </div>
          )}
        </div>

        {/* Footer — selection summary + primary action. */}
        {result?.ok && result.items.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 border-t border-[var(--border)] px-5 py-4">
            <button
              type="button"
              className="toolbar-btn"
              onClick={() => selectVisible(selectedItems.length < visibleItems.length)}
            >
              {selectedItems.length < visibleItems.length
                ? t('grabber.selectAll')
                : t('grabber.deselectAll')}
            </button>
            <span className="text-[12px] tabular-nums text-[var(--muted)]">
              {t('grabber.totalSize', {
                count: selectedItems.length,
                size: selectedBytes > 0 ? formatBytes(selectedBytes) : '—'
              })}
            </span>
            <span className="flex-1" />
            <button
              className="btn btn-primary"
              disabled={selectedItems.length === 0 || adding}
              onClick={() => void downloadSelected()}
            >
              {t('grabber.downloadSelected')}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
