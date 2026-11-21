import { defineConfig, devices } from '@playwright/test'

// On hosted containers curl may reach the test URL through HTTPS_PROXY while
// Chromium tries direct egress and hangs before even receiving a DOM. Pass the
// same proxy explicitly to Playwright, without weakening TLS verification.
function browserProxy(){
  const value=process.env.HTTPS_PROXY||process.env.https_proxy||
    process.env.HTTP_PROXY||process.env.http_proxy
  if(!value)return undefined
  try{
    const proxy=new URL(value)
    if(proxy.protocol!=='https:'&&proxy.protocol!=='http:')return undefined
    const credentials=proxy.username?{
      username:decodeURIComponent(proxy.username),
      password:decodeURIComponent(proxy.password),
    }:{}
    return {
      server:proxy.protocol+'//'+proxy.host,
      ...credentials,
      bypass:process.env.NO_PROXY||process.env.no_proxy||'',
    }
  }catch{return undefined}
}

export default defineConfig({
  testDir: './live-qa',
  timeout: 45000,
  retries: 1,
  reporter: [['list'], ['html', { outputFolder: 'live-qa-report', open: 'never' }], ['json', { outputFile: 'live-qa-results/playwright-results.json' }]],
  outputDir: 'live-qa-results',
  use: {
    baseURL: process.env.E2E_BASE_URL || 'https://test.web-tie.ru',
    browserName: 'chromium',
    proxy: browserProxy(),
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
