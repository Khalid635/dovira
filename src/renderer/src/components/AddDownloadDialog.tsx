import { useMemo, useState } from 'react'
import type { AddOptions } from '../../../main/types'
import { useStore, useT } from '../store'
import { formatBytes, formatEta } from '../util/format'

const HEIGHTS = [2160, 1080, 720, 480, 360]
const BITRATES = ['320', '192', '128']
const SUB_LANGS = ['en', 'bn', 'es', 'fr', 'de', 'hi', 'ja']

function sanitizeName(name: string): string {
  // Strip Windows-illegal filename chars + control chars (no regex with
  // control escapes — eslint no-control-regex).
  const cleaned = name
    .split('')
    .filter((c) => {
      const n = c.charCodeAt(0)
      return n >= 32 && !'<>:"/\\|?*'.includes(c)
    })
    .join('')
    .trim()
  return (cleaned || 'download').slice(0, 120)
}

function errorKey(code: string | null): string {
  switch (code) {
    case 'unavailable':
      return 'error.unavailable'
    case 'login-required':
      return 'error.loginRequired'
    case 'unsupported':
      return 'error.unsupported'
    case 'drm':
      return 'error.drm'
    case 'forbidden':
      return 'error.forbidden'
    case 'not-found':
      return 'error.not-found'
    case 'invalid-url':
      return 'error.invalid-url'
    case 'no-space':
      return 'error.no-space'
    case 'engine-missing':
      return 'error.engine-missing'
    case 'network':
      return 'error.network'
    default:
      return 'error.unknown'
  }
}

