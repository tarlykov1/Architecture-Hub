import {expect,test} from '@playwright/test'

test.describe.configure({retries:0})

test('QA-WORK: async area catalog exposes user-selected membership and process passports',async({page})=>{
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
  const partnerName='QA-WORK-LATE-PARTNER-'+suffix
  const partner=await create('/api/objects',{kind:'system',name:partnerName})
  await create('/api/business/system-links',{process_id:process,system_id:partner,role:'supporting'})
  let releaseCategories!:()=>void
  const categoryGate=new Promise<void>(resolve=>{releaseCategories=resolve})
  await page.route('**/api/business/categories',async route=>{
    if(route.request().method()==='GET')await categoryGate
    await route.continue()
  })
  await page.goto('/',{waitUntil:'domcontentloaded'})
  const map=page.getByRole('region',{name:'Главная карта архитектуры'})
  const toggle=map.getByRole('button',{name:'QA-WORK-LATE-GROUP-'+suffix,exact:true})
  await expect(toggle).toHaveCount(0)
  releaseCategories()
  await expect(toggle).toHaveAttribute('aria-pressed','false')
  await toggle.click()
  await expect(map.locator('.react-flow__node[data-id="'+sys+'"] .systemAreaLabel')).toHaveText('QA-WORK-LATE-GROUP-'+suffix)
  const context=map.getByRole('region',{name:'Связанные бизнес-процессы'})
  await context.getByRole('button',{name:'QA-WORK-LATE-PROCESS-'+suffix}).click()
  const passport=page.getByRole('dialog',{name:'Паспорт бизнес-процесса'})
  await expect(passport).toContainText('QA-WORK-LATE-PROCESS-'+suffix)
  await passport.getByRole('button',{name:'Закрыть паспорт БП'}).click()
  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-pressed','false')
  await map.getByRole('button',{name:'Бизнес-связи',exact:true}).click()
  await map.getByText('Фильтры и слои',{exact:true}).click()
  await map.getByLabel('Фокус на ИС').selectOption(sys)
  await expect(map.locator('.react-flow__node').filter({hasText:partnerName})).toBeVisible()
  await expect(context.getByRole('button',{name:'QA-WORK-LATE-PROCESS-'+suffix})).toBeVisible()
  // Explicit deselection must not be reverted by the async initial-selection effect.
  await expect(toggle).toHaveAttribute('aria-pressed','false')
})
