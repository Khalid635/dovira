/**
 * IDM-style floating download button (next-level).
 *
 * Hover any <video> on the page and a small "Download" button appears
 * floating over its top-right corner, exactly like IDM. Clicking it
 * sends that video to the DOVIRA app via the background service worker
 * — the content script never calls the Local API directly, because its
 * Origin would be the page's origin and the API rejects web-page
 * origins.
 *
 * Blob URLs (YouTube etc.) cannot be downloaded directly, so the PAGE
 * URL is sent instead — yt-dlp resolves the video from it. A real
 * http(s) media URL (direct <video src> or <source>) is sent as-is.
 * Tiny videos/ads are ignored (under ~200x120, or under ~3s when the
 * duration is known; live streams are never skipped).
 *
 * The button never touches page layout: one shared fixed-position
 * element that tracks the hovered video (recomputed on scroll/resize/
 * fullscreen), no wrapper, no DOM changes to the page itself. In
 * fullscreen it moves inside the fullscreen element so it stays
 * visible. It hides 250ms after the mouse leaves, so video controls
 * are never blocked for long. Videos inside iframes are NOT covered —
 * the content script runs in the top frame only.
 *
 * Not paired yet? Clicking shows "Pair DOVIRA" — the next click opens
 * the extension Options page. The app owns the on/off switch
 * (Settings > Setup & diagnostics, ON by default); a missing storage
 * key means "never synced yet" and is treated as ON.
 *
 * MV3 content scripts cannot import ES modules, so the pure helpers
 * (pickVideoDownloadUrl / isDownloadableVideo) are duplicated here
 * from lib.ts — lib.ts is the source of truth, keep them in sync.
 * chrome.* types come from ./chrome.d.ts (included via tsconfig).
 */

const BUTTON_ID = 'dovira-float-btn'
const MIN_VIDEO_WIDTH = 200
const MIN_VIDEO_HEIGHT = 120
const MIN_VIDEO_DURATION_SECONDS = 3
const HIDE_DELAY_MS = 250
const FEEDBACK_MS = 2500

const MEDIA_EXTENSIONS = new Set([
  'mp4',
  'm4v',
  'webm',
  'mov',
  'mkv',
  'avi',
  'mp3',
  'm4a',
  'ogg',
  'ogv',
  'wav',
  'flac'
])

function isRealMediaUrl(url: string): boolean {
  try {
    const u = new URL(url)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false
    const ext = u.pathname.split('.').pop()?.toLowerCase() ?? ''
    return MEDIA_EXTENSIONS.has(ext)
  } catch {
    return false
  }
}

function pickVideoDownloadUrl(srcs: (string | null | undefined)[], pageUrl: string): string {
  for (const src of srcs) {
    if (src && isRealMediaUrl(src)) return src
  }
  return pageUrl
}

function isDownloadableVideo(video: HTMLVideoElement): boolean {
  const rect = video.getBoundingClientRect()
  if (rect.width < MIN_VIDEO_WIDTH || rect.height < MIN_VIDEO_HEIGHT) return false
  if (Number.isFinite(video.duration) && video.duration < MIN_VIDEO_DURATION_SECONDS) return false
  return true
}

// One shared button for the whole page — created lazily, reused for
// every video, so hover never allocates DOM.
let button: HTMLButtonElement | null = null
let label: HTMLSpanElement | null = null
let currentVideo: HTMLVideoElement | null = null
let hideTimer: ReturnType<typeof setTimeout> | undefined
let feedbackTimer: ReturnType<typeof setTimeout> | undefined
let needsPair = false

function createButton(): HTMLButtonElement {
  const btn = document.createElement('button')
  btn.id = BUTTON_ID
  btn.type = 'button'
  btn.setAttribute('aria-label', 'Download this video with DOVIRA')
  btn.style.cssText =
    'position:fixed;z-index:2147483647;display:none;align-items:center;gap:6px;' +
    'cursor:pointer;border:0;border-radius:999px;background:#0f1115;color:#e7e9ee;' +
    'font-size:13px;font-weight:600;font-family:system-ui,sans-serif;' +
    'padding:7px 12px;box-shadow:0 4px 16px rgba(0,0,0,0.45);'
  btn.innerHTML =
    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#5b8cff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12"/><path d="m6 11 6 6 6-6"/><path d="M4 21h16"/></svg>'
  const span = document.createElement('span')
  span.textContent = 'Download'
  btn.appendChild(span)
  label = span

  btn.addEventListener('mouseenter', () => {
    if (hideTimer !== undefined) {
      clearTimeout(hideTimer)
      hideTimer = undefined
    }
  })
  btn.addEventListener('mouseleave', scheduleHide)
  btn.addEventListener('click', onButtonClick)
  return btn
}

function setButtonState(text: string, disabled: boolean): void {
  if (label) label.textContent = text
  if (button) button.disabled = disabled
}

function showDefault(): void {
  needsPair = false
  setButtonState('Download', false)
}

