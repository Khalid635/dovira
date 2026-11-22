import { useMemo, type ComponentType } from 'react'
import logo from '../assets/logo.png'
import { useStore, useT, type Filter } from '../store'
import type { DownloadInfo } from '../../../main/types'
import {
  IconAll,
  IconAudio,
  IconChat,
  IconCheckCircle,
  IconClock,
  IconDownload,
  IconFile,
  IconGlobe,
  IconMoon,
  IconSettings,
  IconSun,
  IconVideo,
  type IconProps
} from './icons'

interface NavItem {
  key: Filter | 'history' | 'settings'
  labelKey: string
  icon: ComponentType<IconProps>
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
  const appInfo = useStore((s) => s.appInfo)
  const setFilter = useStore((s) => s.setFilter)
  const setView = useStore((s) => s.setView)
  const openGrabber = useStore((s) => s.openGrabber)
  const settings = useStore((s) => s.settings)
  const updateSettings = useStore((s) => s.updateSettings)
  const effectiveTheme = useMemo(() => {
    const theme = settings?.theme ?? 'light'
    return theme === 'system'
      ? window.matchMedia('(prefers-color-scheme: dark)').matches
        ? 'dark'
        : 'light'
      : theme
  }, [settings?.theme])

  const downloadItems: NavItem[] = [
    { key: 'all', labelKey: 'sidebar.all', icon: IconAll, count: countFor(downloads, 'all') },
    {
      key: 'downloading',
      labelKey: 'sidebar.downloading',
      icon: IconDownload,
      count: countFor(downloads, 'downloading')
    },
    {
      key: 'queued',
      labelKey: 'sidebar.queued',
      icon: IconClock,
      count: countFor(downloads, 'queued')
    },
    {
      key: 'completed',
      labelKey: 'sidebar.completed',
      icon: IconCheckCircle,
      count: countFor(downloads, 'completed')
    }
  ]

  const mediaItems: NavItem[] = [
    {
      key: 'video',
      labelKey: 'sidebar.video',
      icon: IconVideo,
      count: countFor(downloads, 'video')
    },
    {
      key: 'audio',
      labelKey: 'sidebar.audio',
      icon: IconAudio,
      count: countFor(downloads, 'audio')
    },
    {
      key: 'files',
      labelKey: 'sidebar.files',
      icon: IconFile,
      count: countFor(downloads, 'files')
    },
    {
      key: 'history',
      labelKey: 'sidebar.history',
      icon: IconClock
    }
  ]

  const renderItems = (items: NavItem[]): React.JSX.Element[] =>
    items.map((item) => {
      // Phase 3: History is its own view, not a Home filter.
      const active =
        item.key === 'history' ? view === 'history' : view === 'home' && filter === item.key
      const ItemIcon = item.icon
      return (
        <button
          key={item.key}
          disabled={item.disabled}
          title={item.disabled && item.disabledHintKey ? t(item.disabledHintKey) : undefined}
          onClick={() => {
            if (item.key === 'history') {
              setView('history')
            } else if (item.key === 'settings') {
              setView('settings')
            } else {
              setView('home')
              setFilter(item.key as Filter)
            }
          }}
          className={`nav-item ${active ? 'nav-item-active' : ''} ${item.disabled ? 'opacity-45' : ''}`}
        >
          <ItemIcon size={15} />
          <span className="flex-1 text-left">{t(item.labelKey)}</span>
          {typeof item.count === 'number' && (
            <span className="sidebar-count rounded-full bg-[var(--sidebar-count-bg)] px-2 py-0.5 text-[11px] tabular-nums text-[var(--sidebar-muted)]">
              {item.count}
            </span>
          )}
        </button>
      )
    })

  return (
    <aside className="sidebar flex w-[220px] shrink-0 flex-col border-r border-[var(--sidebar-border)] bg-[var(--sidebar-bg)]">
      <div className="flex items-center gap-2 px-4 pb-3 pt-4">
        <img src={logo} alt="DOVIRA" className="h-8 w-8 rounded-lg" />
        <div className="min-w-0">
          <div className="text-[16px] font-semibold leading-tight tracking-wide text-[var(--sidebar-text)]">
            DOVIRA
          </div>
          <div className="text-[11px] leading-tight text-[var(--sidebar-muted)]">
            v{appInfo?.version ?? '0.7.0'}
          </div>
          <div className="truncate text-[10px] leading-tight text-[var(--sidebar-muted)]">
            {t('app.tagline')}
          </div>
        </div>
      </div>

      <nav className="flex-1 space-y-0.5 overflow-y-auto px-2 py-2">
        <div className="sidebar-section">{t('sidebar.sectionDownloads')}</div>
        {renderItems(downloadItems)}
        <div className="sidebar-section">{t('sidebar.sectionMedia')}</div>
        {renderItems(mediaItems)}
        <div className="sidebar-section">{t('sidebar.sectionTools')}</div>
        <button className="nav-item" onClick={openGrabber}>
          <IconGlobe size={15} />
          <span className="flex-1 text-left">{t('grabber.title')}</span>
        </button>
        <button
          className={`nav-item ${view === 'assistant' ? 'nav-item-active' : ''}`}
          onClick={() => setView('assistant')}
        >
          <IconChat size={15} />
          <span className="flex-1 text-left">{t('sidebar.assistant')}</span>
        </button>
      </nav>

      <div className="flex items-center gap-1 border-t border-[var(--sidebar-border)] p-2">
        <button
          onClick={() => setView('settings')}
          className={`nav-item flex-1 ${view === 'settings' ? 'nav-item-active' : ''}`}
        >
          <IconSettings size={15} />
          <span className="flex-1 text-left">{t('sidebar.settings')}</span>
        </button>
        <button
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[9px] text-[var(--sidebar-text)] hover:bg-[var(--sidebar-hover-bg)] hover:text-[var(--sidebar-active-text)]"
          title={t('theme.toggle')}
          onClick={() =>
            void updateSettings({ theme: effectiveTheme === 'dark' ? 'light' : 'dark' })
          }
        >
          {effectiveTheme === 'dark' ? <IconSun size={16} /> : <IconMoon size={16} />}
        </button>
      </div>
    </aside>
  )
}
