import {test,expect} from '@playwright/test'

// A-02: an old guest-model ID must not dim every IS after authentication.
test('QA-WORK: stale focus does not dim the current architecture model',async({page})=>{
 await page.addInitScript(()=>{
  sessionStorage.setItem('architecture-hub:access-token:session','browser-ci-development-token')
 })
 const created=await page.request.post('http://127.0.0.1:8001/api/objects',{
  data:{kind:'system',name:'QA-WORK-Stale focus regression '+Date.now()}
 })
 expect(created.status(),await created.text()).toBe(201)
 const {id}=await created.json() as {id:string}
 await page.goto('/?focus=guest-system-not-in-authenticated-model')
 const map=page.getByRole('region',{name:'Главная карта архитектуры'})
 await expect(map).toBeVisible()
 const system=map.locator('.react-flow__node').filter({hasText:'QA-WORK-Stale focus regression'})
 await expect(system).toBeVisible()
 await expect(system).toHaveCSS('opacity','1')
 const nodes=map.locator('.react-flow__node').filter({has:page.locator('.homeDiagramNodeLabel')})
 // The stale query ID must not make legitimate cards look inactive.
 if(await nodes.count()>0){
  const opacity=await nodes.evaluateAll(elements=>elements.map(element=>getComputedStyle(element).opacity))
  expect(opacity.every(value=>value==='1')).toBeTruthy()
 }
 await page.goto('/?focus='+id)
 await expect(system).toBeVisible()
 await expect(system).toHaveCSS('border-top-color','rgb(37, 99, 235)')
})
