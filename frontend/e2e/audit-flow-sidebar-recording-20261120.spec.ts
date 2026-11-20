import {expect,test} from '@playwright/test'

test.describe.configure({retries:0})

test('QA-WORK: video regression – existing flow and new flow are separate, dropdown labels do not duplicate endpoints',async({page})=>{
  await page.addInitScript(()=>sessionStorage.setItem('architecture-hub:access-token:session','browser-ci-development-token'))
  const api='http://127.0.0.1:8001',suffix=String(Date.now())
  const make=async(path:string,data:Record<string,unknown>)=>{
    const response=await page.request.post(api+path,{data})
    expect(response.status(),await response.text()).toBe(201)
    return (await response.json()).id as string
  }
  const system=await make('/api/objects',{name:'QA-WORK-Flow UX-'+suffix,kind:'system'})
  const from=await make('/api/infra',{name:'QA-WORK-Source-'+suffix,system_id:system,kind:'vm'})
  const to=await make('/api/infra',{name:'QA-WORK-Target-'+suffix,system_id:system,kind:'vm'})
  const alternate=await make('/api/infra',{name:'QA-WORK-Other-'+suffix,system_id:system,kind:'vm'})
  const caption='QA-WORK-Source-'+suffix+' → QA-WORK-Target-'+suffix
  const id=await make('/api/flows',{source_id:from,target_id:to,name:caption,protocol:'HTTPS',port:'443'})
  await page.goto('/flows?system='+system)
  await page.getByRole('button',{name:'Редактор потоков',exact:true}).click()
  const editor=page.getByRole('region',{name:'Редактор архитектурной схемы'})
  await editor.getByRole('button',{name:'→ Поток'}).click()

  await expect(editor.getByText('Режим: новый поток.',{exact:false})).toBeVisible()
  await expect(editor.getByRole('combobox',{name:'Откуда'})).toBeVisible()
  const list=editor.getByRole('combobox',{name:'Выбрать поток на схеме'})
  const option=list.locator('option[value="'+id+'"]')
  await expect(option).toContainText(caption)
  const label=await option.textContent()
  expect(label?.split(caption).length).toBe(2) // no repeated endpoint caption

  const search=editor.getByRole('searchbox',{name:'Поиск потоков на схеме'})
  await search.fill('no such flow')
  await expect(list.locator('option')).toHaveCount(1)
  await search.fill('QA-WORK-Source')
  await expect(list.locator('option[value="'+id+'"]')).toHaveCount(1)
  await list.selectOption(id)
  await expect(editor.getByText('Режим: редактирование существующей связи.',{exact:false})).toBeVisible()
  await expect(editor.getByRole('combobox',{name:'Откуда'})).toHaveCount(0)
  await expect(editor.getByRole('combobox',{name:'Куда'})).toHaveCount(0)
  await expect(editor.getByRole('combobox',{name:'Получатель выбранного потока'})).toHaveValue(to)
  await editor.getByRole('combobox',{name:'Получатель выбранного потока'}).selectOption(alternate)
  const action=editor.getByRole('button',{name:'Изменить подключение выбранного потока'})
  await expect(action).toBeEnabled()
  await action.click()
  await expect(editor.getByRole('button',{name:/Черновик: 1 изменений/})).toBeEnabled()
  const data=(await (await page.request.get(api+'/api/flows')).json()) as Array<{id:string;target_id:string}>
  expect(data.find(x=>x.id===id)?.target_id).toBe(to)
  await editor.getByRole('button',{name:'+ Новый поток'}).click()
  await expect(editor.getByText('Режим: новый поток.',{exact:false})).toBeVisible()
  await expect(editor.getByRole('combobox',{name:'Откуда'})).toBeVisible()
  await expect(editor.getByRole('combobox',{name:'Куда'})).toBeVisible()
})
