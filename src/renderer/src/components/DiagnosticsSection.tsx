import { useState } from 'react'
import { useStore, useT } from '../store'
import type { DiagnosticCheck, DiagnosticsResult } from '../../../main/types'
import { IconAlert, IconCheck } from './icons'

const CHECK_LABEL_KEYS: Record<string, string> = {
  localApi: 'diag.checkLocalApi',
  ytdlp: 'diag.checkYtdlp',
  aria2: 'diag.checkAria2',
  extension: 'diag.checkExtension',
  downloadDir: 'diag.checkDownloadDir',
  binaries: 'diag.checkBinaries'
}

/**
 * v1.2.0: one-click self-checks (Settings > Setup & diagnostics).
 * Each row is a plain-language result with a one-click fix where one
 * exists (update yt-dlp, open setup, choose folder).
 */
export default function DiagnosticsSection(): React.JSX.Element {
  const t = useT()
  const openWizard = useStore((s) => s.openWizard)
  const updateSettings = useStore((s) => s.updateSettings)
  const updateEngine = useStore((s) => s.updateEngine)
  const [result, setResult] = useState<DiagnosticsResult | null>(null)
  const [running, setRunning] = useState(false)
  const [lastRun, setLastRun] = useState<number | null>(null)
  const [fixNote, setFixNote] = useState(false)

  const run = async (): Promise<void> => {
    if (typeof window.dovira === 'undefined' || running) return
    setRunning(true)
    setFixNote(false)
    try {
      const r = await window.dovira.runDiagnostics()
      setResult(r)
      setLastRun(Date.now())
    } catch {
      // A failed run is not a crash — the section stays.
    } finally {
      setRunning(false)
    }
  }

  const applyFix = async (check: DiagnosticCheck): Promise<void> => {
    if (check.fix === 'updateYtdlp') {
      await updateEngine('yt-dlp')
      setFixNote(true)
    } else if (check.fix === 'openSetup') {
      openWizard()
    } else if (check.fix === 'chooseFolder') {
      if (typeof window.dovira === 'undefined') return
      try {
        const dir = await window.dovira.pickFolder()
        if (dir) void updateSettings({ downloadDir: dir })
      } catch {
        // Folder stays as-is.
      }
    }
  }

  const fixLabel = (check: DiagnosticCheck): string => {
    switch (check.fix) {
      case 'updateYtdlp':
        return t('diag.fixUpdateYtdlp')
      case 'openSetup':
        return t('diag.fixOpenSetup')
      case 'chooseFolder':
        return t('diag.fixChooseFolder')
      default:
        return ''
    }
  }

  const statusColor = (status: DiagnosticCheck['status']): string =>
    status === 'ok'
      ? 'text-[var(--success)]'
      : status === 'warn'
        ? 'text-[var(--warning)]'
        : 'text-[var(--danger)]'

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <span className="text-[13px] font-medium">{t('diag.title')}</span>
        <span className="flex-1" />
        <button className="btn btn-sm" disabled={running} onClick={() => void run()}>
          {running ? t('diag.running') : t('diag.run')}
        </button>
      </div>
      <p className="text-[12px] text-[var(--muted)]">
        {lastRun
          ? t('diag.lastRun', { when: new Date(lastRun).toLocaleString() })
          : t('diag.neverRun')}
      </p>
      {fixNote && <p className="text-[13px]">{t('diag.fixDone')}</p>}
      {result?.checks.map((check) => (
        <div key={check.id} className="settings-field flex items-start gap-2 text-[13px]">
          <span className={`mt-0.5 shrink-0 ${statusColor(check.status)}`}>
            {check.status === 'ok' ? <IconCheck size={15} /> : <IconAlert size={15} />}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block font-medium">{t(CHECK_LABEL_KEYS[check.id] ?? check.id)}</span>
            <span className="block text-[var(--muted)]">
              {t(check.detailKey, check.detailParams)}
            </span>
          </span>
          {check.fix && (
            <button className="btn btn-sm shrink-0" onClick={() => void applyFix(check)}>
              {fixLabel(check)}
            </button>
          )}
        </div>
      ))}
    </div>
  )
}
