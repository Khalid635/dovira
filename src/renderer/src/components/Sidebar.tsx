import logo from '../assets/logo.png'
import { useStore, useT, type Filter } from '../store'
import type { DownloadInfo } from '../../../main/types'

interface NavItem {
  key: Filter | 'history' | 'settings'
  labelKey: string
  count?: number
  disabled?: boolean
  disabledHintKey?: string
}

function countFor(downloads: DownloadInfo[], key: Filter): number {
  switch (key) {
    case 'all':
      return downloads.length
    case 'downloading':
      return downloads.filter((d) => d.status === 'downloading').length
    case 'queued':
      return downloads.filter((d) => d.status === 'queued').length
    case 'completed':
      return downloads.filter((d) => d.status === 'completed').length
    case 'video':
      return downloads.filter((d) => d.kind === 'video').length
    case 'audio':
      return downloads.filter((d) => d.kind === 'audio').length
    case 'files':
      return downloads.filter((d) => d.kind === 'file').length
    default:
      return 0
  }
}

export default function Sidebar(): React.JSX.Element {
  const t = useT()
  const downloads = useStore((s) => s.downloads)
  const filter = useStore((s) => s.filter)
  const view = useStore((s) => s.view)
  const setFilter = useStore((s) => s.setFilter)
  const setView = useStore((s) => s.setView)

  const items: NavItem[] = [
    { key: 'all', labelKey: 'sidebar.all', count: countFor(downloads, 'all') },
    {
      key: 'downloading',
      labelKey: 'sidebar.downloading',
      count: countFor(downloads, 'downloading')
    },
    { key: 'queued', labelKey: 'sidebar.queued', count: countFor(downloads, 'queued') },
    { key: 'completed', labelKey: 'sidebar.completed', count: countFor(downloads, 'completed') },
    { key: 'video', labelKey: 'sidebar.video', count: countFor(downloads, 'video') },
    { key: 'audio', labelKey: 'sidebar.audio', count: countFor(downloads, 'audio') },
    { key: 'files', labelKey: 'sidebar.files', count: countFor(downloads, 'files') },
    {
      key: 'history',
      labelKey: 'sidebar.history',
      disabled: true,
      disabledHintKey: 'sidebar.historySoon'
    }
  ]

  return (
    <aside className="flex w-[220px] shrink-0 flex-col border-r border-[var(--border)] bg-[var(--surface)]">
      <div className="flex items-center gap-2 px-4 pb-3 pt-4">
        <img src={logo} alt="DOVIRA" className="h-8 w-8 rounded-lg" />
        <div>
          <div className="text-[16px] font-semibold leading-tight tracking-wide">DOVIRA</div>
          <div className="text-[11px] leading-tight text-[var(--muted)]">v1.0.0 · Phase 1</div>
        </div>
      </div>

      <nav className="flex-1 space-y-0.5 px-2 py-2">
        {items.map((item) => {
          const active = view === 'home' && filter === item.key
          return (
            <button
              key={item.key}
              disabled={item.disabled}
              title={item.disabled && item.disabledHintKey ? t(item.disabledHintKey) : undefined}
              onClick={() => {
                setView('home')
                setFilter(item.key as Filter)
              }}
              className={`nav-item ${active ? 'nav-item-active' : ''} ${item.disabled ? 'opacity-45' : ''}`}
            >
              <span className="flex-1 text-left">{t(item.labelKey)}</span>
              {typeof item.count === 'number' && (
                <span className="rounded-full bg-[var(--surface-2)] px-2 py-0.5 text-[11px] text-[var(--muted)]">
                  {item.count}
                </span>
              )}
              {item.disabled && <span className="text-[11px] text-[var(--muted)]">Phase 3</span>}
            </button>
          )
        })}
      </nav>

      <div className="border-t border-[var(--border)] p-2">
        <button
          onClick={() => setView('settings')}
          className={`nav-item ${view === 'settings' ? 'nav-item-active' : ''}`}
        >
          <span className="flex-1 text-left">{t('sidebar.settings')}</span>
        </button>
      </div>
    </aside>
  )
}
