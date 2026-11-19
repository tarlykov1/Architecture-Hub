import {expect,test} from '@playwright/test'

test('AH-QA-01/02: rename keeps unknown flow fields and rejects invalid ports',async({page})=>{
  await page.addInitScript(()=>sessionStorage.setItem('architecture-hub:access-token:session','browser-ci-development-token'))
  const api='http://127.0.0.1:8001'
  const create=async(path:string,data:Record<string,unknown>)=>{
    const response=await page.request.post(api+path,{data})
    expect(response.status(),await response.text()).toBe(201)
    return (await response.json()).id as string
  }
  const system=await create('/api/objects',{name:'QA-WORK-Audit19-'+Date.now(),kind:'system'})
  const source=await create('/api/infra',{system_id:system,name:'QA-WORK-source',kind:'vm'})
  const target=await create('/api/infra',{system_id:system,name:'QA-WORK-target',kind:'vm'})
  const flowId=await create('/api/flows',{
    source_id:source,target_id:target,name:'QA-WORK-FLOW-UNKNOWN',protocol:'',port:'',security:'unknown',
  })
  await page.goto('/flows?system='+system)
  const registry=page.getByRole('region',{name:'Реестр технических потоков'})
  await expect(registry).toBeVisible()
  const flowCard=registry.locator('article').filter({hasText:'QA-WORK-FLOW-UNKNOWN'})
  await flowCard.getByRole('button',{name:'Редактировать'}).click()
  const drawer=page.getByRole('dialog',{name:'Редактор потока'})
  await expect(drawer.getByRole('textbox',{name:'Протокол'})).toHaveValue('')
  await expect(drawer.getByRole('textbox',{name:'Порт'})).toHaveValue('')
  await drawer.getByRole('textbox',{name:'Название'}).fill('QA-WORK-FLOW-RENAMED')
  await drawer.getByRole('button',{name:'Сохранить',exact:true}).click()
  await expect(drawer).toHaveCount(0)

  const getFlow=async()=>{
    const response=await page.request.get(api+'/api/flows')
    expect(response.ok(),await response.text()).toBeTruthy()
    const rows=await response.json() as Array<{id:string;name:string;protocol:string;port:string;security:string}>
    return rows.find(item=>item.id===flowId)
  }
  await expect.poll(async()=>getFlow()).toMatchObject({
    name:'QA-WORK-FLOW-RENAMED',protocol:'',port:'',security:'unknown',
  })
  await page.reload()
  const renamed=registry.locator('article').filter({hasText:'QA-WORK-FLOW-RENAMED'})
  await renamed.getByRole('button',{name:'Редактировать'}).click()
  await drawer.getByRole('textbox',{name:'Порт'}).fill('70000')
  await expect(drawer.getByRole('alert')).toContainText('1 до 65535')
  await drawer.getByRole('button',{name:'Сохранить',exact:true}).click()
  await expect(drawer).toBeVisible()
  const stored=await getFlow()
  expect(stored?.name).toBe('QA-WORK-FLOW-RENAMED')
  expect(stored?.port).toBe('')
})
