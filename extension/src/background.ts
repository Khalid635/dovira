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
 *
 * v1.2.0: the worker also pings the app every minute (chrome.alarms),
 * so the app can show a live "extension connected" status, and syncs
 * the floating-button / intercept switches FROM the app — the app is
 * the single source of truth for them (Settings > Setup & diagnostics).
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

/**
 * v1.2.0: one ping against the app's /status. Shared by the periodic
 * alarm, startup, install, and the popup/options "Test connection".
 * Next-level: the ping also reports this extension's Options page URL
 * (X-Dovira-Options-Url) so the app's one-click "Pair extension"
 * button knows exactly which chrome-extension:// (or moz-extension://)
 * page to open with the token.
 */
async function pingApp(): Promise<{ ok: boolean; error?: string }> {
  const settings = await loadSettings()
  if (!settings.token) return { ok: false, error: 'unauthorized' }
  try {
    const res = await fetch(`http://127.0.0.1:${settings.port}/status`, {
      headers: {
        Authorization: `Bearer ${settings.token}`,
        'X-Dovira-Options-Url': chrome.runtime.getURL('options.html')
      }
    })
    return {
      ok: res.ok,
      error: res.ok ? undefined : res.status === 401 ? 'unauthorized' : 'failed'
    }
  } catch {
    return { ok: false, error: 'app-not-running' }
  }
}

/**
 * v1.2.0: pull the floating-button / intercept switches from the app
 * (GET /extension-settings, token-authenticated). The options page no
 * longer owns them. A failed fetch keeps the cached values.
 */
async function syncExtensionSettings(): Promise<void> {
  const settings = await loadSettings()
  if (!settings.token) return
  try {
    const res = await fetch(`http://127.0.0.1:${settings.port}/extension-settings`, {
      headers: { Authorization: `Bearer ${settings.token}` }
    })
    if (!res.ok) return
    const data = (await res.json()) as {
      ok?: boolean
      floatingButton?: boolean
      interceptDownloads?: boolean
    }
    if (!data.ok) return
    await chrome.storage.local.set({
      floatingButton: data.floatingButton === true,
      interceptDownloads: data.interceptDownloads === true
    })
  } catch {
    // App not running — keep the cached values.
  }
}

async function pingAndSync(): Promise<void> {
  const r = await pingApp()
  if (r.ok) await syncExtensionSettings()
}

type SendError = 'app-not-running' | 'unauthorized' | 'failed' | string

interface SendResult {
  ok: boolean
  error?: SendError
  /** True when the app started the download at once (direct flow). */
  direct?: boolean
}

/**
 * Send one URL to the DOVIRA app. Cookies for that URL travel with it
 * (Netscape format, per link only), plus the browser's User-Agent and
 * the page URL as Referer. Cookies are never logged anywhere.
 *
 * `direct` starts the download at once with the auto quality/
 * subtitle pick — no Add dialog. No extension sender uses it now:
 * the floating button opens the Add dialog since 2026-11-24 (so the
 * user picks Video quality or Audio before the download starts);
 * the flag stays for API senders, and the app's direct path is kept
 * for the AI Assistant's download command.
 */
async function sendToApp(url: string, referer?: string, direct = false): Promise<SendResult> {
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
        referer: referer || undefined,
        direct: direct || undefined
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
  let data: {
    ok?: boolean
    error?: string
    direct?: boolean
    dialog?: boolean
    id?: string
  } = {}
  try {
    data = (await res.json()) as {
      ok?: boolean
      error?: string
      direct?: boolean
      dialog?: boolean
      id?: string
    }
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
  return { ok: true, direct: data.direct === true }
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
  // v1.2.0: check in with the app every minute (status + behaviour sync).
  chrome.alarms.create('dovira-sync', { periodInMinutes: 1 })
  void pingAndSync()
})

chrome.runtime.onStartup.addListener(() => {
  void pingAndSync()
})

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== 'dovira-sync') return
  void pingAndSync()
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
  const msg = message as { type?: string; url?: string; referer?: string; direct?: boolean }
  if (msg.type === 'dovira-download' && typeof msg.url === 'string' && isSupportedUrl(msg.url)) {
    // Every sender uses the dialog flow now — the floating button
    // used to send direct: true (removed 2026-11-24: no quality /
    // audio choice that way). The `direct` flag is still passed
    // through for any sender that sets it.
    void sendToApp(msg.url, msg.referer, msg.direct === true).then((r) => sendResponse(r))
    return true // async response
  }
  if (msg.type === 'dovira-ping') {
    void (async () => {
      const r = await pingApp()
      if (r.ok) await syncExtensionSettings()
      sendResponse(r)
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
