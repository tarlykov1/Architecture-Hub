import {test,expect} from '@playwright/test'

// The 20 navigation loops must pass on the first attempt, not via runner retry.
test.describe.configure({retries:0})

for(let batch=0;batch<4;batch++)test('QA-WORK: #164 focus transitions '+(batch*5+1)+'–'+(batch*5+5)+' of 20, no retry',async({page})=>{
 await page.addInitScript(()=>{
  sessionStorage.setItem('architecture-hub:access-token:session','browser-ci-development-token')
 })
 const api='http://127.0.0.1:8001',suffix=Date.now().toString(36)
 const create=async(path:string,data:Record<string,unknown>)=>{
  const response=await page.request.post(api+path,{data})
  expect(response.status(),await response.text()).toBe(201)
  return (await response.json()).id as string
 }
 const name='QA-WORK-Focus repeat '+suffix
 const system=await create('/api/objects',{kind:'system',name})
 const source=await create('/api/infra',{kind:'vm',system_id:system,name:'QA-WORK-Source '+suffix})
 const target=await create('/api/infra',{kind:'vm',system_id:system,name:'QA-WORK-Target '+suffix})
 await create('/api/flows',{source_id:source,target_id:target,name:'QA-WORK-Repeated focus '+suffix})
 const errors:string[]=[]
 page.on('pageerror',error=>errors.push(error.message))
 for(let iteration=batch*5+1;iteration<=batch*5+5;iteration++){
  await page.goto('/')
  await page.getByRole('navigation',{name:'Разделы архитектуры'}).getByRole('button',{name:'Потоки',exact:true}).click()
  await page.getByRole('combobox',{name:'Система потоков'}).selectOption(system)
  const registry=page.getByRole('region',{name:'Реестр технических потоков'})
  await expect(registry.locator('.infraCard')).toHaveCount(1)
  // A record's «На карте» now opens that exact technical flow.
  const link=registry.getByRole('link',{name:'На карте'}).first()
  await expect(link).toHaveAttribute('href',new RegExp('^/flows\\?system='+system+'&flow='))
  // The independent overview ?focus contract must still work for repeated IS navigation.
  await page.goto('/?focus='+system)
  const map=page.getByRole('region',{name:'Главная карта архитектуры'})
  await expect(map).toBeVisible()
  const node=map.locator('.react-flow__node').filter({hasText:name})
  await expect(node, 'Iteration '+iteration+' must render selected IS').toBeVisible()
  await expect(node).toHaveCSS('border-top-color','rgb(37, 99, 235)')
  const rect=await node.boundingBox()
  const canvas=await map.locator('.homeMapGraph').boundingBox()
  expect(rect,'Iteration '+iteration+' selected IS has bounds').not.toBeNull()
  expect(canvas,'Iteration '+iteration+' canvas has bounds').not.toBeNull()
  expect(rect!.x).toBeGreaterThanOrEqual(canvas!.x-2)
  expect(rect!.x+rect!.width).toBeLessThanOrEqual(canvas!.x+canvas!.width+2)
  expect(rect!.y).toBeGreaterThanOrEqual(canvas!.y-2)
  expect(rect!.y+rect!.height).toBeLessThanOrEqual(canvas!.y+canvas!.height+2)
 }
 expect(errors).toEqual([])
})
