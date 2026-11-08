import { test, expect } from '@playwright/test'

// Isolated browser CI: runs against localhost Vite + temporary SQLite backend.
// Explicitly use demo mode to test the mobile inspector without writing data.
test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })

async function navigate(page: import('@playwright/test').Page, section: string) {
  const nav = page.getByRole('navigation', { name: 'Разделы архитектуры' })
  const selector = nav.getByLabel('Выбрать раздел')
  await expect(selector).toBeVisible()
  await selector.click()
  await nav.locator('.mobileSectionOptions').getByRole('button', { name: section, exact: true }).click()
}

test('mobile system passport does not intercept section navigation', async ({ page }) => {
  await page.goto('/')
  await navigate(page, 'Системы')
  const registry = page.getByRole('region', { name: 'Реестр информационных систем' })
  await expect(registry).toBeVisible()
  const row = registry.locator('tr').filter({ hasText: 'Демо: портал сотрудников' })
  await expect(row).toBeVisible()
  await row.getByRole('button', { name: 'Паспорт', exact: true }).click()
  const inspector = page.getByRole('complementary', { name: 'Карточка архитектурного объекта' })
  await expect(inspector).toBeVisible()

  const header = page.getByRole('banner', { name: 'Главная панель Architecture Hub' })
  const navSelector = header.getByLabel('Выбрать раздел')
  await expect(navSelector).toBeVisible()
  const headerBounds = await header.boundingBox()
  const inspectorBounds = await inspector.boundingBox()
  expect(headerBounds).not.toBeNull()
  expect(inspectorBounds).not.toBeNull()
  expect(inspectorBounds!.y, 'Inspector must start below the mobile global header').toBeGreaterThanOrEqual(headerBounds!.y + headerBounds!.height - 1)

  // Must be a real pointer click; force:true would conceal the reported regression.
  await navigate(page, 'Компоненты')
  await expect(page.getByRole('group', { name: 'Представление компонентов' })).toBeVisible()
  await navigate(page, 'Системы')
  await expect(registry).toBeVisible()
})
