import {test,expect} from '@playwright/test'

const api='http://127.0.0.1:8001/api'
async function setup(request:import('@playwright/test').APIRequestContext){
  const suffix=Date.now().toString(36)+Math.random().toString(36).slice(2,6)
  const aName='QA-WORK-Scenario-'+suffix+'-A'
  const bName='QA-WORK-Scenario-'+suffix+'-B'
  async function created(path:string,data:object){
    const result=await request.post(api+path,{data})
    expect(result.status(),await result.text()).toBe(201)
    return result.json()
  }
  const a=await created('/objects',{kind:'system',name:aName})
  const b=await created('/objects',{kind:'system',name:bName})
  const vmA=await created('/infra',{kind:'vm',name:'QA-WORK-VM-A',system_id:a.id})
  const vmB=await created('/infra',{kind:'vm',name:'QA-WORK-VM-B',system_id:b.id})
  const forward=await created('/flows',{name:'QA-WORK-Request-'+suffix,source_id:vmA.id,target_id:vmB.id,protocol:'HTTPS',port:'443'})
  const backward=await created('/flows',{name:'QA-WORK-Response-'+suffix,source_id:vmB.id,target_id:vmA.id,protocol:'HTTPS',port:'8443'})
  const category=await created('/business/categories',{name:'QA-WORK-Cat-'+suffix})
  const process=await created('/business/processes',{name:'QA-WORK-BP-'+suffix,category_id:category.id})
  return {suffix,a,b,forward,backward,process}
}

async function openSequence(page:import('@playwright/test').Page,systemSearch:string){
  await page.addInitScript(()=>sessionStorage.setItem('architecture-hub:access-token:session','browser-ci-development-token'))
  await page.goto('/flows')
  await page.getByRole('navigation',{name:'Представления потоков'}).getByRole('button',{name:'Карта',exact:true}).click()
  await page.getByRole('button',{name:'Потоки данных',exact:true}).click()
  await page.getByRole('textbox',{name:'Поиск на карте'}).fill(systemSearch)
  await page.getByRole('button',{name:'Последовательность'}).click()
  return page.getByRole('region',{name:'Диаграмма последовательности'})
}

test('QA-WORK: shared scenario stores repeatable flow steps, BP, order and note after reload',async({page,request})=>{
  const {suffix,forward,backward,process}=await setup(request)
  const diagram=await openSequence(page,'QA-WORK-Scenario-'+suffix)
  await expect(diagram.getByRole('listitem')).toHaveCount(2)
  await diagram.getByRole('button',{name:'Сохранить как сценарий'}).click()
  const name='QA-WORK-Обмен-'+suffix
  await diagram.getByRole('textbox',{name:'Название нового сценария'}).fill(name)
  await diagram.getByRole('combobox',{name:'Бизнес-процесс сценария'}).selectOption(process.id)
  await diagram.getByRole('textbox',{name:'Описание нового сценария'}).fill('Сценарий повторного обращения')
  await diagram.getByRole('button',{name:'Сохранить общий сценарий'}).click()
  await expect(diagram.getByRole('combobox',{name:'Сценарий обмена'})).toHaveValue(/.+/)
  const list=await (await request.get(api+'/flow-scenarios')).json() as {id:string;name:string;revision:number;steps:{flow_id:string;id:string;reply:boolean;note:string}[];process_id:string}[]
  const chosen=list.find(s=>s.name===name)
  expect(chosen).toBeTruthy()
  expect(chosen!.steps).toHaveLength(2)
  expect(chosen!.process_id).toBe(process.id)
  expect(new Set(chosen!.steps.map(x=>x.flow_id))).toEqual(new Set([forward.id,backward.id]))

  await diagram.getByRole('button',{name:'Настроить шаги'}).click()
  await diagram.getByRole('combobox',{name:'Поток для нового шага'}).selectOption(forward.id)
  await diagram.getByRole('button',{name:'Добавить шаг'}).click()
  await expect(diagram.getByRole('listitem')).toHaveCount(3)
  await diagram.getByRole('textbox',{name:'Примечание шага 3'}).fill('Повтор при запросе')
  await diagram.getByRole('listitem').nth(1).getByRole('checkbox',{name:'Ответ'}).check()
  await diagram.getByRole('listitem').nth(2).getByRole('button',{name:/Поднять шаг/}).click()
  await diagram.getByRole('button',{name:'Сохранить сценарий'}).click()
  await expect(diagram.getByText('Версия сценария сохранена: 2')).toBeVisible()
  const saved=(await (await request.get(api+'/flow-scenarios/'+chosen!.id)).json()) as {revision:number;steps:{flow_id:string;id:string;reply:boolean;note:string}[]}
  expect(saved.revision).toBe(2)
  expect(saved.steps).toHaveLength(3)
  expect(saved.steps.filter(x=>x.flow_id===forward.id)).toHaveLength(2)
  expect(saved.steps.some(x=>x.note==='Повтор при запросе')).toBe(true)
  expect(saved.steps.some(x=>x.reply)).toBe(true)
  const stepIds=new Set(saved.steps.map(x=>x.id))
  expect(stepIds.size).toBe(3)

  await page.reload()
  const reopened=page.getByRole('region',{name:'Диаграмма последовательности'})
  await expect(reopened.getByRole('combobox',{name:'Сценарий обмена'})).toHaveValue(chosen!.id)
  await expect(reopened.getByRole('listitem')).toHaveCount(3)
  await expect(reopened).toContainText('Повтор при запросе')
  // A saved sequence is shared with other browsers, unlike the personal view.
  await page.evaluate(()=>localStorage.removeItem('archhub-flow-scenario-selection-v1'))
  await page.reload()
  await reopened.getByRole('combobox',{name:'Сценарий обмена'}).selectOption(chosen!.id)
  await expect(reopened.getByRole('listitem')).toHaveCount(3)
})

