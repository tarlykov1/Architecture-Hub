import {test,expect, type Page, type APIRequestContext} from '@playwright/test'

const api='http://127.0.0.1:8001/api'
type Vm={id:string;system_id:string;kind:string;name:string;x:number;y:number;description?:string;environment?:string}
type Flow={id:string;name:string;source_id:string;target_id:string;protocol:string;port:string;security?:string;data_description?:string;schedule?:string;verification?:string}
type Decision={id:string;revision:number;title:string;proposed_vms:Vm[];proposed_flows:Flow[]}
async function build(request:APIRequestContext, name:string,withFlow=false){
  const title='QA-WORK-'+name+'-'+Date.now()+'-'+Math.random().toString(36).slice(2,7)
  const system=await request.post(api+'/objects',{data:{kind:'system',name:title}})
  expect(system.status()).toBe(201)
  const systemId=(await system.json()).id as string
  const live=await request.post(api+'/infra',{data:{kind:'vm',name:'QA-WORK-Live',system_id:systemId}})
  expect(live.status()).toBe(201)
  const liveId=(await live.json()).id as string
  const decision=await request.post(api+'/technical-decisions',{data:{title,system_id:systemId}})
  expect(decision.status()).toBe(201)
  const original=await decision.json() as Decision
  const vm:Vm={id:crypto.randomUUID(),name:'QA-WORK-Proposed',kind:'vm',system_id:systemId,x:305,y:140}
  const flow:Flow={id:crypto.randomUUID(),name:'QA-WORK-ExistingDraft',source_id:liveId,target_id:vm.id,protocol:'HTTPS',port:'443'}
  const url=api+'/technical-decisions/'+original.id
  const saved=await request.put(url,{data:{
    title,expected_revision:original.revision,proposed_vms:[vm],proposed_flows:withFlow?[flow]:[]
  }})
  expect(saved.status(),await saved.text()).toBe(200)
  return {title,url,vm,liveId,flow}
}
async function open(page:Page,title:string){
  await page.addInitScript(()=>sessionStorage.setItem('architecture-hub:access-token:session','browser-ci-development-token'))
  await page.goto('/decisions')
  await page.getByRole('button',{name:title,exact:true}).click()
  await page.getByRole('button',{name:'Открыть схему'}).click()
}

test('QA-WORK: VM passport editing, project-only undo/redo and reload',async({page,request})=>{
  const {title,url,vm}=await build(request,'VMPassport',true)
  await open(page,title)
  const node=page.locator(`.decisionCanvas .react-flow__node[data-id="${vm.id}"]`)
  await node.click()
  const passport=page.getByRole('region',{name:'Паспорт выбранной ВМ'})
  await expect(passport).toBeVisible()
  await passport.getByRole('textbox',{name:'Имя проектируемой ВМ'}).fill('QA-WORK-EditedVM')
  await passport.getByRole('combobox',{name:'Тип проектируемой ВМ'}).selectOption('server')
  await passport.getByRole('textbox',{name:'Среда проектируемой ВМ'}).fill('test')
  await passport.getByRole('textbox',{name:'Описание проектируемой ВМ'}).fill('New API service')
  await passport.getByRole('button',{name:'Сохранить свойства ВМ'}).click()
  await expect.poll(async()=>{
    const data=await (await request.get(url)).json() as Decision
    return data.proposed_vms[0].name
  }).toBe('QA-WORK-EditedVM')
  let data=await (await request.get(url)).json() as Decision
  expect(data.proposed_vms[0]).toMatchObject({kind:'server',environment:'test',description:'New API service'})
  expect(data.proposed_flows).toHaveLength(1)
  const undo=page.getByRole('button',{name:'Отменить изменение черновика'})
  const redo=page.getByRole('button',{name:'Повторить изменение черновика'})
  await expect(undo).toBeEnabled()
  await undo.click()
  await expect.poll(async()=>((await (await request.get(url)).json()) as Decision).proposed_vms[0].name).toBe(vm.name)
  await redo.click()
  await expect.poll(async()=>((await (await request.get(url)).json()) as Decision).proposed_vms[0].name).toBe('QA-WORK-EditedVM')
  await page.reload()
  await page.getByRole('button',{name:title,exact:true}).click()
  await page.getByRole('button',{name:'Открыть схему'}).click()
  await expect(page.locator(`.decisionCanvas .react-flow__node[data-id="${vm.id}"]`)).toContainText('QA-WORK-EditedVM')
  data=await (await request.get(url)).json() as Decision
  expect(data.proposed_flows[0].target_id).toBe(vm.id)
})

