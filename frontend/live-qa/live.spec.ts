import { test, expect, type Page, type APIRequestContext } from '@playwright/test'

// Differentiate browser egress failure from application errors. The static
// curl preflight succeeds even when Chromium cannot load a document.
async function navigateToTestSite(page:Page,request:APIRequestContext){
  const failures:string[]=[]
  page.on('requestfailed',failed=>{
    if(failures.length>=8)return
    let path='unknown'
    try{path=new URL(failed.url()).pathname}catch{}
    failures.push(path+': '+(failed.failure()?.errorText||'request failed'))
  })
  try{
    const response=await page.goto('/',{waitUntil:'domcontentloaded',timeout:32000})
    if(!response)throw new Error('No HTTP document response from Chromium')
    if(response.status()>=400)throw new Error('Chromium received HTTP '+response.status())
  }catch(error){
    let probe='HTTP probe failed'
    try{
      const check=await request.get('/build-info.json',{timeout:8000,headers:{'Cache-Control':'no-cache'}})
      probe='Node HTTP probe: '+check.status()
    }catch(e){probe='Node HTTP probe error: '+(e instanceof Error?e.message:String(e))}
    throw new Error(
      'Browser could not navigate to test server; '+probe+
      '; Chromium request failures: '+(failures.join('; ')||'none observed')+
      '; original error: '+(error instanceof Error?error.message:String(error))
    )
  }
}

// Authenticate live tests in session storage before the app's first script runs.
// The token is read from GitHub Actions secrets and must never be logged or committed.
test.beforeEach(async ({ page }) => {
  const token = process.env.E2E_AUTH_TOKEN?.trim()
  if (!token) return // Public demo smoke tests still work without configured secrets.
  await page.addInitScript((value: string) => {
    window.sessionStorage.setItem('architecture-hub:access-token:session', value)
  }, token)
})

test('test server: navigation, viewport and deployed build revision', async ({ page, request }, testInfo) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await navigateToTestSite(page,request)
  await expect(page.getByLabel('Версия сборки')).toBeVisible()
  // Test servers can use authenticated or open-access mode and need not contain any demo seed.
  await expect(page.getByRole('navigation', { name: 'Разделы архитектуры' })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Главная карта архитектуры' })).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('01-overview.png'), fullPage: true })

  const sections = ['Системы', 'Компоненты', 'Потоки', 'Обзор']
  for (const section of sections) {
    await switchSection(page, section)
    await expect(page.getByLabel('Версия сборки')).toBeVisible()
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 2)
    expect(overflow, `Horizontal overflow in ${section} at ${testInfo.project.name}`).toBe(false)
    await page.screenshot({ path: testInfo.outputPath('section-' + section + '.png'), fullPage: true })
  }

  expect(errors).toEqual([])
  const horizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 2)
  expect(horizontalOverflow).toBe(false)
})

test('test server: deployed revision is available without authentication', async ({ request }) => {
  const response = await request.get('/build-info.json', { headers: { 'Cache-Control': 'no-cache' } })
  expect(response.ok()).toBeTruthy()
  const info = await response.json() as { revision: string; builtAt: string }
  expect(info.revision).toMatch(/^[a-f0-9]{40}$/)
  expect(info.builtAt).toMatch(/^[0-9]{4}-/)
})

async function switchSection(page: import('@playwright/test').Page, section: string) {
  const nav = page.getByRole('navigation', { name: 'Разделы архитектуры' })
  const mobile = nav.locator('details.mobileSectionMenu > summary')
  const desktop = nav.getByRole('button', { name: section, exact: true })
  // CSS can switch to mobile navigation after React's initial hydration.
  // A one-shot isVisible() raced that transition and incorrectly selected
  // the hidden desktop buttons on Chromium/iPhone.
  await expect.poll(
    async () => await mobile.isVisible() || await desktop.isVisible(),
    { message: 'A navigation control must be visible before changing sections' },
  ).toBe(true)
  if (await mobile.isVisible()) {
    await mobile.click()
    const choice=nav.locator('.mobileSectionOptions').getByRole('button', { name: section, exact: true })
    await expect(choice).toBeVisible()
    await choice.click()
  } else {
    await expect(desktop, 'The '+section+' navigation must be accessible on the current viewport').toBeVisible()
    await desktop.click()
  }
}

