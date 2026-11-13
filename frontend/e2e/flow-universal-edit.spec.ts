import {expect,test} from '@playwright/test'

test('All grouped flow records can be chosen directly and one reassigned without changing its peers',async({page})=>{
  await page.addInitScript(()=>sessionStorage.setItem('architecture-hub:access-token:session','browser-ci-development-token'))
  const suffix=String(Date.now())
  const api='http://127.0.0.1:8001'
  const create=async(path:string,data:Record<string,unknown>)=>{
    const response=await page.request.post(api+path,{data})
    expect(response.status(),await response.text()).toBe(201)
    return (await response.json()).id as string
  }
  const system=await create('/api/objects',{kind:'system',name:'Flow selector QA '+suffix})
  const source=await create('/api/infra',{system_id:system,kind:'vm',name:'QA flow source '+suffix})
  const originalTarget=await create('/api/infra',{system_id:system,kind:'vm',name:'QA original target '+suffix})
  const alternative=await create('/api/infra',{system_id:system,kind:'vm',name:'QA alternative target '+suffix})
  const ids:string[]=[]
  for(let index=1;index<=3;index++){
    ids.push(await create('/api/flows',{source_id:source,target_id:originalTarget,name:'Grouped flow '+index+' '+suffix,protocol:'HTTPS',port:'443'}))
  }
  await page.goto('/flows?system='+system)
  await page.getByRole('button',{name:'Редактор потоков',exact:true}).click()
  const editor=page.getByRole('region',{name:'Редактор архитектурной схемы'})
  await editor.getByRole('button',{name:'→ Поток'}).click()
  const picker=editor.getByRole('combobox',{name:'Выбрать поток на схеме'})
  await expect(picker.locator('option')).toHaveCount(4)
  for(const id of ids){
    await picker.selectOption(id)
    await expect(picker).toHaveValue(id)
    await expect(editor.locator('.boardEndpointGrip')).toHaveCount(2)
  }
  await picker.selectOption(ids[1])
  await editor.getByRole('combobox',{name:'Получатель выбранного потока'}).selectOption(alternative)
  const reassign=editor.getByRole('button',{name:'Изменить подключение выбранного потока'})
  await expect(reassign).toBeEnabled()
  await reassign.click()
  await expect(editor.getByRole('button',{name:/Черновик: 1 изменений/})).toBeEnabled()
  await expect(editor.locator('.react-flow__edge')).toHaveCount(2)
  const persisted=await page.request.get(api+'/api/flows')
  expect(persisted.status()).toBe(200)
  const stored=await persisted.json() as Array<{id:string;source_id:string;target_id:string}>
  for(const id of ids){
    expect(stored.find(item=>item.id===id)?.target_id).toBe(originalTarget)
  }
  await picker.selectOption(ids[2])
  await expect(editor.getByRole('group',{name:'Переподключить выбранный поток'})).toContainText('Grouped flow 3')
  await expect(editor.locator('.boardEndpointGrip')).toHaveCount(2)
  // Confirm the same staged batch and verify only the chosen flow ID changed.
  await editor.getByRole('button',{name:'Сохранить изменения схемы'}).click()
  await editor.getByPlaceholder('Например: актуализация схемы ИС после изменения сети').fill('QA: move only one grouped flow to alternate VM')
  await editor.getByRole('button',{name:/Проверить изменения/}).click()
  await page.getByRole('dialog',{name:'Подтверждение изменений'}).getByRole('button',{name:'Подтвердить и записать в журнал'}).click()
  await expect.poll(async()=>{
    const response=await page.request.get(api+'/api/flows')
    const rows=await response.json() as Array<{id:string;target_id:string}>
    return ids.map(id=>rows.find(item=>item.id===id)?.target_id)
  }).toEqual([originalTarget,alternative,originalTarget])
})

