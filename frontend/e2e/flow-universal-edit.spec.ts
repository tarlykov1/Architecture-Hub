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
  await editor.getByRole('combobox',{name:'Куда',exact:true}).selectOption(alternative)
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
  // None of these changes should persist without confirming the reviewed batch.
})

test('Selecting a flow from a crowded board always exposes its endpoint controls',async({page})=>{
  await page.goto('/components?system=11111111-1111-4111-8111-111111111111')
  await page.getByRole('group',{name:'Представление компонентов'}).getByRole('button',{name:'Схема',exact:true}).click()
  await page.getByRole('button',{name:'Редактировать схему'}).click()
  const editor=page.getByRole('region',{name:'Редактор архитектурной схемы'})
  await editor.getByRole('button',{name:'→ Поток'}).click()
  const picker=editor.getByRole('combobox',{name:'Выбрать поток на схеме'})
  await expect(picker.locator('option').count()).resolves.toBeGreaterThan(1)
  await picker.selectOption({index:1})
  await expect(editor.locator('.boardEndpointGrip')).toHaveCount(2)
})
