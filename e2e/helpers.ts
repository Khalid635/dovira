import { chromium, type Browser, type BrowserContext, type Page } from '@playwright/test'
import { spawn, type ChildProcess } from 'node:child_process'
import { execFile } from 'node:child_process'
import * as fs from 'node:fs'
import * as http from 'node:http'
import * as net from 'node:net'
import * as os from 'node:os'
import * as path from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export interface DoviraDownload {
  id: string
  filename: string
  status: string
  totalBytes: number
  doneBytes: number
  errorCode?: string | null
  errorMessage?: string | null
}

export interface DoviraSettings {
  language: string
  downloadDir: string
  minimizeToTray: boolean
  setupCompleted: boolean
  smartOrganizer: boolean
}

export interface DoviraAppInfo {
  version: string
}

interface DoviraApi {
  getAppInfo(): Promise<DoviraAppInfo>
  getSettings(): Promise<DoviraSettings>
  setSettings(patch: Partial<DoviraSettings>): Promise<DoviraSettings>
  listDownloads(): Promise<DoviraDownload[]>
  removeDownload(id: string, deleteFile: boolean): Promise<boolean>
}

export interface LaunchedApp {
  child: ChildProcess
  browser: Browser
  context: BrowserContext
  mainPage: Page
  userDataDir: string
  close: () => Promise<void>
}

export function packageVersion(): string {
  const pkg = JSON.parse(
    fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8')
  ) as { version: string }
  return pkg.version
}

function unpackedExePath(): string {
  const exe = path.join(process.cwd(), 'dist', 'win-unpacked', 'dovira.exe')
  if (!fs.existsSync(exe)) {
    throw new Error(`DOVIRA unpacked build not found at ${exe} — run 'npm run build:unpack' first.`)
  }
  return exe
}

function pickFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address !== null ? address.port : 0
      server.close(() => resolve(port))
    })
  })
}

async function waitForDebugger(port: number, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/list`)
      if (res.ok) {
        const targets = (await res.json()) as { type?: string }[]
        if (targets.some((t) => t.type === 'page')) return
      }
    } catch {
      // Not up yet — keep polling.
    }
    await sleep(500)
  }
  throw new Error(`DOVIRA did not expose CDP on port ${port} within ${timeoutMs}ms`)
}

async function waitForContext(browser: Browser, timeoutMs: number): Promise<BrowserContext> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const contexts = browser.contexts()
    if (contexts.length > 0) {
      const ctx = contexts[0]
      if (ctx) return ctx
    }
    await sleep(500)
  }
  throw new Error('No browser context appeared over CDP')
}

async function waitForMainPage(context: BrowserContext, timeoutMs: number): Promise<Page> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const page = context.pages().find((p) => !p.url().includes('progress='))
    if (page) return page
    await sleep(500)
  }
  throw new Error('Main window page did not appear over CDP')
}

export async function waitForProgressPage(
  context: BrowserContext,
  downloadId: string,
  timeoutMs: number
): Promise<Page> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const page = context.pages().find((p) => p.url().includes(`progress=${downloadId}`))
    if (page) return page
    await sleep(500)
  }
  throw new Error(`Progress window for download ${downloadId} did not appear within ${timeoutMs}ms`)
}

function killTree(child: ChildProcess): void {
  if (child.exitCode === null) {
    try {
      child.kill()
    } catch {
      // Already gone.
    }
  }
}

async function waitForExit(child: ChildProcess, timeoutMs: number): Promise<void> {
  if (child.exitCode !== null) return
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      if (child.pid !== undefined) {
        void execFileAsync('taskkill', ['/F', '/T', '/PID', String(child.pid)]).catch(() => {
          // Already gone.
        })
      }
      resolve()
    }, timeoutMs)
    child.once('exit', () => {
      clearTimeout(timer)
      resolve()
    })
  })
}

/**
 * Launch the packaged app (dist/win-unpacked) with a throwaway profile and
 * connect Playwright to it over CDP. Do NOT use Playwright's
 * `_electron.launch` — it is unproven under SSH Session 0; this spawn +
 * connectOverCDP pattern is the one the probes proved.
 */
export async function launchApp(userDataDir: string): Promise<LaunchedApp> {
  const exe = unpackedExePath()
  const port = await pickFreePort()
  const child = spawn(
    exe,
    [`--user-data-dir=${userDataDir}`, `--remote-debugging-port=${port}`, '--remote-allow-origins=*'],
    { stdio: 'ignore', windowsHide: true }
  )
  try {
    await waitForDebugger(port, 60000)
  } catch (err) {
    killTree(child)
    throw err
  }
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`)
  const context = await waitForContext(browser, 30000)
  const mainPage = await waitForMainPage(context, 30000)
  // The preload must be up before any window.dovira call.
  await mainPage.waitForFunction(
    () => typeof (globalThis as unknown as { dovira?: unknown }).dovira !== 'undefined',
    { timeout: 30000 }
  )
  const close = async (): Promise<void> => {
    try {
      await browser.close()
    } catch {
      // CDP already disconnected.
    }
    killTree(child)
    await waitForExit(child, 10000)
  }
  return { child, browser, context, mainPage, userDataDir, close }
}

