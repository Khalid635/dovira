import { test, expect } from '@playwright/test'
import * as fs from 'node:fs'
import * as path from 'node:path'
import {
  SMALL_FILE_SIZE,
  apiGetSettings,
  apiRemoveDownload,
  apiSetSettings,
  dismissWizard,
  launchApp,
  makeTempDir,
  removeTempDir,
  startFileServer,
  waitForDownloadByName,
  waitForDownloadStatus,
  waitForProgressPage,
  type FileServer,
  type LaunchedApp
} from './helpers'

let app: LaunchedApp
let userDataDir: string
let downloadDir: string
let server: FileServer

test.beforeAll(async () => {
  userDataDir = makeTempDir('dovira-e2e-')
  downloadDir = makeTempDir('dovira-e2e-dl-')
  server = await startFileServer()
  app = await launchApp(userDataDir)
  await dismissWizard(app.mainPage)
  // smartOrganizer is ON by default and would move small.zip into an
  // Archives/ subfolder, so turn it off: this suite asserts the file lands
  // directly in downloadDir.
  await apiSetSettings(app.mainPage, { downloadDir, smartOrganizer: false })
  const settings = await apiGetSettings(app.mainPage)
  expect(settings.downloadDir).toBe(downloadDir)
  // apiSetSettings writes straight to the DB; the renderer's settings store
  // only refreshes on load, so reload once here — otherwise the Add dialog
  // would still use the stale store settings (organizer on, default dir).
  await app.mainPage.reload()
  await expect(app.mainPage.getByPlaceholder('Paste a download link here...')).toBeVisible({
    timeout: 30000
  })
})

test.afterAll(async () => {
  await app.close()
  await server.close()
  removeTempDir(userDataDir)
  removeTempDir(downloadDir)
})

async function openAddDialog(url: string): Promise<void> {
  const page = app.mainPage
  // Tests 7–8 leave the view on History; the add input only exists on Home.
  // The "All" nav button carries a count badge, so its accessible name is
  // "All 0", "All 1", ... — match the label plus the badge number.
  await page.getByRole('button', { name: /^All \d+$/ }).click()
  await page.getByPlaceholder('Paste a download link here...').fill(url)
  await page.getByRole('button', { name: 'Add', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'Add download' })).toBeVisible({ timeout: 30000 })
}

test('add dialog loads formats for a YouTube URL', async () => {
  // YouTube fetchInfo can take up to ~3 minutes; the 120s default is not enough.
  test.setTimeout(300000)
  await openAddDialog('https://www.youtube.com/watch?v=YE7VzlLtp-4')
  const dialog = app.mainPage.getByRole('dialog', { name: 'Add download' })
  await expect(dialog.getByText('1080p', { exact: true })).toBeVisible({ timeout: 180000 })
  // The Video/Audio tabs are plain buttons (no tab role), so match by name.
  await expect(dialog.getByRole('button', { name: 'Video', exact: true })).toBeVisible()
  await expect(dialog.getByRole('button', { name: 'Audio', exact: true })).toBeVisible()
  // The dialog is taller than the 800px window for a YouTube video, so the
  // footer Cancel button sits below the viewport with no scrollable ancestor;
  // close via the header X instead (same closeDialog path).
  await dialog.getByRole('button', { name: 'Close' }).click()
  await expect(app.mainPage.getByRole('dialog', { name: 'Add download' })).toHaveCount(0)
})

test('small plain-file download completes and shows in Home and History', async () => {
  const url = `${server.url}/small.zip`
  await openAddDialog(url)
  const dialog = app.mainPage.getByRole('dialog', { name: 'Add download' })
  await expect(dialog.getByText('small.zip', { exact: true })).toBeVisible({ timeout: 30000 })
  await dialog.getByRole('button', { name: 'Download', exact: true }).click()
  await expect(app.mainPage.getByRole('dialog', { name: 'Add download' })).toHaveCount(0)

  const download = await waitForDownloadByName(app.mainPage, 'small.zip', 30000)
  const progress = await waitForProgressPage(app.context, download.id, 60000)
  await expect(progress.getByText('small.zip', { exact: true })).toBeVisible({ timeout: 30000 })
  await expect(progress.getByText(/%/)).toBeVisible({ timeout: 30000 })

  await waitForDownloadStatus(app.mainPage, download.id, 'completed', 120000)
  const savedPath = path.join(downloadDir, 'small.zip')
  expect(fs.statSync(savedPath).size).toBe(SMALL_FILE_SIZE)

  await expect(progress.getByText('Completed', { exact: true })).toBeVisible()
  await expect(progress.getByRole('button', { name: 'Open', exact: true })).toBeVisible()
  await expect(progress.getByRole('button', { name: 'Show in folder', exact: true })).toBeVisible()
  await expect(progress.getByRole('button', { name: 'Close', exact: true })).toBeVisible()
  await progress.getByRole('button', { name: 'Close', exact: true }).click()

  const card = app.mainPage.locator('.dl-grid', { hasText: 'small.zip' })
  await expect(card.getByText('Completed', { exact: true })).toBeVisible()

  await app.mainPage.getByRole('button', { name: 'History', exact: true }).click()
  await expect(app.mainPage.getByText('small.zip', { exact: true })).toBeVisible()

  const removed = await apiRemoveDownload(app.mainPage, download.id, true)
  expect(removed).toBe(true)
  expect(fs.existsSync(savedPath)).toBe(false)
})

test('pause, resume and cancel from the progress window', async () => {
  const url = `${server.url}/slow.zip`
  await openAddDialog(url)
  const dialog = app.mainPage.getByRole('dialog', { name: 'Add download' })
  await expect(dialog.getByText('slow.zip', { exact: true })).toBeVisible({ timeout: 30000 })
  await dialog.getByRole('button', { name: 'Download', exact: true }).click()
  await expect(app.mainPage.getByRole('dialog', { name: 'Add download' })).toHaveCount(0)

  const download = await waitForDownloadByName(app.mainPage, 'slow.zip', 30000)
  const progress = await waitForProgressPage(app.context, download.id, 60000)
  await waitForDownloadStatus(app.mainPage, download.id, 'downloading', 120000)

  await progress.getByRole('button', { name: 'Pause', exact: true }).click()
  await waitForDownloadStatus(app.mainPage, download.id, 'paused', 60000)

  await progress.getByRole('button', { name: 'Resume', exact: true }).click()
  await waitForDownloadStatus(app.mainPage, download.id, 'downloading', 60000)

  await progress.getByRole('button', { name: 'Cancel', exact: true }).click()
  await waitForDownloadStatus(app.mainPage, download.id, 'cancelled', 60000)

  const removed = await apiRemoveDownload(app.mainPage, download.id, true)
  expect(removed).toBe(true)
  expect(fs.existsSync(path.join(downloadDir, 'slow.zip'))).toBe(false)
})
