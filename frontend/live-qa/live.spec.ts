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
  let lastError:unknown=null
  let stage='HTTP navigation'
  // The VPS may be reachable by the CI HTTP client while hosted Chromium has
  // a transient proxy/DNS handshake timeout. Retry only before receiving a
  // document response, and never retry a real 4xx/5xx or a React/DOM failure.
  for(let attempt=0;attempt<2;attempt++){
    try{
      stage='HTTP navigation'
      const response=await page.goto('/',{waitUntil:'commit',timeout:16000})
      if(!response)throw new Error('Chromium received no document response')
      if(response.status()>=400)throw new Error('Chromium received HTTP '+response.status())
      stage='DOM readiness'
      await page.waitForLoadState('domcontentloaded',{timeout:14000})
      return
    }catch(error){
      lastError=error
      const transient=stage==='HTTP navigation'&&error instanceof Error&&/Timeout|net::ERR_CONNECTION|net::ERR_TIMED_OUT/i.test(error.message)
      if(!transient||attempt===1)break
      // A fresh blank page discards the cancelled navigation without changing
      // the context, headers or authentication init script for the next try.
      await page.goto('about:blank',{waitUntil:'commit',timeout:3000}).catch(()=>{})
    }
  }
  let probe='HTTP probe failed'
  try{
    const check=await request.get('/build-info.json',{timeout:8000,headers:{'Cache-Control':'no-cache'}})
    probe='Node HTTP probe: '+check.status()
  }catch(error){
    probe='Node HTTP probe error: '+(error instanceof Error?error.name:String(error))
  }
  throw new Error(
    'Live QA browser '+stage+' failed after guarded navigation; '+probe+
    '; Chromium request failures: '+(failures.join('; ')||'none observed')+
    '; original error: '+(lastError instanceof Error?lastError.message:String(lastError))
  )
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

async function checkBuildVersion(page: import('@playwright/test').Page) {
  if (await page.evaluate(()=>matchMedia('(max-width:650px)').matches)) {
    const menu=page.getByLabel('Выбрать раздел')
    await menu.click()
    await expect(page.getByLabel('Версия в меню')).toBeVisible()
    await menu.click()
  } else {
    await expect(page.getByLabel('Версия сборки')).toBeVisible()
  }
}

test('test server: navigation, viewport and deployed build revision', async ({ page, request }, testInfo) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await navigateToTestSite(page,request)
  await checkBuildVersion(page)
  // Test servers can use authenticated or open-access mode and need not contain any demo seed.
  await expect(page.getByRole('navigation', { name: 'Разделы архитектуры' })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Главная карта архитектуры' })).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('01-overview.png'), fullPage: true })

  const sections = ['Системы', 'Компоненты', 'Потоки', 'Обзор']
  for (const section of sections) {
    await switchSection(page, section)
    await checkBuildVersion(page)
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
  if(section==='Компоненты'){
    await switchSection(page,'Системы')
    await page.locator('.systemsWorkspaceActions').getByRole('button',{name:'Компоненты',exact:true}).click()
    return
  }
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
  await checkBuildVersion(page)
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
  await checkBuildVersion(page)
})
