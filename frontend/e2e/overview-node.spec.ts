import { expect, test } from '@playwright/test'

test('overview nodes open the inspector directly without redundant passport buttons', async ({ page }) => {
  await page.goto('/')
  const graph = page.getByRole('region', { name: 'Главная карта архитектуры' })
  await expect(graph).toBeVisible()
  await expect(graph.getByRole('button', { name: /Открыть паспорт ИС:/ })).toHaveCount(0)
  const node = graph.locator('.react-flow__node').first()
  await expect(node).toBeVisible()
  await node.click()
  await expect(page.getByRole('button', { name: 'Закрыть правую панель' })).toBeVisible()
})
