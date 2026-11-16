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
  const system=await create('/api/objects',{kind:'system',name:'QA-WORK-Flow selector '+suffix})
  const source=await create('/api/infra',{system_id:system,kind:'vm',name:'QA-WORK-flow source '+suffix})
  const originalTarget=await create('/api/infra',{system_id:system,kind:'vm',name:'QA-WORK-original target '+suffix})
  const alternative=await create('/api/infra',{system_id:system,kind:'vm',name:'QA-WORK-alternative target '+suffix})
  const ids:string[]=[]
  for(let index=1;index<=3;index++){
    ids.push(await create('/api/flows',{source_id:source,target_id:originalTarget,name:'QA-WORK-Grouped flow '+index+' '+suffix,protocol:'HTTPS',port:'443'}))
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
  await expect(editor.getByRole('group',{name:'Переподключить выбранный поток'})).toContainText('QA-WORK-Grouped flow 3')
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



test('QA-WORK: cancel a right-side reassignment without changing the flow or its peers',async({page})=>{
  await page.addInitScript(()=>sessionStorage.setItem('architecture-hub:access-token:session','browser-ci-development-token'))
  const api='http://127.0.0.1:8001',suffix=String(Date.now())
  const create=async(path:string,data:Record<string,unknown>)=>{
    const result=await page.request.post(api+path,{data})
    expect(result.status(),await result.text()).toBe(201)
    return (await result.json()).id as string
  }
  const system=await create('/api/objects',{name:'QA-WORK-Cancel '+suffix,kind:'system'})
  const source=await create('/api/infra',{system_id:system,name:'QA-WORK-Cancel source',kind:'vm'})
  const target=await create('/api/infra',{system_id:system,name:'QA-WORK-Cancel target',kind:'vm'})
  const alternative=await create('/api/infra',{system_id:system,name:'QA-WORK-Cancel alternative',kind:'vm'})
  const first=await create('/api/flows',{source_id:source,target_id:target,name:'QA-WORK-Cancel first'})
  const peer=await create('/api/flows',{source_id:source,target_id:target,name:'QA-WORK-Cancel peer'})
  await page.goto('/flows?system='+system)
  await page.getByRole('button',{name:'Редактор потоков',exact:true}).click()
  const editor=page.getByRole('region',{name:'Редактор архитектурной схемы'})
  await editor.getByRole('button',{name:'→ Поток'}).click()
  await editor.getByRole('combobox',{name:'Выбрать поток на схеме'}).selectOption(first)
  await editor.getByRole('combobox',{name:'Получатель выбранного потока'}).selectOption(alternative)
  await editor.getByRole('button',{name:'Изменить подключение выбранного потока'}).click()
  await expect(editor.getByRole('button',{name:/Черновик: 1 изменений/})).toBeEnabled()
  await editor.getByRole('button',{name:'Отменить правку потока'}).click()
  await expect(editor.getByRole('button',{name:'Черновик: 0 изменений'})).toBeDisabled()
  await expect(editor.getByRole('button',{name:'Сохранить расположение'})).toBeDisabled()
  const response=await page.request.get(api+'/api/flows')
  const data=await response.json() as Array<{id:string;source_id:string;target_id:string}>
  for(const id of [first,peer]){
    expect(data.find(flow=>flow.id===id)).toMatchObject({id,source_id:source,target_id:target})
  }
})

test('QA-WORK: dragging a selected endpoint commits one flow ID and is audited',async({page})=>{
  await page.addInitScript(()=>sessionStorage.setItem('architecture-hub:access-token:session','browser-ci-development-token'))
  const api='http://127.0.0.1:8001',suffix=String(Date.now())
  const create=async(path:string,data:Record<string,unknown>)=>{
    const result=await page.request.post(api+path,{data})
    expect(result.status(),await result.text()).toBe(201)
    return (await result.json()).id as string
  }
  const system=await create('/api/objects',{name:'QA-WORK-DragFlow '+suffix,kind:'system'})
  const source=await create('/api/infra',{system_id:system,name:'QA-WORK-Drag source',kind:'vm'})
  const target=await create('/api/infra',{system_id:system,name:'QA-WORK-Drag old target',kind:'vm'})
  const alternative=await create('/api/infra',{system_id:system,name:'QA-WORK-Drag new target',kind:'vm'})
  const selected=await create('/api/flows',{source_id:source,target_id:target,name:'QA-WORK-Drag selected'})
  const untouched=await create('/api/flows',{source_id:source,target_id:target,name:'QA-WORK-Drag untouched'})
  await page.goto('/flows?system='+system)
  await page.getByRole('button',{name:'Редактор потоков',exact:true}).click()
  const editor=page.getByRole('region',{name:'Редактор архитектурной схемы'})
  await editor.getByRole('button',{name:'→ Поток'}).click()
  await editor.getByRole('combobox',{name:'Выбрать поток на схеме'}).selectOption(selected)
  const endpoint=editor.locator('.boardEndpointGrip[data-flow-end="target"]')
  const recipient=editor.locator('.react-flow__node-boardComponent').filter({hasText:'QA-WORK-Drag new target'})
  await expect(endpoint).toBeVisible()
  await expect(recipient).toBeVisible()
  const grip=await endpoint.boundingBox(),box=await recipient.boundingBox()
  expect(grip&&box).toBeTruthy()
  await page.mouse.move(grip!.x+grip!.width/2,grip!.y+grip!.height/2)
  await page.mouse.down()
  await page.mouse.move(box!.x+box!.width/2,box!.y+box!.height/2,{steps:12})
  await page.mouse.up()
  await expect(editor.getByRole('button',{name:/Черновик: 1 изменений/})).toBeEnabled()
  // Staging must not modify database before approval.
  let rows=await (await page.request.get(api+'/api/flows')).json() as Array<{id:string;target_id:string}>
  expect(rows.find(flow=>flow.id===selected)?.target_id).toBe(target)
  await editor.getByRole('button',{name:'Сохранить изменения схемы'}).click()
  await editor.getByPlaceholder('Например: актуализация схемы ИС после изменения сети').fill('QA-WORK: reattach one endpoint with mouse')
  await editor.getByRole('button',{name:/Проверить изменения/}).click()
  await page.getByRole('dialog',{name:'Подтверждение изменений'}).getByRole('button',{name:'Подтвердить и записать в журнал'}).click()
  await expect.poll(async()=>{
    rows=await (await page.request.get(api+'/api/flows')).json() as Array<{id:string;target_id:string}>
    return [rows.find(flow=>flow.id===selected)?.target_id,rows.find(flow=>flow.id===untouched)?.target_id]
  }).toEqual([alternative,target])
  const audit=(await (await page.request.get(api+'/api/board/audit?limit=100')).json()) as Array<{reason:string;changes:Array<{id:string;action:string}>}>
  expect(audit.some(record=>record.changes.some(change=>change.action==='update_flow'&&change.id===selected))).toBe(true)
})
