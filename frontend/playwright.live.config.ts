import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './live-qa',
  timeout: 45000,
  retries: 1,
  reporter: [['list'], ['html', { outputFolder: 'live-qa-report', open: 'never' }]],
  outputDir: 'live-qa-results',
  use: {
    baseURL: 'https://test.web-tie.ru',
    browserName: 'chromium',
    headless: true,
    trace: 'retain-on-failure',
    screenshot: 'on',
    actionTimeout: 10000,
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['iPhone 13'], defaultBrowserType: 'chromium' } },
  ],
})
