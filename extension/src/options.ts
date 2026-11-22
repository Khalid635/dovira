// Loaded as a module script (options.html uses type="module"), so this
// file is module-scoped — its top-level names cannot collide with the
// service worker's.
// chrome.* types come from ./chrome.d.ts (included via tsconfig).
export {}

const DEFAULT_API_PORT = 17530

const tokenEl = document.getElementById('token') as HTMLInputElement
const portEl = document.getElementById('port') as HTMLInputElement
const interceptEl = document.getElementById('intercept') as HTMLInputElement
const statusEl = document.getElementById('status') as HTMLDivElement
const saveBtn = document.getElementById('save') as HTMLButtonElement
const testBtn = document.getElementById('test') as HTMLButtonElement

function setStatus(text: string, ok: boolean | null): void {
  statusEl.textContent = text
  statusEl.className = ok === true ? 'ok' : ok === false ? 'bad' : ''
}

async function load(): Promise<void> {
  const items = await chrome.storage.local.get(['token', 'port', 'interceptDownloads'])
  tokenEl.value = typeof items['token'] === 'string' ? (items['token'] as string) : ''
  portEl.value = String(
    typeof items['port'] === 'number' ? (items['port'] as number) : DEFAULT_API_PORT
  )
  interceptEl.checked = items['interceptDownloads'] === true
}

async function save(): Promise<void> {
  const port = Number(portEl.value)
  await chrome.storage.local.set({
    token: tokenEl.value.trim(),
    port: Number.isFinite(port) && port > 0 && port <= 65535 ? Math.floor(port) : DEFAULT_API_PORT,
    interceptDownloads: interceptEl.checked
  })
  setStatus('Saved.', true)
}

async function test(): Promise<void> {
  setStatus('Testing…', null)
  try {
    const res = (await chrome.runtime.sendMessage({ type: 'dovira-ping' })) as {
      ok?: boolean
      error?: string
    }
    if (res?.ok) {
      setStatus('Connected to the DOVIRA app.', true)
    } else if (res?.error === 'unauthorized') {
      setStatus(
        'Pairing failed — the token is wrong or missing. Copy the current token from the app.',
        false
      )
    } else if (res?.error === 'app-not-running') {
      setStatus('DOVIRA app is not running — start the desktop app.', false)
    } else {
      setStatus('Could not reach the DOVIRA app.', false)
    }
  } catch {
    setStatus('Could not reach the DOVIRA app.', false)
  }
}

saveBtn.addEventListener('click', () => {
  void save()
})
testBtn.addEventListener('click', () => {
  void test()
})

void load()
