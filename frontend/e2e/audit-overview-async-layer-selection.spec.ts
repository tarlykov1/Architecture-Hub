import {expect,test} from '@playwright/test'

test.describe.configure({retries:0})

test('QA-WORK: business area enabled before async catalogs load selects the first available group',async({page})=>{
  await page.addInitScript(()=>sessionStorage.setItem('architecture-hub:access-token:session','browser-ci-development-token'))
  const api='http://127.0.0.1:8001',suffix=String(Date.now())
  const create=async(path:string,data:Record<string,unknown>)=>{
    const response=await page.request.post(api+path,{data})
    expect(response.status(),await response.text()).toBe(201)
    return (await response.json()).id as string
  }
  const sys=await create('/api/objects',{kind:'system',name:'QA-WORK-LATE-GROUP-SYS-'+suffix})
  const category=await create('/api/business/categories',{name:'QA-WORK-LATE-GROUP-'+suffix})
  const process=await create('/api/business/processes',{category_id:category,name:'QA-WORK-LATE-PROCESS-'+suffix})
  await create('/api/business/system-links',{process_id:process,system_id:sys,role:'supporting'})
  let releaseCategories!:()=>void
  const categoryGate=new Promise<void>(resolve=>{releaseCategories=resolve})
  await page.route('**/api/business/categories',async route=>{
    if(route.request().method()==='GET')await categoryGate
    await route.continue()
  })
  await page.goto('/',{waitUntil:'domcontentloaded'})
  const map=page.getByRole('region',{name:'Главная карта архитектуры'})
  const toggle=map.getByRole('checkbox',{name:'Показать бизнес-области'})
  await toggle.check()
  const info=map.getByRole('status').filter({hasText:'Показана бизнес-область:'})
  await expect(info).toHaveCount(0)
  releaseCategories()
  // Other tests can seed categories into the same isolated CI database.
  // Initial selection must exist, but need not be our newly created category.
  await expect(info).toContainText('Показана бизнес-область:')
  await expect(map.locator('.react-flow__node-layerRegion')).toHaveCount(1)
  await map.getByText('Выбрать бизнес-область').click()
  await map.getByRole('button',{name:'QA-WORK-LATE-GROUP-'+suffix}).click()
  await expect(info).toContainText('QA-WORK-LATE-GROUP-'+suffix)
  const clear=map.getByRole('button',{name:'Снять выделение'})
  await clear.click()
  await expect(info).toHaveCount(0)
  await expect(toggle).toBeChecked()
  // Explicit deselection must not be reverted by the async initial-selection effect.
  await expect(info).toHaveCount(0)
})
