import {test,expect} from '@playwright/test'

test.describe.configure({retries:0})

test('QA-WORK: add two environment-specific versions, search across IS, show approved monitor report',async({page})=>{
 await page.addInitScript(()=>sessionStorage.setItem('architecture-hub:access-token:session','browser-ci-development-token'))
 const api='http://127.0.0.1:8001'
 const suffix=Date.now().toString(36)
 const create=async(path:string,data:Record<string,unknown>)=>{
  const response=await page.request.post(api+path,{data})
  expect(response.status(),await response.text()).toBe(201)
  return await response.json() as {id:string}
 }
 const name='QA-WORK-Security inventory '+suffix
 const system=await create('/api/objects',{kind:'system',name})
 const vm=await create('/api/infra',{system_id:system.id,kind:'vm',name:'QA-WORK-database '+suffix})
 await page.goto('/')
 await page.getByRole('navigation',{name:'Разделы архитектуры'}).getByRole('button',{name:'Системы',exact:true}).click()
 await page.getByRole('button',{name,exact:true}).click()
 const details=page.getByLabel('Карточка архитектурного объекта')
 await details.getByRole('button',{name:'Технологический стек'}).click()
 const stack=details.getByRole('region',{name:'Технологический стек ИС'})
 await expect(stack).toBeVisible()
 await stack.getByRole('button',{name:'+ Добавить технологию'}).click()
 const form=stack.getByRole('form',{name:'Редактор технологии ИС'})
 await form.getByRole('textbox',{name:'Технология'}).fill('QA-WORK-PostgreSQL-'+suffix)
 await form.getByRole('combobox',{name:'Категория'}).selectOption('database')
 await form.getByRole('textbox',{name:'Версия (если подтверждена)'}).fill('14.3')
 await form.getByRole('combobox',{name:'Среда'}).selectOption('prod')
 await form.getByRole('combobox',{name:'Где установлено'}).selectOption(vm.id)
 await form.getByRole('combobox',{name:'Достоверность'}).selectOption('assumed')
 await form.getByRole('button',{name:'Сохранить технологию'}).click()
 await expect(form).toHaveCount(0)
 await expect(stack).toContainText('QA-WORK-PostgreSQL-'+suffix)
 const techApi=api+'/api/systems/'+system.id+'/technologies'
 let technologies=(await (await page.request.get(techApi)).json()) as Array<{id:string;version:string}>
 expect(technologies).toHaveLength(1)
 const original=technologies[0].id
 await stack.getByRole('button',{name:'+ Добавить технологию'}).click()
 const testForm=stack.getByRole('form',{name:'Редактор технологии ИС'})
 await testForm.getByRole('textbox',{name:'Технология'}).fill('QA-WORK-PostgreSQL-'+suffix)
 await testForm.getByRole('combobox',{name:'Категория'}).selectOption('database')
 await testForm.getByRole('textbox',{name:'Версия (если подтверждена)'}).fill('16.2')
 await testForm.getByRole('combobox',{name:'Среда'}).selectOption('test')
 await testForm.getByRole('button',{name:'Сохранить технологию'}).click()
 await expect(testForm).toHaveCount(0)
 technologies=(await (await page.request.get(techApi)).json()) as typeof technologies
 expect(technologies).toHaveLength(2)
 const source=await create('/api/monitoring/sources',{
  name:'QA-WORK-Zabbix-'+suffix,kind:'zabbix',base_url:'https://zabbix.example.invalid',enabled:true
 })
 await create('/api/monitoring/links',{
  source_id:source.id,target_type:'component',target_id:vm.id,relation_kind:'monitors',
  dashboard_url:'https://zabbix.example.invalid/dashboard',external_ref:'qa-component'
 })
 await create('/api/systems/'+system.id+'/technologies/'+original+'/observations',{
  source_id:source.id,observed_at:new Date().toISOString(),
  observed_version:'14.2',reachable:true,notes:'QA-WORK: recorded by approved monitor'
 })
 await page.reload()
 await page.getByRole('navigation',{name:'Разделы архитектуры'}).getByRole('button',{name:'Системы',exact:true}).click()
 await page.getByRole('button',{name:'Реестр технологий'}).click()
 const inventory=page.getByRole('region',{name:'Реестр технологий всех ИС'})
 await expect(inventory).toContainText('QA-WORK-PostgreSQL-'+suffix)
 await inventory.getByRole('textbox',{name:'Поиск технологии и версии'}).fill('QA-WORK-PostgreSQL-'+suffix)
 await inventory.getByRole('combobox',{name:'Среда инвентаризации'}).selectOption('prod')
 await inventory.getByRole('button',{name:'Найти'}).click()
 await expect(inventory).toContainText('Найдено записей: 1')
 await expect(inventory).toContainText('Версии различаются')
 await expect(inventory).toContainText('14.2')
 await expect(inventory).toContainText('QA-WORK-Zabbix-'+suffix)
 await inventory.getByRole('button',{name,exact:true}).click()
 const reopened=page.getByLabel('Карточка архитектурного объекта')
 await expect(reopened.getByRole('region',{name:'Технологический стек ИС'})).toContainText('14.2')
 await expect(reopened.getByRole('region',{name:'Технологический стек ИС'})).toContainText('Обнаруженная версия отличается')
})
