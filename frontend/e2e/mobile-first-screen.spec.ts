import {expect,test} from '@playwright/test'
import {publicDemoResponse} from '../src/publicDemo'

test('mobile workspaces show the first record or canvas before scrolling',async({page})=>{
  await page.setViewportSize({width:390,height:680})
  await page.addInitScript(()=>sessionStorage.setItem('architecture-hub:access-token:session','browser-ci-development-token'))
  await page.route('**/api/**',route=>{
    const path=new URL(route.request().url()).pathname
    const data=path==='/api/auth/me'?{role:'admin',auth_kind:'development'}:publicDemoResponse(path)
    return route.fulfill({json:data})
  })
  for(const [path,content] of [
    ['/systems','.systemsTable tbody tr'],
    ['/networks','.networkTable tbody tr'],
    ['/flows?map=flows','.homeMapGraph'],
    ['/topology','.topologyCanvas'],
    ['/','.homeMapGraph'],
  ]){
    await page.goto(path)
    const first=page.locator(content).first()
    await expect(first).toBeVisible()
    const box=await first.boundingBox()
    expect(box!.y,path).toBeLessThan(340)
    expect(await page.evaluate(()=>document.documentElement.scrollWidth),path).toBeLessThanOrEqual(391)
  }
})