test('QA-WORK: removing a saved scenario never deletes its underlying technical flows',async({page,request})=>{
  await page.setViewportSize({width:390,height:844})
  const {suffix,forward,backward}=await setup(request)
  const diagram=await openSequence(page,'QA-WORK-Scenario-'+suffix)
  await diagram.getByRole('button',{name:'Сохранить как сценарий'}).click()
  const name='QA-WORK-Удаление-'+suffix
  await diagram.getByRole('textbox',{name:'Название нового сценария'}).fill(name)
  await diagram.getByRole('button',{name:'Сохранить общий сценарий'}).click()
  // The network write is asynchronous; wait for a browser-visible confirmed save.
  await expect(diagram.getByText('Общий сценарий сохранён в реестре.')).toBeVisible()
  await expect(diagram.getByRole('combobox',{name:'Сценарий обмена'})).toHaveValue(/.+/)
  const list=await (await request.get(api+'/flow-scenarios')).json() as {id:string;name:string}[]
  const scenario=list.find(s=>s.name===name)
  expect(scenario).toBeTruthy()
  const blocked=await request.delete(api+'/flows/'+forward.id)
  expect(blocked.status()).toBe(409)
  page.once('dialog',async dialog=>{expect(dialog.message()).toContain('Технические потоки останутся');await dialog.accept()})
  await diagram.getByRole('button',{name:'Удалить сценарий'}).click()
  await expect(diagram.getByRole('combobox',{name:'Сценарий обмена'})).toHaveValue('')
  expect((await request.get(api+'/flow-scenarios/'+scenario!.id)).status()).toBe(404)
  const live=(await (await request.get(api+'/flows')).json()) as {id:string}[]
  expect(live.some(x=>x.id===forward.id)).toBe(true)
  expect(live.some(x=>x.id===backward.id)).toBe(true)
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(392)
})


test('QA-WORK: concurrent scenario edit stays visible on conflict and can refresh safely',async({page,request})=>{
  const {suffix,forward}=await setup(request)
  const diagram=await openSequence(page,'QA-WORK-Scenario-'+suffix)
  await diagram.getByRole('button',{name:'Сохранить как сценарий'}).click()
  const name='QA-WORK-Concurrent-'+suffix
  await diagram.getByRole('textbox',{name:'Название нового сценария'}).fill(name)
  await diagram.getByRole('button',{name:'Сохранить общий сценарий'}).click()
  await expect(diagram.getByText('Общий сценарий сохранён в реестре.')).toBeVisible()
  const list=await (await request.get(api+'/flow-scenarios')).json() as {id:string;name:string;revision:number;steps:{id:string;flow_id:string;reply:boolean;note:string}[];description:string;process_id:string|null}[]
  const server=list.find(x=>x.name===name)!
  expect(server).toBeTruthy()
  await diagram.getByRole('button',{name:'Настроить шаги'}).click()
  await diagram.getByRole('textbox',{name:'Примечание шага 1'}).fill('QA-WORK-Несохранённая правка')

  // Simulate another architect publishing revision 2 before this editor saves.
  const other=await request.put(api+'/flow-scenarios/'+server.id,{data:{
    name,description:'Обновлено другим архитектором',process_id:null,
    expected_revision:server.revision,
    steps:server.steps.map(step=>({id:step.id,flow_id:step.flow_id,reply:step.reply,note:step.note})),
  }})
  expect(other.status(),await other.text()).toBe(200)
  await diagram.getByRole('button',{name:'Сохранить сценарий'}).click()
  await expect(diagram.getByRole('alert')).toContainText('конфликт')
  await expect(diagram.getByRole('textbox',{name:'Примечание шага 1'})).toHaveValue('QA-WORK-Несохранённая правка')
  page.once('dialog',dialog=>{expect(dialog.message()).toContain('несохранённые изменения');void dialog.dismiss()})
  await diagram.getByRole('button',{name:'Обновить сценарий'}).click()
  await expect(diagram.getByRole('textbox',{name:'Примечание шага 1'})).toHaveValue('QA-WORK-Несохранённая правка')
  page.once('dialog',dialog=>void dialog.accept())
  await diagram.getByRole('button',{name:'Обновить сценарий'}).click()
  await expect(diagram.getByText('Актуальная версия сценария: 2')).toBeVisible()
  await expect(diagram).toContainText('версия 2')
  await diagram.getByRole('button',{name:'Настроить шаги'}).click()
  await expect(diagram.getByRole('textbox',{name:'Описание выбранного сценария'})).toHaveValue('Обновлено другим архитектором')
  await diagram.getByRole('textbox',{name:'Примечание шага 1'}).fill('Новая согласованная правка')
  await diagram.getByRole('button',{name:'Сохранить сценарий'}).click()
  await expect(diagram.getByText('Версия сценария сохранена: 3')).toBeVisible()
  const final=(await (await request.get(api+'/flow-scenarios/'+server.id)).json()) as {revision:number;steps:{flow_id:string;note:string}[]}
  expect(final.revision).toBe(3)
  expect(final.steps[0].note).toBe('Новая согласованная правка')
  expect(final.steps.some(x=>x.flow_id===forward.id)).toBe(true)
})
