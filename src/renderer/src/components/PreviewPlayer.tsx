// Next-level: in-app preview of a completed video/audio file.
// The src is a Local API /preview URL (token in the query string),
// fetched through the main process — the media element never talks
// to the Local API directly. Esc / backdrop click closes; the media
// pauses on unmount.
import { useEffect, useRef } from 'react'
import { useT } from '../store'
import { IconClose } from './icons'

interface PreviewPlayerProps {
  src: string
  kind: 'video' | 'audio' | 'file'
  title: string
  onClose: () => void
}

export default function PreviewPlayer({
  src,
  kind,
  title,
  onClose
}: PreviewPlayerProps): React.JSX.Element {
  const t = useT()
  const mediaRef = useRef<HTMLVideoElement | HTMLAudioElement | null>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // Pause on unmount so audio never keeps playing after close.
  useEffect(
    () => () => {
      mediaRef.current?.pause()
    },
    []
  )

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={t('preview.title')}
    >
      <div
        className="w-full max-w-2xl rounded-xl bg-[var(--surface)] p-4 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-start justify-between gap-3">
          <div className="min-w-0 truncate text-[14px] font-medium" title={title}>
            {title}
          </div>
          <button className="icon-btn shrink-0" title={t('preview.close')} onClick={onClose}>
            <IconClose size={15} />
          </button>
        </div>
        {kind === 'video' ? (
          <video
            ref={mediaRef as React.Ref<HTMLVideoElement>}
            src={src}
            controls
            autoPlay
            className="max-h-[70vh] w-full rounded-lg bg-black"
          />
        ) : (
          <audio
            ref={mediaRef as React.Ref<HTMLAudioElement>}
            src={src}
            controls
            autoPlay
            className="w-full"
          />
        )}
      </div>
    </div>
  )
}
