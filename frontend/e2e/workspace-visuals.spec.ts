import {expect, test} from '@playwright/test'
import {publicDemoResponse} from '../src/publicDemo'

for (const width of [390, 1440]) {
  test(`overview flow popover and registry drawer at ${width}px`, async ({page}) => {
    await page.setViewportSize({width, height: 900})
    await page.addInitScript(() => sessionStorage.setItem('architecture-hub:access-token:session','browser-ci-development-token'))
    const items = publicDemoResponse('/api/infra') as {id:string}[]
    const sample = publicDemoResponse('/api/flows') as {id:string; target_id:string}[]
    const systems = publicDemoResponse('/api/objects') as {id:string;name:string}[]
    const areas = ['A','B'].map(id=>({id,name:'QA-WORK-Area '+id}))
    await page.route('**/api/**', route => {
      const path = new URL(route.request().url()).pathname
      if (path === '/api/auth/mode') return route.fulfill({json:{open_access:false}})
      if (path === '/api/auth/me') return route.fulfill({json:{role:'admin',auth_kind:'development'}})
      if (path === '/api/business/categories') return route.fulfill({json:areas})
      if (path === '/api/business/processes') return route.fulfill({json:areas.map(area=>({id:area.id,name:area.name+' BP',category_id:area.id}))})
      if (path === '/api/business/system-links') return route.fulfill({json:areas.map(area=>({process_id:area.id,system_id:systems[0].id}))})
      if (path === '/api/flows') return route.fulfill({json:[{...sample[0],target_id:items[2].id}]})
      return route.fulfill({json:publicDemoResponse(path)})
    })
    await page.goto('/')
    await expect(page.locator('.globalHeader')).toHaveCSS('background-color', 'rgb(255, 255, 255)')
    await page.getByRole('button', {name: 'Потоки данных', exact: true}).click()
    const counter = page.locator('.overviewEdgeControl button').first()
    const member=page.locator('.react-flow__node[data-id="'+systems[0].id+'"]')
    const other=page.locator('.react-flow__node[data-id="'+systems[1].id+'"]')
    const area=(id:string)=>page.getByRole('button',{name:'QA-WORK-Area '+id,exact:true})
    const inspector=page.locator('aside.details')
    if(width===1440){
      await other.click()
      await expect(inspector).toBeVisible()
    }
    await area('A').click()
    await expect(inspector).toHaveCount(0)
    await expect(other).toHaveAttribute('aria-disabled','true')
    await expect(other).not.toHaveAttribute('tabindex','0')
    await other.click({force:true})
    await expect(inspector).toHaveCount(0)
    await member.click()
    await expect(inspector).toBeVisible()
    await inspector.getByRole('button',{name:/Закрыть/}).first().click()

    const search=page.getByRole('textbox',{name:'Поиск на карте'})
    await search.fill(systems[1].name)
    const results=page.getByRole('region',{name:'Результаты поиска по архитектуре'})
    for(const action of ['Выбрать','Паспорт','Компоненты']){
      await expect(results.getByRole('button',{name:new RegExp(action==='Паспорт'?'Открыть паспорт':action,'i')})).toBeDisabled()
    }
    await search.fill('')
    const filters=page.getByText('Фильтры и слои',{exact:true})
    await filters.click()
    await expect(page.getByLabel('Фокус на ИС').locator('option').filter({hasText:systems[1].name})).toBeDisabled()
    await filters.click()
    await expect(member).not.toHaveCSS('box-shadow','none')
    const stripes=member.locator('.systemAreaStripes > span')
    const dots=member.locator('.systemAreaLabel i')
    await expect(stripes).toHaveCount(1)
    await expect(member).toHaveCSS('background-color','rgb(237, 237, 237)')
    await expect(other).toHaveCSS('opacity','0.35')
    await expect(counter).toHaveCSS('opacity','0.35')
    await area('B').click()
    await expect(stripes).toHaveCount(2)
    await expect(dots).toHaveCount(2)
    for(const index of [0,1]){
      const color=await dots.nth(index).evaluate(dot=>getComputedStyle(dot).backgroundColor)
      await expect(stripes.nth(index)).toHaveCSS('background-color',color)
      await expect(stripes.nth(index)).toBeVisible()
    }
    await expect(member).toHaveCSS('background-color','rgb(237, 237, 237)')
    await page.getByLabel('Только участники').check()
    await expect(other).toHaveCount(0)
    await expect(member).not.toHaveCSS('box-shadow','none')
    await page.getByRole('button',{name:'Сбросить фильтры'}).click()
    await expect(stripes).toHaveCount(0)
    await expect(other).toHaveCSS('opacity','1')
    await expect(other).toHaveAttribute('aria-disabled','false')
    await expect(member).toHaveCSS('background-color','rgb(255, 255, 255)')
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
