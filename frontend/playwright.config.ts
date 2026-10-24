import { defineConfig } from '@playwright/test'
export default defineConfig({
  testDir: './e2e',
  timeout: 30000,
  retries: 1,
  use: { baseURL: 'http://127.0.0.1:5174', browserName: 'chromium', headless: true, trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  reporter: 'list',
})