test('QA-WORK: proposed flow security, data and schedule are persisted, previewed and undoable',async({page,request})=>{
  const {title,url,vm,liveId}=await build(request,'FlowContract')
  await open(page,title)
  await page.getByRole('toolbar',{name:'Инструменты решения'}).getByRole('button',{name:'＋ Поток'}).click()
  await page.getByRole('textbox',{name:'Название потока'}).fill('QA-WORK-FullFlow')
  await page.getByRole('combobox',{name:'Источник',exact:true}).selectOption(liveId)
  await page.getByRole('combobox',{name:'Получатель',exact:true}).selectOption(vm.id)
  await page.getByRole('textbox',{name:'Протокол'}).fill('HTTPS')
  await page.getByRole('textbox',{name:'Порт'}).fill('443')
  await page.getByRole('textbox',{name:'Данные проектируемого потока'}).fill('Employee reference identifiers')
  await page.getByRole('textbox',{name:'Защита проектируемого потока'}).fill('mTLS')
  await page.getByRole('textbox',{name:'Периодичность проектируемого потока'}).fill('every 5 minutes')
  await page.getByRole('combobox',{name:'Достоверность проектируемого потока'}).selectOption('assumed')
  await page.getByRole('button',{name:'Добавить в черновик'}).click()
  await expect.poll(async()=>((await (await request.get(url)).json()) as Decision).proposed_flows.length).toBe(1)
  let data=await (await request.get(url)).json() as Decision
  expect(data.proposed_flows[0]).toMatchObject({
    name:'QA-WORK-FullFlow',source_id:liveId,target_id:vm.id,
    security:'mTLS',data_description:'Employee reference identifiers',
    schedule:'every 5 minutes',verification:'assumed'
  })
  await page.getByRole('button',{name:'Изменения',exact:true}).click()
  const diff=page.getByRole('region',{name:'Изменения технического решения'})
  await expect(diff).toContainText('QA-WORK-FullFlow')
  await expect(diff).toContainText('mTLS')
  await page.getByRole('button',{name:'Отменить изменение черновика'}).click()
  await expect.poll(async()=>((await (await request.get(url)).json()) as Decision).proposed_flows.length).toBe(0)
  await page.getByRole('button',{name:'Повторить изменение черновика'}).click()
  await expect.poll(async()=>((await (await request.get(url)).json()) as Decision).proposed_flows.length).toBe(1)
  data=await (await request.get(url)).json() as Decision
  expect(data.proposed_flows[0].security).toBe('mTLS')
})

test('QA-WORK: context menu deletes only proposed VM and unsaved form cannot silently disappear',async({page,request})=>{
  const {title,url,vm,liveId}=await build(request,'ContextMenu',true)
  await open(page,title)
  const proposed=page.locator(`.decisionCanvas .react-flow__node[data-id="${vm.id}"]`)
  const live=page.locator(`.decisionCanvas .react-flow__node[data-id="${liveId}"]`)
  await live.click({button:'right'})
  const menu=page.getByRole('menu',{name:'Действия с объектом'})
  await expect(menu).toBeVisible()
  await expect(menu.getByRole('menuitem',{name:'Удалить проектируемую ВМ'})).toHaveCount(0)
  await menu.getByRole('menuitem',{name:'Закрыть меню'}).click()
  await proposed.click()
  const name=page.getByRole('textbox',{name:'Имя проектируемой ВМ'})
  await name.fill('QA-WORK-UnsavedName')
  page.once('dialog',async dialog=>{expect(dialog.message()).toContain('несохранённые');await dialog.dismiss()})
  await page.getByRole('button',{name:'Изменения',exact:true}).click()
  await expect(name).toHaveValue('QA-WORK-UnsavedName')
  page.once('dialog',async dialog=>{await dialog.accept()})
  await page.getByRole('button',{name:'Изменения',exact:true}).click()
  await expect(page.getByRole('region',{name:'Изменения технического решения'})).toBeVisible()
  expect(((await (await request.get(url)).json()) as Decision).proposed_vms[0].name).toBe(vm.name)
  await proposed.click({button:'right'})
  await expect(menu.getByRole('menuitem',{name:'Удалить проектируемую ВМ'})).toBeVisible()
  page.once('dialog',async dialog=>{await dialog.accept()})
  await menu.getByRole('menuitem',{name:'Удалить проектируемую ВМ'}).click()
  await expect.poll(async()=>((await (await request.get(url)).json()) as Decision).proposed_vms.length).toBe(0)
  const data=await (await request.get(url)).json() as Decision
  expect(data.proposed_flows).toHaveLength(0)
  expect((await (await request.get(api+'/infra')).json() as {id:string}[]).some(vm=>vm.id===liveId)).toBe(true)
})
