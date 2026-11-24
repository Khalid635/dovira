import './assets/main.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import ProgressWindow from './components/ProgressWindow'

// Bridge-health gate: if the preload never exposed window.dovira, no IPC
// call can work and every screen would hang on a bare "…" (the 2026-11-22
// Settings bug — the dev run whose preload raced electron-vite). Fail loudly
// with a full-screen message instead of rendering a dead app. Plain
// innerHTML on purpose: React and the stylesheet must not be needed to show
// this, and the app cannot restart itself without the bridge.
if (typeof window.dovira === 'undefined') {
  const root = document.getElementById('root')
  if (root) {
    root.innerHTML =
      '<div style="display:flex;min-height:100vh;align-items:center;justify-content:center;background:#0f1115;color:#e5e7eb;font-family:system-ui,sans-serif;padding:24px">' +
      '<div style="max-width:480px">' +
      '<h1 style="font-size:18px;margin:0 0 12px">DOVIRA চালু হয়নি</h1>' +
      '<p style="font-size:14px;line-height:1.6;margin:0 0 8px">অ্যাপের ভেতরের সংযোগ চালু হয়নি — অ্যাপ বন্ধ করে আবার চালান।</p>' +
      '<p style="font-size:13px;line-height:1.6;color:#9ca3af;margin:0">The app internal connection did not start — close the app and open it again.</p>' +
      '</div></div>'
  }
} else {
  // v1.4.1: ?progress=<id> renders ONLY the small progress window for
  // one download — no sidebar, no dialog. The query never changes for
  // the life of the window; branching here (not an early return inside
  // App) keeps the hooks rules intact.
  const progressId = new URLSearchParams(window.location.search).get('progress')
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      {progressId ? <ProgressWindow downloadId={progressId} /> : <App />}
    </StrictMode>
  )
}
