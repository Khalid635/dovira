import { test, expect } from '@playwright/test'
import {
  apiGetSettings,
  dismissWizard,
  launchApp,
  makeTempDir,
  packageVersion,
  removeTempDir,
  type LaunchedApp
} from './helpers'

let app: LaunchedApp
let userDataDir: string

test.beforeAll(async () => {
  userDataDir = makeTempDir('dovira-e2e-')
  app = await launchApp(userDataDir)
})

test.afterAll(async () => {
  await app.close()
  removeTempDir(userDataDir)
})

test('first-run wizard completes', async () => {
  await dismissWizard(app.mainPage)
  await expect(app.mainPage.getByText('Welcome to DOVIRA')).toHaveCount(0)
  const settings = await apiGetSettings(app.mainPage)
  expect(settings.language).toBe('en')
  expect(settings.setupCompleted).toBe(true)
  // The main nav is visible once the wizard is gone.
  await expect(app.mainPage.getByRole('button', { name: 'Settings', exact: true })).toBeVisible()
})

test('app launches and shows the main window', async () => {
  const version = packageVersion()
  await expect(app.mainPage.getByText('DOVIRA', { exact: true })).toBeVisible({ timeout: 30000 })
  await expect(app.mainPage.getByText(`v${version}`, { exact: true })).toBeVisible({
    timeout: 30000
  })
  await expect(app.mainPage.getByText('No downloads yet')).toBeVisible()
})

test('settings toggle persists across restart', async () => {
  const before = await apiGetSettings(app.mainPage)
  await app.mainPage.getByRole('button', { name: 'Settings', exact: true }).click()
  await app.mainPage.getByLabel('Close to tray instead of quitting').click()
  const flipped = await apiGetSettings(app.mainPage)
  expect(flipped.minimizeToTray).toBe(!before.minimizeToTray)

  await app.close()
  app = await launchApp(userDataDir)
  const afterRestart = await apiGetSettings(app.mainPage)
  expect(afterRestart.minimizeToTray).toBe(!before.minimizeToTray)

  // Flip it back so the throwaway profile is left as found.
  await app.mainPage.getByRole('button', { name: 'Settings', exact: true }).click()
  await app.mainPage.getByLabel('Close to tray instead of quitting').click()
  const restored = await apiGetSettings(app.mainPage)
  expect(restored.minimizeToTray).toBe(before.minimizeToTray)
})

test('AI Assistant answers a status question', async () => {
  await app.mainPage.getByRole('button', { name: 'AI Assistant', exact: true }).click()
  await app.mainPage.getByRole('button', { name: "What's downloading?", exact: true }).click()
  // The assistant bubble is the justify-start one; the user bubble
  // (justify-end) also contains "downloading", so scope to the reply.
  const reply = app.mainPage.locator('div.flex.justify-start').last()
  await expect(reply).toContainText(/download/i, { timeout: 60000 })
})

test('history starts empty', async () => {
  await app.mainPage.getByRole('button', { name: 'History', exact: true }).click()
  await expect(
    app.mainPage.getByText('No history yet — finished downloads will appear here.')
  ).toBeVisible()
})
