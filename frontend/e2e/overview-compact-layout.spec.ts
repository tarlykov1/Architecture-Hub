import {expect, test, type Page} from '@playwright/test'
import {publicDemoResponse} from '../src/publicDemo'

async function expectCompact(page: Page, count: number, columns: number) {
  const canvas = page.locator('.homeMapGraph .react-flow')
  await expect(canvas.locator('.react-flow__node')).toHaveCount(count)
  await expect.poll(() => canvas.evaluate((element, columns) => {
    const pane = element.getBoundingClientRect()
    const nodes = Array.from(element.querySelectorAll<HTMLElement>('.react-flow__node'))
    const boxes = nodes.map(node => node.getBoundingClientRect())
    const left = Math.min(...boxes.map(box => box.left))
    const top = Math.min(...boxes.map(box => box.top))
    const right = Math.max(...boxes.map(box => box.right))
    const bottom = Math.max(...boxes.map(box => box.bottom))
    const valid = left >= pane.left && right <= pane.right && top >= pane.top && bottom <= pane.bottom &&
      Math.abs((left + right - pane.left - pane.right) / 2) < 3 &&
      Math.abs((top + bottom - pane.top - pane.bottom) / 2) < 3 &&
      nodes.every((node,index) => {
        const matrix = new DOMMatrix(node.style.transform)
        return matrix.e === index % columns * 340 && matrix.f === Math.floor(index / columns) * 190 &&
          boxes[index].width <= node.offsetWidth + 1 &&
          boxes.slice(index+1).every(other => other.left >= boxes[index].right || other.right <= boxes[index].left ||
            other.top >= boxes[index].bottom || other.bottom <= boxes[index].top)
      })
    return valid ? "ok" : JSON.stringify({left,right,top,bottom,pane:pane.toJSON(),nodes:nodes.map(n=>[n.dataset.id,n.style.transform])})
  },columns)).toBe("ok")
}

test('overview and logical maps fit the compact visible grid', async ({page}) => {
  const systems = Array.from({length:12}, (_,i) => ({
    id:'system-'+i, name:'QA-WORK-System '+i, kind:'system', status:'active', attributes:{}
  }))
  await page.addInitScript(() => sessionStorage.setItem('architecture-hub:access-token:session','browser-ci-development-token'))
  const data:Record<string,unknown> = {
    '/api/objects':systems,
    '/api/auth/mode':{open_access:false},
    '/api/auth/me':{role:'admin',auth_kind:'development'},
    '/api/diagrams':[{id:'saved',name:'Saved',positions:Object.fromEntries(systems.map(s=>[s.id,{x:10,y:10}]))}],
    '/api/business/categories':[{id:'area',name:'QA-WORK-Area'}],
    '/api/business/processes':[{id:'bp',name:'QA-WORK-Process',category_id:'area'},{id:'other',name:'Other'}],
    '/api/business/system-links':systems.slice(0,5).map(s=>({process_id:'bp',system_id:s.id})).concat([systems[0],systems[6]].map(s=>({process_id:'other',system_id:s.id})))
  }
  await page.route('**/api/**',route=>{
    const path = new URL(route.request().url()).pathname
    return route.fulfill({json:data[path] ?? publicDemoResponse(path)})
  })
  await page.setViewportSize({width:1920,height:1080})
  await page.goto('/')
  await expectCompact(page,12,4)
  await page.getByRole('button',{name:'QA-WORK-Area',exact:true}).click()
  await expectCompact(page,12,4)
  const outside = page.locator('[data-id="business:system-0|system-6"]')
  await expect(outside.locator('.react-flow__edge-path')).toHaveCSS('opacity','0.18')
  await expect(outside.locator('text')).toHaveCount(0)
  await page.getByLabel('Только участники').check()
  await expectCompact(page,5,3)
  await page.setViewportSize({width:390,height:844})
  await expectCompact(page,5,2)
  await page.getByLabel('Только участники').uncheck()
  await expectCompact(page,12,2)
  await page.getByRole('button',{name:'QA-WORK-Area',exact:true}).click()
  await expectCompact(page,12,2)
  await page.setViewportSize({width:1920,height:1080})
  await page.goto('/?map=logical')
  await expectCompact(page,12,4)
  await page.getByLabel('Ручная раскладка').check()
  await expect(page.locator('.react-flow__node').first()).toHaveCSS('transform','matrix(1, 0, 0, 1, 10, 10)')
  await page.getByLabel('Ручная раскладка').uncheck()
  await page.setViewportSize({width:390,height:844})
  await expectCompact(page,12,2)
  await page.locator('.react-flow__controls-fitview').click()
  await expectCompact(page,12,2)
  await page.getByRole('button',{name:'Потоки данных',exact:true}).click()
  await expectCompact(page,12,2)
  await page.getByLabel('Поиск на карте').fill('QA-WORK-System 11')
  await expectCompact(page,1,1)
})
