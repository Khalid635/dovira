import { useEffect, useMemo, useRef, useState } from 'react'
import Sidebar from './components/Sidebar'
import DownloadCard from './components/DownloadCard'
import HistoryPage from './components/HistoryPage'
import AssistantPage from './components/AssistantPage'
import StatusBar from './components/StatusBar'
import SettingsPage from './components/SettingsPage'
import AddDownloadDialog from './components/AddDownloadDialog'
import SiteGrabberDialog from './components/SiteGrabberDialog'
import SetupWizard from './components/SetupWizard'
import StatsRow from './components/StatsRow'
import {
  IconAlert,
  IconDownload,
  IconPause,
  IconPlay,
  IconPlus,
  IconTrash
} from './components/icons'
import { useStore, useT, type Filter } from './store'
import type { DownloadInfo } from '../../main/types'

function applyFilter(downloads: DownloadInfo[], filter: Filter): DownloadInfo[] {
  switch (filter) {
    case 'downloading':
      return downloads.filter((d) => d.status === 'downloading')
    case 'queued':
      return downloads.filter((d) => d.status === 'queued')
    case 'completed':
      return downloads.filter((d) => d.status === 'completed')
    case 'video':
      return downloads.filter((d) => d.kind === 'video')
    case 'audio':
      return downloads.filter((d) => d.kind === 'audio')
    case 'files':
      return downloads.filter((d) => d.kind === 'file')
    default:
      return downloads
  }
}

