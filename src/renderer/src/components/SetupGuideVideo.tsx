import { useEffect, useRef, useState } from 'react'
import { useStore, useT } from '../store'

/**
 * v1.3.1: the setup-guide video in Settings > Setup & diagnostics.
 * The video is ONE swappable asset file (resources/setup-guide.mp4,
 * served over the Local API) — replacing the file updates the video
 * with no code change. The version label is the app version: the guide
 * is made for the running release. No autoplay — the user presses play.
 * preload="metadata" so opening Settings fetches only the header, not
 * the whole ~15 MB file.
 */
export default function SetupGuideVideo(): React.JSX.Element {
  const t = useT()
  const appInfo = useStore((s) => s.appInfo)
  const setupGuideUrl = useStore((s) => s.setupGuideUrl)
  const [url, setUrl] = useState<string | null>(null)
  const videoRef = useRef<HTMLVideoElement | null>(null)

  useEffect(() => {
    let cancelled = false
    void setupGuideUrl()
      .then((u) => {
        if (!cancelled) setUrl(u)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [setupGuideUrl])

  // Pause on unmount so audio never keeps playing after leaving Settings.
  useEffect(
    () => () => {
      videoRef.current?.pause()
    },
    []
  )

  const version = appInfo?.version
  return (
    <div>
      <span className="mb-2 block text-[13px] font-medium">{t('settings.setupGuideTitle')}</span>
      <p className="text-[13px]">{t('settings.setupGuideDesc')}</p>
      {version && (
        <p className="mt-1 text-[12px] text-[var(--muted)]">
          {t('settings.setupGuideVersion', { version })}
        </p>
      )}
      {url ? (
        <video
          ref={videoRef}
          src={url}
          controls
          preload="metadata"
          className="mt-2 w-full rounded-lg bg-black"
        />
      ) : (
        <p className="mt-2 text-[12px] text-[var(--muted)]">{t('settings.setupGuideUnavailable')}</p>
      )}
    </div>
  )
}
