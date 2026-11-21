import { useStore, useT } from '../store'
import type { Settings } from '../../../main/types'

export default function SettingsPage(): React.JSX.Element {
  const t = useT()
  const settings = useStore((s) => s.settings)
  const appInfo = useStore((s) => s.appInfo)
  const updateSettings = useStore((s) => s.updateSettings)

  if (!settings) return <div className="p-6 text-[var(--muted)]">…</div>

  const set = (patch: Partial<Settings>): void => {
    void updateSettings(patch)
  }

  const pickFolder = async (): Promise<void> => {
    const dir = await window.dovira.pickFolder()
    if (dir) set({ downloadDir: dir })
  }

  return (
    <div className="mx-auto w-full max-w-[640px] space-y-6 p-6">
      <h1 className="text-[20px] font-semibold">{t('settings.title')}</h1>

      <section className="card space-y-4">
        <label className="block">
          <span className="mb-1 block text-[13px] text-[var(--muted)]">
            {t('settings.downloadFolder')}
          </span>
          <span className="flex gap-2">
            <input className="input flex-1" value={settings.downloadDir} readOnly />
            <button className="btn" onClick={() => void pickFolder()}>
              {t('settings.choose')}
            </button>
          </span>
        </label>

        <label className="block">
          <span className="mb-1 block text-[13px] text-[var(--muted)]">
            {t('settings.maxConcurrent')} (1–5)
          </span>
          <input
            className="input w-32"
            type="number"
            min={1}
            max={5}
            value={settings.maxConcurrent}
            onChange={(e) => set({ maxConcurrent: Number(e.target.value) })}
          />
        </label>

        <label className="block">
          <span className="mb-1 block text-[13px] text-[var(--muted)]">
            {t('settings.connections')} (1–16)
          </span>
          <input
            className="input w-32"
            type="number"
            min={1}
            max={16}
            value={settings.connectionsPerDownload}
            onChange={(e) => set({ connectionsPerDownload: Number(e.target.value) })}
          />
        </label>

        <label className="block">
          <span className="mb-1 block text-[13px] text-[var(--muted)]">
            {t('settings.speedLimit')} — {t('settings.speedLimitUnit')}
          </span>
          <input
            className="input w-40"
            type="number"
            min={0}
            value={settings.speedLimitKBps}
            onChange={(e) => set({ speedLimitKBps: Number(e.target.value) })}
          />
        </label>

        <label className="block">
          <span className="mb-1 block text-[13px] text-[var(--muted)]">
            {t('settings.language')}
          </span>
          <select
            className="input w-48"
            value={settings.language}
            onChange={(e) => set({ language: e.target.value as 'en' | 'bn' })}
          >
            <option value="bn">বাংলা</option>
            <option value="en">English</option>
          </select>
        </label>

        <label className="block">
          <span className="mb-1 block text-[13px] text-[var(--muted)]">{t('settings.theme')}</span>
          <select
            className="input w-48"
            value={settings.theme}
            onChange={(e) => set({ theme: e.target.value as 'dark' | 'light' | 'system' })}
          >
            <option value="dark">{t('settings.themeDark')}</option>
            <option value="light">{t('settings.themeLight')}</option>
            <option value="system">{t('settings.themeSystem')}</option>
          </select>
        </label>
      </section>

      <section className="card space-y-1 text-[13px] text-[var(--muted)]">
        <h2 className="text-[14px] font-semibold text-[var(--text)]">{t('settings.about')}</h2>
        <div>{t('settings.version', { version: appInfo?.version ?? '1.0.0' })}</div>
        <div>
          {appInfo?.aria2Version
            ? t('settings.aria2Version', { version: appInfo.aria2Version })
            : t('settings.engineMissing')}
        </div>
        <div>Electron {appInfo?.electronVersion ?? ''}</div>
      </section>
    </div>
  )
}
