import { useEffect, useMemo, useState } from 'react'
import { useStore, useT } from '../store'
import { formatBytes, formatTime, historyTime } from '../util/format'
import { IconExternal, IconFolder, IconRetry, IconTrash } from './icons'

type DateFilter = 'all' | 'today' | 'week'
type KindFilter = 'all' | 'video' | 'audio' | 'file'
type StatusFilter = 'all' | 'completed' | 'failed' | 'cancelled'

const BADGE: Record<string, string> = {
  completed: 'badge-completed',
  failed: 'badge-failed',
  cancelled: 'badge-cancelled'
}

/**
 * Phase 3: History — past downloads only (completed / failed / cancelled).
 * Search + date/kind/status/site filters, a "File missing" badge for rows
 * whose file is gone from disk, Re-download, per-row Delete record, and
 * Clear history (records only — files are never deleted here).
 */
export default function HistoryPage(): React.JSX.Element {
  const t = useT()
  const downloads = useStore((s) => s.downloads)
  const historyMissing = useStore((s) => s.historyMissing)
  const redownload = useStore((s) => s.redownload)
  const clearHistory = useStore((s) => s.clearHistory)
  const remove = useStore((s) => s.remove)
  const showToast = useStore((s) => s.showToast)

  const [search, setSearch] = useState('')
  const [dateFilter, setDateFilter] = useState<DateFilter>('all')
  const [kindFilter, setKindFilter] = useState<KindFilter>('all')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [siteFilter, setSiteFilter] = useState('all')
  const [missingIds, setMissingIds] = useState<string[]>([])
  // "Today"/"last 7 days" boundaries, fixed once per mount — computing them
  // inside the filter's useMemo would call impure Date.now() during render.
  const [dayStartMs] = useState(() => {
    const d = new Date()
    d.setHours(0, 0, 0, 0)
    return d.getTime()
  })
  const [weekAgoMs] = useState(() => Date.now() - 7 * 24 * 60 * 60 * 1000)

  useEffect(() => {
    let cancelled = false
    void historyMissing().then((ids) => {
      if (!cancelled) setMissingIds(ids)
    })
    return () => {
      cancelled = true
    }
  }, [downloads, historyMissing])

  const finished = useMemo(
    () =>
      downloads.filter(
        (d) => d.status === 'completed' || d.status === 'failed' || d.status === 'cancelled'
      ),
    [downloads]
  )

  const sites = useMemo(() => {
    const out = new Set<string>()
    for (const d of finished) if (d.site) out.add(d.site)
    return [...out].sort()
  }, [finished])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return finished.filter((d) => {
      if (q) {
        const hay = `${d.filename} ${d.title ?? ''} ${d.url} ${d.site ?? ''}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      // The date filters use the same time the row displays, so "today"
      // means "finished today" — not "added today".
      if (dateFilter === 'today' && historyTime(d) < dayStartMs) return false
      if (dateFilter === 'week' && historyTime(d) < weekAgoMs) return false
      if (kindFilter !== 'all' && d.kind !== kindFilter) return false
      if (statusFilter !== 'all' && d.status !== statusFilter) return false
      if (siteFilter !== 'all' && d.site !== siteFilter) return false
      return true
    })
  }, [finished, search, dateFilter, kindFilter, statusFilter, siteFilter, dayStartMs, weekAgoMs])

  const handleClear = (): void => {
    if (!window.confirm(t('history.clearConfirm'))) return
    void clearHistory().then((n) => {
      showToast('toast.historyCleared', { n })
    })
  }

  const handleRedownload = (id: string): void => {
    void redownload(id).then((res) => {
      if (!res.ok) showToast('toast.redownloadFailed')
    })
  }

  const handleDeleteRecord = (id: string): void => {
    if (!window.confirm(t('history.deleteConfirm'))) return
    void remove(id, false)
  }

  return (
    <div className="flex h-full flex-col gap-3 overflow-y-auto p-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-[16px] font-semibold">{t('history.title')}</h2>
        <button className="btn btn-sm" onClick={handleClear} disabled={finished.length === 0}>
          {t('history.clear')}
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <input
          className="input min-w-[200px] flex-1"
          type="search"
          placeholder={t('history.search')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select
          className="input"
          value={dateFilter}
          onChange={(e) => setDateFilter(e.target.value as DateFilter)}
          aria-label={t('history.filterDate')}
        >
          <option value="all">{t('history.filterDateAll')}</option>
          <option value="today">{t('history.filterDateToday')}</option>
          <option value="week">{t('history.filterDateWeek')}</option>
        </select>
        <select
          className="input"
          value={kindFilter}
          onChange={(e) => setKindFilter(e.target.value as KindFilter)}
          aria-label={t('history.filterKind')}
        >
          <option value="all">{t('history.filterKindAll')}</option>
          <option value="video">{t('history.filterKindVideo')}</option>
          <option value="audio">{t('history.filterKindAudio')}</option>
          <option value="file">{t('history.filterKindFile')}</option>
        </select>
        <select
          className="input"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
          aria-label={t('history.filterStatus')}
        >
          <option value="all">{t('history.filterStatusAll')}</option>
          <option value="completed">{t('history.filterStatusCompleted')}</option>
          <option value="failed">{t('history.filterStatusFailed')}</option>
          <option value="cancelled">{t('history.filterStatusCancelled')}</option>
        </select>
        <select
          className="input"
          value={siteFilter}
          onChange={(e) => setSiteFilter(e.target.value)}
          aria-label={t('history.filterSite')}
        >
          <option value="all">{t('history.filterSiteAll')}</option>
          {sites.map((site) => (
            <option key={site} value={site}>
              {site}
            </option>
          ))}
        </select>
      </div>

      {filtered.length === 0 ? (
        <div className="card p-8 text-center text-[var(--muted)]">{t('history.empty')}</div>
      ) : (
        <div className="flex flex-col gap-2">
          {filtered.map((d) => {
            const missing = missingIds.includes(d.id)
            return (
              <div key={d.id} className="card card-download">
                <div className="flex items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[14px] font-medium" title={d.filename}>
                      {d.filename}
                    </div>
                    <div className="mt-0.5 truncate text-[12px] text-[var(--muted)]">
                      {d.site ?? d.url} ·{' '}
                      {d.totalBytes > 0 ? formatBytes(d.totalBytes) : t('status.unknownSize')} ·{' '}
                      {formatTime(historyTime(d)) || '—'}
                    </div>
                  </div>
                  <span className={`badge ${BADGE[d.status] ?? ''}`}>
                    {t(`status.${d.status}`)}
                  </span>
                  {missing && (
                    <span className="badge badge-failed">{t('history.fileMissing')}</span>
                  )}
                  <div className="flex items-center gap-1">
                    {d.status === 'completed' && !missing && (
                      <>
                        <button
                          className="icon-btn"
                          title={t('history.open')}
                          onClick={() => void window.dovira.openFile(d.id)}
                        >
                          <IconExternal size={15} />
                        </button>
                        <button
                          className="icon-btn"
                          title={t('history.showInFolder')}
                          onClick={() => void window.dovira.showInFolder(d.id)}
                        >
                          <IconFolder size={15} />
                        </button>
                      </>
                    )}
                    <button
                      className="icon-btn icon-btn-accent"
                      title={t('history.redownload')}
                      onClick={() => handleRedownload(d.id)}
                    >
                      <IconRetry size={15} />
                    </button>
                    <button
                      className="icon-btn icon-btn-danger"
                      title={t('history.deleteRecord')}
                      onClick={() => handleDeleteRecord(d.id)}
                    >
                      <IconTrash size={15} />
                    </button>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
