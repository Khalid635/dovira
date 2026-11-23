import { useEffect, useMemo, useState } from 'react'
import type { AddOptions, PlainFileInfo, VideoInfo } from '../../../main/types'
import { useStore, useT } from '../store'
import { formatBytes, formatEta } from '../util/format'
import { IconAlert, IconClose, IconFolder } from './icons'

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
    case 'bridge':
      return 'error.bridge'
    case 'already-downloaded':
      return 'error.alreadyDownloaded'
    case 'duplicate':
      return 'error.duplicate'
    case 'timeout':
      // error.infoTimeout exists since Phase 2 but was never mapped — a
      // timed-out info fetch used to fall through to error.unknown.
      return 'error.infoTimeout'
    default:
      return 'error.unknown'
  }
}

/** Phase 4: "HH:MM:SS", "MM:SS" or plain seconds → seconds, else null. */
function parseClipTime(s: string): number | null {
  const t = s.trim()
  if (!t) return null
  if (/^\d+$/.test(t)) return Number(t)
  const parts = t.split(':').map(Number)
  if (parts.some((n) => !Number.isFinite(n) || n < 0)) return null
  if (parts.length === 2) return parts[0] * 60 + parts[1]
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2]
  return null
}

/** Phase 4: one batch line after "Check links". */
interface BatchLine {
  url: string
  status: 'pending' | 'checking' | 'ready' | 'failed'
  title?: string
  kind?: 'video' | 'audio' | 'file'
  info?: VideoInfo
  plainFile?: PlainFileInfo
  error?: string
}

