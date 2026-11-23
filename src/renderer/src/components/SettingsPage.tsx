import { useEffect, useState } from 'react'
import { useStore, useT } from '../store'
import type { ExtensionApiStatus, SchedulerStatus, Settings } from '../../../main/types'
import { IconCheck } from './icons'
import { presetIdForTemplate, presetTemplate, type NamePresetId } from '../util/namePresets'
import ExtensionSetup from './ExtensionSetup'
import DiagnosticsSection from './DiagnosticsSection'

const SUB_LANGS = ['en', 'bn', 'es', 'fr', 'de', 'hi', 'ja']

/** Phase 7: global speed-limit presets (KB/s). */
const SPEED_PRESETS = [
  { value: 0, labelKey: 'settings.speedLimitPresetUnlimited' },
  { value: 100, labelKey: 'settings.speedLimitPreset100' },
  { value: 500, labelKey: 'settings.speedLimitPreset500' },
  { value: 1024, labelKey: 'settings.speedLimitPreset1m' },
  { value: 5120, labelKey: 'settings.speedLimitPreset5m' }
]

/** Phase 7 (v1.0): organizer folder inputs — one per category. */
const SMART_CATEGORIES = [
  'Video',
  'Music',
  'Documents',
  'Archives',
  'Programs',
  'Images',
  'Others'
] as const

/**
 * Issue #5: map a local-model Test error code to its i18n reason key, so
 * the status line can name the failure instead of showing only ok/fail.
 */
const MODEL_TEST_REASON_KEYS: Record<string, string> = {
  'no-endpoint': 'settings.localModelReasonNoEndpoint',
  'no-model': 'settings.localModelReasonNoModel',
  unreachable: 'settings.localModelReasonUnreachable',
  timeout: 'settings.localModelReasonTimeout',
  http: 'settings.localModelReasonHttp',
  'bad-answer': 'settings.localModelReasonBadAnswer'
}

function modelTestReasonKey(error: string): string {
  return MODEL_TEST_REASON_KEYS[error] ?? 'settings.localModelReasonUnreachable'
}

