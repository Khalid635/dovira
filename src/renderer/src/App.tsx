import { useEffect, useRef, useState } from 'react'
import Sidebar from './components/Sidebar'
import DownloadCard from './components/DownloadCard'
import StatusBar from './components/StatusBar'
import SettingsPage from './components/SettingsPage'
import { useStore, useT, type Filter } from './store'
import type { DownloadInfo } from '../../main/types'

const VIDEO_HOSTS = new Set([
  'youtube.com',
  'www.youtube.com',
  'youtu.be',
  'facebook.com',
  'www.facebook.com',
  'fb.watch',
  'instagram.com',
  'www.instagram.com',
  'tiktok.com',
  'www.tiktok.com',
  'vimeo.com',
  'www.vimeo.com',
  'dailymotion.com',
  'www.dailymotion.com',
  'twitch.tv',
  'www.twitch.tv'
])

function isVideoSite(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase()
    return VIDEO_HOSTS.has(host)
  } catch {
    return false
  }
}

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

function errorKey(code: string | undefined): string {
  switch (code) {
    case 'no-space':
      return 'error.no-space'
    case 'invalid-url':
      return 'error.invalid-url'
    case 'unsupported-url':
      return 'error.unsupported-url'
    default:
      return 'error.unknown'
  }
}

function App(): React.JSX.Element {
  const t = useT()
  const init = useStore((s) => s.init)
  const loaded = useStore((s) => s.loaded)
  const downloads = useStore((s) => s.downloads)
  const filter = useStore((s) => s.filter)
  const view = useStore((s) => s.view)
  const settings = useStore((s) => s.settings)
  const toast = useStore((s) => s.toast)
  const addDownload = useStore((s) => s.addDownload)

  const [url, setUrl] = useState('')
  const [busy, setBusy] = useState(false)
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

  // Ctrl+V anywhere focuses the link box (Phase 1 version of §7.2).
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'v') {
        if (document.activeElement !== inputRef.current && view === 'home') {
          inputRef.current?.focus()
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [view])

  const submit = async (): Promise<void> => {
    const value = url.trim()
    if (!value || busy) return
    if (isVideoSite(value)) {
      setError(t('add.videoSite'))
      return
    }
    setBusy(true)
    setError(null)
    const res = await addDownload(value)
    setBusy(false)
    if (res.ok) {
      setUrl('')
    } else {
      setError(t(errorKey(res.error)))
    }
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
                <button className="btn btn-primary" disabled={busy} onClick={() => void submit()}>
                  {busy ? t('add.adding') : t('add.button')}
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

      {toast && (
        <div className="fixed bottom-12 left-1/2 z-50 -translate-x-1/2 rounded-lg bg-[var(--surface-2)] px-4 py-2 text-[13px] shadow-lg">
          {t(toast.key, toast.params)}
        </div>
      )}
    </div>
  )
}

export default App
