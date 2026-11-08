import { test, expect } from '@playwright/test'

/** Read-only authenticated checks. Never mutate shared test-server architecture data. */
test.describe('authenticated live architecture', () => {
  test.skip(!process.env.E2E_AUTH_TOKEN?.trim(), 'Requires E2E_AUTH_TOKEN in Actions secrets')

  test('token can read protected architecture collections', async ({ request }) => {
    const token = process.env.E2E_AUTH_TOKEN!.trim()
    for (const endpoint of ['/api/objects', '/api/relations', '/api/diagrams', '/api/infra', '/api/flows', '/api/networks', '/api/network-interfaces', '/api/business/categories', '/api/business/processes', '/api/business/system-links']) {
      const response = await request.get(endpoint, {
        headers: { Authorization: `Bearer ${token}` },
      })
      expect(response.status(), `${endpoint} must be accessible with E2E_AUTH_TOKEN`).toBe(200)
      const body: unknown = await response.json()
      expect(Array.isArray(body), `${endpoint} must return a collection`).toBe(true)
    }
  })

  test('browser starts in authenticated mode and stays signed in after reload', async ({ page }) => {
    const token = process.env.E2E_AUTH_TOKEN!.trim()
    await page.addInitScript((value: string) => {
      sessionStorage.setItem('architecture-hub:access-token:session', value)
    }, token)
    await page.goto('/', { waitUntil: 'domcontentloaded' })
    await expect(page.getByRole('button', { name: 'Выйти' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Войти для редактирования' })).toHaveCount(0)
    await expect(page.getByText('Демонстрационный режим').first()).toHaveCount(0)
    await page.reload()
    await expect(page.getByRole('button', { name: 'Выйти' })).toBeVisible()
  })
})
