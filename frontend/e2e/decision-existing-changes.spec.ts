import {expect,test,type APIRequestContext,type Page} from '@playwright/test'

const api='http://127.0.0.1:8001/api'
type Decision={
  id:string;title:string;revision:number;status:string;base_changed:boolean
  existing_changes:Array<{kind:'vm'|'flow';id:string;action:'update'|'remove';before:Record<string,string>;after:Record<string,string>|null;fields:Record<string,string>}>
  proposed_vms:object[];proposed_flows:object[]
}

async function created(request:APIRequestContext, path:string, data:object){
  const result=await request.post(api+path,{data})
  expect(result.status(),await result.text()).toBe(201)
  return result.json() as Promise<{id:string;name:string;system_id?:string;source_id?:string;target_id?:string}>
}

async function setup(request:APIRequestContext){
  const suffix=Date.now()+'-'+Math.random().toString(36).slice(2,8)
  const system=await created(request,'/objects',{kind:'system',name:'QA-WORK-AH05-'+suffix})
  const remote=await created(request,'/objects',{kind:'system',name:'QA-WORK-External-'+suffix})
  const vm=await created(request,'/infra',{kind:'vm',name:'QA-WORK-Existing-'+suffix,system_id:system.id})
  const external=await created(request,'/infra',{kind:'vm',name:'QA-WORK-RemoteVM-'+suffix,system_id:remote.id})
  const flow=await created(request,'/flows',{
    name:'QA-WORK-ExistingFlow-'+suffix,source_id:vm.id,target_id:external.id,
    protocol:'HTTPS',port:'443',security:'TLS'
  })
  const title='QA-WORK-DecisionChange-'+suffix
  const decision=await created(request,'/technical-decisions',{title,system_id:system.id})
  const url=api+'/technical-decisions/'+decision.id
  return {title,system,vm,external,flow,decision,url}
}
async function open(page:Page,title:string){
  await page.addInitScript(()=>sessionStorage.setItem('architecture-hub:access-token:session','browser-ci-development-token'))
  await page.goto('/decisions')
  await page.getByRole('button',{name:title,exact:true}).click()
  const inspector=page.getByRole('complementary',{name:'Карточка технического решения'})
  await inspector.getByRole('button',{name:'Изменения',exact:true}).click()
  const planner=inspector.getByRole('region',{name:'Изменения действующей архитектуры'})
  await expect(planner).toBeVisible()
  return {inspector,planner}
}

test('QA-WORK: edit existing VM and flow with visual diff, reload, undo, redo and review without CMDB mutation',async({page,request})=>{
  const {title,vm,flow,url}=await setup(request)
  const {inspector,planner}=await open(page,title)
  await planner.getByRole('combobox',{name:'Тип изменяемого объекта'}).selectOption('vm')
  await planner.getByRole('combobox',{name:'Действующий объект для изменения'}).selectOption(vm.id)
  await planner.getByRole('textbox',{name:'Новое значение: Название'}).fill('QA-WORK-RenamedServer')
  await planner.getByRole('textbox',{name:'Новое значение: Описание'}).fill('Updated role proposed for review')
  await planner.getByRole('button',{name:'Сохранить в черновик'}).click()
  await expect.poll(async()=>{
    const d=await (await request.get(url)).json() as Decision
    return d.existing_changes.length
  }).toBe(1)
  await expect(planner).toContainText('QA-WORK-RenamedServer')

  await planner.getByRole('combobox',{name:'Тип изменяемого объекта'}).selectOption('flow')
  await planner.getByRole('combobox',{name:'Действующий объект для изменения'}).selectOption(flow.id)
  await planner.getByRole('textbox',{name:'Новое значение: Порт'}).fill('8443')
  await planner.getByRole('textbox',{name:'Новое значение: Защита'}).fill('mTLS')
  await planner.getByRole('button',{name:'Сохранить в черновик'}).click()
  await expect.poll(async()=>((await (await request.get(url)).json()) as Decision).existing_changes.length).toBe(2)
  await expect(inspector).toContainText('8443')
  await expect(inspector).toContainText('mTLS')
  const activeFlow=(await (await request.get(api+'/flows')).json() as {id:string;port:string}[]).find(x=>x.id===flow.id)
  expect(activeFlow?.port).toBe('443')

  await planner.getByRole('button',{name:'На схеме'}).first().click()
  const node=page.locator(`.decisionCanvas .react-flow__node[data-id="${vm.id}"]`)
  await expect(node).toContainText('QA-WORK-RenamedServer')
  await expect(node).toContainText('Изменение')
  const undo=page.getByRole('button',{name:'Отменить изменение черновика'})
  await undo.click()
  await expect.poll(async()=>((await (await request.get(url)).json()) as Decision).existing_changes.length).toBe(1)
  await page.getByRole('button',{name:'Повторить изменение черновика'}).click()
  await expect.poll(async()=>((await (await request.get(url)).json()) as Decision).existing_changes.length).toBe(2)
  await page.reload()
  await page.getByRole('button',{name:title,exact:true}).click()
  await page.getByRole('button',{name:'Изменения',exact:true}).click()
  await expect(page.getByRole('region',{name:'Изменения действующей архитектуры'})).toContainText('8443')
  await page.getByRole('button',{name:'Состав',exact:true}).click()
  await inspector.getByRole('button',{name:'На согласование',exact:true}).click()
  await expect(page.locator('tr.current .decisionStatus')).toHaveText('На согласовании')
  const stored=await (await request.get(url)).json() as Decision
  expect(stored.status).toBe('in_review')
  expect(stored.base_changed).toBe(false)
  expect(stored.existing_changes.map(change=>change.action)).toEqual(['update','update'])
  expect((await (await request.get(api+'/infra')).json() as {id:string;name:string}[]).find(x=>x.id===vm.id)?.name).toBe(vm.name)
})

