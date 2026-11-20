import {expect, test} from '@playwright/test'
import {publicDemoResponse} from '../src/publicDemo'

for (const width of [390, 1440]) {
  test(`overview flow popover and registry drawer at ${width}px`, async ({page}) => {
    await page.setViewportSize({width, height: 900})
    await page.addInitScript(() => sessionStorage.setItem('architecture-hub:access-token:session','browser-ci-development-token'))
    const items = publicDemoResponse('/api/infra') as {id:string}[]
    const sample = publicDemoResponse('/api/flows') as {id:string; target_id:string}[]
    await page.route('**/api/**', route => {
      const path = new URL(route.request().url()).pathname
      if (path === '/api/auth/mode') return route.fulfill({json:{open_access:false}})
      if (path === '/api/auth/me') return route.fulfill({json:{role:'admin',auth_kind:'development'}})
      if (path === '/api/flows') return route.fulfill({json:[{...sample[0],target_id:items[2].id}]})
      return route.fulfill({json:publicDemoResponse(path)})
    })
    await page.goto('/')
    await expect(page.locator('.globalHeader')).toHaveCSS('background-color', 'rgb(255, 255, 255)')
    await page.getByRole('button', {name: 'Потоки данных', exact: true}).click()
    const counter = page.locator('.overviewEdgeControl button').first()
    await counter.click()
    await expect(page.locator('.overviewFlowList a').first()).toHaveAttribute('href', /\/flows\?flow=/)
    await page.keyboard.press('Escape')
    await expect(counter).toBeFocused()
    await expect(page.locator('.overviewFlowList')).toHaveCount(0)
    const graph = await page.locator('.homeMapGraph').boundingBox()
    expect(graph!.width).toBeGreaterThan(width * .85)
    expect(graph!.height).toBeGreaterThan(400)
    await page.goto('/systems')
    await page.locator('.systemNameLink').first().click()
    await expect(page.locator('aside.details')).toBeVisible()
    await expect(page.locator('tr.inspectedRow')).toHaveCount(1)
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width+2)
  })
}
