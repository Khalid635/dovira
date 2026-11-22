/**
 * DOVIRA extension — background service worker (Manifest V3).
 *
 * chrome.* types come from ./chrome.d.ts (included via tsconfig).
 *
 * Self-contained BY DESIGN: MV3 service workers cannot reliably import
 * ES modules across Chrome and Firefox, so this file carries its own
 * small copies of the helpers in lib.ts (formatNetscapeCookies,
 * isSupportedUrl). lib.ts is the source of truth — keep them in sync.
 *
 * Architecture: the background worker is the ONLY part that talks to
 * the app's Local API (http://127.0.0.1:<port>). The content script
 * and popup never fetch the API directly — a content script's Origin
 * would be the page's origin, and the API rejects web-page origins.
 */

const DEFAULT_PORT = 17530

interface ExtSettings {
  token: string
  port: number
  interceptDownloads: boolean
}

async function loadSettings(): Promise<ExtSettings> {
  const items = await chrome.storage.local.get(['token', 'port', 'interceptDownloads'])
  return {
    token: typeof items['token'] === 'string' ? (items['token'] as string) : '',
    port: typeof items['port'] === 'number' ? (items['port'] as number) : DEFAULT_PORT,
    interceptDownloads: items['interceptDownloads'] === true
  }
}

function isSupportedUrl(url: string): boolean {
  if (typeof url !== 'string' || url.length === 0 || url.length > 4096) return false
  try {
    const u = new URL(url)
    return u.protocol === 'http:' || u.protocol === 'https:' || u.protocol === 'magnet:'
  } catch {
    return false
  }
}

/** chrome.cookies.Cookie[] → Netscape cookies.txt text (yt-dlp's --cookies format). */
function formatNetscapeCookies(cookies: ChromeCookie[]): string {
  const lines = ['# Netscape HTTP Cookie File', '# DOVIRA extension — per-link cookies']
  for (const c of cookies) {
    if (!c.name || /[\t\r\n]/.test(c.name) || /[\t\r\n]/.test(c.value)) continue
    const domain = c.hostOnly ? `#HttpOnly_${c.domain}` : c.domain
    const expires = c.expirationDate ? Math.floor(c.expirationDate) : 0
    lines.push(
      [
        domain,
        'TRUE',
        c.path || '/',
        c.secure ? 'TRUE' : 'FALSE',
        String(expires),
        c.name,
        c.value
      ].join('\t')
    )
  }
  return lines.join('\n') + '\n'
}

async function notify(title: string, message: string): Promise<void> {
  try {
    await chrome.notifications.create({
      type: 'basic',
      iconUrl: 'icons/icon.png',
      title,
      message
    })
  } catch {
    // Notifications are best-effort — a failed toast must not lose the download.
  }
}

type SendError = 'app-not-running' | 'unauthorized' | 'failed' | string

interface SendResult {
  ok: boolean
  error?: SendError
}

/**
 * Send one URL to the DOVIRA app. Cookies for that URL travel with it
 * (Netscape format, per link only), plus the browser's User-Agent and
 * the page URL as Referer. Cookies are never logged anywhere.
 */
async function sendToApp(url: string, referer?: string): Promise<SendResult> {
  const settings = await loadSettings()
  if (!settings.token) {
    await notify(
      'DOVIRA — not paired',
      'Open the DOVIRA extension options and paste the pairing token from the app (Settings > Browser & Cookies).'
    )
    return { ok: false, error: 'unauthorized' }
  }
  let cookiesText = ''
  try {
    const cookies = await chrome.cookies.getAll({ url })
    if (cookies.length > 0) cookiesText = formatNetscapeCookies(cookies)
  } catch {
    // No cookies readable for this URL — send without them.
  }
  let res: Response
  try {
    res = await fetch(`http://127.0.0.1:${settings.port}/downloads`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${settings.token}`
      },
      body: JSON.stringify({
        url,
        cookies: cookiesText || undefined,
        userAgent: navigator.userAgent,
        referer: referer || undefined
      })
    })
  } catch {
    await notify('DOVIRA app is not running', 'Start the DOVIRA desktop app and try again.')
    return { ok: false, error: 'app-not-running' }
  }
  if (res.status === 401) {
    await notify(
      'DOVIRA — pairing failed',
      'The token is wrong. Copy the current token from the app (Settings > Browser & Cookies) into the extension options.'
    )
    return { ok: false, error: 'unauthorized' }
  }
  let data: { ok?: boolean; error?: string } = {}
  try {
    data = (await res.json()) as { ok?: boolean; error?: string }
  } catch {
    // Non-JSON response — treated as a failure below.
  }
  if (!res.ok || !data.ok) {
    const message =
      data.error === 'playlist'
        ? 'That is a playlist link — open it in the DOVIRA app to pick videos.'
        : 'Could not add the download. Check the app and try again.'
    await notify('DOVIRA — download failed', message)
    return { ok: false, error: data.error ?? 'failed' }
  }
  return { ok: true }
}

// Right-click menu: link + video/page. Created once on install.
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: 'dovira-download-link',
      title: 'Download with DOVIRA',
      contexts: ['link']
    })
    chrome.contextMenus.create({
      id: 'dovira-download-page',
      title: 'Download this page with DOVIRA',
      contexts: ['page', 'video']
    })
  })
})

chrome.contextMenus.onClicked.addListener((info) => {
  const url = info.linkUrl ?? info.srcUrl ?? info.pageUrl
  if (!url || !isSupportedUrl(url)) return
  void (async () => {
    const result = await sendToApp(url, info.pageUrl)
    if (result.ok) await notify('Sent to DOVIRA', 'The download was added to the app queue.')
  })()
})

// Messages from the content script (floating button) and the popup.
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const msg = message as { type?: string; url?: string; referer?: string }
  if (msg.type === 'dovira-download' && typeof msg.url === 'string' && isSupportedUrl(msg.url)) {
    void sendToApp(msg.url, msg.referer).then((r) => sendResponse(r))
    return true // async response
  }
  if (msg.type === 'dovira-ping') {
    void (async () => {
      const settings = await loadSettings()
      if (!settings.token) {
        sendResponse({ ok: false, error: 'unauthorized' })
        return
      }
      try {
        const res = await fetch(`http://127.0.0.1:${settings.port}/status`, {
          headers: { Authorization: `Bearer ${settings.token}` }
        })
        sendResponse({
          ok: res.ok,
          error: res.ok ? undefined : res.status === 401 ? 'unauthorized' : 'failed'
        })
      } catch {
        sendResponse({ ok: false, error: 'app-not-running' })
      }
    })()
    return true // async response
  }
  return false
})

// Optional intercept (OFF by default — see options): cancel the browser's
// own download and send the URL to the app instead.
chrome.downloads.onCreated.addListener((item) => {
  void (async () => {
    const settings = await loadSettings()
    if (!settings.interceptDownloads) return
    if (!isSupportedUrl(item.url)) return
    chrome.downloads.cancel(item.id, () => {
      // Callback form: works in Chrome and Firefox alike; a failure
      // (already finished) just means there is nothing to cancel.
      void chrome.runtime.lastError
    })
    const result = await sendToApp(item.url)
    if (result.ok) {
      await notify('Sent to DOVIRA', 'The browser download was moved to the app.')
    }
  })()
})