test('test server: system passport and navigation remain clickable', async ({ page, request }, testInfo) => {
  await navigateToTestSite(page,request)
  await switchSection(page, 'Системы')
  const registry = page.getByRole('region', { name: 'Реестр информационных систем' })
  await expect(registry).toBeVisible()
  const passportAction = registry.getByRole('button', { name: 'Паспорт', exact: true }).first()
  if (await passportAction.count()) {
    await passportAction.click()
    const inspector = page.getByLabel('Карточка архитектурного объекта')
    await expect(inspector).toBeVisible()
    // PDn metadata is intentionally optional for older IS records.
    await expect(inspector.getByRole('region', { name: 'ПДн и классы защиты' })).toBeVisible()
  } else {
    // No seeded objects is a valid state; record actions cannot be smoke-tested.
    await expect(registry.getByRole('status')).toBeVisible()
  }
  await page.screenshot({ path: testInfo.outputPath('system-passport.png'), fullPage: true })
  // Regression: opening an inspector must not block the top navigation.
  await switchSection(page, 'Компоненты')
  await expect(page.getByLabel('Версия сборки')).toBeVisible()
})

test('test server: component registry exposes a passport action', async ({ page, request }, testInfo) => {
  await navigateToTestSite(page,request)
  await switchSection(page, 'Компоненты')
  await page.getByRole('group', { name: 'Представление компонентов' })
    .getByRole('button', { name: 'Реестр', exact: true }).click()
  const registry = page.getByRole('region', { name: 'Архитектурный реестр' })
  await expect(registry).toBeVisible()
  const openAction = registry.getByRole('button', { name: 'Открыть', exact: true }).first()
  if (await openAction.count()) {
    await openAction.click()
    await expect(page.getByRole('dialog', { name: /^Карточка компонента / })).toBeVisible()
  } else {
    await expect(registry.getByText('Компонентов: 0')).toBeVisible()
  }
  await page.screenshot({ path: testInfo.outputPath('component-passport.png'), fullPage: true })
})

test('test server: overview diagram zoom controls work without blocking overlay', async ({ page, request }, testInfo) => {
  await navigateToTestSite(page,request)
  await expect(page.locator('.react-flow__viewport').first()).toBeVisible()
  const controls = page.locator('.react-flow__controls').first()
  await expect(controls).toBeVisible()
  const viewport = page.locator('.react-flow__viewport').first()
  const getScale = async () => viewport.evaluate(element => {
    const transform = getComputedStyle(element).transform
    if (transform === 'none') return 1
    const matrix = new DOMMatrixReadOnly(transform)
    return Math.hypot(matrix.a, matrix.b)
  })
  // Live QA must compare two user zoom levels, not an uninitialized CSS
  // transform (scale=1) with the later overview AutoFit (e.g. scale=0.24).
  // Wait for actual graph nodes and two matching transforms across the 300ms
  // layout settle window before taking a baseline.
  await expect(viewport.locator('.react-flow__node').first()).toBeVisible()
  const transform = () => viewport.evaluate(element => getComputedStyle(element).transform)
  await expect.poll(async () => {
    const before = await transform()
    await page.waitForTimeout(400)
    return before !== 'none' && before === await transform()
  }, { timeout: 12000, message: 'Wait for the overview viewport to finish initial AutoFit' }).toBe(true)
  const initialScale = await getScale()
  await controls.locator('.react-flow__controls-zoomin').click()
  await expect.poll(getScale, { message: 'Zoom in must increase the actual canvas scale' }).toBeGreaterThan(initialScale + 0.01)
  const zoomedScale = await getScale()
  await controls.locator('.react-flow__controls-zoomout').click()
  await expect.poll(getScale, { message: 'Zoom out must decrease the actual canvas scale' }).toBeLessThan(zoomedScale - 0.01)
  await page.screenshot({ path: testInfo.outputPath('overview-after-zoom.png'), fullPage: true })
  await switchSection(page, 'Потоки')
  // Viewing flows must not create a full-page pseudo-element that steals pointer events.
  const overlay = await page.evaluate(() => {
    const style = getComputedStyle(document.body, '::before')
    return { content: style.content, pointerEvents: style.pointerEvents }
  })
  expect(overlay.content === 'none' || overlay.pointerEvents === 'none').toBeTruthy()
  await switchSection(page, 'Обзор')
  await expect(page.getByLabel('Версия сборки')).toBeVisible()
})