test('QA-WORK: proposed removals require dependencies, never delete live objects',async({page,request})=>{
  await page.setViewportSize({width:390,height:844})
  const {title,vm,flow,url}=await setup(request)
  const {planner}=await open(page,title)
  await planner.getByRole('combobox',{name:'Действующий объект для изменения'}).selectOption(vm.id)
  await planner.getByRole('combobox',{name:'Планируемое действие'}).selectOption('remove')
  await planner.getByRole('button',{name:'Сохранить в черновик'}).click()
  await expect(page.getByRole('alert')).toContainText('Stage deletion or rerouting of connected flows')
  const empty=await (await request.get(url)).json() as Decision
  expect(empty.existing_changes).toHaveLength(0)

  await planner.getByRole('combobox',{name:'Тип изменяемого объекта'}).selectOption('flow')
  await planner.getByRole('combobox',{name:'Действующий объект для изменения'}).selectOption(flow.id)
  await planner.getByRole('combobox',{name:'Планируемое действие'}).selectOption('remove')
  await planner.getByRole('button',{name:'Сохранить в черновик'}).click()
  await expect.poll(async()=>((await (await request.get(url)).json()) as Decision).existing_changes.length).toBe(1)
  await planner.getByRole('combobox',{name:'Тип изменяемого объекта'}).selectOption('vm')
  await planner.getByRole('combobox',{name:'Действующий объект для изменения'}).selectOption(vm.id)
  await planner.getByRole('combobox',{name:'Планируемое действие'}).selectOption('remove')
  await planner.getByRole('button',{name:'Сохранить в черновик'}).click()
  await expect.poll(async()=>((await (await request.get(url)).json()) as Decision).existing_changes.length).toBe(2)
  const updated=await (await request.get(url)).json() as Decision
  expect(updated.existing_changes.map(c=>c.action)).toEqual(['remove','remove'])
  expect(updated.existing_changes.every(c=>c.after===null)).toBe(true)
  const liveVMs=await (await request.get(api+'/infra')).json() as {id:string}[]
  const liveFlows=await (await request.get(api+'/flows')).json() as {id:string}[]
  expect(liveVMs.some(x=>x.id===vm.id)).toBe(true)
  expect(liveFlows.some(x=>x.id===flow.id)).toBe(true)
  const width=await page.evaluate(()=>document.documentElement.scrollWidth)
  expect(width).toBeLessThanOrEqual(392)
})

