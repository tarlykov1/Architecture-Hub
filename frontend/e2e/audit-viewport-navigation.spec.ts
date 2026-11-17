import {expect,test} from '@playwright/test'

// Smoke each required viewport on an isolated, authenticated CI model.
for(const width of [390,768,1440,1920]){
 test('QA-WORK audit navigation fits viewport '+width,async({page})=>{
  await page.setViewportSize({width,height:1000})
  await page.addInitScript(()=>sessionStorage.setItem('architecture-hub:access-token:session','browser-ci-development-token'))
  await page.goto('/')
  const errors:string[]=[]
  page.on('pageerror',error=>errors.push(error.message))
  const nav=page.getByRole('navigation',{name:'Разделы архитектуры'})
  await expect(nav).toBeVisible()
  const overview=page.getByRole('region',{name:'Главная карта архитектуры'})
  await expect(overview).toBeVisible()
  const graph=overview.locator('.homeMapGraph')
  const rect=await graph.boundingBox()
  expect(rect).not.toBeNull()
  expect(rect!.width).toBeGreaterThan(200)
  expect(rect!.x).toBeGreaterThanOrEqual(-2)
  expect(rect!.x+rect!.width).toBeLessThanOrEqual(width+2)
  expect(errors).toEqual([])
 })
}