/**
 * Click through the first-run wizard: pick English, then Next through the
 * folder and extension steps, then Start downloading. Fresh profiles
 * default to Bangla, so the wizard title starts in Bangla — the language
 * button itself is the language-independent hook. Step markers guard
 * against double-clicks landing on the same step twice.
 */
export async function dismissWizard(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'English', exact: true }).waitFor({ timeout: 60000 })
  await page.getByRole('button', { name: 'English', exact: true }).click()
  await page.getByText('Welcome to DOVIRA').waitFor({ timeout: 30000 })
  const next = page.getByRole('button', { name: 'Next', exact: true })
  await next.click()
  await page.getByText('Step 1 of 3').waitFor({ timeout: 15000 })
  await next.click()
  await page.getByText('Step 2 of 3').waitFor({ timeout: 15000 })
  await next.click()
  await page.getByText('Step 3 of 3').waitFor({ timeout: 15000 })
  await page.getByRole('button', { name: 'Start downloading', exact: true }).click()
  await page.getByText('Welcome to DOVIRA').waitFor({ state: 'detached', timeout: 30000 })
}

export async function apiGetSettings(page: Page): Promise<DoviraSettings> {
  return page.evaluate(() => {
    const g = globalThis as unknown as { dovira: DoviraApi }
    return g.dovira.getSettings()
  })
}

export async function apiSetSettings(
  page: Page,
  patch: Partial<DoviraSettings>
): Promise<DoviraSettings> {
  return page.evaluate((p) => {
    const g = globalThis as unknown as { dovira: DoviraApi }
    return g.dovira.setSettings(p)
  }, patch)
}

export async function apiGetAppInfo(page: Page): Promise<DoviraAppInfo> {
  return page.evaluate(() => {
    const g = globalThis as unknown as { dovira: DoviraApi }
    return g.dovira.getAppInfo()
  })
}

export async function apiListDownloads(page: Page): Promise<DoviraDownload[]> {
  return page.evaluate(() => {
    const g = globalThis as unknown as { dovira: DoviraApi }
    return g.dovira.listDownloads()
  })
}

export async function apiRemoveDownload(
  page: Page,
  id: string,
  deleteFile: boolean
): Promise<boolean> {
  return page.evaluate(
    ({ downloadId, del }) => {
      const g = globalThis as unknown as { dovira: DoviraApi }
      return g.dovira.removeDownload(downloadId, del)
    },
    { downloadId: id, del: deleteFile }
  )
}

export async function findDownloadByName(
  page: Page,
  filename: string
): Promise<DoviraDownload | undefined> {
  const list = await apiListDownloads(page)
  return list.find((d) => d.filename === filename)
}

export async function waitForDownloadByName(
  page: Page,
  filename: string,
  timeoutMs: number
): Promise<DoviraDownload> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const found = await findDownloadByName(page, filename)
    if (found) return found
    await sleep(500)
  }
  throw new Error(`Download '${filename}' did not appear within ${timeoutMs}ms`)
}

