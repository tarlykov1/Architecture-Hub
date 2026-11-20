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
  const card=page.getByRole('region',{name:'Реестр технических потоков'}).locator('article').filter({hasText:original})
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
