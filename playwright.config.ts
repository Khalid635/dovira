import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  timeout: 120000,
  workers: 1,
  retries: 0,
  use: {
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure'
  },
  outputDir: 'e2e/test-results'
})
