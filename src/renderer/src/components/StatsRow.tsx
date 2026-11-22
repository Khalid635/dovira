import { useState } from 'react'
import { useStore, useT } from '../store'
import { formatBytes, formatSpeed } from '../util/format'

interface StatDef {
  label: string
  value: string
  frac: number
  orange: boolean
}

/** v0.7.0: V22-style stats row — real numbers from the download list. */
export default function StatsRow(): React.JSX.Element {
  const t = useT()
  const downloads = useStore((s) => s.downloads)
  const settings = useStore((s) => s.settings)

  const todayStart = new Date()
  todayStart.setHours(0, 0, 0, 0)
  const todayTs = todayStart.getTime()
  const addedToday = downloads.filter((d) => d.createdAt >= todayTs)
  const completedToday = downloads.filter((d) => d.completedAt !== null && d.completedAt >= todayTs)
  const active = downloads.filter((d) => d.status === 'downloading')
  const currentSpeed = active.reduce((sum, d) => sum + d.speedBps, 0)
  // Session peak speed — the bar's scale (resets when the app restarts).
  // Render-time adjustment (the documented React pattern for deriving state
  // from a prop): re-renders immediately, before paint.
  const [peak, setPeak] = useState(0)
  if (currentSpeed > peak) {
    setPeak(currentSpeed)
  }
  const completed = downloads.filter((d) => d.status === 'completed')
  const totalBytes = completed.reduce((sum, d) => sum + d.totalBytes, 0)
  const allTotal = downloads.reduce((sum, d) => sum + d.totalBytes, 0)
  const allDone = downloads.reduce((sum, d) => sum + d.doneBytes, 0)

  const clamp01 = (v: number): number => Math.min(1, Math.max(0, v))

  const stats: StatDef[] = [
    {
      label: t('stats.today'),
      value: String(completedToday.length),
      frac: addedToday.length === 0 ? 0 : completedToday.length / addedToday.length,
      orange: false
    },
    {
      label: t('stats.speed'),
      value: formatSpeed(currentSpeed),
      frac: peak === 0 ? 0 : currentSpeed / peak,
      orange: true
    },
    {
      label: t('stats.active'),
      value: String(active.length),
      frac: active.length / (settings?.maxConcurrent ?? 3),
      orange: false
    },
    {
      label: t('stats.totalSize'),
      value: formatBytes(totalBytes),
      frac: allTotal === 0 ? 0 : allDone / allTotal,
      orange: false
    }
  ]

  return (
    <div className="grid grid-cols-2 gap-2.5 md:grid-cols-4">
      {stats.map((s) => (
        <div key={s.label} className="stat-card">
          <div className="stat-label">{s.label}</div>
          <div className="stat-num">{s.value}</div>
          <div className="stat-bar">
            <div
              className="stat-fill"
              style={{
                width: `${Math.round(clamp01(s.frac) * 100)}%`,
                ...(s.orange ? { background: 'var(--accent-orange)' } : {})
              }}
            />
          </div>
        </div>
      ))}
    </div>
  )
}
