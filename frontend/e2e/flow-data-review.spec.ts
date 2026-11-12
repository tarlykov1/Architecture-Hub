import {expect,test} from '@playwright/test'

test.beforeEach(async({page})=>{
 await page.addInitScript(()=>{
  sessionStorage.setItem('architecture-hub:access-token:session','browser-ci-development-token')
 })
})

test('flow metadata is edited only after preview and audited confirmation',async({page})=>{
 const marker=String(Date.now())+Math.floor(Math.random()*1000)
 const create=async(path:string,data:Record<string,unknown>)=>{
  const response=await page.request.post('http://127.0.0.1:8001'+path,{data})
  expect(response.status(),await response.text()).toBe(201)
  return await response.json() as {id:string}
 }
 const system=await create('/api/objects',{name:'Reviewed system '+marker,kind:'system'})
 const consumer=await create('/api/objects',{name:'Reviewed consumer '+marker,kind:'system'})
 const category=await create('/api/business/categories',{name:'Review BP category '+marker})
 const process=await create('/api/business/processes',{name:'Review process '+marker,category_id:category.id})
 const source=await create('/api/infra',{system_id:system.id,name:'Reviewed source '+marker,kind:'vm'})
 const target=await create('/api/infra',{system_id:system.id,name:'Reviewed target '+marker,kind:'vm'})
 const flow=await create('/api/flows',{source_id:source.id,target_id:target.id,name:'Reviewed flow '+marker})
 const attribute=await create('/api/data-attributes',{
  code:'reviewed_employee_'+marker,name:'Reviewed employee attribute '+marker,sensitivity:'internal'
 })
 await page.goto('/')
 await page.getByRole('navigation',{name:'Разделы архитектуры'})
  .getByRole('button',{name:'Компоненты',exact:true}).click()
 await page.getByRole('group',{name:'Представление компонентов'})
  .getByRole('button',{name:'Схема',exact:true}).click()
 await page.getByRole('button',{name:'Редактировать схему'}).click()
 const chooser=page.getByRole('combobox',{name:'Выбрать ИС для редактора компонентов'})
 if(await chooser.isVisible())await chooser.selectOption(system.id)
 const board=page.getByRole('region',{name:'Редактор архитектурной схемы'})
 await board.locator('.react-flow__node').filter({hasText:'Reviewed source '+marker}).click()
 const inspector=board.getByRole('dialog',{name:'Паспорт компонента Reviewed source '+marker})
 await inspector.getByRole('button',{name:'Открыть параметры потока'}).click()
 const map=board.getByRole('region',{name:'Атрибуты данных потока'})
 await expect(map.getByText('0 из 0 привязок атрибутов')).toBeVisible()
 await map.getByRole('button',{name:'Добавить атрибут потока'}).click()
 let review=page.getByRole('dialog',{name:'Изменение состава данных потока'})
 await review.getByRole('combobox',{name:'Атрибут привязки'}).selectOption(attribute.id)
 await review.getByRole('combobox',{name:'Бизнес-процесс привязки'}).selectOption(process.id)
 await review.getByRole('combobox',{name:'Система-потребитель привязки'}).selectOption(consumer.id)
 await review.getByRole('textbox',{name:'Назначение атрибута'}).fill('Test scoped lookup')
 await review.getByRole('textbox',{name:'Причина изменения состава данных'}).fill('Documenting process-specific consumer data')
 await review.getByRole('button',{name:'Проверить изменение данных'}).click()
 await expect(review.getByRole('region',{name:'Предварительный просмотр изменений данных'})).toBeVisible()
 await expect(map.getByText('0 из 0 привязок атрибутов')).toBeVisible()
 await review.getByRole('button',{name:'Подтвердить и записать в журнал'}).click()
 await expect(review).toHaveCount(0)
 await expect(map.getByText('Reviewed employee attribute '+marker)).toBeVisible()
 await expect(map.getByText('1 из 1 привязок атрибутов')).toBeVisible()

 await map.getByRole('button',{name:'Изменить привязку Reviewed employee attribute '+marker}).click()
 review=page.getByRole('dialog',{name:'Изменение состава данных потока'})
 await review.getByRole('textbox',{name:'Назначение атрибута'}).fill('Corrected metadata purpose')
 await review.getByRole('combobox',{name:'Статус подтверждения атрибута'}).selectOption('verified')
 await review.getByRole('textbox',{name:'Причина изменения состава данных'}).fill('Verification by business owner')
 await review.getByRole('button',{name:'Проверить изменение данных'}).click()
 await review.getByRole('button',{name:'Подтвердить и записать в журнал'}).click()
 await expect(map.getByText('Назначение: Corrected metadata purpose')).toBeVisible()

 await map.getByRole('button',{name:'Удалить привязку Reviewed employee attribute '+marker}).click()
 review=page.getByRole('dialog',{name:'Изменение состава данных потока'})
 await review.getByRole('textbox',{name:'Причина изменения состава данных'}).fill('Remove obsolete transfer metadata')
 await review.getByRole('button',{name:'Проверить изменение данных'}).click()
 await review.getByRole('button',{name:'Подтвердить и записать в журнал'}).click()
 await expect(map.getByText('0 из 0 привязок атрибутов')).toBeVisible()
 await expect(board.getByRole('form',{name:'Редактирование существующего потока'})).toHaveCount(1)

 const saved=await page.request.get('http://127.0.0.1:8001/api/flows/'+flow.id+'/data-map')
 expect((await saved.json()).attributes).toEqual([])
 const audit=await page.request.get('http://127.0.0.1:8001/api/board/audit?limit=200')
 expect(audit.ok()).toBeTruthy()
 const records=await audit.json() as Array<{reason:string;changes:Array<{action:string}>}>
 for(const name of ['Documenting process-specific consumer data','Verification by business owner','Remove obsolete transfer metadata']){
  expect(records.some(row=>row.reason===name&&row.changes[0].action.endsWith('_flow_attribute'))).toBeTruthy()
 }
})