function onButtonClick(): void {
  if (!currentVideo) return
  // Second click while unpaired opens the Options page to pair.
  if (needsPair) {
    showDefault()
    void chrome.runtime.openOptionsPage()
    return
  }
  const video = currentVideo
  const srcs: (string | null | undefined)[] = [video.currentSrc, video.src]
  for (const source of video.querySelectorAll('source')) {
    srcs.push(source.src)
  }
  const url = pickVideoDownloadUrl(srcs, location.href)
  setButtonState('Sending…', true)
  void chrome.runtime
    .sendMessage({ type: 'dovira-download', url, referer: location.href })
    .then((response) => {
      const r = response as { ok?: boolean; error?: string } | undefined
      if (r?.ok) {
        setButtonState('Sent to DOVIRA', true)
      } else if (r?.error === 'unauthorized') {
        needsPair = true
        setButtonState('Pair DOVIRA', false)
        return // stays until clicked (opens Options) or the mouse moves on
      } else if (r?.error === 'app-not-running') {
        setButtonState('App not running', true)
      } else if (r?.error === 'duplicate') {
        // The file is already on disk (the app's duplicate guard said
        // so) — honest feedback, not a failure.
        setButtonState('Already downloaded', true)
      } else {
        setButtonState('Failed — try again', true)
      }
      if (feedbackTimer !== undefined) clearTimeout(feedbackTimer)
      feedbackTimer = setTimeout(showDefault, FEEDBACK_MS)
    })
    .catch(() => {
      setButtonState('Failed — try again', true)
      if (feedbackTimer !== undefined) clearTimeout(feedbackTimer)
      feedbackTimer = setTimeout(showDefault, FEEDBACK_MS)
    })
}

/** Right/top offsets avoid measuring the button's width. */
function positionButton(video: HTMLVideoElement): void {
  if (!button) return
  const rect = video.getBoundingClientRect()
  const host = document.fullscreenElement
  if (host) {
    // Inside the fullscreen element, positioned absolutely against it.
    if (button.parentElement !== host) host.appendChild(button)
    const hostRect = host.getBoundingClientRect()
    button.style.position = 'absolute'
    button.style.top = `${Math.max(0, rect.top - hostRect.top + 8)}px`
    button.style.right = `${Math.max(0, hostRect.right - rect.right + 8)}px`
    button.style.left = 'auto'
    button.style.bottom = 'auto'
  } else {
    if (button.parentElement !== document.body) document.body.appendChild(button)
    button.style.position = 'fixed'
    button.style.top = `${Math.max(0, rect.top + 8)}px`
    button.style.right = `${Math.max(0, window.innerWidth - rect.right + 8)}px`
    button.style.left = 'auto'
    button.style.bottom = 'auto'
  }
}

function showFor(video: HTMLVideoElement): void {
  if (!isDownloadableVideo(video)) return
  if (hideTimer !== undefined) {
    clearTimeout(hideTimer)
    hideTimer = undefined
  }
  if (!button) button = createButton()
  currentVideo = video
  positionButton(video)
  button.style.display = 'flex'
}

function hideButton(): void {
  if (hideTimer !== undefined) {
    clearTimeout(hideTimer)
    hideTimer = undefined
  }
  currentVideo = null
  if (button) button.style.display = 'none'
}

function scheduleHide(): void {
  if (hideTimer !== undefined) return
  hideTimer = setTimeout(hideButton, HIDE_DELAY_MS)
}

function start(): void {
  // Delegated hover — covers videos added later by SPAs (YouTube,
  // Facebook) without a listener per video.
  document.addEventListener('mouseover', (e) => {
    const target = e.target as Element | null
    const video = target?.closest?.('video') as HTMLVideoElement | null
    if (video) showFor(video)
  })
  document.addEventListener('mouseout', (e) => {
    const target = e.target as Element | null
    const video = target?.closest?.('video') as HTMLVideoElement | null
    if (video && video === currentVideo) scheduleHide()
  })
  // Keep the button glued to the video while the page moves.
  const reposition = (): void => {
    if (currentVideo) positionButton(currentVideo)
  }
  window.addEventListener('scroll', reposition, true)
  window.addEventListener('resize', reposition)
  document.addEventListener('fullscreenchange', reposition)
  // The hovered video left the DOM (SPA navigation) — hide.
  const observer = new MutationObserver(() => {
    if (currentVideo && !currentVideo.isConnected) hideButton()
  })
  if (document.body) {
    observer.observe(document.body, { childList: true, subtree: true })
  } else {
    document.addEventListener('DOMContentLoaded', () => {
      observer.observe(document.body, { childList: true, subtree: true })
    })
  }
}

// The app owns the switch (Settings > Setup & diagnostics, ON by
// default) and syncs it here on every background ping. A missing key
// means "never synced yet" — treat it as ON, the app default. A page
// already open needs a reload to pick a change up.
void chrome.storage.local.get('floatingButton').then((items) => {
  if (items['floatingButton'] !== false) start()
})
