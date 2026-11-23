import { useState } from 'react'
import { useStore, useT } from '../store'
import ExtensionSetup from './ExtensionSetup'
import { formatBytes } from '../util/format'

type Step = 'welcome' | 'folder' | 'extension' | 'done'

/**
 * v1.2.0: first-run setup wizard — welcome (with a language picker),
 * download folder, guided browser-extension install, done. Skippable;
 * re-openable from Settings > Setup & diagnostics. Finishing (or
 * skipping) sets setupCompleted so it never pops up again on its own.
 */
export default function SetupWizard(): React.JSX.Element {
  const t = useT()
  const settings = useStore((s) => s.settings)
  const appInfo = useStore((s) => s.appInfo)
  const updateSettings = useStore((s) => s.updateSettings)
  const closeWizard = useStore((s) => s.closeWizard)
  const [step, setStep] = useState<Step>('welcome')

  const finish = (): void => {
    void updateSettings({ setupCompleted: true })
    closeWizard()
  }

  const pickFolder = async (): Promise<void> => {
    if (typeof window.dovira === 'undefined') return
    try {
      const dir = await window.dovira.pickFolder()
      if (dir) void updateSettings({ downloadDir: dir })
    } catch {
      // Folder stays as-is.
    }
  }

  if (!settings) return <div />

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="card mx-4 w-full max-w-[560px] p-6">
        {step === 'welcome' && (
          <>
            <div className="text-[18px] font-semibold">{t('wizard.title')}</div>
            <p className="mt-2 text-[13px] leading-relaxed text-[var(--muted)]">
              {t('wizard.welcome')}
            </p>
            <div className="mt-5">
              <span className="mb-2 block text-[13px] text-[var(--muted)]">
                {t('wizard.language')}
              </span>
              <div className="flex gap-2">
                <button
                  className={`btn ${settings.language === 'bn' ? 'btn-primary' : ''}`}
                  onClick={() => void updateSettings({ language: 'bn' })}
                >
                  বাংলা
                </button>
                <button
                  className={`btn ${settings.language === 'en' ? 'btn-primary' : ''}`}
                  onClick={() => void updateSettings({ language: 'en' })}
                >
                  English
                </button>
              </div>
            </div>
            <div className="mt-6 flex items-center justify-between">
              <button className="btn btn-ghost" onClick={finish}>
                {t('wizard.skip')}
              </button>
              <button className="btn btn-primary" onClick={() => setStep('folder')}>
                {t('wizard.next')}
              </button>
            </div>
          </>
        )}

        {step === 'folder' && (
          <>
            <div className="text-[13px] text-[var(--muted)]">
              {t('wizard.stepOf', { n: 1, total: 3 })}
            </div>
            <div className="mt-1 text-[18px] font-semibold">{t('wizard.stepFolder')}</div>
            <p className="mt-2 text-[13px] text-[var(--muted)]">{t('wizard.folderTitle')}</p>
            <div className="mt-4 flex gap-2">
              <input className="input flex-1" value={settings.downloadDir} readOnly />
              <button className="btn" onClick={() => void pickFolder()}>
                {t('settings.choose')}
              </button>
            </div>
            {appInfo && appInfo.diskFreeBytes !== null && (
              <p className="mt-2 text-[12px] text-[var(--muted)]">
                {t('wizard.folderFree', { free: formatBytes(appInfo.diskFreeBytes) })}
              </p>
            )}
            <p className="mt-1 text-[12px] text-[var(--muted)]">{t('wizard.folderHint')}</p>
            <div className="mt-6 flex items-center justify-between">
              <button className="btn btn-ghost" onClick={finish}>
                {t('wizard.skip')}
              </button>
              <span className="flex gap-2">
                <button className="btn" onClick={() => setStep('welcome')}>
                  {t('wizard.back')}
                </button>
                <button className="btn btn-primary" onClick={() => setStep('extension')}>
                  {t('wizard.next')}
                </button>
              </span>
            </div>
          </>
        )}

        {step === 'extension' && (
          <>
            <div className="text-[13px] text-[var(--muted)]">
              {t('wizard.stepOf', { n: 2, total: 3 })}
            </div>
            <div className="mt-1 text-[18px] font-semibold">{t('wizard.stepExtension')}</div>
            <div className="mt-4 max-h-[52vh] overflow-y-auto pr-1">
              <ExtensionSetup />
            </div>
            <div className="mt-6 flex items-center justify-between">
              <button className="btn btn-ghost" onClick={finish}>
                {t('wizard.skip')}
              </button>
              <span className="flex gap-2">
                <button className="btn" onClick={() => setStep('folder')}>
                  {t('wizard.back')}
                </button>
                <button className="btn btn-primary" onClick={() => setStep('done')}>
                  {t('wizard.next')}
                </button>
              </span>
            </div>
          </>
        )}

        {step === 'done' && (
          <>
            <div className="text-[13px] text-[var(--muted)]">
              {t('wizard.stepOf', { n: 3, total: 3 })}
            </div>
            <div className="mt-1 text-[18px] font-semibold">{t('wizard.doneTitle')}</div>
            <p className="mt-2 text-[13px] leading-relaxed text-[var(--muted)]">
              {t('wizard.doneHint', { dir: settings.downloadDir })}
            </p>
            <div className="mt-6 flex items-center justify-end">
              <button className="btn btn-primary" onClick={finish}>
                {t('wizard.finish')}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
