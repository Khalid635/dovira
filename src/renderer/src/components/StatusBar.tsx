import { useStore, useT } from '../store'
import { formatBytes, formatSpeed } from '../util/format'

export default function StatusBar(): React.JSX.Element {
  const t = useT()
  const downloads = useStore((s) => s.downloads)
  const appInfo = useStore((s) => s.appInfo)

  const active = downloads.filter((d) => d.status === 'downloading')
  const totalSpeed = active.reduce((sum, d) => sum + d.speedBps, 0)

  return (
    <footer className="flex items-center gap-4 border-t border-[var(--border)] bg-[var(--surface)] px-4 py-2 text-[12px] text-[var(--muted)]">
      <span className="tabular-nums">
        {t('statusbar.speed', { speed: formatSpeed(totalSpeed) })}
      </span>
      <span>·</span>
      <span>{t('statusbar.active', { n: active.length })}</span>
      <span className="flex-1" />
      {appInfo && appInfo.diskFreeBytes !== null && (
        <span className="tabular-nums">
          {t('statusbar.free', { free: formatBytes(appInfo.diskFreeBytes) })}
        </span>
      )}
    </footer>
  )
}
