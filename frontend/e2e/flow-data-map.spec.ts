import {expect,test} from '@playwright/test'

test.beforeEach(async({page})=>{
 await page.addInitScript(()=>{
  sessionStorage.setItem('architecture-hub:access-token:session','browser-ci-development-token')
 })
})

test('saved flow shows distinct attribute sets for each business process and consuming system',async({page})=>{
 const marker=String(Date.now())+Math.floor(Math.random()*1000)
 const create=async(path:string,data:Record<string,unknown>)=>{
  const result=await page.request.post('http://127.0.0.1:8001'+path,{data})
  expect(result.status(),await result.text()).toBe(201)
  return await result.json() as {id:string}
 }
 const system=await create('/api/objects',{name:'Process data map '+marker,kind:'system'})
 const consumer=await create('/api/objects',{name:'Another consuming IS '+marker,kind:'system'})
 const source=await create('/api/infra',{system_id:system.id,kind:'vm',name:'Mapping source '+marker})
 const target=await create('/api/infra',{system_id:system.id,kind:'vm',name:'Mapping target '+marker})
 const flow=await create('/api/flows',{
  source_id:source.id,target_id:target.id,name:'Employee data by process '+marker
 })
 const category=await create('/api/business/categories',{name:'Data-flow scenarios '+marker})
 const onboarding=await create('/api/business/processes',{category_id:category.id,name:'Onboarding '+marker})
 const service=await create('/api/business/processes',{category_id:category.id,name:'Service request '+marker})
 const employeeId=await create('/api/data-attributes',{
  code:'employee_id_'+marker,name:'Employee identifier '+marker,
  data_type:'string',sensitivity:'internal'
 })
 const contact=await create('/api/data-attributes',{
  code:'work_phone_'+marker,name:'Work phone '+marker,
  data_type:'string',sensitivity:'personal'
 })
 await create('/api/flow-data-uses',{
  flow_id:flow.id,attribute_id:employeeId.id,process_id:onboarding.id,
  consumer_system_id:system.id,purpose:'Identity matching',verification:'verified'
 })
 await create('/api/flow-data-uses',{
  flow_id:flow.id,attribute_id:contact.id,process_id:service.id,
  consumer_system_id:consumer.id,purpose:'Call-back contact',verification:'assumed'
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
 await board.locator('.react-flow__node').filter({hasText:'Mapping source '+marker}).click()
 const inspector=board.getByRole('dialog',{name:'Паспорт компонента Mapping source '+marker})
 await inspector.getByRole('button',{name:'Открыть параметры потока'}).click()
 // Two keyed dock widgets must not clone the same edit form on React rerenders.
 await expect(board.getByRole('form',{name:'Редактирование существующего потока'})).toHaveCount(1)
 const metadata=board.getByRole('region',{name:'Атрибуты данных потока'})
 await expect(metadata.getByText('Состав передаваемых данных')).toBeVisible()
 await expect(metadata.getByText('Employee identifier '+marker)).toBeVisible()
 await expect(metadata.getByText('Work phone '+marker)).toBeVisible()
 await expect(metadata.getByText('Identity matching',{exact:false})).toBeVisible()
 await expect(metadata.getByText('Call-back contact',{exact:false})).toBeVisible()
 const filter=metadata.getByRole('combobox',{name:'Фильтр бизнес-процесса'})
 await filter.selectOption(onboarding.id)
 await expect(metadata.getByText('Employee identifier '+marker)).toBeVisible()
 await expect(metadata.getByText('Work phone '+marker)).toHaveCount(0)
 await expect(metadata.getByText('1 из 2 привязок атрибутов')).toBeVisible()
 await filter.selectOption('all')
 await metadata.getByRole('combobox',{name:'Фильтр системы-потребителя'}).selectOption(consumer.id)
 await expect(metadata.getByText('Employee identifier '+marker)).toHaveCount(0)
 await expect(metadata.getByText('Work phone '+marker)).toBeVisible()
})
