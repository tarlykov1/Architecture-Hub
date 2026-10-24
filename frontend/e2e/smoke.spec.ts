import { expect, test } from '@playwright/test'

test('catalog loads and saved workspace views survive reload', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Карта архитектуры' })).toBeVisible()
  await page.getByRole('button', { name: 'Системы', exact: true }).click()
  const filter = page.getByRole('textbox', { name: 'Фильтр по названию' })
  await filter.fill('ci-nonexistent-system')
  page.once('dialog', dialog => dialog.accept('CI: пустой результат'))
  await page.getByRole('button', { name: 'Сохранить вид' }).click()
  await expect(page.getByRole('combobox', { name: 'Сохранённое представление' })).toHaveValue(/.+/)
  await page.reload()
  await page.getByRole('combobox', { name: 'Сохранённое представление' }).selectOption({ label: 'CI: пустой результат' })
  await expect(page.getByRole('textbox', { name: 'Фильтр по названию' })).toHaveValue('ci-nonexistent-system')
  await page.getByRole('button', { name: 'Сбросить' }).click()
  await expect(page.getByRole('textbox', { name: 'Фильтр по названию' })).toHaveValue('')
})

test('network registry and incidents navigation do not crash', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Реестр сетей' }).click()
  await expect(page.getByRole('heading', { name: 'Реестр сетей' })).toBeVisible()
  await expect(page.getByRole('textbox', { name: 'Поиск сети' })).toBeVisible()
  await page.getByRole('button', { name: 'Инциденты', exact: true }).first().click()
  await expect(page.getByRole('heading', { name: 'Реестр инцидентов' })).toBeVisible()
})