function App(): React.JSX.Element {
  const t = useT()
  const init = useStore((s) => s.init)
  const loaded = useStore((s) => s.loaded)
  const initError = useStore((s) => s.initError)
  const downloads = useStore((s) => s.downloads)
  const filter = useStore((s) => s.filter)
  const view = useStore((s) => s.view)
  const settings = useStore((s) => s.settings)
  const toast = useStore((s) => s.toast)
  const openDialog = useStore((s) => s.openDialog)
  const openGrabber = useStore((s) => s.openGrabber)
  const wizardOpen = useStore((s) => s.wizardOpen)
  const pause = useStore((s) => s.pause)
  const resume = useStore((s) => s.resume)
  const remove = useStore((s) => s.remove)
  const reorderDownloads = useStore((s) => s.reorderDownloads)
  const schedulerCountdown = useStore((s) => s.schedulerCountdown)
  const cancelSchedulerCountdown = useStore((s) => s.cancelSchedulerCountdown)

  const [url, setUrl] = useState('')
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  // Phase 3: drag-and-drop queue reorder — the card being dragged.
  const [draggedId, setDraggedId] = useState<string | null>(null)

  // Phase 3: start order rank (queued/paused, by sort_order) — drives the
  // "Waiting #n" label and the Move-to-top button on each card.
  const queuePositions = useMemo(() => {
    const order = [...downloads]
      .filter((d) => d.status === 'queued' || d.status === 'paused')
      .sort((a, b) => a.sortOrder - b.sortOrder || a.createdAt - b.createdAt)
    const map = new Map<string, number>()
    order.forEach((d, i) => map.set(d.id, i + 1))
    return map
  }, [downloads])

  useEffect(() => {
    void init()
  }, [init])

  // Theme: Mint light default (v0.7.0); 'system' resolves from the OS.
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

  // Ctrl+V anywhere opens the Add dialog with the clipboard link (§7.2);
  // Ctrl+N opens an empty dialog. Typing in an input keeps normal paste.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const target = e.target as HTMLElement | null
      const typing =
        target &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT')
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'v' && !typing) {
        e.preventDefault()
        void (async () => {
          try {
            const text = await navigator.clipboard.readText()
            openDialog(text.trim())
          } catch {
            openDialog('')
          }
        })()
        return
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'n') {
        e.preventDefault()
        openDialog('')
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [openDialog])

  const submit = (): void => {
    const value = url.trim()
    if (!value) return
    setUrl('')
    setError(null)
    openDialog(value)
  }

  const pasteLink = (): void => {
    void (async () => {
      try {
        const text = await navigator.clipboard.readText()
        openDialog(text.trim())
      } catch {
        openDialog('')
      }
    })()
  }

  const visible = applyFilter(downloads, filter)
  const pausedVisible = visible.filter((d) => d.status === 'paused')
  const downloadingVisible = visible.filter((d) => d.status === 'downloading')
  const completedVisible = visible.filter((d) => d.status === 'completed')

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-[var(--bg)] text-[var(--text)]">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        {view === 'settings' ? (
          <div className="flex-1 overflow-y-auto">
            <SettingsPage />
          </div>
        ) : view === 'history' ? (
          <div className="flex min-h-0 flex-1 flex-col">
            <HistoryPage />
          </div>
        ) : view === 'assistant' ? (
          <div className="flex min-h-0 flex-1 flex-col">
            <AssistantPage />
          </div>
        ) : (
          <>
            <header className="border-b border-[var(--border)] bg-[var(--surface)] px-4 py-3">
              <div className="flex gap-2">
                <input
                  ref={inputRef}
                  className="input flex-1"
                  value={url}
                  placeholder={t('add.placeholder')}
                  onChange={(e) => {
                    setUrl(e.target.value)
                    if (error) setError(null)
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void submit()
                  }}
                />
                <button className="btn btn-accent" onClick={() => submit()}>
                  {t('add.button')}
                </button>
              </div>
              {/* One-click toolbar (IDM-style): acts on the visible list. */}
              <div className="mt-2 flex items-center gap-1">
                <button
                  className="toolbar-btn"
                  onClick={() => openDialog('')}
                  title={t('toolbar.new')}
                >
                  <IconPlus size={14} />
                  {t('toolbar.new')}
                </button>
                <button
                  className="toolbar-btn"
                  disabled={pausedVisible.length === 0}
                  onClick={() => void Promise.all(pausedVisible.map((d) => resume(d.id)))}
                  title={t('toolbar.resumeAll')}
                >
                  <IconPlay size={14} />
                  {t('toolbar.resumeAll')}
                </button>
                <button
                  className="toolbar-btn"
                  disabled={downloadingVisible.length === 0}
                  onClick={() => void Promise.all(downloadingVisible.map((d) => pause(d.id)))}
                  title={t('toolbar.pauseAll')}
                >
                  <IconPause size={14} />
                  {t('toolbar.pauseAll')}
                </button>
                <button
                  className="toolbar-btn"
                  disabled={completedVisible.length === 0}
                  onClick={() => void Promise.all(completedVisible.map((d) => remove(d.id, false)))}
                  title={t('toolbar.removeCompleted')}
                >
                  <IconTrash size={14} />
                  {t('toolbar.removeCompleted')}
                </button>
              </div>
              <div className="mt-1.5 text-[12px] text-[var(--muted)]">
                {error ? <span className="text-[var(--danger)]">{error}</span> : t('add.hint')}
              </div>
            </header>

            <main className="flex-1 overflow-y-auto p-4">
              {!loaded ? (
                <div className="flex h-full items-center justify-center">
                  <div className="text-[13px] text-[var(--muted)]">{t('app.loading')}</div>
                </div>
              ) : visible.length === 0 && initError ? (
                // Startup load failed: a real message (distinct for a dead
                // bridge or a startup timeout) plus Retry — never a bare "…".
                <div className="flex h-full items-center justify-center">
                  <div className="card mx-auto w-full max-w-[420px] p-8 text-center">
                    <div className="empty-icon text-[var(--danger)]">
                      <IconAlert size={28} />
                    </div>
                    <div className="mt-4 text-[14px] leading-relaxed text-[var(--danger)]">
                      {initError === 'bridge'
                        ? t('settings.bridgeError')
                        : initError === 'initTimeout'
                          ? t('settings.initTimeoutError')
                          : t('settings.loadError')}
                    </div>
                    <button className="btn btn-primary mt-5" onClick={() => void init()}>
                      {t('settings.retry')}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="mx-auto flex min-h-full w-full max-w-[860px] flex-col gap-3">
                  {/* V22-style emerald banner */}
                  <div className="banner">
                    <div className="min-w-0 flex-1">
                      <div className="text-[16px] font-extrabold leading-snug">
                        {t('app.tagline')}
                      </div>
                    </div>
                    <button className="btn btn-accent" onClick={() => openDialog('')}>
                      {t('banner.cta')}
                    </button>
                  </div>
                  {downloads.length > 0 && <StatsRow />}
                  {visible.length === 0 ? (
                    // Loaded and empty: a proper empty state, not a black void.
                    <div className="flex flex-1 items-center justify-center py-8">
                      <div className="card mx-auto w-full max-w-[420px] p-8 text-center">
                        <div className="empty-icon">
                          <IconDownload size={28} />
                        </div>
                        <div className="mt-4 text-[16px] font-medium">{t('empty.title')}</div>
                        <div className="mx-auto mt-1 max-w-[320px] text-[13px] text-[var(--muted)]">
                          {t('empty.hint')}
                        </div>
                        <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
                          <button className="btn btn-primary" onClick={pasteLink}>
                            {t('empty.pasteLink')}
                          </button>
                          <button className="btn" onClick={openGrabber}>
                            {t('empty.grabber')}
                          </button>
                          <span className="kbd">Ctrl+V</span>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <>
                      {/* Column labels — same grid as the card rows, so the
                      list reads like a table (IDM's scannability). */}
                      <div className="dl-grid list-header">
                        <span />
                        <span>{t('list.name')}</span>
                        <span className="text-right">{t('list.size')}</span>
                        <span>{t('list.status')}</span>
                        <span className="text-right">{t('list.speedEta')}</span>
                        <span className="text-right normal-case tracking-normal">
                          {t('list.count', { n: visible.length })}
                        </span>
                      </div>
                      <div
                        className="space-y-2"
                        onDragOver={(e) => {
                          if (draggedId) {
                            e.preventDefault()
                            e.dataTransfer.dropEffect = 'move'
                          }
                        }}
                        onDrop={(e) => {
                          // Dropped below the last card — move to the end.
                          if (draggedId) {
                            e.preventDefault()
                            void reorderDownloads(draggedId, null)
                            setDraggedId(null)
                          }
                        }}
                      >
                        {visible.map((d) => (
                          <DownloadCard
                            key={d.id}
                            d={d}
                            queuePosition={queuePositions.get(d.id)}
                            draggable
                            dragging={draggedId === d.id}
                            onDragStart={() => setDraggedId(d.id)}
                            onDragEnd={() => setDraggedId(null)}
                            onDropOn={() => {
                              if (draggedId && draggedId !== d.id) {
                                void reorderDownloads(draggedId, d.id)
                              }
                              setDraggedId(null)
                            }}
                          />
                        ))}
                      </div>
                    </>
                  )}
                </div>
              )}
            </main>
          </>
        )}
        <StatusBar />
      </div>

      <AddDownloadDialog />
      <SiteGrabberDialog />

      {/* v1.2.0: first-run setup wizard (also re-openable from Settings). */}
      {loaded && settings && (!settings.setupCompleted || wizardOpen) && <SetupWizard />}

      {toast && (
        <div className="fixed bottom-12 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-4 py-2 text-[13px] shadow-xl">
          <span>{t(toast.key, toast.params)}</span>
          {toast.action && (
            <button
              className="btn btn-primary btn-sm"
              onClick={() => openDialog(toast.action?.url ?? '')}
            >
              {t(toast.action.labelKey)}
            </button>
          )}
        </div>
      )}

      {/* Phase 3: scheduler countdown — 60s to cancel before shutdown/sleep. */}
      {schedulerCountdown && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="card mx-4 w-full max-w-[420px] p-6 text-center">
            <div className="text-[16px] font-semibold">
              {schedulerCountdown.action === 'shutdown'
                ? t('scheduler.countdownShutdown', { seconds: schedulerCountdown.secondsLeft })
                : t('scheduler.countdownSleep', { seconds: schedulerCountdown.secondsLeft })}
            </div>
            <div className="mt-2 text-[13px] text-[var(--muted)]">
              {t('scheduler.countdownNote')}
            </div>
            <button
              className="btn btn-primary mt-5"
              onClick={() => void cancelSchedulerCountdown()}
            >
              {t('scheduler.cancel')}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

export default App
