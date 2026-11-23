import { useEffect, useState } from 'react'
import { useStore, useT } from '../store'
import type { ExtensionApiStatus, Settings } from '../../../main/types'
import { IconExternal } from './icons'

/**
 * v1.2.0: guided browser-extension install + live status + behaviour
 * switches. Shared by the first-run wizard and Settings > Setup &
 * diagnostics, so the steps are identical in both places.
 *
 * The app cannot open chrome://extensions itself (a Chrome-only page),
 * so step 2 copies the address for the user to paste into Chrome.
 */
export default function ExtensionSetup(): React.JSX.Element {
  const t = useT()
  const settings = useStore((s) => s.settings)
  const updateSettings = useStore((s) => s.updateSettings)
  const [extStatus, setExtStatus] = useState<ExtensionApiStatus | null>(null)
  const [folderPath, setFolderPath] = useState<string | null>(null)
  const [folderMissing, setFolderMissing] = useState(false)
  const [copied, setCopied] = useState<string | null>(null)
  const [testing, setTesting] = useState(false)
  // Next-level: one-click pairing state.
  const [pairState, setPairState] = useState<'idle' | 'done' | 'failed'>('idle')
  // Clock snapshot for the "seen X minutes ago" line — plain state, so
  // render stays pure (no Date.now() during render).
  const [now, setNow] = useState(0)

  const refreshStatus = async (): Promise<void> => {
    if (typeof window.dovira === 'undefined') return
    try {
      setExtStatus(await window.dovira.extensionStatus())
      setNow(Date.now())
    } catch {
      // Keep the previous status — the section still renders.
    }
  }

  useEffect(() => {
    if (typeof window.dovira === 'undefined') return
    // Initial fetch via promise chain (setState in a callback, not a
    // synchronous effect call); the interval below re-polls.
    void window.dovira
      .extensionStatus()
      .then((s) => {
        setExtStatus(s)
        setNow(Date.now())
      })
      .catch(() => undefined)
    void window.dovira
      .extensionFolderPath()
      .then((p) => {
        if (p) setFolderPath(p)
        else setFolderMissing(true)
      })
      .catch(() => setFolderMissing(true))
    // Live status: the extension checks in every minute.
    const id = setInterval(() => {
      void refreshStatus()
    }, 3000)
    return () => clearInterval(id)
  }, [])

  const copy = async (which: string, text: string): Promise<void> => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(which)
      setTimeout(() => setCopied((c) => (c === which ? null : c)), 2000)
    } catch {
      // Clipboard unavailable — the user can still select the text.
    }
  }

  const testConnection = async (): Promise<void> => {
    setTesting(true)
    await refreshStatus()
    setTimeout(() => setTesting(false), 1200)
  }

  const openFolder = async (): Promise<void> => {
    if (typeof window.dovira === 'undefined') return
    try {
      await window.dovira.openExtensionFolder()
    } catch {
      // Explorer failing must not break the section.
    }
  }

  const regenToken = async (): Promise<void> => {
    if (typeof window.dovira === 'undefined') return
    try {
      const token = await window.dovira.regenerateExtensionToken()
      setExtStatus((prev) =>
        prev
          ? { ...prev, token }
          : { running: false, port: null, token, extensionSeenAt: null, extensionOptionsUrl: null }
      )
    } catch {
      // Keep the old token on screen.
    }
  }

  // Next-level: one-click pairing — opens the extension's own Options
  // page with the token in the URL; the Options page pre-fills and
  // auto-saves it. Only enabled once the extension has checked in
  // (the app only learns the Options URL from its status ping).
  const pairExtension = async (): Promise<void> => {
    if (typeof window.dovira === 'undefined') return
    try {
      const res = await window.dovira.pairExtension()
      setPairState(res.ok ? 'done' : 'failed')
    } catch {
      setPairState('failed')
    }
  }

  if (!settings) return <div />

  const set = (patch: Partial<Settings>): void => {
    void updateSettings(patch)
  }

  const seenAt = extStatus?.extensionSeenAt ?? null
  const seenFresh = seenAt !== null && now !== 0 && now - seenAt <= 120_000
  const seenMinutes =
    seenAt !== null && now !== 0 ? Math.max(1, Math.round((now - seenAt) / 60000)) : 0

  return (
    <div className="space-y-4">
      <div>
        <span className="mb-1 block text-[13px] text-[var(--muted)]">{t('extension.title')}</span>
        <p className="text-[13px]">
          {extStatus?.running
            ? t('extension.statusApiRunning', { port: extStatus.port ?? 0 })
            : t('extension.statusApiStopped')}
        </p>
        <p className="mt-1 text-[13px]">
          {seenFresh
            ? t('extension.statusConnected')
            : seenAt !== null
              ? t('extension.statusSeenAgo', { minutes: seenMinutes })
              : t('extension.statusNotSeen')}
        </p>
      </div>

      <div>
        <span className="mb-2 block text-[13px] font-medium">{t('extension.guideTitle')}</span>
        <ol className="space-y-3 text-[13px]">
          <li>
            <div>{t('extension.step1')}</div>
            <div className="mt-1 text-[12px] text-[var(--muted)]">{t('extension.step1Hint')}</div>
            <div className="mt-1 flex flex-wrap gap-2">
              <button
                className="btn btn-sm"
                disabled={!folderPath}
                onClick={() => void copy('path', folderPath ?? '')}
              >
                {copied === 'path' ? t('extension.copied') : t('extension.copyPath')}
              </button>
              <button
                className="btn btn-sm"
                disabled={!folderPath}
                onClick={() => void openFolder()}
              >
                {t('extension.openFolder')}
              </button>
            </div>
            {folderPath && (
              <div className="mt-1 break-all font-mono text-[12px] text-[var(--muted)]">
                {folderPath}
              </div>
            )}
            {folderMissing && (
              <div className="mt-1 text-[12px] text-[var(--danger)]">
                {t('extension.pathMissing')}
              </div>
            )}
            {folderMissing && (
              <div className="mt-1 text-[12px] text-[var(--muted)]">
                {t('extension.folderMissingHint')}
              </div>
            )}
          </li>
          <li>
            <div>{t('extension.step2')}</div>
            <div className="mt-1 text-[12px] text-[var(--muted)]">{t('extension.step2Hint')}</div>
            <div className="mt-1">
              <button
                className="btn btn-sm"
                onClick={() => void copy('address', 'chrome://extensions')}
              >
                {copied === 'address' ? t('extension.copied') : t('extension.copyAddress')}
              </button>
            </div>
          </li>
          <li>
            <div>{t('extension.step3')}</div>
          </li>
          <li>
            <div>{t('extension.step4')}</div>
            <div className="mt-1 flex flex-wrap gap-2">
              <button
                className="btn btn-sm btn-primary"
                disabled={!extStatus?.extensionOptionsUrl}
                onClick={() => void pairExtension()}
              >
                {t('extension.pairExtension')}
              </button>
              <button
                className="btn btn-sm"
                disabled={!extStatus?.token}
                onClick={() => void copy('token', extStatus?.token ?? '')}
              >
                {copied === 'token' ? t('extension.copied') : t('extension.copyToken')}
              </button>
              <button className="btn btn-sm btn-ghost" onClick={() => void regenToken()}>
                {t('settings.extensionRegenerate')}
              </button>
            </div>
            <div className="mt-1 text-[12px] text-[var(--muted)]">
              {extStatus?.extensionOptionsUrl
                ? t('extension.pairHint')
                : t('extension.pairUnavailable')}
            </div>
            {pairState === 'done' && (
              <div className="mt-1 text-[12px] text-[var(--success)]">
                {t('extension.pairDone')}
              </div>
            )}
            {pairState === 'failed' && (
              <div className="mt-1 text-[12px] text-[var(--danger)]">
                {t('extension.pairFailed')}
              </div>
            )}
          </li>
        </ol>
      </div>

      <div>
        <button className="btn btn-sm" disabled={testing} onClick={() => void testConnection()}>
          {testing ? t('extension.testing') : t('extension.test')}
        </button>
        <p className="mt-1 text-[12px] text-[var(--muted)]">{t('extension.testHint')}</p>
      </div>

      <div>
        <label className="flex cursor-pointer items-center justify-between gap-2 text-[13px]">
          <span>{t('extension.floatingButton')}</span>
          <span className="switch">
            <input
              type="checkbox"
              checked={settings.extensionFloatingButton}
              onChange={(e) => set({ extensionFloatingButton: e.target.checked })}
            />
            <span className="switch-track" />
          </span>
        </label>
        <p className="mt-1 text-[12px] text-[var(--muted)]">{t('extension.floatingButtonHint')}</p>
      </div>

      <div>
        <label className="flex cursor-pointer items-center justify-between gap-2 text-[13px]">
          <span>{t('extension.intercept')}</span>
          <span className="switch">
            <input
              type="checkbox"
              checked={settings.extensionIntercept}
              onChange={(e) => set({ extensionIntercept: e.target.checked })}
            />
            <span className="switch-track" />
          </span>
        </label>
        <p className="mt-1 text-[12px] text-[var(--muted)]">{t('extension.interceptHint')}</p>
      </div>

      <p className="text-[12px] text-[var(--muted)]">{t('extension.noteDevMode')}</p>

      <button
        className="btn btn-sm"
        onClick={() => void window.dovira.openLocalApiDocs()}
        title={t('extension.apiDocsHint')}
      >
        <IconExternal size={14} />
        {t('extension.apiDocs')}
      </button>
    </div>
  )
}
