/**
 * IDM-style floating download button (Phase 5).
 *
 * Shows a small fixed button when the page has a <video> element.
 * Clicking it sends the PAGE URL to the DOVIRA app via the background
 * service worker — the content script never calls the Local API
 * directly, because its Origin would be the page's origin and the API
 * rejects web-page origins.
 *
 * The button never touches page layout: a single fixed-position div,
 * no page DOM changes, dismissible with the × (hidden for the rest of
 * the tab session). YouTube's SPA navigation is covered by the
 * MutationObserver — the button reappears when a new video loads.
 *
 * chrome.* types come from ./chrome.d.ts (included via tsconfig).
 */

const BUTTON_ID = 'dovira-float-btn'
const DISMISSED_KEY = 'dovira-float-dismissed'

function isDismissed(): boolean {
  try {
    return sessionStorage.getItem(DISMISSED_KEY) === '1'
  } catch {
    return false
  }
}

function dismiss(): void {
  try {
    sessionStorage.setItem(DISMISSED_KEY, '1')
  } catch {
    // Storage unavailable — the button just stays hidden this load.
  }
  document.getElementById(BUTTON_ID)?.remove()
}

function setButtonState(label: HTMLSpanElement, text: string, disabled: boolean): void {
  label.textContent = text
  const btn = label.parentElement as HTMLButtonElement | null
  if (btn) btn.disabled = disabled
}

function createButton(): void {
  if (document.getElementById(BUTTON_ID) || isDismissed()) return
  if (document.querySelector('video') === null) return

  const wrap = document.createElement('div')
  wrap.id = BUTTON_ID
  wrap.style.cssText =
    'position:fixed;right:16px;bottom:16px;z-index:2147483647;' +
    'display:flex;align-items:center;gap:6px;font-family:system-ui,sans-serif;'

  const btn = document.createElement('button')
  btn.type = 'button'
  btn.style.cssText =
    'display:flex;align-items:center;gap:6px;cursor:pointer;border:0;border-radius:999px;' +
    'background:#0f1115;color:#e7e9ee;font-size:13px;font-weight:600;padding:8px 14px;' +
    'box-shadow:0 4px 16px rgba(0,0,0,0.45);'
  btn.innerHTML =
    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#5b8cff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12"/><path d="m6 11 6 6 6-6"/><path d="M4 21h16"/></svg>'
  const label = document.createElement('span')
  label.textContent = 'DOVIRA'
  btn.appendChild(label)

  btn.addEventListener('click', () => {
    setButtonState(label, 'Sending…', true)
    void chrome.runtime
      .sendMessage({ type: 'dovira-download', url: location.href, referer: location.href })
      .then((response) => {
        const r = response as { ok?: boolean; error?: string } | undefined
        if (r?.ok) {
          setButtonState(label, 'Sent to DOVIRA', true)
          setTimeout(() => setButtonState(label, 'DOVIRA', false), 2500)
        } else if (r?.error === 'app-not-running') {
          setButtonState(label, 'App not running', true)
          setTimeout(() => setButtonState(label, 'DOVIRA', false), 2500)
        } else {
          setButtonState(label, 'Failed — try again', true)
          setTimeout(() => setButtonState(label, 'DOVIRA', false), 2500)
        }
      })
      .catch(() => {
        setButtonState(label, 'Failed — try again', true)
        setTimeout(() => setButtonState(label, 'DOVIRA', false), 2500)
      })
  })

  const close = document.createElement('button')
  close.type = 'button'
  close.textContent = '×'
  close.setAttribute('aria-label', 'Dismiss')
  close.style.cssText =
    'cursor:pointer;border:0;border-radius:999px;width:26px;height:26px;' +
    'background:rgba(15,17,21,0.85);color:#8b93a5;font-size:15px;line-height:1;' +
    'box-shadow:0 4px 16px rgba(0,0,0,0.45);'
  close.addEventListener('click', dismiss)

  wrap.appendChild(btn)
  wrap.appendChild(close)
  document.body.appendChild(wrap)
}

function scan(): void {
  createButton()
}

scan()

// Pages that load videos late (YouTube SPA, infinite scroll) — re-scan
// whenever the DOM changes, cheaply: the button is created at most once.
const observer = new MutationObserver(() => {
  if (document.getElementById(BUTTON_ID) === null) scan()
})
if (document.body) {
  observer.observe(document.body, { childList: true, subtree: true })
} else {
  document.addEventListener('DOMContentLoaded', () => {
    observer.observe(document.body, { childList: true, subtree: true })
    scan()
  })
}
