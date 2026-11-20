import {expect,test} from '@playwright/test'

test.describe.configure({retries:0})

test('AH-QA-14: search is independent in Flows, Business, Systems and Components',async({page})=>{
  await page.addInitScript(()=>sessionStorage.setItem('architecture-hub:access-token:session','browser-ci-development-token'))
  const api='http://127.0.0.1:8001'
  const suffix=String(Date.now())
  const create=async(path:string,data:Record<string,unknown>)=>{
    const response=await page.request.post(api+path,{data})
    expect(response.status(),await response.text()).toBe(201)
    return (await response.json()).id as string
  }
  const system=await create('/api/objects',{name:'QA-WORK-Filter-System-'+suffix,kind:'system'})
  const a=await create('/api/infra',{system_id:system,name:'QA-WORK-Filter-A',kind:'vm'})
  const b=await create('/api/infra',{system_id:system,name:'QA-WORK-Filter-B',kind:'vm'})
  const flowName='QA-WORK-Filter-Flow-'+suffix
  await create('/api/flows',{source_id:a,target_id:b,name:flowName})
  const category=await create('/api/business/categories',{name:'QA-WORK-Filter-Category-'+suffix})
  const processName='QA-WORK-Filter-BP-'+suffix
  await create('/api/business/processes',{category_id:category,name:processName})

  await page.goto('/flows')
  const nav=page.getByRole('navigation',{name:'Разделы архитектуры'})
  const search=page.getByRole('textbox',{name:'Фильтр по названию'})
  await expect(search).toBeVisible()
  await search.fill(flowName)
  await expect(page.getByRole('region',{name:'Реестр технических потоков'})).toContainText(flowName)

  await nav.getByLabel('Другие разделы').click()
  await nav.getByRole('button',{name:'Бизнес-процессы',exact:true}).click()
  await expect(search).toHaveValue('')
  await expect(page.getByText(processName,{exact:true})).toBeVisible()
  await search.fill('QA-WORK-no-such-process-'+suffix)
  await expect(page.getByRole('status').filter({hasText:'Нет бизнес-процессов по фильтру'})).toBeVisible()
  await page.getByRole('button',{name:'Сбросить поиск'}).click()
  await expect(search).toHaveValue('')
  await expect(page.getByText(processName,{exact:true})).toBeVisible()

  await nav.getByRole('button',{name:'Потоки',exact:true}).click()
  await expect(search).toHaveValue(flowName)
  await expect(page.getByRole('region',{name:'Реестр технических потоков'})).toContainText(flowName)

  await nav.getByRole('button',{name:'Системы',exact:true}).click()
  await expect(search).toHaveValue('')
  await expect(page.getByRole('button',{name:'QA-WORK-Filter-System-'+suffix,exact:true})).toBeVisible()
  await search.fill('QA-WORK-Filter-System-'+suffix)
  await nav.getByRole('button',{name:'Компоненты',exact:true}).click()
  await expect(search).toHaveValue('')
  await nav.getByRole('button',{name:'Системы',exact:true}).click()
  await expect(search).toHaveValue('QA-WORK-Filter-System-'+suffix)
})
