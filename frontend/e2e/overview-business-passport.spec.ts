import {expect,test} from '@playwright/test'

test('business map opens the shared process, saves edits and lists multiple processes',async({page})=>{
  await page.setViewportSize({width:1920,height:1080})
  await page.addInitScript(()=>sessionStorage.setItem('architecture-hub:access-token:session','browser-ci-development-token'))
  const prefix='QA-WORK-PAIR-'+Date.now()
  const create=async(path:string,data:Record<string,string>)=>{
    const response=await page.request.post('http://127.0.0.1:8001/api/'+path,{data})
    expect(response.status()).toBe(201)
    return (await response.json()).id as string
  }
  const a=await create('objects',{kind:'system',name:prefix+'-A'})
  const b=await create('objects',{kind:'system',name:prefix+'-B'})
  const category=await create('business/categories',{name:prefix})
  const addProcess=async(name:string)=>{
    const process=await create('business/processes',{name,category_id:category})
    for(const system of [a,b])await create('business/system-links',{process_id:process,system_id:system,role:'supporting'})
  }
  await addProcess(prefix+'-First')
  await page.goto('/')
  const pair=page.getByRole('button',{name:new RegExp('БП · .*'+prefix+'-')})
  await pair.click()
  const dialog=page.getByRole('dialog',{name:'Паспорт бизнес-процесса'})
  await expect(dialog).toContainText(prefix+'-First')
  const bounds=await dialog.boundingBox()
  expect(bounds?.width).toBe(480)
  expect(bounds?.x).toBe(1440)
  await dialog.getByLabel('Владелец бизнес-процесса').fill('QA-WORK-Owner')
  await dialog.getByRole('button',{name:'Сохранить паспорт'}).click()
  await expect(dialog.getByRole('status')).toContainText('сохранён')
  await dialog.getByLabel('Закрыть паспорт БП').click()
  await expect(pair).toHaveAttribute('aria-pressed','true')
  await addProcess(prefix+'-Second')
  await page.reload()
  await pair.click()
  await page.getByRole('button',{name:prefix+'-First',exact:true}).click()
  await expect(dialog.getByLabel('Владелец бизнес-процесса')).toHaveValue('QA-WORK-Owner')
  await page.setViewportSize({width:390,height:844})
  await expect(dialog).toHaveCSS('width','390px')
})
