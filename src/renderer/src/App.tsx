import { useEffect, useRef, useState } from 'react'
import Sidebar from './components/Sidebar'
import DownloadCard from './components/DownloadCard'
import StatusBar from './components/StatusBar'
import SettingsPage from './components/SettingsPage'
import AddDownloadDialog from './components/AddDownloadDialog'
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

  const [url, setUrl] = useState('')
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    void init()
  }, [init])

  // Theme: dark default, light from day 1 (§6.2).
  useEffect(() => {
    const theme = settings?.theme ?? 'dark'
    const resolved =
      theme === 'system'
        ? window.matchMedia('(prefers-color-scheme: dark)').matches
          ? 'dark'
          : 'light'
        : theme
    document.documentElement.dataset.theme = resolved
  }, [settings?.theme])

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

  const visible = applyFilter(downloads, filter)

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-[var(--bg)] text-[var(--text)]">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        {view === 'settings' ? (
          <div className="flex-1 overflow-y-auto">
            <SettingsPage />
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
                <button className="btn btn-primary" onClick={() => submit()}>
                  {t('add.button')}
                </button>
              </div>
              <div className="mt-1.5 text-[12px] text-[var(--muted)]">
                {error ? <span className="text-[var(--danger)]">{error}</span> : t('add.hint')}
              </div>
            </header>

            <main className="flex-1 overflow-y-auto p-4">
              {!loaded ? (
                <div className="p-8 text-center text-[var(--muted)]">…</div>
              ) : visible.length === 0 ? (
                <div className="flex h-full flex-col items-center justify-center text-center">
                  <div className="text-[40px] text-[var(--accent)]">⤓</div>
                  <div className="mt-2 text-[16px] font-medium">{t('empty.title')}</div>
                  <div className="mt-1 max-w-[380px] text-[13px] text-[var(--muted)]">
                    {t('empty.hint')}
                  </div>
                  {initError && (
                    <div className="mt-4 max-w-[380px] text-[13px] text-[var(--danger)]">
                      {t('settings.loadError')}
                    </div>
                  )}
                </div>
              ) : (
                <div className="mx-auto w-full max-w-[860px] space-y-2">
                  {visible.map((d) => (
                    <DownloadCard key={d.id} d={d} />
                  ))}
                </div>
              )}
            </main>
          </>
        )}
        <StatusBar />
      </div>

      <AddDownloadDialog />

      {toast && (
        <div className="fixed bottom-12 left-1/2 z-50 -translate-x-1/2 rounded-lg bg-[var(--surface-2)] px-4 py-2 text-[13px] shadow-lg">
          {t(toast.key, toast.params)}
        </div>
      )}
    </div>
  )
}

export default App
