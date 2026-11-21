import { useEffect } from 'react'
import { useStore, useT } from '../store'
import type { Settings } from '../../../main/types'

const SUB_LANGS = ['en', 'bn', 'es', 'fr', 'de', 'hi', 'ja']

export default function SettingsPage(): React.JSX.Element {
  const t = useT()
  const settings = useStore((s) => s.settings)
  const appInfo = useStore((s) => s.appInfo)
  const initError = useStore((s) => s.initError)
  const init = useStore((s) => s.init)
  const updateSettings = useStore((s) => s.updateSettings)
  const engines = useStore((s) => s.engines)
  const enginesLoading = useStore((s) => s.enginesLoading)
  const loadEngines = useStore((s) => s.loadEngines)
  const updateEngine = useStore((s) => s.updateEngine)

  useEffect(() => {
    void loadEngines(false)
  }, [loadEngines])

  // Settings never arrived (a startup load failed): say so plainly with a
  // Retry button instead of the bare "…" Phase 1 showed forever.
  if (!settings) {
    return (
      <div className="mx-auto w-full max-w-[640px] space-y-4 p-6">
        <h1 className="text-[20px] font-semibold">{t('settings.title')}</h1>
        {initError ? (
          <>
            <p className="text-[13px] text-[var(--danger)]">{t('settings.loadError')}</p>
            <button className="btn btn-primary" onClick={() => void init()}>
              {t('settings.retry')}
            </button>
          </>
        ) : (
          <p className="text-[var(--muted)]">…</p>
        )}
      </div>
    )
  }

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

      <section className="card space-y-4">
        <h2 className="text-[14px] font-semibold">{t('settings.videoAudio')}</h2>

        <label className="block">
          <span className="mb-1 block text-[13px] text-[var(--muted)]">
            {t('settings.defaultQuality')}
          </span>
          <select
            className="input w-48"
            value={settings.defaultVideoQuality}
            onChange={(e) => set({ defaultVideoQuality: e.target.value })}
          >
            {['2160', '1080', '720', '480', '360'].map((q) => (
              <option key={q} value={q}>
                {q}p
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="mb-1 block text-[13px] text-[var(--muted)]">
            {t('settings.container')}
          </span>
          <select
            className="input w-48"
            value={settings.videoContainer}
            onChange={(e) => set({ videoContainer: e.target.value as 'mp4' | 'mkv' })}
          >
            <option value="mp4">MP4</option>
            <option value="mkv">MKV</option>
          </select>
        </label>

        <label className="block">
          <span className="mb-1 block text-[13px] text-[var(--muted)]">
            {t('settings.defaultBitrate')}
          </span>
          <select
            className="input w-48"
            value={settings.defaultAudioBitrate}
            onChange={(e) => set({ defaultAudioBitrate: e.target.value as '320' | '192' | '128' })}
          >
            <option value="320">320 kbps</option>
            <option value="192">192 kbps</option>
            <option value="128">128 kbps</option>
          </select>
        </label>

        <label className="block">
          <span className="mb-1 block text-[13px] text-[var(--muted)]">
            {t('settings.subtitleLang')}
          </span>
          <select
            className="input w-48"
            value={settings.subtitleLang}
            onChange={(e) => set({ subtitleLang: e.target.value })}
          >
            {SUB_LANGS.map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </select>
        </label>
      </section>

      <section className="card space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-[14px] font-semibold">{t('settings.engines')}</h2>
          <button
            className="btn btn-sm"
            disabled={enginesLoading}
            onClick={() => void loadEngines(true)}
          >
            {enginesLoading ? t('settings.checking') : t('settings.checkForUpdates')}
          </button>
        </div>
        {engines.length === 0 && (
          <div className="text-[13px] text-[var(--muted)]">
            {enginesLoading ? t('settings.checking') : t('settings.engineMissing')}
          </div>
        )}
        {engines.map((e) => (
          <div key={e.name} className="flex items-center gap-2 text-[13px] text-[var(--muted)]">
            <span className="w-20 font-medium text-[var(--text)]">{e.name}</span>
            <span className="tabular-nums">{e.version ?? '—'}</span>
            <span className="flex-1" />
            {e.updateAvailable ? (
              <>
                <span className="text-[var(--warning)]">{t('settings.updateAvailable')}</span>
                <button className="btn btn-sm" onClick={() => void updateEngine(e.name)}>
                  {t('settings.updateNow')}
                </button>
              </>
            ) : (
              <span>{e.latest ? t('settings.upToDate') : ''}</span>
            )}
          </div>
        ))}
        <label className="flex cursor-pointer items-center gap-2 pt-1 text-[13px]">
          <input
            type="checkbox"
            checked={settings.engineAutoUpdate}
            onChange={(e) => set({ engineAutoUpdate: e.target.checked })}
          />
          {t('settings.autoUpdateEngines')}
        </label>
      </section>

      <section className="card space-y-1 text-[13px] text-[var(--muted)]">
        <h2 className="text-[14px] font-semibold text-[var(--text)]">{t('settings.about')}</h2>
        <div>{t('settings.version', { version: appInfo?.version ?? '0.1.0' })}</div>
        <div>
          {appInfo?.aria2Version
            ? t('settings.aria2Version', { version: appInfo.aria2Version })
            : t('settings.engineMissing')}
        </div>
        <div>
          {appInfo?.ytDlpVersion
            ? t('settings.ytDlpVersion', { version: appInfo.ytDlpVersion })
            : `yt-dlp —`}
        </div>
        <div>
          {appInfo?.ffmpegVersion
            ? t('settings.ffmpegVersion', { version: appInfo.ffmpegVersion })
            : `ffmpeg —`}
        </div>
        <div>
          {appInfo?.denoVersion
            ? t('settings.denoVersion', { version: appInfo.denoVersion })
            : `Deno —`}
        </div>
        <div>Electron {appInfo?.electronVersion ?? ''}</div>
      </section>
    </div>
  )
}