test('QA-WORK: technical decision Markdown exports staged existing changes and live records remain intact',async({page,request})=>{
  const {title,vm,flow,url}=await setup(request)
  const category=await created(request,'/business/categories',{name:'QA-WORK-ImpactArea-'+title})
  const process=await created(request,'/business/processes',{
    name:'QA-WORK-ImpactProcess-'+title,category_id:category.id
  })
  const processSave=await request.put(api+'/business/process-passports/'+process.id,{data:{
    expected_revision:0,steps:[{name:'QA-WORK-ImpactStep',flow_id:flow.id}]
  }})
  expect(processSave.status(),await processSave.text()).toBe(200)
  const scenario=await created(request,'/flow-scenarios',{
    name:'QA-WORK-ImpactScenario-'+title,
    process_id:process.id,steps:[{flow_id:flow.id}]
  })
  const row=await (await request.get(url)).json() as Decision
  const staged=await request.put(url,{data:{
    title,expected_revision:row.revision,existing_changes:[
      {kind:'vm',action:'update',id:vm.id,fields:{name:'QA-WORK-NewName'}},
      {kind:'flow',action:'remove',id:flow.id,fields:{}},
    ],
  }})
  expect(staged.status(),await staged.text()).toBe(200)
  const impact=(await staged.json() as Decision & {existing_changes:Array<{impacts:string[]}>}).existing_changes[1].impacts
  expect(impact.some(text=>text.includes(process.name))).toBe(true)
  expect(impact.some(text=>text.includes(scenario.name))).toBe(true)
  const {inspector}=await open(page,title)
  await expect(inspector.getByRole('note')).toContainText(process.name)
  await expect(inspector.getByRole('note')).toContainText(scenario.name)
  const downloadEvent=page.waitForEvent('download')
  await inspector.getByRole('button',{name:'Скачать техническое решение (.md)'}).click()
  const file=await downloadEvent
  const filename=file.suggestedFilename()
  expect(filename).toMatch(/^ArchitectureHub_.*\.md$/)
  const fs=await import('node:fs/promises')
  const markdown=await fs.readFile((await file.path())!,'utf8')
  expect(markdown).toContain('## Изменение действующей архитектуры')
  expect(markdown).toContain(process.name)
  expect(markdown).toContain(scenario.name)
  expect(markdown).toContain('QA-WORK-NewName')
  expect(markdown).toContain('Запланировано удаление')
  expect(markdown).toContain('Не подтверждает фактическое внедрение')
  expect((await (await request.get(api+'/flows')).json() as {id:string}[]).some(x=>x.id===flow.id)).toBe(true)
})


test('QA-WORK: unsaved existing-object changes survive dismissed tab navigation and rejected save',async({page,request})=>{
  const {title,flow,url}=await setup(request)
  const {inspector,planner}=await open(page,title)
  await planner.getByRole('combobox',{name:'Тип изменяемого объекта'}).selectOption('flow')
  await planner.getByRole('combobox',{name:'Действующий объект для изменения'}).selectOption(flow.id)
  const port=planner.getByRole('textbox',{name:'Новое значение: Порт'})
  await port.fill('999999')
  page.once('dialog',dialog=>{
    expect(dialog.message()).toContain('несохранённые изменения')
    void dialog.dismiss()
  })
  await inspector.getByRole('button',{name:'Согласование',exact:true}).click()
  await expect(planner).toBeVisible()
  await expect(port).toHaveValue('999999')
  await planner.getByRole('button',{name:'Сохранить в черновик'}).click()
  await expect(inspector.getByRole('alert').last()).toContainText('Порт должен быть числом')
  await expect(port).toHaveValue('999999')
  expect(((await (await request.get(url)).json()) as Decision).existing_changes).toHaveLength(0)

  await port.fill('8443')
  await planner.getByRole('button',{name:'Сохранить в черновик'}).click()
  await expect.poll(async()=>((await (await request.get(url)).json()) as Decision).existing_changes.length).toBe(1)
  await expect(planner).toContainText('8443')
  await inspector.getByRole('button',{name:'Согласование',exact:true}).click()
  await expect(inspector.getByRole('region',{name:'Маршрут согласования'})).toBeVisible()
})
