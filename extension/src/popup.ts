import { isSupportedUrl } from './lib.js'

// chrome.* types come from ./chrome.d.ts (included via tsconfig).

interface PageLink {
  url: string
  text: string
}

/**
 * Runs INSIDE the page (chrome.scripting.executeScript serializes it),
 * so it must be self-contained — no references to outer scope.
 * Collects links + video sources, http(s) only, max 50.
 */
function collectLinks(): PageLink[] {
  const seen = new Set<string>()
  const out: PageLink[] = []
  const push = (url: string, text: string): void => {
    if (out.length >= 50) return
    try {
      const u = new URL(url, location.href)
      if (u.protocol !== 'http:' && u.protocol !== 'https:') return
      if (seen.has(u.href)) return
      seen.add(u.href)
      out.push({ url: u.href, text: text.trim().slice(0, 80) || u.href })
    } catch {
      // Bad URL — skip it.
    }
  }
  for (const a of document.querySelectorAll('a[href]')) {
    push(a.getAttribute('href') ?? '', a.textContent ?? '')
  }
  for (const v of document.querySelectorAll('video[src], video source[src]')) {
    push(v.getAttribute('src') ?? '', 'video')
  }
  return out
}

const statusEl = document.getElementById('status') as HTMLDivElement
const linksEl = document.getElementById('links') as HTMLDivElement
const emptyEl = document.getElementById('empty') as HTMLDivElement

function setStatus(text: string, ok: boolean): void {
  statusEl.textContent = text
  statusEl.className = ok ? 'ok' : 'bad'
}

async function ping(): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = (await chrome.runtime.sendMessage({ type: 'dovira-ping' })) as {
      ok?: boolean
      error?: string
    }
    return { ok: res?.ok === true, error: res?.error }
  } catch {
    return { ok: false, error: 'failed' }
  }
}

async function main(): Promise<void> {
  const pingRes = await ping()
  if (pingRes.ok) {
    setStatus('Connected to DOVIRA', true)
  } else if (pingRes.error === 'unauthorized') {
    setStatus('Not paired — paste the token in Options.', false)
  } else if (pingRes.error === 'app-not-running') {
    setStatus('DOVIRA app is not running — start the desktop app.', false)
  } else {
    setStatus('Could not reach the DOVIRA app.', false)
  }

  const tabs = await chrome.tabs.query({ active: true, currentWindow: true })
  const tab = tabs[0]
  if (!tab?.id) {
    emptyEl.hidden = false
    return
  }
  let links: PageLink[] = []
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: collectLinks
    })
    const first = results[0]?.result as PageLink[] | undefined
    if (Array.isArray(first)) links = first
  } catch {
    // Restricted pages (chrome://, store pages) refuse script injection.
    emptyEl.hidden = false
    emptyEl.textContent = 'Cannot read links on this page.'
    return
  }
  if (links.length === 0) {
    emptyEl.hidden = false
    return
  }
  for (const link of links) {
    const row = document.createElement('div')
    row.className = 'row'
    const text = document.createElement('span')
    const title = document.createElement('div')
    title.textContent = link.text
    const url = document.createElement('small')
    try {
      url.textContent = new URL(link.url).hostname
    } catch {
      url.textContent = link.url
    }
    text.appendChild(title)
    text.appendChild(url)
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.textContent = 'Send to app'
    btn.addEventListener('click', () => {
      if (!isSupportedUrl(link.url)) return
      btn.disabled = true
      btn.textContent = 'Sending…'
      void chrome.runtime
        .sendMessage({ type: 'dovira-download', url: link.url, referer: tab.url })
        .then((response) => {
          const r = response as { ok?: boolean } | undefined
          btn.textContent = r?.ok ? 'Sent ✓' : 'Failed'
          if (!r?.ok) btn.disabled = false
        })
        .catch(() => {
          btn.textContent = 'Failed'
          btn.disabled = false
        })
    })
    row.appendChild(text)
    row.appendChild(btn)
    linksEl.appendChild(row)
  }
}

void main()
