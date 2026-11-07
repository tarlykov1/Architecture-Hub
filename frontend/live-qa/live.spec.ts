import { test, expect } from '@playwright/test'

test('test server: public demo navigation, viewport and build revision', async ({ page }, testInfo) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('/', { waitUntil: 'domcontentloaded' })
  await expect(page.getByLabel('Версия сборки')).toBeVisible()
  await expect(page.getByText('Демонстрационный режим').first()).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('01-overview.png'), fullPage: true })

  const sections = ['Системы', 'Компоненты', 'Потоки', 'Обзор']
  for (const section of sections) {
    await page.getByRole('navigation', { name: 'Разделы архитектуры' })
      .getByRole('button', { name: section, exact: true }).click()
    await expect(page.getByLabel('Версия сборки')).toBeVisible()
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
