import {expect,test} from '@playwright/test'

test.describe.configure({retries:0})
const api='http://127.0.0.1:8001'

async function create(page:import('@playwright/test').Page,path:string,data:Record<string,unknown>){
  const response=await page.request.post(api+path,{data})
  expect(response.status(),await response.text()).toBe(201)
  return (await response.json()).id as string
}

test('AH-QA-03: registry link opens the exact technical flow with its endpoints, including after reload',async({page})=>{
  await page.addInitScript(()=>sessionStorage.setItem('architecture-hub:access-token:session','browser-ci-development-token'))
  const suffix=String(Date.now())
  const system=await create(page,'/api/objects',{name:'QA-WORK-MAP-'+suffix,kind:'system'})
  const source=await create(page,'/api/infra',{system_id:system,name:'QA-WORK-SOURCE-'+suffix,kind:'vm'})
  const target=await create(page,'/api/infra',{system_id:system,name:'QA-WORK-TARGET-'+suffix,kind:'vm'})
  const other=await create(page,'/api/infra',{system_id:system,name:'QA-WORK-OTHER-'+suffix,kind:'vm'})
  const selected=await create(page,'/api/flows',{source_id:source,target_id:target,name:'QA-WORK-SELECTED-'+suffix,protocol:'',port:''})
  await create(page,'/api/flows',{source_id:source,target_id:target,name:'QA-WORK-PARALLEL-'+suffix})
  await create(page,'/api/flows',{source_id:source,target_id:other,name:'QA-WORK-OTHER-FLOW-'+suffix})

  await page.goto('/flows?system='+system)
  const registry=page.getByRole('region',{name:'Реестр технических потоков'})
  await expect(registry).toBeVisible()
  await registry.getByRole('button',{name:'QA-WORK-SELECTED-'+suffix,exact:true}).click()
  await registry.getByRole('link',{name:'На карте'}).click()
  await expect(page).toHaveURL(new RegExp('/flows\\?system='+system+'&flow='+selected+'$'))
  const selectedBanner=page.getByRole('status',{name:'Выбранный технический поток'})
  await expect(selectedBanner).toContainText('QA-WORK-SELECTED-'+suffix)
  await expect(selectedBanner).toContainText('QA-WORK-SOURCE-'+suffix+' → QA-WORK-TARGET-'+suffix)
  const diagram=page.getByRole('region',{name:'Схема потоков'})
  await expect(diagram).toBeVisible()
  await expect(diagram.locator('.react-flow__node')).toHaveCount(2)
  await expect(diagram.locator('.react-flow__edge')).toHaveCount(1)
  await expect(diagram).toContainText('QA-WORK-SELECTED-'+suffix)

  await page.reload()
  await expect(selectedBanner).toContainText('QA-WORK-SELECTED-'+suffix)
  await expect(diagram.locator('.react-flow__edge')).toHaveCount(1)
  await selectedBanner.getByRole('button',{name:'Показать все потоки'}).click()
  await expect(page).toHaveURL(new RegExp('/flows\\?system='+system+'$'))
  await expect(diagram.locator('.react-flow__node')).toHaveCount(3)
  await expect(diagram.locator('.react-flow__edge')).toHaveCount(2)
  await expect(selectedBanner).toHaveCount(0)
})

test('AH-QA-03: a parallel flow deep link does not silently select its peer',async({page})=>{
  await page.addInitScript(()=>sessionStorage.setItem('architecture-hub:access-token:session','browser-ci-development-token'))
  const suffix=String(Date.now())
  const system=await create(page,'/api/objects',{name:'QA-WORK-PARALLEL-'+suffix,kind:'system'})
  const source=await create(page,'/api/infra',{system_id:system,name:'QA-WORK-VM-A',kind:'vm'})
  const target=await create(page,'/api/infra',{system_id:system,name:'QA-WORK-VM-B',kind:'vm'})
  await create(page,'/api/flows',{source_id:source,target_id:target,name:'QA-WORK-FIRST-'+suffix})
  const second=await create(page,'/api/flows',{source_id:source,target_id:target,name:'QA-WORK-SECOND-'+suffix})
  await page.goto('/flows?system='+system+'&flow='+second)
  const context=page.getByRole('status',{name:'Выбранный технический поток'})
  await expect(context).toContainText('QA-WORK-SECOND-'+suffix)
  await expect(context).not.toContainText('QA-WORK-FIRST-'+suffix)
  await expect(page.getByRole('region',{name:'Схема потоков'}).locator('.react-flow__edge')).toHaveCount(1)
})
