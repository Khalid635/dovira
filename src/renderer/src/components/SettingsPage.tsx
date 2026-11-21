import { useEffect, useState } from 'react'
import { useStore, useT } from '../store'
import type { Settings } from '../../../main/types'
import { IconCheck } from './icons'

const SUB_LANGS = ['en', 'bn', 'es', 'fr', 'de', 'hi', 'ja']

const SECTIONS = [
  { id: 'settings-general', labelKey: 'settings.navGeneral' },
  { id: 'settings-video-audio', labelKey: 'settings.navVideoAudio' },
  { id: 'settings-engines', labelKey: 'settings.navEngines' },
  { id: 'settings-about', labelKey: 'settings.navAbout' }
]

export default function SettingsPage(): React.JSX.Element {
  const t = useT()
  const settings = useStore((s) => s.settings)
  const appInfo = useStore((s) => s.appInfo)
  const loaded = useStore((s) => s.loaded)
  const initError = useStore((s) => s.initError)
  const init = useStore((s) => s.init)
  const updateSettings = useStore((s) => s.updateSettings)
  const engines = useStore((s) => s.engines)
  const enginesLoading = useStore((s) => s.enginesLoading)
  const loadEngines = useStore((s) => s.loadEngines)
  const updateEngine = useStore((s) => s.updateEngine)
  const [activeSection, setActiveSection] = useState(SECTIONS[0].id)

  useEffect(() => {
    void loadEngines(false)
  }, [loadEngines])

  // Settings never arrived: distinguish "still loading" from "failed".
  // The bare "…" Phase 1 showed forever is gone — a failed load always
  // shows a real message (with a distinct one for a dead bridge or a
  // startup timeout) plus a Retry button.
  if (!settings) {
    return (
      <div className="mx-auto w-full max-w-[640px] space-y-4 p-6">
        <h1 className="text-[20px] font-semibold">{t('settings.title')}</h1>
        {!loaded ? (
          <p className="text-[var(--muted)]">{t('app.loading')}</p>
        ) : (
          <>
            <p className="text-[13px] text-[var(--danger)]">
              {initError === 'bridge'
                ? t('settings.bridgeError')
                : initError === 'initTimeout'
                  ? t('settings.initTimeoutError')
                  : t('settings.loadError')}
            </p>
            <button className="btn btn-primary" onClick={() => void init()}>
              {t('settings.retry')}
            </button>
          </>
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

  const scrollTo = (id: string): void => {
    setActiveSection(id)
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  return (
    <div className="mx-auto flex w-full max-w-[860px] gap-6 p-6">
      {/* Left sub-nav (plan §7.5) — simple anchor scroll, no new routing. */}
      <nav className="w-[170px] shrink-0">
        <div className="sticky top-0 space-y-0.5">
          {SECTIONS.map((s) => (
            <button
              key={s.id}
              onClick={() => scrollTo(s.id)}
              className={`nav-item ${activeSection === s.id ? 'nav-item-active' : ''}`}
            >
              <span className="flex-1 text-left">{t(s.labelKey)}</span>
            </button>
          ))}
        </div>
      </nav>

      <div className="min-w-0 flex-1 space-y-6">
        <h1 className="text-[20px] font-semibold">{t('settings.title')}</h1>

        <section id="settings-general" className="card scroll-mt-6">
          <div className="settings-head">
            <h2 className="text-[14px] font-semibold">{t('settings.navGeneral')}</h2>
          </div>
          <div className="settings-field">
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
          </div>

          <div className="settings-field">
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
          </div>

          <div className="settings-field">
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
          </div>

          <div className="settings-field">
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
          </div>

          <div className="settings-field">
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
          </div>

          <div className="settings-field">
            <label className="block">
              <span className="mb-1 block text-[13px] text-[var(--muted)]">
                {t('settings.theme')}
              </span>
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
          </div>
        </section>

        <section id="settings-video-audio" className="card scroll-mt-6">
          <div className="settings-head">
            <h2 className="text-[14px] font-semibold">{t('settings.videoAudio')}</h2>
          </div>

          <div className="settings-field">
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
          </div>

          <div className="settings-field">
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
          </div>

          <div className="settings-field">
            <label className="block">
              <span className="mb-1 block text-[13px] text-[var(--muted)]">
                {t('settings.defaultBitrate')}
              </span>
              <select
                className="input w-48"
                value={settings.defaultAudioBitrate}
                onChange={(e) =>
                  set({ defaultAudioBitrate: e.target.value as '320' | '192' | '128' })
                }
              >
                <option value="320">320 kbps</option>
                <option value="192">192 kbps</option>
                <option value="128">128 kbps</option>
              </select>
            </label>
          </div>

          <div className="settings-field">
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
          </div>
        </section>

        <section id="settings-engines" className="card scroll-mt-6">
          <div className="settings-head">
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
            <div className="py-3 text-[13px] text-[var(--muted)]">
              {enginesLoading ? t('settings.checking') : t('settings.engineMissing')}
            </div>
          )}
          {engines.map((e) => (
            <div
              key={e.name}
              className="settings-field flex items-center gap-2 text-[13px] text-[var(--muted)]"
            >
              <span className="w-20 font-medium text-[var(--text)]">{e.name}</span>
              <span className="badge tabular-nums">{e.version ?? '—'}</span>
              <span className="flex-1" />
              {e.updateAvailable ? (
                <>
                  <span className="text-[var(--warning)]">{t('settings.updateAvailable')}</span>
                  <button className="btn btn-sm" onClick={() => void updateEngine(e.name)}>
                    {t('settings.updateNow')}
                  </button>
                </>
              ) : (
                <span className="inline-flex items-center gap-1 text-[var(--success)]">
                  <IconCheck size={14} />
                  {e.latest ? t('settings.upToDate') : ''}
                </span>
              )}
            </div>
          ))}
          <div className="settings-field">
            <label className="flex cursor-pointer items-center gap-2 text-[13px]">
              <input
                type="checkbox"
                checked={settings.engineAutoUpdate}
                onChange={(e) => set({ engineAutoUpdate: e.target.checked })}
              />
              {t('settings.autoUpdateEngines')}
            </label>
          </div>
        </section>

        <section id="settings-about" className="card scroll-mt-6 text-[13px] text-[var(--muted)]">
          <div className="settings-head">
            <h2 className="text-[14px] font-semibold text-[var(--text)]">{t('settings.about')}</h2>
          </div>
          <div className="settings-field space-y-1">
            <div>{t('settings.version', { version: appInfo?.version ?? '0.1.0' })}</div>
            <div className="text-[12px]">{t('app.tagline')}</div>
            <div>
              <a
                href="https://github.com/Khalid635/dovira"
                target="_blank"
                rel="noreferrer"
                className="text-[var(--accent)] hover:underline"
              >
                github.com/Khalid635/dovira
              </a>
            </div>
          </div>
          <div className="settings-field space-y-1">
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
          </div>
        </section>
      </div>
    </div>
  )
}