export default function AddDownloadDialog(): React.JSX.Element {
  const t = useT()
  const dialogOpen = useStore((s) => s.dialogOpen)
  const dialogUrl = useStore((s) => s.dialogUrl)
  const dialogLoading = useStore((s) => s.dialogLoading)
  const dialogInfo = useStore((s) => s.dialogInfo)
  const dialogPlainFile = useStore((s) => s.dialogPlainFile)
  const dialogError = useStore((s) => s.dialogError)
  const settings = useStore((s) => s.settings)
  const closeDialog = useStore((s) => s.closeDialog)
  const fetchInfo = useStore((s) => s.fetchInfo)
  const addWithOptions = useStore((s) => s.addWithOptions)

  const [url, setUrl] = useState(dialogUrl)
  const [tab, setTab] = useState<'video' | 'audio'>('video')
  const [heightOverride, setHeightOverride] = useState<number | null>(null)
  const [bitrate, setBitrate] = useState('320')
  const [subtitles, setSubtitles] = useState(false)
  const [subLang, setSubLang] = useState('en')
  const [embedThumbnail, setEmbedThumbnail] = useState(false)
  const [saveDir, setSaveDir] = useState('')
  const [busy, setBusy] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  // Reset local state when a (new) dialog opens — the React-endorsed
  // "adjust state during render" pattern, not a setState-in-effect.
  const [prevDialog, setPrevDialog] = useState({ open: false, url: '' })
  if (dialogOpen && (prevDialog.url !== dialogUrl || !prevDialog.open)) {
    setPrevDialog({ open: true, url: dialogUrl })
    setUrl(dialogUrl)
    setTab('video')
    setHeightOverride(null)
    setSubtitles(false)
    setSubLang(settings?.subtitleLang ?? 'en')
    setEmbedThumbnail(false)
    setSaveDir(settings?.downloadDir ?? '')
    setBusy(false)
    setSubmitError(null)
    if (settings) setBitrate(settings.defaultAudioBitrate)
  }
  if (!dialogOpen && prevDialog.open) {
    setPrevDialog({ open: false, url: '' })
  }

  // Default quality: Settings value when the video has it, else the
  // highest available row at or below 1080p.
  const rows = useMemo(() => {
    if (!dialogInfo) return []
    const videoFormats = dialogInfo.formats.filter((f) => f.height !== null)
    const audioOnly = dialogInfo.formats.filter((f) => f.height === null && !f.combined)
    const bestAudioSize =
      audioOnly.length > 0 ? Math.max(...audioOnly.map((f) => f.filesize ?? 0)) : null
    return HEIGHTS.filter((h) => videoFormats.some((f) => (f.height ?? 0) >= h)).map((h) => {
      const atHeight = videoFormats.filter((f) => f.height === h)
      const combined = atHeight.find((f) => f.combined)
      const videoOnly = atHeight
        .filter((f) => !f.combined)
        .sort((a, b) => (b.filesize ?? 0) - (a.filesize ?? 0))[0]
      let size: number | null = null
      if (combined?.filesize) size = combined.filesize
      else if (videoOnly?.filesize && bestAudioSize) size = videoOnly.filesize + bestAudioSize
      else if (videoOnly?.filesize && bestAudioSize === null) size = videoOnly.filesize
      return { height: h, size }
    })
  }, [dialogInfo])

  // Default quality: Settings value when the video has it, else the
  // highest available row at or below 1080p. Derived, not synced state —
  // the user picking a row overrides it for this dialog only.
  const defaultHeight = useMemo(() => {
    if (rows.length === 0) return 1080
    const wanted = Number(settings?.defaultVideoQuality ?? '1080')
    const exact = rows.find((r) => r.height === wanted)
    const fallback = rows.filter((r) => r.height <= 1080).sort((a, b) => b.height - a.height)[0]
    return (exact ?? fallback ?? rows[0]).height
  }, [rows, settings?.defaultVideoQuality])
  const height = heightOverride ?? defaultHeight

  if (!dialogOpen) return <></>

  const container = settings?.videoContainer ?? 'mp4'
  const filename =
    dialogInfo && tab === 'video'
      ? `${sanitizeName(dialogInfo.title)}.${container}`
      : dialogInfo && tab === 'audio'
        ? `${sanitizeName(dialogInfo.title)}.mp3`
        : dialogPlainFile
          ? dialogPlainFile.filename
          : 'download'
  const savePath = saveDir ? `${saveDir}\\${filename}` : filename

  const submit = async (): Promise<void> => {
    if (busy) return
    if (!dialogInfo && !dialogPlainFile) {
      if (url.trim()) void fetchInfo(url)
      return
    }
    if (dialogPlainFile) {
      setBusy(true)
      const res = await window.dovira.addDownload(dialogUrl || url, saveDir ? saveDir : undefined)
      setBusy(false)
      if (res.ok) {
        closeDialog()
      } else {
        setSubmitError(res.error ?? 'unknown')
      }
      return
    }
    if (!dialogInfo) return
    const opts: AddOptions =
      tab === 'video'
        ? {
            url: dialogInfo.url,
            kind: 'video',
            formatId: `${height}p`,
            formatString: `bv*[height<=${height}]+ba/b[height<=${height}]`,
            qualityLabel: `${height}p`,
            subtitles,
            subLang,
            embedThumbnail,
            savePath,
            filename,
            title: dialogInfo.title,
            thumbnailUrl: dialogInfo.thumbnail
          }
        : {
            url: dialogInfo.url,
            kind: 'audio',
            formatId: `mp3-${bitrate}`,
            formatString: 'bestaudio',
            qualityLabel: `${bitrate} kbps`,
            subtitles: false,
            subLang,
            embedThumbnail: false,
            savePath,
            filename,
            title: dialogInfo.title,
            thumbnailUrl: dialogInfo.thumbnail
          }
    setBusy(true)
    const res = await addWithOptions(opts)
    setBusy(false)
    if (!res.ok) setSubmitError(res.error ?? 'unknown')
  }

  const pickSaveDir = async (): Promise<void> => {
    const dir = await window.dovira.pickFolder()
    if (dir) setSaveDir(dir)
  }

  const pasteFromClipboard = async (): Promise<void> => {
    try {
      const text = await navigator.clipboard.readText()
      if (text.trim()) {
        setUrl(text.trim())
        void fetchInfo(text.trim())
      }
    } catch {
      // Clipboard read needs focus — the user can paste manually instead.
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 p-4 pt-[10vh]"
      onClick={closeDialog}
    >
      <div
        className="card w-full max-w-[560px] p-5"
        role="dialog"
        aria-label={t('dialog.title')}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Escape') closeDialog()
          if (e.key === 'Enter' && !dialogLoading) void submit()
        }}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-[16px] font-semibold">{t('dialog.title')}</h2>
          <button className="btn btn-ghost btn-sm" onClick={closeDialog} aria-label="Close">
            ✕
          </button>
        </div>

        <div className="mt-3 flex gap-2">
          <input
            className="input flex-1"
            value={url}
            placeholder="https://..."
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void fetchInfo(url)
            }}
            autoFocus
          />
          <button className="btn" onClick={() => void pasteFromClipboard()}>
            {t('dialog.paste')}
          </button>
        </div>

        {dialogLoading && (
          <div className="mt-4 space-y-2">
            <div className="h-4 w-3/4 animate-pulse rounded bg-[var(--surface-2)]" />
            <div className="h-4 w-1/2 animate-pulse rounded bg-[var(--surface-2)]" />
            <div className="mt-2 text-[13px] text-[var(--muted)]">{t('dialog.loading')}</div>
            <button className="btn btn-ghost btn-sm" onClick={closeDialog}>
              {t('dialog.cancel')}
            </button>
          </div>
        )}

        {dialogError && !dialogLoading && (
          <div className="mt-4">
            <div className="text-[13px] text-[var(--danger)]">{t(errorKey(dialogError))}</div>
            <button className="btn btn-sm mt-2" onClick={() => void fetchInfo(url || dialogUrl)}>
              {t('dialog.retry')}
            </button>
          </div>
        )}

        {dialogInfo && !dialogLoading && (
          <div className="mt-4">
            <div className="flex gap-3">
              {dialogInfo.thumbnail && (
                <img
                  src={dialogInfo.thumbnail}
                  alt=""
                  className="h-[68px] w-[120px] shrink-0 rounded-lg object-cover"
                  onError={(e) => {
                    ;(e.target as HTMLImageElement).style.display = 'none'
                  }}
                />
              )}
              <div className="min-w-0">
                <div className="truncate text-[14px] font-medium" title={dialogInfo.title}>
                  {dialogInfo.title}
                </div>
                <div className="mt-0.5 text-[12px] text-[var(--muted)]">
                  {dialogInfo.duration !== null ? `${formatEta(dialogInfo.duration)}  ·  ` : ''}
                  {dialogInfo.uploader ?? ''}
                  {dialogInfo.site ? `  ·  ${dialogInfo.site}` : ''}
                </div>
              </div>
            </div>

            <div className="mt-4 flex gap-2" role="tablist">
              <button
                className={`btn btn-sm ${tab === 'video' ? 'btn-primary' : ''}`}
                onClick={() => setTab('video')}
              >
                {t('dialog.video')}
              </button>
              <button
                className={`btn btn-sm ${tab === 'audio' ? 'btn-primary' : ''}`}
                onClick={() => setTab('audio')}
              >
                {t('dialog.audio')}
              </button>
            </div>

            {tab === 'video' && (
              <div className="mt-3 space-y-1.5">
                {rows.length === 0 && (
                  <div className="text-[13px] text-[var(--muted)]">{t('dialog.unknownSize')}</div>
                )}
                {rows.map((r) => (
                  <label
                    key={r.height}
                    className="flex cursor-pointer items-center gap-2 rounded-lg border border-[var(--border)] px-3 py-2 text-[13px]"
                  >
                    <input
                      type="radio"
                      name="quality"
                      checked={height === r.height}
                      onChange={() => setHeightOverride(r.height)}
                    />
                    <span className="font-medium">{r.height}p</span>
                    <span className="text-[var(--muted)]">MP4</span>
                    <span className="flex-1" />
                    <span className="tabular-nums text-[var(--muted)]">
                      {r.size ? `~${formatBytes(r.size)}` : t('dialog.unknownSize')}
                    </span>
                  </label>
                ))}
                <label className="mt-2 flex cursor-pointer items-center gap-2 text-[13px]">
                  <input
                    type="checkbox"
                    checked={subtitles}
                    onChange={(e) => setSubtitles(e.target.checked)}
                  />
                  {t('dialog.subtitles')}
                  {subtitles && (
                    <select
                      className="input w-24 py-1"
                      value={subLang}
                      onChange={(e) => setSubLang(e.target.value)}
                    >
                      {SUB_LANGS.map((l) => (
                        <option key={l} value={l}>
                          {l}
                        </option>
                      ))}
                    </select>
                  )}
                </label>
                <label className="flex cursor-pointer items-center gap-2 text-[13px]">
                  <input
                    type="checkbox"
                    checked={embedThumbnail}
                    onChange={(e) => setEmbedThumbnail(e.target.checked)}
                  />
                  {t('dialog.embedThumbnail')}
                </label>
              </div>
            )}

            {tab === 'audio' && (
              <div className="mt-3 space-y-1.5">
                {BITRATES.map((b) => (
                  <label
                    key={b}
                    className="flex cursor-pointer items-center gap-2 rounded-lg border border-[var(--border)] px-3 py-2 text-[13px]"
                  >
                    <input
                      type="radio"
                      name="bitrate"
                      checked={bitrate === b}
                      onChange={() => setBitrate(b)}
                    />
                    <span className="font-medium">{b} kbps</span>
                    <span className="text-[var(--muted)]">MP3</span>
                  </label>
                ))}
              </div>
            )}

            <div className="mt-4 flex items-center gap-2 text-[13px]">
              <span className="shrink-0 text-[var(--muted)]">{t('dialog.saveTo')}:</span>
              <span className="min-w-0 flex-1 truncate" title={savePath}>
                {savePath}
              </span>
              <button className="btn btn-sm shrink-0" onClick={() => void pickSaveDir()}>
                {t('dialog.change')}
              </button>
            </div>
          </div>
        )}

        {dialogPlainFile && !dialogLoading && (
          <div className="mt-4 space-y-1 text-[13px]">
            <div className="truncate font-medium" title={dialogPlainFile.filename}>
              {dialogPlainFile.filename}
            </div>
            <div className="text-[var(--muted)]">
              {dialogPlainFile.size ? formatBytes(dialogPlainFile.size) : t('dialog.unknownSize')}
              {dialogPlainFile.contentType ? `  ·  ${dialogPlainFile.contentType}` : ''}
            </div>
            <div className="flex items-center gap-2 pt-1">
              <span className="shrink-0 text-[var(--muted)]">{t('dialog.saveTo')}:</span>
              <span className="min-w-0 flex-1 truncate" title={savePath}>
                {savePath}
              </span>
              <button className="btn btn-sm shrink-0" onClick={() => void pickSaveDir()}>
                {t('dialog.change')}
              </button>
            </div>
          </div>
        )}

        {submitError && (
          <div className="mt-3 text-[13px] text-[var(--danger)]">{t(errorKey(submitError))}</div>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <button className="btn" onClick={closeDialog}>
            {t('dialog.cancel')}
          </button>
          <button className="btn btn-primary" disabled={busy} onClick={() => void submit()}>
            {busy ? t('add.adding') : t('dialog.download')}
          </button>
        </div>
      </div>
    </div>
  )
}
