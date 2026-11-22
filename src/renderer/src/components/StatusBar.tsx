import { useStore, useT } from '../store'
import { formatBytes, formatSpeed } from '../util/format'
import { IconActivity, IconClock, IconDisk, IconDownload, IconGauge } from './icons'

export default function StatusBar(): React.JSX.Element {
  const t = useT()
  const downloads = useStore((s) => s.downloads)
  const appInfo = useStore((s) => s.appInfo)
  const settings = useStore((s) => s.settings)

  const active = downloads.filter((d) => d.status === 'downloading')
  const queued = downloads.filter((d) => d.status === 'queued')
  const totalSpeed = active.reduce((sum, d) => sum + d.speedBps, 0)
  // Phase 7: any active download running under a limit (its own or global)?
  const globalLimit = settings?.speedLimitKBps ?? 0
  const anyLimited = active.some((d) => (d.speedLimitKBps > 0 ? d.speedLimitKBps : globalLimit) > 0)

  return (
    <footer className="flex items-center gap-3 border-t border-[var(--border)] bg-[var(--surface)] px-4 py-2 text-[12px] text-[var(--muted)]">
      <span className="inline-flex items-center gap-1.5 tabular-nums">
        <IconDownload size={13} />
        {t('statusbar.speed', { speed: formatSpeed(totalSpeed) })}
      </span>
      <span className="h-3.5 w-px bg-[var(--border)]" />
      <span className="inline-flex items-center gap-1.5 tabular-nums">
        <IconActivity size={13} />
        {t('statusbar.active', { n: active.length })}
      </span>
      <span className="h-3.5 w-px bg-[var(--border)]" />
      <span className="inline-flex items-center gap-1.5 tabular-nums">
        <IconClock size={13} />
        {t('statusbar.queued', { n: queued.length })}
      </span>
      {anyLimited && (
        <>
          <span className="h-3.5 w-px bg-[var(--border)]" />
          <span className="inline-flex items-center gap-1.5 tabular-nums">
            <IconGauge size={13} />
            {globalLimit > 0
              ? `${t('download.speedLimitGlobal')} · ${formatSpeed(globalLimit * 1024)}`
              : t('status.limited')}
          </span>
        </>
      )}
      <span className="flex-1" />
      {appInfo && appInfo.diskFreeBytes !== null && (
        <span className="inline-flex items-center gap-1.5 tabular-nums">
          <IconDisk size={13} />
          {t('statusbar.free', { free: formatBytes(appInfo.diskFreeBytes) })}
        </span>
      )}
    </footer>
  )
}