export async function waitForDownloadStatus(
  page: Page,
  id: string,
  status: string,
  timeoutMs: number
): Promise<void> {
  const deadline = Date.now() + timeoutMs
  let last: string | null = null
  let lastError: string | null = null
  while (Date.now() < deadline) {
    const list = await apiListDownloads(page)
    const found = list.find((d) => d.id === id)
    last = found?.status ?? null
    lastError = found?.errorMessage ?? found?.errorCode ?? null
    if (last === status) return
    await sleep(500)
  }
  throw new Error(
    `Download ${id} did not reach status '${status}' within ${timeoutMs}ms (last: ${last}${lastError ? `, error: ${lastError}` : ''})`
  )
}

export function makeTempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix))
}

export function removeTempDir(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true })
}

export const SMALL_FILE_SIZE = 262144 // 256 KiB
export const SLOW_FILE_SIZE = 10485760 // 10 MiB
const SLOW_RATE_BPS = 400 * 1024 // ~400 KB/s aggregate

export interface FileServer {
  url: string
  close: () => Promise<void>
}

/**
 * Hermetic download source: an in-process HTTP server serving two
 * deterministic files. Both endpoints support HEAD (the queue does a HEAD
 * first) and send Content-Length. Range requests are HONORED with 206 +
 * Content-Range — aria2 splits downloads into ranged connections and FAILS
 * ("Invalid range header") if a ranged request gets the full body back, so
 * a no-Range server does not work. /slow.zip is dripped through one GLOBAL
 * pacer (~400 KB/s aggregate across all connections), so the download lasts
 * ~25s no matter how many connections the downloader opens.
 */
export async function startFileServer(): Promise<FileServer> {
  const small = Buffer.alloc(SMALL_FILE_SIZE, 0x41)
  const slow = Buffer.alloc(SLOW_FILE_SIZE, 0x42)
  const pacer = { sent: 0, startedAt: Date.now() }

  const pace = async (bytes: number): Promise<void> => {
    pacer.sent += bytes
    const expectedMs = (pacer.sent / SLOW_RATE_BPS) * 1000
    const elapsedMs = Date.now() - pacer.startedAt
    if (expectedMs > elapsedMs) await sleep(expectedMs - elapsedMs)
  }

  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    let data: Buffer | null
    if (url.pathname === '/small.zip') data = small
    else if (url.pathname === '/slow.zip') data = slow
    else {
      res.writeHead(404)
      res.end()
      return
    }
    const body = data
    // Honor Range (aria2 splits into ranged connections; answering a ranged
    // request with the full body makes it fail with "Invalid range header").
    let start = 0
    let end = body.length - 1
    let status = 200
    const range = req.headers.range
    if (typeof range === 'string') {
      const m = /^bytes=(\d*)-(\d*)$/.exec(range.trim())
      if (m) {
        start = m[1] === '' ? Math.max(0, body.length - Number(m[2] || 0)) : Number(m[1])
        end = m[2] === '' ? body.length - 1 : Math.min(Number(m[2]), body.length - 1)
        if (start <= end && start < body.length) {
          status = 206
        } else {
          res.writeHead(416, { 'Content-Range': `bytes */${body.length}` })
          res.end()
          return
        }
      }
    }
    const slice = body.subarray(start, end + 1)
    const headers: Record<string, string> = {
      'Content-Type': 'application/zip',
      'Content-Length': String(slice.length),
      'Accept-Ranges': 'bytes'
    }
    if (status === 206) headers['Content-Range'] = `bytes ${start}-${end}/${body.length}`
    if (req.method === 'HEAD') {
      res.writeHead(status, headers)
      res.end()
      return
    }
    res.writeHead(status, headers)
    void (async () => {
      const CHUNK = 32 * 1024
      try {
        for (let offset = 0; offset < slice.length; offset += CHUNK) {
          const piece = slice.subarray(offset, Math.min(offset + CHUNK, slice.length))
          if (url.pathname === '/slow.zip') await pace(piece.length)
          if (res.destroyed) return
          const ok = res.write(piece)
          if (!ok) await new Promise<void>((resolve) => res.once('drain', resolve))
        }
        res.end()
      } catch {
        // Client went away (e.g. cancelled download) — nothing to do.
      }
    })()
  })

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
  const address = server.address()
  if (typeof address !== 'object' || address === null) {
    throw new Error('File server did not bind to a port')
  }
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections()
        server.close(() => resolve())
      })
  }
}
