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
  await page.getByRole('link',{name:'Общая карта связей'}).click()
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
  const {suffix,forward,backward}=await setup(request)
  const diagram=await openSequence(page,'QA-WORK-Scenario-'+suffix)
  await diagram.getByRole('button',{name:'Сохранить как сценарий'}).click()
  const name='QA-WORK-Удаление-'+suffix
  await diagram.getByRole('textbox',{name:'Название нового сценария'}).fill(name)
  await diagram.getByRole('button',{name:'Сохранить общий сценарий'}).click()
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
})