const SECTIONS = [
  { id: 'settings-general', labelKey: 'settings.navGeneral' },
  { id: 'settings-network', labelKey: 'settings.navNetwork' },
  { id: 'settings-browser', labelKey: 'settings.navBrowser' },
  { id: 'settings-setup', labelKey: 'settings.navSetup' },
  { id: 'settings-scheduler', labelKey: 'settings.navScheduler' },
  { id: 'settings-video-audio', labelKey: 'settings.navVideoAudio' },
  { id: 'settings-smart', labelKey: 'settings.navSmart' },
  { id: 'settings-engines', labelKey: 'settings.navEngines' },
  { id: 'settings-app-update', labelKey: 'settings.navAppUpdate' },
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
  // Phase 6: app auto-update.
  const appUpdate = useStore((s) => s.appUpdate)
  const checkAppUpdate = useStore((s) => s.checkAppUpdate)
  const downloadAppUpdate = useStore((s) => s.downloadAppUpdate)
  const installAppUpdate = useStore((s) => s.installAppUpdate)
  const clearDownloadArchive = useStore((s) => s.clearDownloadArchive)
  // v1.2.0: re-open the first-run setup wizard.
  const openWizard = useStore((s) => s.openWizard)
  const [activeSection, setActiveSection] = useState(SECTIONS[0].id)
  // Phase 3: scheduler status (next run / last run) for the Scheduler section.
  const [schedulerStatus, setSchedulerStatus] = useState<SchedulerStatus | null>(null)
  // Phase 5: browser extension pairing (Local API status + token).
  const [extStatus, setExtStatus] = useState<ExtensionApiStatus | null>(null)
  const [showToken, setShowToken] = useState(false)
  const [tokenCopied, setTokenCopied] = useState(false)
  // Phase 7 (v1.0): Smart — local-model test state + live template preview.
  const [modelTesting, setModelTesting] = useState(false)
  const [modelTest, setModelTest] = useState<{ ok: boolean; error?: string } | null>(null)
  const [templatePreview, setTemplatePreview] = useState('')

  useEffect(() => {
    void loadEngines(false)
  }, [loadEngines])

  useEffect(() => {
    if (typeof window.dovira === 'undefined') return
    let cancelled = false
    void window.dovira
      .schedulerStatus()
      .then((s) => {
        if (!cancelled) setSchedulerStatus(s)
      })
      .catch(() => {
        // Keep the previous status — the section still renders.
      })
    return () => {
      cancelled = true
    }
  }, [settings?.schedulerEnabled, settings?.schedulerTime, settings?.schedulerAction])

  // Phase 5: Local API status for the Browser & Cookies section.
  useEffect(() => {
    if (typeof window.dovira === 'undefined') return
    let cancelled = false
    void window.dovira
      .extensionStatus()
      .then((s) => {
        if (!cancelled) setExtStatus(s)
      })
      .catch(() => {
        // Section still renders — with the "not running" message.
      })
    return () => {
      cancelled = true
    }
  }, [])

  const copyToken = async (): Promise<void> => {
    if (!extStatus?.token) return
    try {
      await navigator.clipboard.writeText(extStatus.token)
      setTokenCopied(true)
      setTimeout(() => setTokenCopied(false), 2000)
    } catch {
      // Clipboard unavailable — the user can still select the text.
    }
  }

  const regenerateToken = async (): Promise<void> => {
    const token = await window.dovira.regenerateExtensionToken()
    setExtStatus((prev) =>
      prev ? { ...prev, token } : { running: false, port: null, token, extensionSeenAt: null }
    )
  }

  // Phase 7: live template preview — same code path as the real naming
  // (main's suggestName), debounced so typing doesn't spam IPC.
  useEffect(() => {
    if (!settings?.smartNaming) return
    if (typeof window.dovira === 'undefined') return
    let cancelled = false
    const id = setTimeout(() => {
      void window.dovira
        .smartSuggestName({
          filename: 'Best PayPal Alternative (Official Video) [HD].mp4',
          title: 'Best PayPal Alternative (Official Video) [HD]',
          height: 1080,
          uploader: 'Sample Channel'
        })
        .then((r) => {
          if (!cancelled) setTemplatePreview(r.name)
        })
        .catch(() => {
          // Keep the previous preview.
        })
    }, 400)
    return () => {
      cancelled = true
      clearTimeout(id)
    }
  }, [settings?.nameTemplate, settings?.smartNaming])

  // Phase 7: test the local-model endpoint (Ollama / LM Studio).
  // Issue #5: keep the full result — the status line names the provider,
  // host and model it tested, plus the failure reason.
  const testLocalModel = async (): Promise<void> => {
    if (typeof window.dovira === 'undefined') return
    setModelTesting(true)
    setModelTest(null)
    try {
      const res = await window.dovira.testLocalModel()
      setModelTest(res)
    } catch {
      setModelTest({ ok: false, error: 'unreachable' })
    } finally {
      setModelTesting(false)
    }
  }

  // Issue #5: what the Test button tested, in display form.
  const localModelProviderLabel = settings?.localModelProvider === 'ollama' ? 'Ollama' : 'LM Studio'
  const localModelHost =
    (settings?.localModelEndpoint ?? '').replace(/^https?:\/\//, '').replace(/\/+$/, '') ||
    settings?.localModelEndpoint ||
    ''

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

  // Phase 6: app-update status line (the checksum states name the exact
  // reason — a failed verification never looks like "no update").
  const updateBusy = ['checking', 'downloading', 'verifying'].includes(appUpdate.state)
  const updateStatusText = (() => {
    switch (appUpdate.state) {
      case 'checking':
        return t('settings.appUpdateChecking')
      case 'available':
        return t('settings.appUpdateAvailable', { version: appUpdate.version ?? '' })
      case 'not-available':
        return t('settings.appUpdateNotAvailable')
      case 'downloading':
        return t('settings.appUpdateDownloading', { n: appUpdate.progress ?? 0 })
      case 'verifying':
        return t('settings.appUpdateVerifying')
      case 'install-ready':
        return t('settings.appUpdateReady', { version: appUpdate.version ?? '' })
      case 'checksum-failed':
        return appUpdate.error === 'checksum-mismatch'
          ? t('settings.appUpdateChecksumMismatch')
          : appUpdate.error === 'checksums-missing'
            ? t('settings.appUpdateChecksumsMissing')
            : t('settings.appUpdateChecksumsUnavailable')
      case 'error':
        return t('settings.appUpdateError', { error: appUpdate.error ?? '' })
      default:
        return t('settings.appUpdateIdle')
    }
  })()

  const pickFolder = async (): Promise<void> => {
    const dir = await window.dovira.pickFolder()
    if (dir) set({ downloadDir: dir })
  }

  // Phase 3: cookies.txt picker.
  const pickCookiesFile = async (): Promise<void> => {
    const path = await window.dovira.pickCookiesFile()
    if (path) set({ cookiesFile: path })
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

          {/* Phase 7: speed-limit presets + custom value (was a bare number input). */}
          <div className="settings-field">
            <span className="mb-1 block text-[13px] text-[var(--muted)]">
              {t('settings.speedLimitPresets')}
            </span>
            <div className="flex flex-wrap items-center gap-2">
              <div className="seg-tabs" role="group" aria-label={t('settings.speedLimitPresets')}>
                {SPEED_PRESETS.map((p) => (
                  <button
                    key={p.value}
                    type="button"
                    className={`seg-tab ${settings.speedLimitKBps === p.value ? 'seg-tab-active' : ''}`}
                    onClick={() => set({ speedLimitKBps: p.value })}
                  >
                    {t(p.labelKey)}
                  </button>
                ))}
              </div>
              <label className="flex items-center gap-1 text-[12px] text-[var(--muted)]">
                <input
                  key={settings.speedLimitKBps}
                  className="input w-28 py-1 text-[12px]"
                  type="number"
                  min={0}
                  max={1_000_000}
                  defaultValue={
                    !SPEED_PRESETS.some((p) => p.value === settings.speedLimitKBps)
                      ? settings.speedLimitKBps
                      : undefined
                  }
                  placeholder={t('settings.speedLimitCustom')}
                  onBlur={(e) => {
                    const v = Math.max(
                      0,
                      Math.min(1_000_000, Math.floor(Number(e.target.value) || 0))
                    )
                    set({ speedLimitKBps: v })
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
                  }}
                  aria-label={t('settings.speedLimitCustom')}
                />
                KB/s
              </label>
            </div>
            <div className="mt-1 text-[12px] text-[var(--muted)]">
              {t('settings.speedLimitHelp')}
            </div>
          </div>

          {/* Phase 3: auto-retry count (0–10), next to the other download settings. */}
          <div className="settings-field">
            <label className="block">
              <span className="mb-1 block text-[13px] text-[var(--muted)]">
                {t('settings.autoRetry')} (0–10)
              </span>
              <input
                className="input w-32"
                type="number"
                min={0}
                max={10}
                value={settings.autoRetry}
                onChange={(e) => set({ autoRetry: Number(e.target.value) })}
              />
            </label>
          </div>

          {/* Phase 3: startup + tray. */}
          <div className="settings-field">
            <label className="flex cursor-pointer items-center gap-2 text-[13px]">
              <input
                type="checkbox"
                checked={settings.launchAtStartup}
                onChange={(e) => set({ launchAtStartup: e.target.checked })}
              />
              {t('settings.launchAtStartup')}
            </label>
          </div>

          <div className="settings-field">
            <label className="flex cursor-pointer items-center gap-2 text-[13px]">
              <input
                type="checkbox"
                checked={settings.minimizeToTray}
                onChange={(e) => set({ minimizeToTray: e.target.checked })}
              />
              {t('settings.minimizeToTray')}
            </label>
          </div>

          {/* Phase 3: clipboard watch (AI Link Detection) — OFF by default. */}
          <div className="settings-field">
            <label className="flex cursor-pointer items-center justify-between gap-2 text-[13px]">
              <span>{t('settings.clipboardWatch')}</span>
              <span className="switch">
                <input
                  type="checkbox"
                  checked={settings.clipboardWatch}
                  onChange={(e) => set({ clipboardWatch: e.target.checked })}
                />
                <span className="switch-track" />
              </span>
            </label>
            <p className="mt-1 text-[12px] text-[var(--muted)]">
              {t('settings.clipboardWatchHint')}
            </p>
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

        {/* Phase 3: Network — proxy for downloads. */}
        <section id="settings-network" className="card scroll-mt-6">
          <div className="settings-head">
            <h2 className="text-[14px] font-semibold">{t('settings.network')}</h2>
          </div>
          <div className="settings-field">
            <label className="block">
              <span className="mb-1 block text-[13px] text-[var(--muted)]">
                {t('settings.proxyUrl')}
              </span>
              <input
                className="input w-full"
                type="text"
                placeholder="http://127.0.0.1:8080"
                value={settings.proxyUrl}
                onChange={(e) => set({ proxyUrl: e.target.value })}
              />
            </label>
            <p className="mt-1 text-[12px] text-[var(--muted)]">{t('settings.proxyHint')}</p>
          </div>
        </section>

        {/* Phase 3: Browser & Cookies — login-required downloads. */}
        <section id="settings-browser" className="card scroll-mt-6">
          <div className="settings-head">
            <h2 className="text-[14px] font-semibold">{t('settings.browserCookies')}</h2>
          </div>
          <div className="settings-field">
            <label className="block">
              <span className="mb-1 block text-[13px] text-[var(--muted)]">
                {t('settings.cookieBrowser')}
              </span>
              <select
                className="input w-48"
                value={settings.cookieBrowser}
                onChange={(e) =>
                  set({ cookieBrowser: e.target.value as Settings['cookieBrowser'] })
                }
              >
                <option value="none">{t('settings.cookieBrowserNone')}</option>
                <option value="chrome">Chrome</option>
                <option value="edge">Edge</option>
                <option value="firefox">Firefox</option>
                <option value="brave">Brave</option>
              </select>
            </label>
            <p className="mt-1 text-[12px] text-[var(--muted)]">{t('settings.cookiesHint')}</p>
          </div>
          <div className="settings-field">
            <label className="block">
              <span className="mb-1 block text-[13px] text-[var(--muted)]">
                {t('settings.cookiesFile')}
              </span>
              <span className="flex gap-2">
                <input
                  className="input flex-1"
                  value={settings.cookiesFile ?? ''}
                  placeholder="cookies.txt"
                  readOnly
                />
                <button className="btn" onClick={() => void pickCookiesFile()}>
                  {t('settings.choose')}
                </button>
                {settings.cookiesFile && (
                  <button className="btn btn-ghost" onClick={() => set({ cookiesFile: null })}>
                    {t('settings.cookiesFileClear')}
                  </button>
                )}
              </span>
            </label>
          </div>
          {/* Phase 5: Browser extension pairing — Local API status + token. */}
          <div className="settings-field">
            <span className="mb-1 block text-[13px] text-[var(--muted)]">
              {t('settings.extensionStatus')}
            </span>
            <p className="text-[13px]">
              {extStatus?.running
                ? t('settings.extensionStatusRunning', { port: extStatus.port ?? 0 })
                : t('settings.extensionStatusStopped')}
            </p>
            <p className="mt-1 text-[12px] text-[var(--muted)]">
              {t('settings.extensionInstallHint')}
            </p>
          </div>
          <div className="settings-field">
            <label className="block">
              <span className="mb-1 block text-[13px] text-[var(--muted)]">
                {t('settings.extensionToken')}
              </span>
              <span className="flex gap-2">
                <input
                  className="input flex-1 font-mono"
                  type={showToken ? 'text' : 'password'}
                  value={extStatus?.token ?? ''}
                  readOnly
                />
                <button className="btn" onClick={() => setShowToken(!showToken)}>
                  {showToken ? t('settings.extensionTokenHide') : t('settings.extensionTokenShow')}
                </button>
                <button className="btn" onClick={() => void copyToken()}>
                  {tokenCopied ? t('settings.extensionCopied') : t('settings.extensionTokenCopy')}
                </button>
                <button className="btn btn-ghost" onClick={() => void regenerateToken()}>
                  {t('settings.extensionRegenerate')}
                </button>
              </span>
            </label>
            <p className="mt-1 text-[12px] text-[var(--muted)]">{t('settings.extensionHint')}</p>
          </div>
        </section>

        {/* v1.2.0: Setup & diagnostics — first-run wizard re-run, guided extension install, self-checks. */}
        <section id="settings-setup" className="card scroll-mt-6">
          <div className="settings-head">
            <h2 className="text-[14px] font-semibold">{t('settings.setupTitle')}</h2>
          </div>
          <div className="settings-field">
            <button className="btn btn-sm" onClick={openWizard}>
              {t('settings.setupRerun')}
            </button>
            <p className="mt-1 text-[12px] text-[var(--muted)]">{t('settings.setupRerunHint')}</p>
          </div>
          <div className="settings-field">
            <ExtensionSetup />
          </div>
          <div className="settings-field">
            <DiagnosticsSection />
          </div>
        </section>

        {/* Phase 3: Scheduler — timed queue start + shutdown/sleep after. */}
        <section id="settings-scheduler" className="card scroll-mt-6">
          <div className="settings-head">
            <h2 className="text-[14px] font-semibold">{t('settings.scheduler')}</h2>
          </div>
          <div className="settings-field">
            <label className="flex cursor-pointer items-center justify-between gap-2 text-[13px]">
              <span>{t('settings.schedulerEnable')}</span>
              <span className="switch">
                <input
                  type="checkbox"
                  checked={settings.schedulerEnabled}
                  onChange={(e) => set({ schedulerEnabled: e.target.checked })}
                />
                <span className="switch-track" />
              </span>
            </label>
          </div>
          <div className="settings-field">
            <label className="block">
              <span className="mb-1 block text-[13px] text-[var(--muted)]">
                {t('settings.schedulerTime')}
              </span>
              <input
                className="input w-32"
                type="time"
                value={settings.schedulerTime}
                onChange={(e) => set({ schedulerTime: e.target.value })}
              />
            </label>
          </div>
          <div className="settings-field">
            <label className="block">
              <span className="mb-1 block text-[13px] text-[var(--muted)]">
                {t('settings.schedulerAction')}
              </span>
              <select
                className="input w-48"
                value={settings.schedulerAction}
                onChange={(e) =>
                  set({ schedulerAction: e.target.value as Settings['schedulerAction'] })
                }
              >
                <option value="none">{t('settings.schedulerActionNone')}</option>
                <option value="shutdown">{t('settings.schedulerActionShutdown')}</option>
                <option value="sleep">{t('settings.schedulerActionSleep')}</option>
              </select>
            </label>
          </div>
          <div className="settings-field text-[13px] text-[var(--muted)]">
            {schedulerStatus?.nextRunAt ? (
              <div>
                {t('settings.schedulerNextRun', {
                  when: new Date(schedulerStatus.nextRunAt).toLocaleString()
                })}
              </div>
            ) : (
              <div>{t('settings.schedulerNextRunNone')}</div>
            )}
            {schedulerStatus?.lastRunAt && (
              <div>
                {t('settings.schedulerLastRun', {
                  when: new Date(schedulerStatus.lastRunAt).toLocaleString()
                })}
              </div>
            )}
            <p className="mt-1 text-[12px]">{t('settings.schedulerNote')}</p>
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

          {/* Phase 4: skip videos already downloaded (playlists/batch). */}
          <div className="settings-field">
            <label className="flex cursor-pointer items-center justify-between gap-2 text-[13px]">
              <span>{t('settings.playlistSkipDownloaded')}</span>
              <span className="switch">
                <input
                  type="checkbox"
                  checked={settings.playlistSkipDownloaded}
                  onChange={(e) => set({ playlistSkipDownloaded: e.target.checked })}
                />
                <span className="switch-track" />
              </span>
            </label>
            <p className="mt-1 text-[12px] text-[var(--muted)]">
              {t('settings.playlistSkipDownloadedHint')}
            </p>
          </div>

          {/* Phase 4: embed title/artist metadata by default. */}
          <div className="settings-field">
            <label className="flex cursor-pointer items-center gap-2 text-[13px]">
              <input
                type="checkbox"
                checked={settings.embedMetadataDefault}
                onChange={(e) => set({ embedMetadataDefault: e.target.checked })}
              />
              {t('settings.embedMetadataDefault')}
            </label>
          </div>

          {/* Phase 4: clear the download archive (yt-dlp --download-archive). */}
          <div className="settings-field">
            <button className="btn btn-sm" onClick={() => void clearDownloadArchive()}>
              {t('settings.clearArchive')}
            </button>
          </div>
        </section>

        {/* Phase 7 (v1.0): Smart features — organizer, smart names, duplicates, adaptive download, local model. */}
        <section id="settings-smart" className="card scroll-mt-6">
          <div className="settings-head">
            <h2 className="text-[14px] font-semibold">{t('settings.smart')}</h2>
          </div>

          <div className="settings-field">
            <label className="flex cursor-pointer items-center justify-between gap-2 text-[13px]">
              <span>{t('settings.smartOrganizer')}</span>
              <span className="switch">
                <input
                  type="checkbox"
                  checked={settings.smartOrganizer}
                  onChange={(e) => set({ smartOrganizer: e.target.checked })}
                />
                <span className="switch-track" />
              </span>
            </label>
            <p className="mt-1 text-[12px] text-[var(--muted)]">
              {t('settings.smartOrganizerHint')}
            </p>
          </div>

          {settings.smartOrganizer && (
            <div className="settings-field">
              <span className="mb-1 block text-[13px] text-[var(--muted)]">
                {t('settings.organizerFolders')}
              </span>
              <div className="grid grid-cols-2 gap-2">
                {SMART_CATEGORIES.map((c) => (
                  <label key={c} className="block">
                    <span className="mb-1 block text-[12px] text-[var(--muted)]">
                      {t(`smart.category${c}`)}
                    </span>
                    <input
                      className="input w-full"
                      value={settings.organizerFolders[c] ?? c}
                      onChange={(e) =>
                        set({
                          organizerFolders: { ...settings.organizerFolders, [c]: e.target.value }
                        })
                      }
                    />
                  </label>
                ))}
              </div>
              <p className="mt-1 text-[12px] text-[var(--muted)]">
                {t('settings.organizerFoldersHint')}
              </p>
            </div>
          )}

          <div className="settings-field">
            <label className="flex cursor-pointer items-center justify-between gap-2 text-[13px]">
              <span>{t('settings.smartNaming')}</span>
              <span className="switch">
                <input
                  type="checkbox"
                  checked={settings.smartNaming}
                  onChange={(e) => set({ smartNaming: e.target.checked })}
                />
                <span className="switch-track" />
              </span>
            </label>
            <p className="mt-1 text-[12px] text-[var(--muted)]">{t('settings.smartNamingHint')}</p>
          </div>

          {settings.smartNaming && (
            <div className="settings-field">
              <label className="block">
                <span className="mb-1 block text-[13px] text-[var(--muted)]">
                  {t('settings.namePreset')}
                </span>
                <select
                  className="input w-full"
                  value={settings.nameTemplatePreset}
                  onChange={(e) => {
                    const id = e.target.value as NamePresetId
                    if (id === 'custom') set({ nameTemplatePreset: 'custom' })
                    else set({ nameTemplatePreset: id, nameTemplate: presetTemplate(id) })
                  }}
                >
                  <option value="title-quality">{t('settings.namePresetTitleQuality')}</option>
                  <option value="title">{t('settings.namePresetTitle')}</option>
                  <option value="title-uploader">{t('settings.namePresetTitleUploader')}</option>
                  <option value="uploader-title-quality">
                    {t('settings.namePresetUploaderTitleQuality')}
                  </option>
                  <option value="title-date">{t('settings.namePresetTitleDate')}</option>
                  <option value="custom">{t('settings.namePresetCustom')}</option>
                </select>
              </label>
              <p className="mt-1 text-[12px] text-[var(--muted)]">
                {t('settings.namePresetHint')}
              </p>
              <label className="mt-3 block">
                <span className="mb-1 block text-[13px] text-[var(--muted)]">
                  {t('settings.nameTemplate')}
                </span>
                <input
                  className="input w-full font-mono"
                  value={settings.nameTemplate}
                  onChange={(e) =>
                    set({
                      nameTemplate: e.target.value,
                      nameTemplatePreset: presetIdForTemplate(e.target.value)
                    })
                  }
                />
              </label>
              <p className="mt-1 text-[12px] text-[var(--muted)]">
                {t('settings.nameTemplatePreview', {
                  name: templatePreview || settings.nameTemplate
                })}
              </p>
            </div>
          )}

          <div className="settings-field">
            <label className="flex cursor-pointer items-center justify-between gap-2 text-[13px]">
              <span>{t('settings.smartDuplicates')}</span>
              <span className="switch">
                <input
                  type="checkbox"
                  checked={settings.smartDuplicates}
                  onChange={(e) => set({ smartDuplicates: e.target.checked })}
                />
                <span className="switch-track" />
              </span>
            </label>
            <p className="mt-1 text-[12px] text-[var(--muted)]">
              {t('settings.smartDuplicatesHint')}
            </p>
          </div>

          <div className="settings-field">
            <label className="flex cursor-pointer items-center justify-between gap-2 text-[13px]">
              <span>{t('settings.smartDownload')}</span>
              <span className="switch">
                <input
                  type="checkbox"
                  checked={settings.smartDownload}
                  onChange={(e) => set({ smartDownload: e.target.checked })}
                />
                <span className="switch-track" />
              </span>
            </label>
            <p className="mt-1 text-[12px] text-[var(--muted)]">
              {t('settings.smartDownloadHint')}
            </p>
          </div>

          <div className="settings-field">
            <label className="flex cursor-pointer items-center justify-between gap-2 text-[13px]">
              <span>{t('settings.assistant')}</span>
              <span className="switch">
                <input
                  type="checkbox"
                  checked={settings.assistantEnabled}
                  onChange={(e) => set({ assistantEnabled: e.target.checked })}
                />
                <span className="switch-track" />
              </span>
            </label>
            <p className="mt-1 text-[12px] text-[var(--muted)]">{t('settings.assistantHint')}</p>
          </div>

          {settings.assistantEnabled && (
            <div className="settings-field">
              <label className="flex cursor-pointer items-center justify-between gap-2 text-[13px]">
                <span>{t('settings.assistantLocalModel')}</span>
                <span className="switch">
                  <input
                    type="checkbox"
                    checked={settings.assistantLocalModel}
                    onChange={(e) => set({ assistantLocalModel: e.target.checked })}
                  />
                  <span className="switch-track" />
                </span>
              </label>
              <p className="mt-1 text-[12px] text-[var(--muted)]">
                {t('settings.assistantLocalModelHint')}
              </p>
            </div>
          )}

          <div className="settings-field">
            <label className="flex cursor-pointer items-center justify-between gap-2 text-[13px]">
              <span>{t('settings.localModel')}</span>
              <span className="switch">
                <input
                  type="checkbox"
                  checked={settings.localModelEnabled}
                  onChange={(e) => set({ localModelEnabled: e.target.checked })}
                />
                <span className="switch-track" />
              </span>
            </label>
            <p className="mt-1 text-[12px] text-[var(--muted)]">{t('settings.localModelHint')}</p>
          </div>

          {settings.localModelEnabled && (
            <>
              <div className="settings-field">
                <label className="block">
                  <span className="mb-1 block text-[13px] text-[var(--muted)]">
                    {t('settings.localModelProvider')}
                  </span>
                  <select
                    className="input w-48"
                    value={settings.localModelProvider}
                    onChange={(e) =>
                      set({ localModelProvider: e.target.value as 'ollama' | 'lmstudio' })
                    }
                  >
                    <option value="ollama">Ollama</option>
                    <option value="lmstudio">LM Studio</option>
                  </select>
                </label>
              </div>
              <div className="settings-field">
                <label className="block">
                  <span className="mb-1 block text-[13px] text-[var(--muted)]">
                    {t('settings.localModelEndpoint')}
                  </span>
                  <input
                    className="input w-full font-mono"
                    value={settings.localModelEndpoint}
                    placeholder="http://127.0.0.1:11434"
                    onChange={(e) => set({ localModelEndpoint: e.target.value })}
                  />
                </label>
              </div>
              <div className="settings-field">
                <label className="block">
                  <span className="mb-1 block text-[13px] text-[var(--muted)]">
                    {t('settings.localModelName')}
                  </span>
                  <input
                    className="input w-full"
                    value={settings.localModelName}
                    placeholder="llama3.2"
                    onChange={(e) => set({ localModelName: e.target.value })}
                  />
                </label>
              </div>
              <div className="settings-field">
                <span className="flex items-center gap-2">
                  <button
                    className="btn btn-sm"
                    onClick={() => void testLocalModel()}
                    disabled={modelTesting}
                  >
                    {modelTesting ? t('settings.localModelTesting') : t('settings.localModelTest')}
                  </button>
                  {modelTest && (
                    <span className={`text-[13px] ${modelTest.ok ? '' : 'text-[var(--danger)]'}`}>
                      {modelTest.ok
                        ? t('settings.localModelTestOkDetail', {
                            provider: localModelProviderLabel,
                            host: localModelHost,
                            model: settings.localModelName || '—'
                          })
                        : t('settings.localModelTestFailDetail', {
                            provider: localModelProviderLabel,
                            host: localModelHost,
                            model: settings.localModelName || '—',
                            reason: t(modelTestReasonKey(modelTest.error ?? 'unreachable'))
                          })}
                    </span>
                  )}
                </span>
              </div>
            </>
          )}
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

        {/* Phase 6: app auto-update (electron-updater + GitHub Releases).
            The download is checksum-verified before install — a failed
            verification cancels the update and says so here. */}
        <section id="settings-app-update" className="card scroll-mt-6">
          <div className="settings-head">
            <h2 className="text-[14px] font-semibold">{t('settings.appUpdate')}</h2>
            <button
              className="btn btn-sm"
              disabled={updateBusy}
              onClick={() => void checkAppUpdate()}
            >
              {t('settings.checkForUpdates')}
            </button>
          </div>
          <div className="settings-field text-[13px] text-[var(--muted)]">{updateStatusText}</div>
          {appUpdate.state === 'available' && (
            <div className="settings-field">
              <button className="btn btn-sm" onClick={() => void downloadAppUpdate()}>
                {t('settings.downloadUpdate')}
              </button>
            </div>
          )}
          {appUpdate.state === 'install-ready' && (
            <div className="settings-field">
              <button className="btn btn-sm" onClick={() => void installAppUpdate()}>
                {t('settings.restartAndInstall')}
              </button>
            </div>
          )}
          <div className="settings-field">
            <label className="flex cursor-pointer items-center gap-2 text-[13px]">
              <input
                type="checkbox"
                checked={settings.appUpdateCheck}
                onChange={(e) => set({ appUpdateCheck: e.target.checked })}
              />
              {t('settings.appUpdateCheck')}
            </label>
          </div>
          <div className="settings-field">
            <label className="flex cursor-pointer items-center gap-2 text-[13px]">
              <input
                type="checkbox"
                checked={settings.appUpdateAutoDownload}
                onChange={(e) => set({ appUpdateAutoDownload: e.target.checked })}
              />
              {t('settings.appUpdateAutoDownload')}
            </label>
          </div>
        </section>

        <section id="settings-about" className="card scroll-mt-6 text-[13px] text-[var(--muted)]">
          <div className="settings-head">
            <h2 className="text-[14px] font-semibold text-[var(--text)]">{t('settings.about')}</h2>
          </div>
          <div className="settings-field space-y-1">
            <div>{t('settings.version', { version: appInfo?.version ?? '0.5.0' })}</div>
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