export default function AddDownloadDialog(): React.JSX.Element {
  const t = useT()
  const dialogOpen = useStore((s) => s.dialogOpen)
  const dialogUrl = useStore((s) => s.dialogUrl)
  const dialogLoading = useStore((s) => s.dialogLoading)
  const dialogInfo = useStore((s) => s.dialogInfo)
  const dialogPlainFile = useStore((s) => s.dialogPlainFile)
  const dialogError = useStore((s) => s.dialogError)
  const dialogErrorDetail = useStore((s) => s.dialogErrorDetail)
  const settings = useStore((s) => s.settings)
  const dialogPlaylist = useStore((s) => s.dialogPlaylist)
  const dialogTorrent = useStore((s) => s.dialogTorrent)
  const closeDialog = useStore((s) => s.closeDialog)
  const fetchInfo = useStore((s) => s.fetchInfo)
  const addWithOptions = useStore((s) => s.addWithOptions)
  const addPlaylist = useStore((s) => s.addPlaylist)
  const addThumbnailOnly = useStore((s) => s.addThumbnailOnly)
  const importBatchFile = useStore((s) => s.importBatchFile)
  const refresh = useStore((s) => s.refresh)
  const showToast = useStore((s) => s.showToast)

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
  const [submitDetail, setSubmitDetail] = useState<string | null>(null)
  // Phase 4: Single | Batch mode, clip, metadata, subtitle mode, thumbnail-only.
  const [mode, setMode] = useState<'single' | 'batch'>('single')
  const [clipEnabled, setClipEnabled] = useState(false)
  const [clipStart, setClipStart] = useState('')
  const [clipEnd, setClipEnd] = useState('')
  const [embedMetadata, setEmbedMetadata] = useState(false)
  const [subMode, setSubMode] = useState<'embed' | 'file' | 'both'>('embed')
  const [autoSubs, setAutoSubs] = useState(false)
  const [thumbnailOnly, setThumbnailOnly] = useState(false)
  // Phase 4: playlist selection (all selected by default).
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [prevPlaylistUrl, setPrevPlaylistUrl] = useState('')
  // Phase 4: batch mode.
  const [batchText, setBatchText] = useState('')
  const [batchLines, setBatchLines] = useState<BatchLine[]>([])
  const [batchChecking, setBatchChecking] = useState(false)
  // Phase 7 (v1.0): Smart features — organizer folder, smart name, duplicate panel.
  const [smartName, setSmartName] = useState<string | null>(null)
  const [useSmartName, setUseSmartName] = useState(true)
  const [duplicate, setDuplicate] = useState<{
    duplicate: boolean
    kind?: 'url' | 'remote' | 'file'
    existingId?: string
    existingName?: string
    existingSize?: number | null
    existingCompletedAt?: number | null
  } | null>(null)
  const [duplicateBypass, setDuplicateBypass] = useState(false)
  const [saveDirTouched, setSaveDirTouched] = useState(false)

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
    setSubmitDetail(null)
    if (settings) setBitrate(settings.defaultAudioBitrate)
    // Phase 4: fresh state for the new dialog.
    setMode('single')
    setClipEnabled(false)
    setClipStart('')
    setClipEnd('')
    setEmbedMetadata(settings?.embedMetadataDefault ?? false)
    setSubMode('embed')
    setAutoSubs(false)
    setThumbnailOnly(false)
    setSelectedIds(new Set())
    setBatchText('')
    setBatchLines([])
    setBatchChecking(false)
    // Phase 7: fresh Smart state for the new dialog.
    setSmartName(null)
    setUseSmartName(true)
    setDuplicate(null)
    setDuplicateBypass(false)
    setSaveDirTouched(false)
  }
  // Phase 4: a fresh playlist defaults to all entries selected.
  if (dialogPlaylist && prevPlaylistUrl !== dialogPlaylist.url) {
    setPrevPlaylistUrl(dialogPlaylist.url)
    setSelectedIds(new Set(dialogPlaylist.entries.map((e) => e.id)))
  }
  if (!dialogPlaylist && prevPlaylistUrl) {
    setPrevPlaylistUrl('')
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
    // No rows (playlist/batch mode, or an audio-only video): the Settings
    // default is the quality — the height is picked without a format list.
    if (rows.length === 0) return Number(settings?.defaultVideoQuality ?? '1080')
    const wanted = Number(settings?.defaultVideoQuality ?? '1080')
    const exact = rows.find((r) => r.height === wanted)
    const fallback = rows.filter((r) => r.height <= 1080).sort((a, b) => b.height - a.height)[0]
    return (exact ?? fallback ?? rows[0]).height
  }, [rows, settings?.defaultVideoQuality])
  const height = heightOverride ?? defaultHeight

  // Phase 4: clip validation (end > start, inside the video when known).
  const duration = dialogInfo?.duration ?? null
  const clipStartSec = clipEnabled ? parseClipTime(clipStart) : null
  const clipEndSec = clipEnabled && clipEnd.trim() ? parseClipTime(clipEnd) : null
  const clipValid =
    !clipEnabled ||
    (clipStartSec !== null &&
      clipStartSec >= 0 &&
      (clipEndSec === null || clipEndSec > clipStartSec) &&
      (duration === null || clipStartSec < duration) &&
      (clipEndSec === null || duration === null || clipEndSec <= duration))
  const clipDurationSec =
    clipEnabled && clipValid && clipStartSec !== null
      ? clipEndSec !== null
        ? clipEndSec - clipStartSec
        : duration !== null
          ? duration - clipStartSec
          : null
      : null
  // Phase 4: what subtitles actually exist for the chosen language.
  const hasSubs = dialogInfo ? dialogInfo.subtitleLangs.includes(subLang) : false
  const hasAuto = dialogInfo ? dialogInfo.autoCaptionLangs.includes(subLang) : false
  const subsAvailable = hasSubs || hasAuto
  // A subtitles request for a language with no subs would fail the whole
  // download in yt-dlp — drop it instead, with the hint below.
  const effectiveSubtitles = subtitles && subsAvailable
  const readyCount = batchLines.filter((l) => l.status === 'ready').length
  // Issue #6: the exact conditions of the footer Download button — the
  // Ctrl+Enter shortcut only fires when the button would be enabled.
  const submitDisabled =
    busy ||
    (mode === 'batch'
      ? readyCount === 0 || batchChecking
      : dialogPlaylist
        ? selectedIds.size === 0
        : clipEnabled && dialogInfo !== null && !thumbnailOnly && !clipValid)

  // Phase 7: organizer + smart name — runs once per fetched info/tab/quality.
  // (Hooks must live above the early return below.)
  useEffect(() => {
    if (!dialogOpen) return
    if (!dialogInfo && !dialogPlainFile) return
    // No "already ran" guard needed: the effect only re-runs when its
    // deps change, categorize is skipped once the user picks a folder
    // (saveDirTouched), and the naming call is idempotent.
    if (typeof window.dovira === 'undefined') return
    const s = settings
    if (!s) return
    const kind = dialogInfo ? (tab === 'audio' ? 'audio' : 'video') : 'file'
    const fname = dialogInfo
      ? tab === 'audio'
        ? `${sanitizeName(dialogInfo.title)}.mp3`
        : `${sanitizeName(dialogInfo.title)}.${s.videoContainer ?? 'mp4'}`
      : (dialogPlainFile?.filename ?? 'download')
    if (s.smartOrganizer && !saveDirTouched) {
      void window.dovira
        .smartCategorize({
          filename: fname,
          kind,
          site: dialogInfo?.site ?? null,
          duration: dialogInfo?.duration ?? null,
          ytCategory: dialogInfo?.ytCategory ?? null
        })
        .then((cat) => {
          setSaveDir(cat.folder)
        })
        .catch(() => {
          // Keep the default folder — the organizer is a convenience.
        })
    }
    if (s.smartNaming && dialogInfo) {
      void window.dovira
        .smartSuggestName({
          filename: fname,
          title: dialogInfo.title,
          height: tab === 'video' ? height : null,
          uploader: dialogInfo.uploader
        })
        .then((r) => {
          setSmartName(r.name !== fname ? r.name : null)
        })
        .catch(() => {
          // Keep the plain name.
        })
    }
  }, [dialogOpen, dialogInfo, dialogPlainFile, tab, settings, height, saveDirTouched])

  if (!dialogOpen) return <></>

  const container = settings?.videoContainer ?? 'mp4'
  const baseFilename =
    dialogInfo && tab === 'video'
      ? `${sanitizeName(dialogInfo.title)}.${container}`
      : dialogInfo && tab === 'audio'
        ? `${sanitizeName(dialogInfo.title)}.mp3`
        : dialogPlainFile
          ? dialogPlainFile.filename
          : 'download'
  // Phase 7: the smart name (previewed below) replaces the plain name
  // unless the user unchecked it.
  const filename = smartName && useSmartName && dialogInfo ? smartName : baseFilename
  // Playlist/batch show the folder (each entry gets its own filename).
  const savePath =
    dialogPlaylist || mode === 'batch'
      ? saveDir || settings?.downloadDir || ''
      : saveDir
        ? `${saveDir}\\${filename}`
        : filename

  // Phase 7: duplicate pre-check (DB + destination folder). Issue #2: the
  // plain-file path uses the same check — a re-added .zip shows the panel
  // instead of only the duplicate error text.
  const checkDup = async (): Promise<{
    duplicate: boolean
    kind?: 'url' | 'remote' | 'file'
    existingId?: string
    existingName?: string
    existingSize?: number | null
    existingCompletedAt?: number | null
  } | null> => {
    if (typeof window.dovira === 'undefined') return null
    try {
      if (dialogInfo) {
        return await window.dovira.smartCheckDuplicate({
          url: dialogInfo.url,
          filename,
          saveDir: saveDir || settings?.downloadDir || '',
          totalBytes: rows.find((r) => r.height === height)?.size ?? null,
          remoteId:
            dialogInfo.videoId && dialogInfo.extractor
              ? `${dialogInfo.extractor}:${dialogInfo.videoId}`
              : null,
          formatId: tab === 'video' ? `${height}p` : `mp3-${bitrate}`
        })
      }
      if (dialogPlainFile) {
        return await window.dovira.smartCheckDuplicate({
          url: dialogUrl || url,
          filename: dialogPlainFile.filename,
          saveDir: saveDir || settings?.downloadDir || '',
          totalBytes: dialogPlainFile.size ?? null,
          remoteId: null,
          formatId: null
        })
      }
      return null
    } catch {
      return null
    }
  }

  // Phase 7: the duplicate panel's three answers. Re-download and Keep
  // both both proceed — the queue's unique-path resolver adds the (1)
  // suffix when the file already exists on disk.
  const resolveDuplicate = (choice: 'redownload' | 'skip' | 'keep-both'): void => {
    if (choice === 'skip') {
      closeDialog()
      return
    }
    setDuplicate(null)
    setDuplicateBypass(true)
    void submit(true)
  }

  // Issue #4: jump to the existing file's folder — by DB id when the
  // duplicate came from the history, by path when it is only on disk.
  const openDuplicateFolder = async (): Promise<void> => {
    if (!duplicate || typeof window.dovira === 'undefined') return
    try {
      if (duplicate.existingId) {
        await window.dovira.showInFolder(duplicate.existingId)
        return
      }
      if (duplicate.existingName) {
        const dir = saveDir || settings?.downloadDir || ''
        if (dir) await window.dovira.showPathInFolder(`${dir}\\${duplicate.existingName}`)
      }
    } catch {
      // Best-effort — the panel stays open.
    }
  }

  const submit = async (bypassDup = duplicateBypass): Promise<void> => {
    if (busy) return
    // Phase 4: batch mode — the footer button is "Download all (n)".
    if (mode === 'batch') {
      await submitBatch()
      return
    }
    // Phase 4: torrent — plain addDownload; the queue routes it to aria2.
    if (dialogTorrent) {
      setBusy(true)
      const res = await window.dovira.addDownload(dialogUrl || url)
      setBusy(false)
      if (res.ok) {
        closeDialog()
      } else {
        setSubmitError(res.error ?? 'unknown')
      }
      return
    }
    // Phase 4: playlist — the selected entries, one quality for all.
    if (dialogPlaylist) {
      await submitPlaylist()
      return
    }
    // Phase 4: thumbnail-only — just the .jpg, no media.
    if (dialogInfo && thumbnailOnly) {
      setBusy(true)
      const res = await addThumbnailOnly(dialogInfo.url, saveDir ? saveDir : undefined)
      setBusy(false)
      if (!res.ok) setSubmitError(res.error ?? 'unknown')
      return
    }
    if (!dialogInfo && !dialogPlainFile) {
      if (url.trim()) void fetchInfo(url)
      return
    }
    if (dialogPlainFile) {
      // Issue #2: plain files get the same duplicate pre-check + panel as
      // videos (Re-download / Skip / Keep both).
      if (settings?.smartDuplicates && !bypassDup) {
        setBusy(true)
        const dup = await checkDup()
        setBusy(false)
        if (dup?.duplicate) {
          setDuplicate(dup)
          return
        }
      }
      setBusy(true)
      const res = await window.dovira.addDownload(dialogUrl || url, saveDir ? saveDir : undefined, {
        skipDuplicateCheck: bypassDup
      })
      setBusy(false)
      if (res.ok) {
        closeDialog()
      } else if (res.error === 'duplicate') {
        // Safety-net race: the file appeared after the pre-check.
        const dup = await checkDup()
        if (dup?.duplicate) setDuplicate(dup)
        else setSubmitError(res.error ?? 'unknown')
      } else {
        setSubmitError(res.error ?? 'unknown')
      }
      return
    }
    if (!dialogInfo) return
    if (clipEnabled && !clipValid) return
    const opts: AddOptions =
      tab === 'video'
        ? {
            url: dialogInfo.url,
            kind: 'video',
            formatId: `${height}p`,
            formatString: `bv*[height<=${height}]+ba/b[height<=${height}]`,
            qualityLabel: `${height}p`,
            subtitles: effectiveSubtitles,
            subLang,
            embedThumbnail,
            embedMetadata,
            clipStart: clipEnabled ? clipStart.trim() : null,
            clipEnd: clipEnabled && clipEnd.trim() ? clipEnd.trim() : null,
            subMode,
            autoSubs,
            thumbnailOnly: false,
            useArchive: false,
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
            embedThumbnail,
            embedMetadata,
            clipStart: null,
            clipEnd: null,
            subMode: 'embed',
            autoSubs: false,
            thumbnailOnly: false,
            useArchive: false,
            savePath,
            filename,
            title: dialogInfo.title,
            thumbnailUrl: dialogInfo.thumbnail
          }
    // Phase 7: duplicate pre-check — the panel offers Re-download /
    // Skip / Keep both. Bypassed after the user already chose.
    if (settings?.smartDuplicates && !bypassDup) {
      setBusy(true)
      const dup = await checkDup()
      setBusy(false)
      if (dup?.duplicate) {
        setDuplicate(dup)
        return
      }
    }
    setBusy(true)
    const res = await addWithOptions({
      ...opts,
      videoId: dialogInfo.videoId,
      extractor: dialogInfo.extractor,
      height: tab === 'video' ? height : null,
      uploader: dialogInfo.uploader,
      // The dialog already decided the filename (smart or plain).
      applySmartName: false,
      skipDuplicateCheck: bypassDup
    })
    setBusy(false)
    if (!res.ok) {
      // Safety-net race: the file appeared after the pre-check.
      if (res.error === 'duplicate') {
        const dup = await checkDup()
        if (dup?.duplicate) setDuplicate(dup)
      }
      setSubmitError(res.error ?? 'unknown')
      setSubmitDetail(res.errorDetail ?? null)
    }
  }

  // Phase 4: playlist submit — every selected entry with the chosen quality.
  const submitPlaylist = async (): Promise<void> => {
    if (!dialogPlaylist || busy) return
    const selected = dialogPlaylist.entries.filter((e) => selectedIds.has(e.id))
    if (selected.length === 0) return
    const items: AddOptions[] = selected.map((e) => {
      const name =
        tab === 'video' ? `${sanitizeName(e.title)}.${container}` : `${sanitizeName(e.title)}.mp3`
      return {
        url: e.url,
        kind: tab,
        formatId: tab === 'video' ? `${height}p` : `mp3-${bitrate}`,
        formatString:
          tab === 'video' ? `bv*[height<=${height}]+ba/b[height<=${height}]` : 'bestaudio',
        qualityLabel: tab === 'video' ? `${height}p` : `${bitrate} kbps`,
        subtitles: false,
        subLang,
        embedThumbnail: tab === 'video' ? embedThumbnail : false,
        embedMetadata,
        clipStart: null,
        clipEnd: null,
        subMode: 'embed',
        autoSubs: false,
        thumbnailOnly: false,
        // Playlist items skip videos already in the archive when the
        // setting is on; single re-downloads never do (plan §1).
        useArchive: settings?.playlistSkipDownloaded ?? false,
        savePath: saveDir ? `${saveDir}\\${name}` : name,
        filename: name,
        title: e.title,
        thumbnailUrl: e.thumbnail
      }
    })
    setBusy(true)
    await addPlaylist(items)
    setBusy(false)
  }

  // Phase 4: batch "Check links" — fetchInfo for up to 5 lines in parallel.
  // A line that resolves to a playlist expands into its entries (capped at
  // 200 lines total).
  const checkBatch = async (): Promise<void> => {
    const urls = [
      ...new Set(
        batchText
          .split(/\r?\n/)
          .map((l) => l.trim())
          .filter(Boolean)
      )
    ]
    if (urls.length === 0 || batchChecking) return
    setBatchChecking(true)
    setBatchLines(urls.map((url) => ({ url, status: 'checking' })))
    const results: BatchLine[] = []
    for (let i = 0; i < urls.length; i += 5) {
      const chunk = urls.slice(i, i + 5)
      const settled = await Promise.all(
        chunk.map(async (u): Promise<BatchLine[]> => {
          try {
            const res = await window.dovira.fetchInfo(u)
            if (res.ok && res.playlist) {
              return res.playlist.entries.map((e) => ({
                url: e.url,
                status: 'ready' as const,
                title: e.title,
                kind: 'video' as const
              }))
            }
            if (res.ok && res.info) {
              const hasVideo = res.info.formats.some((f) => f.height !== null)
              return [
                {
                  url: u,
                  status: 'ready' as const,
                  title: res.info.title,
                  kind: hasVideo ? ('video' as const) : ('audio' as const),
                  info: res.info
                }
              ]
            }
            if (res.ok && res.plainFile) {
              return [
                {
                  url: u,
                  status: 'ready' as const,
                  title: res.plainFile.filename,
                  kind: 'file' as const,
                  plainFile: res.plainFile
                }
              ]
            }
            if (res.ok && res.torrent) {
              return [
                {
                  url: u,
                  status: 'ready' as const,
                  title: res.torrent.name,
                  kind: 'file' as const
                }
              ]
            }
            return [{ url: u, status: 'failed' as const, error: res.error ?? 'unknown' }]
          } catch {
            return [{ url: u, status: 'failed' as const, error: 'unknown' }]
          }
        })
      )
      results.push(...settled.flat())
      setBatchLines([
        ...results.slice(0, 200),
        ...urls.slice(i + 5).map((url) => ({ url, status: 'checking' as const }))
      ])
    }
    setBatchLines(results.slice(0, 200))
    setBatchChecking(false)
  }

  // Phase 4: batch "Download all" — videos at the Settings default quality,
  // audio-only URLs as 320kbps MP3, plain files + torrents via addDownload.
  const submitBatch = async (): Promise<void> => {
    const ready = batchLines.filter((l) => l.status === 'ready')
    if (ready.length === 0 || busy) return
    setBusy(true)
    let added = 0
    for (const line of ready) {
      try {
        if (line.kind === 'file') {
          const res = await window.dovira.addDownload(line.url, saveDir ? saveDir : undefined)
          if (res.ok) added++
        } else {
          const isAudio = line.kind === 'audio'
          const name = `${sanitizeName(line.title ?? 'download')}.${isAudio ? 'mp3' : container}`
          const opts: AddOptions = {
            url: line.url,
            kind: isAudio ? 'audio' : 'video',
            formatId: isAudio ? 'mp3-320' : `${height}p`,
            formatString: isAudio ? 'bestaudio' : `bv*[height<=${height}]+ba/b[height<=${height}]`,
            qualityLabel: isAudio ? '320 kbps' : `${height}p`,
            subtitles: false,
            subLang: settings?.subtitleLang ?? 'en',
            embedThumbnail: false,
            embedMetadata: settings?.embedMetadataDefault ?? false,
            clipStart: null,
            clipEnd: null,
            subMode: 'embed',
            autoSubs: false,
            thumbnailOnly: false,
            useArchive: settings?.playlistSkipDownloaded ?? false,
            savePath: saveDir ? `${saveDir}\\${name}` : name,
            filename: name,
            title: line.title ?? null,
            thumbnailUrl: line.info?.thumbnail ?? null
          }
          const res = await window.dovira.addWithOptions(opts)
          if (res.ok) added++
        }
      } catch {
        // One bad line must not stop the rest of the batch.
      }
    }
    setBusy(false)
    closeDialog()
    await refresh()
    showToast('toast.batchAdded', { n: added })
  }

  const importBatch = async (): Promise<void> => {
    const urls = await importBatchFile()
    if (urls) setBatchText(urls.join('\n'))
  }

  const pickSaveDir = async (): Promise<void> => {
    const dir = await window.dovira.pickFolder()
    if (dir) {
      setSaveDir(dir)
      // Phase 7: a hand-picked folder wins — the organizer stops overriding it.
      setSaveDirTouched(true)
    }
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
          // Issue #6: Ctrl+Enter (Cmd+Enter on macOS) submits — but never
          // while the duplicate panel is open or a fetch is still running.
          if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
            e.preventDefault()
            if (!duplicate && !dialogLoading && !submitDisabled) void submit()
            return
          }
          if (e.key === 'Enter' && !dialogLoading && mode === 'single') void submit()
        }}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-[16px] font-semibold">{t('dialog.title')}</h2>
          <button
            className="icon-btn"
            onClick={closeDialog}
            aria-label="Close"
            title={t('dialog.cancel')}
          >
            <IconClose size={15} />
          </button>
        </div>

        <div className="seg-tabs mt-3" role="tablist">
          <button
            className={`seg-tab ${mode === 'single' ? 'seg-tab-active' : ''}`}
            onClick={() => setMode('single')}
          >
            {t('dialog.single')}
          </button>
          <button
            className={`seg-tab ${mode === 'batch' ? 'seg-tab-active' : ''}`}
            onClick={() => setMode('batch')}
          >
            {t('dialog.batch')}
          </button>
        </div>

        {mode === 'single' && (
          <div className="mt-3 flex gap-2">
            <input
              className="input flex-1"
              value={url}
              placeholder="https://..."
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => {
                // Issue #6: Ctrl+Enter is the submit shortcut (handled by
                // the dialog card) — it must not also re-fetch the info.
                if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey) void fetchInfo(url)
              }}
              autoFocus
            />
            <button className="btn" onClick={() => void pasteFromClipboard()}>
              {t('dialog.paste')}
            </button>
          </div>
        )}

        {mode === 'batch' && (
          <div className="mt-4 space-y-3">
            <div className="text-[13px] text-[var(--muted)]">{t('dialog.batchHint')}</div>
            <textarea
              className="input w-full"
              rows={6}
              value={batchText}
              placeholder={t('dialog.batchPlaceholder')}
              onChange={(e) => setBatchText(e.target.value)}
            />
            <div className="flex gap-2">
              <button className="btn btn-sm" onClick={() => void importBatch()}>
                {t('dialog.batchImport')}
              </button>
              <button
                className="btn btn-sm"
                disabled={batchChecking || !batchText.trim()}
                onClick={() => void checkBatch()}
              >
                {batchChecking ? t('app.loading') : t('dialog.batchCheck')}
              </button>
            </div>
            {batchLines.length > 0 && (
              <div className="max-h-[220px] space-y-1 overflow-y-auto pr-1">
                {batchLines.map((l, i) => (
                  <div
                    key={`${l.url}-${i}`}
                    className="flex items-center gap-2 rounded-lg border border-[var(--border)] px-3 py-1.5 text-[13px]"
                  >
                    <span className="min-w-0 flex-1 truncate" title={l.title ?? l.url}>
                      {l.title ?? l.url}
                    </span>
                    <span className="shrink-0 text-[var(--muted)]">
                      {l.status === 'checking'
                        ? '…'
                        : l.status === 'ready'
                          ? t('dialog.batchReady')
                          : l.status === 'failed'
                            ? t('dialog.batchFailed')
                            : ''}
                    </span>
                  </div>
                ))}
              </div>
            )}
            <div className="flex items-center gap-2 text-[13px]">
              <span className="inline-flex shrink-0 items-center gap-1.5 text-[var(--muted)]">
                <IconFolder size={14} />
                {t('dialog.saveTo')}:
              </span>
              <span className="min-w-0 flex-1 truncate" title={savePath}>
                {savePath}
              </span>
              <button className="btn btn-sm shrink-0" onClick={() => void pickSaveDir()}>
                {t('dialog.change')}
              </button>
            </div>
          </div>
        )}

        {dialogLoading && (
          <div className="mt-4 space-y-2">
            <div className="h-[90px] w-[160px] animate-pulse rounded-lg bg-[var(--surface-2)]" />
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
            <div className="flex items-start gap-2 text-[13px] text-[var(--danger)]">
              <IconAlert size={15} className="mt-0.5 shrink-0" />
              <span>{t(errorKey(dialogError))}</span>
            </div>
            <div className="mt-1 text-[11px] text-[var(--muted)]">
              {`code: ${dialogError}`}
              {dialogErrorDetail ? ` — ${dialogErrorDetail}` : ''}
            </div>
            {/* Issue #8: retry re-runs fetchInfo bypassing the cache (force). */}
            <button
              className="btn btn-sm mt-2"
              onClick={() => void fetchInfo(url || dialogUrl, true)}
            >
              {t('dialog.retry')}
            </button>
          </div>
        )}

        {dialogInfo && !dialogLoading && (
          <div className="mt-4">
            <div className="flex gap-3">
              {dialogInfo.thumbnail && (
                <div className="relative h-[90px] w-[160px] shrink-0">
                  <img
                    src={dialogInfo.thumbnail}
                    alt=""
                    className="thumb h-full w-full"
                    onError={(e) => {
                      ;(e.target as HTMLImageElement).style.display = 'none'
                    }}
                  />
                  {dialogInfo.duration !== null && (
                    <span className="absolute bottom-1.5 right-1.5 rounded bg-black/70 px-1.5 py-0.5 text-[11px] tabular-nums text-white">
                      {formatEta(dialogInfo.duration)}
                    </span>
                  )}
                </div>
              )}
              <div className="min-w-0">
                <div
                  className="line-clamp-2 text-[15px] font-semibold leading-snug"
                  title={dialogInfo.title}
                >
                  {dialogInfo.title}
                </div>
                <div className="mt-1 text-[12px] text-[var(--muted)]">
                  {dialogInfo.duration !== null ? `${formatEta(dialogInfo.duration)}  ·  ` : ''}
                  {dialogInfo.uploader ?? ''}
                  {dialogInfo.site ? `  ·  ${dialogInfo.site}` : ''}
                </div>
              </div>
            </div>

            {smartName && smartName !== baseFilename && (
              <div className="mt-3 flex items-center gap-2 text-[13px]">
                <span className="min-w-0 flex-1 truncate text-[var(--muted)]" title={smartName}>
                  {t('add.smartName')}: <span className="text-[var(--text)]">{smartName}</span>
                </span>
                <label className="flex shrink-0 cursor-pointer items-center gap-1.5">
                  <input
                    type="checkbox"
                    checked={useSmartName}
                    onChange={(e) => setUseSmartName(e.target.checked)}
                  />
                  {t('add.smartNameUse')}
                </label>
              </div>
            )}

            <div className="seg-tabs mt-4" role="tablist">
              <button
                className={`seg-tab ${tab === 'video' ? 'seg-tab-active' : ''}`}
                onClick={() => setTab('video')}
              >
                {t('dialog.video')}
              </button>
              <button
                className={`seg-tab ${tab === 'audio' ? 'seg-tab-active' : ''}`}
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
                    className={`quality-row flex cursor-pointer items-center gap-2 rounded-lg border border-[var(--border)] px-3 py-2 text-[13px] ${
                      height === r.height ? 'quality-row-selected' : ''
                    } ${thumbnailOnly ? 'opacity-45' : ''}`}
                  >
                    <input
                      type="radio"
                      name="quality"
                      checked={height === r.height}
                      disabled={thumbnailOnly}
                      onChange={() => setHeightOverride(r.height)}
                    />
                    <span className="font-medium">{r.height}p</span>
                    <span className="text-[var(--muted)]">MP4</span>
                    {r.height === defaultHeight && (
                      <span className="badge badge-downloading">{t('card.recommended')}</span>
                    )}
                    <span className="flex-1" />
                    <span className="tabular-nums text-[var(--muted)]">
                      {r.size ? `~${formatBytes(r.size)}` : t('dialog.unknownSize')}
                    </span>
                  </label>
                ))}
                <label className="mt-2 flex cursor-pointer items-center gap-2 text-[13px]">
                  <input
                    type="checkbox"
                    checked={clipEnabled}
                    disabled={thumbnailOnly}
                    onChange={(e) => setClipEnabled(e.target.checked)}
                  />
                  {t('dialog.clip')}
                  {clipEnabled && (
                    <>
                      <input
                        className="input w-24 py-1"
                        value={clipStart}
                        placeholder={t('dialog.clipStart')}
                        onChange={(e) => setClipStart(e.target.value)}
                      />
                      <span className="text-[var(--muted)]">–</span>
                      <input
                        className="input w-24 py-1"
                        value={clipEnd}
                        placeholder={t('dialog.clipEnd')}
                        onChange={(e) => setClipEnd(e.target.value)}
                      />
                    </>
                  )}
                </label>
                {clipEnabled && !clipValid && (
                  <div className="text-[12px] text-[var(--danger)]">{t('dialog.clipInvalid')}</div>
                )}
                {clipEnabled && clipValid && clipDurationSec !== null && (
                  <div className="text-[12px] text-[var(--muted)]">
                    {t('dialog.clipDuration', { duration: formatEta(clipDurationSec) })}
                  </div>
                )}
                <label className="mt-2 flex cursor-pointer items-center gap-2 text-[13px]">
                  <input
                    type="checkbox"
                    checked={embedMetadata}
                    onChange={(e) => setEmbedMetadata(e.target.checked)}
                  />
                  {t('dialog.embedMetadata')}
                </label>
                <label className="mt-2 flex cursor-pointer items-center gap-2 text-[13px]">
                  <input
                    type="checkbox"
                    checked={subtitles}
                    disabled={thumbnailOnly}
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
                {subtitles && !subsAvailable && (
                  <div className="text-[12px] text-[var(--muted)]">{t('dialog.noSubtitles')}</div>
                )}
                {subtitles && subsAvailable && (
                  <div className="flex flex-wrap items-center gap-2 text-[13px]">
                    <span className="text-[var(--muted)]">{t('dialog.subtitleMode')}</span>
                    <select
                      className="input w-40 py-1"
                      value={subMode}
                      onChange={(e) => setSubMode(e.target.value as 'embed' | 'file' | 'both')}
                    >
                      <option value="embed">{t('dialog.subtitleModeEmbed')}</option>
                      <option value="file">{t('dialog.subtitleModeFile')}</option>
                      <option value="both">{t('dialog.subtitleModeBoth')}</option>
                    </select>
                    {hasAuto && (
                      <label className="flex cursor-pointer items-center gap-1.5">
                        <input
                          type="checkbox"
                          checked={autoSubs}
                          onChange={(e) => setAutoSubs(e.target.checked)}
                        />
                        {t('dialog.autoSubs')}
                      </label>
                    )}
                  </div>
                )}
                <label className="flex cursor-pointer items-center gap-2 text-[13px]">
                  <input
                    type="checkbox"
                    checked={embedThumbnail}
                    onChange={(e) => setEmbedThumbnail(e.target.checked)}
                  />
                  {t('dialog.embedThumbnail')}
                </label>
                <label className="flex cursor-pointer items-center gap-2 text-[13px]">
                  <input
                    type="checkbox"
                    checked={thumbnailOnly}
                    onChange={(e) => setThumbnailOnly(e.target.checked)}
                  />
                  {t('dialog.thumbnailOnly')}
                </label>
                {thumbnailOnly && (
                  <div className="text-[12px] text-[var(--muted)]">
                    {t('dialog.thumbnailOnlyHint')}
                  </div>
                )}
              </div>
            )}

            {tab === 'audio' && (
              <div className="mt-3 space-y-1.5">
                {BITRATES.map((b) => (
                  <label
                    key={b}
                    className={`quality-row flex cursor-pointer items-center gap-2 rounded-lg border border-[var(--border)] px-3 py-2 text-[13px] ${
                      bitrate === b ? 'quality-row-selected' : ''
                    }`}
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
                <label className="mt-2 flex cursor-pointer items-center gap-2 text-[13px]">
                  <input
                    type="checkbox"
                    checked={embedMetadata}
                    onChange={(e) => setEmbedMetadata(e.target.checked)}
                  />
                  {t('dialog.embedMetadata')}
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

            <div className="mt-4 flex items-center gap-2 text-[13px]">
              <span className="inline-flex shrink-0 items-center gap-1.5 text-[var(--muted)]">
                <IconFolder size={14} />
                {t('dialog.saveTo')}:
              </span>
              <span className="min-w-0 flex-1 truncate" title={savePath}>
                {savePath}
              </span>
              <button className="btn btn-sm shrink-0" onClick={() => void pickSaveDir()}>
                {t('dialog.change')}
              </button>
            </div>
          </div>
        )}

        {dialogPlaylist && !dialogLoading && (
          <div className="mt-4">
            <div
              className="line-clamp-2 text-[15px] font-semibold leading-snug"
              title={dialogPlaylist.title}
            >
              {dialogPlaylist.title}
            </div>
            <div className="mt-1 text-[12px] text-[var(--muted)]">
              {dialogPlaylist.uploader ? `${dialogPlaylist.uploader}  ·  ` : ''}
              {t('dialog.playlistVideos', { n: dialogPlaylist.entries.length })}
            </div>
            <div className="mt-3 flex items-center gap-2 text-[13px]">
              <button
                className="btn btn-sm"
                onClick={() => setSelectedIds(new Set(dialogPlaylist.entries.map((e) => e.id)))}
              >
                {t('dialog.selectAll')}
              </button>
              <button className="btn btn-sm" onClick={() => setSelectedIds(new Set())}>
                {t('dialog.selectNone')}
              </button>
              <span className="text-[var(--muted)]">
                {t('dialog.selectedCount', {
                  n: selectedIds.size,
                  total: dialogPlaylist.entries.length
                })}
              </span>
            </div>
            <div className="mt-2 max-h-[220px] space-y-1 overflow-y-auto pr-1">
              {dialogPlaylist.entries.map((e) => (
                <label
                  key={e.id}
                  className="flex cursor-pointer items-center gap-2 rounded-lg border border-[var(--border)] px-3 py-1.5 text-[13px]"
                >
                  <input
                    type="checkbox"
                    checked={selectedIds.has(e.id)}
                    onChange={(ev) => {
                      const next = new Set(selectedIds)
                      if (ev.target.checked) next.add(e.id)
                      else next.delete(e.id)
                      setSelectedIds(next)
                    }}
                  />
                  <span className="min-w-0 flex-1 truncate" title={e.title}>
                    {e.title}
                  </span>
                  {e.duration !== null && (
                    <span className="shrink-0 tabular-nums text-[var(--muted)]">
                      {formatEta(e.duration)}
                    </span>
                  )}
                </label>
              ))}
            </div>

            <div className="seg-tabs mt-4" role="tablist">
              <button
                className={`seg-tab ${tab === 'video' ? 'seg-tab-active' : ''}`}
                onClick={() => setTab('video')}
              >
                {t('dialog.video')}
              </button>
              <button
                className={`seg-tab ${tab === 'audio' ? 'seg-tab-active' : ''}`}
                onClick={() => setTab('audio')}
              >
                {t('dialog.audio')}
              </button>
            </div>

            {tab === 'video' && (
              <div className="mt-3 space-y-1.5">
                {HEIGHTS.map((h) => (
                  <label
                    key={h}
                    className={`quality-row flex cursor-pointer items-center gap-2 rounded-lg border border-[var(--border)] px-3 py-2 text-[13px] ${
                      height === h ? 'quality-row-selected' : ''
                    }`}
                  >
                    <input
                      type="radio"
                      name="playlist-quality"
                      checked={height === h}
                      onChange={() => setHeightOverride(h)}
                    />
                    <span className="font-medium">{h}p</span>
                    <span className="text-[var(--muted)]">MP4</span>
                    {h === defaultHeight && (
                      <span className="badge badge-downloading">{t('card.recommended')}</span>
                    )}
                  </label>
                ))}
                <label className="mt-2 flex cursor-pointer items-center gap-2 text-[13px]">
                  <input
                    type="checkbox"
                    checked={embedMetadata}
                    onChange={(e) => setEmbedMetadata(e.target.checked)}
                  />
                  {t('dialog.embedMetadata')}
                </label>
              </div>
            )}

            {tab === 'audio' && (
              <div className="mt-3 space-y-1.5">
                {BITRATES.map((b) => (
                  <label
                    key={b}
                    className={`quality-row flex cursor-pointer items-center gap-2 rounded-lg border border-[var(--border)] px-3 py-2 text-[13px] ${
                      bitrate === b ? 'quality-row-selected' : ''
                    }`}
                  >
                    <input
                      type="radio"
                      name="playlist-bitrate"
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
              <span className="inline-flex shrink-0 items-center gap-1.5 text-[var(--muted)]">
                <IconFolder size={14} />
                {t('dialog.saveTo')}:
              </span>
              <span className="min-w-0 flex-1 truncate" title={savePath}>
                {savePath}
              </span>
              <button className="btn btn-sm shrink-0" onClick={() => void pickSaveDir()}>
                {t('dialog.change')}
              </button>
            </div>
          </div>
        )}

        {dialogTorrent && !dialogLoading && (
          <div className="mt-4 space-y-2 text-[13px]">
            <div className="truncate font-medium" title={dialogTorrent.name}>
              {dialogTorrent.name}
            </div>
            <div className="text-[var(--muted)]">{t('dialog.torrentNote')}</div>
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
              <span className="inline-flex shrink-0 items-center gap-1.5 text-[var(--muted)]">
                <IconFolder size={14} />
                {t('dialog.saveTo')}:
              </span>
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
        {submitDetail && <div className="mt-1 text-[11px] text-[var(--muted)]">{submitDetail}</div>}

        {duplicate && (
          <div className="mt-4 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] p-3">
            <div className="text-[13px] font-semibold">{t('add.duplicateTitle')}</div>
            <div className="mt-1 text-[13px] text-[var(--muted)]">
              {duplicate.existingName ?? ''}
              {duplicate.existingSize ? `  ·  ${formatBytes(duplicate.existingSize)}` : ''}
              {duplicate.existingCompletedAt
                ? `  ·  ${new Date(duplicate.existingCompletedAt).toLocaleDateString()}`
                : ''}
            </div>
            <div className="mt-1 text-[12px] text-[var(--muted)]">
              {duplicate.kind === 'url'
                ? t('add.duplicateUrl')
                : duplicate.kind === 'remote'
                  ? t('add.duplicateRemote')
                  : t('add.duplicateFile')}
            </div>
            <div className="mt-3 flex gap-2">
              <button
                className="btn btn-sm btn-primary"
                onClick={() => resolveDuplicate('redownload')}
              >
                {t('add.duplicateRedownload')}
              </button>
              <button className="btn btn-sm" onClick={() => resolveDuplicate('keep-both')}>
                {t('add.duplicateKeepBoth')}
              </button>
              <button className="btn btn-sm btn-ghost" onClick={() => resolveDuplicate('skip')}>
                {t('add.duplicateSkip')}
              </button>
              {(duplicate.existingId || duplicate.existingName) && (
                <button className="btn btn-sm btn-ghost" onClick={() => void openDuplicateFolder()}>
                  {t('add.duplicateOpenFolder')}
                </button>
              )}
            </div>
          </div>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <button className="btn" onClick={closeDialog}>
            {t('dialog.cancel')}
          </button>
          <button
            className="btn btn-primary"
            disabled={submitDisabled}
            onClick={() => void submit()}
          >
            {busy
              ? t('add.adding')
              : mode === 'batch'
                ? t('dialog.batchDownloadAll', { n: readyCount })
                : t('dialog.download')}
          </button>
        </div>
      </div>
    </div>
  )
}
