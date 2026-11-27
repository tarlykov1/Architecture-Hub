import {expect,test} from '@playwright/test'

test.describe.configure({retries:0})

test('AH-QA-08: Escape, close and backdrop do not silently discard edited flow',async({page})=>{
  await page.addInitScript(()=>sessionStorage.setItem('architecture-hub:access-token:session','browser-ci-development-token'))
  const api='http://127.0.0.1:8001',suffix=String(Date.now())
  const create=async(path:string,data:Record<string,unknown>)=>{
    const response=await page.request.post(api+path,{data})
    expect(response.status(),await response.text()).toBe(201)
    return (await response.json()).id as string
  }
  const system=await create('/api/objects',{name:'QA-WORK-ESC-'+suffix,kind:'system'})
  const source=await create('/api/infra',{system_id:system,name:'QA-WORK-ESC-Source',kind:'vm'})
  const target=await create('/api/infra',{system_id:system,name:'QA-WORK-ESC-Target',kind:'vm'})
  const original='QA-WORK-ESC-Flow-'+suffix
  const flowId=await create('/api/flows',{source_id:source,target_id:target,name:original,protocol:'HTTPS',port:'443'})
  await page.goto('/flows?system='+system)
  const registry=page.getByRole('region',{name:'Реестр технических потоков'})
  await registry.getByRole('button',{name:original,exact:true}).click()
  const card=registry.getByRole('complementary',{name:'Карточка: '+original})
  await card.getByRole('button',{name:'Редактировать'}).click()
  const editor=page.getByRole('dialog',{name:'Редактор потока'})
  const title=editor.getByRole('textbox',{name:'Название'})
  await expect(title).toHaveValue(original)
  await title.fill(original+' edited')
  let prompts=0
  page.once('dialog',async dialog=>{prompts++;expect(dialog.message()).toContain('несохранённые изменения');await dialog.dismiss()})
  await title.press('Escape')
  await expect(editor).toBeVisible()
  await expect(title).toHaveValue(original+' edited')
  expect(prompts).toBe(1)

  page.once('dialog',async dialog=>{prompts++;await dialog.dismiss()})
  await editor.getByRole('button',{name:'Закрыть ×'}).click()
  await expect(editor).toBeVisible()
  expect(prompts).toBe(2)

  page.once('dialog',async dialog=>{prompts++;await dialog.accept()})
  await page.locator('.editorBackdrop').last().click({position:{x:5,y:5}})
  await expect(editor).toHaveCount(0)
  expect(prompts).toBe(3)
  const saved=(await (await page.request.get(api+'/api/flows')).json()) as Array<{id:string;name:string}>
  expect(saved.find(row=>row.id===flowId)?.name).toBe(original)

  // Closing an unchanged form must not prompt.
  await card.getByRole('button',{name:'Редактировать'}).click()
  await expect(editor).toBeVisible()
  await editor.getByRole('button',{name:'Закрыть ×'}).click()
  await expect(editor).toHaveCount(0)
})

test('QA-WORK: continuous and scheduled exchanges share endpoints and retain separate contracts', async ({page,request})=>{
  await page.addInitScript(()=>sessionStorage.setItem('architecture-hub:access-token:session','browser-ci-development-token'))
  const api='http://127.0.0.1:8001/api', suffix=crypto.randomUUID()
  async function create(path:string,data:object){
    const response=await request.post(api+path,{data})
    expect(response.status(),await response.text()).toBe(201)
    return (await response.json()).id as string
  }
  const system=await create('/objects',{kind:'system',name:'QA-WORK-Parallel-'+suffix})
  const source=await create('/infra',{system_id:system,kind:'vm',name:'QA-WORK-Source'})
  const target=await create('/infra',{system_id:system,kind:'vm',name:'QA-WORK-Target'})
  const original='QA-WORK-Events-'+suffix, nightly='QA-WORK-Nightly-'+suffix
  await create('/flows',{source_id:source,target_id:target,name:original,schedule:'Постоянно',data_description:'События'})
  await page.goto('/flows?system='+system)
  const registry=page.getByRole('region',{name:'Реестр технических потоков'})
  await registry.getByRole('button',{name:original,exact:true}).click()
  const card=registry.getByRole('complementary',{name:'Карточка: '+original})
  await card.getByRole('button',{name:'Добавить обмен между этими компонентами'}).click()
  const form=page.getByRole('dialog',{name:'Редактор потока'})
  await expect(form.getByRole('combobox',{name:'Источник',exact:true})).toHaveValue(source)
  await expect(form.getByRole('combobox',{name:'Получатель',exact:true})).toHaveValue(target)
  await form.getByLabel('Название',{exact:true}).fill(nightly)
  await form.getByLabel('Состав данных').fill('Итоги сверки')
  await form.getByLabel('Условие запуска и периодичность').fill('После закрытия дня, в 02:00 МСК')
  await form.getByRole('button',{name:'Сохранить',exact:true}).click()
  await expect(form).toHaveCount(0)
  await page.reload()
  await registry.getByRole('button',{name:nightly,exact:true}).click()
  await expect(registry.getByRole('complementary',{name:'Карточка: '+nightly})).toContainText('После закрытия дня, в 02:00 МСК')
  await registry.getByRole('button',{name:original,exact:true}).click()
  await expect(card).toContainText('Постоянно')
  await expect(card).toContainText('События')
})
