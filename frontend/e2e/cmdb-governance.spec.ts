import {test,expect} from '@playwright/test'

const api='http://127.0.0.1:8001'
test.beforeEach(async({page})=>{
  await page.addInitScript(()=>{
    sessionStorage.setItem('architecture-hub:access-token:session','browser-ci-development-token')
  })
})

test('CMDB governance updates a component, verifies its provenance and keeps the passport open',async({page})=>{
  const suffix=Date.now().toString(36)
  const create=async(path:string,data:Record<string,unknown>)=>{
    const response=await page.request.post(api+path,{data})
    expect(response.status(),await response.text()).toBe(201)
    return response.json()
  }
  const system=await create('/api/objects',{kind:'system',name:'Governance system '+suffix})
  const item=await create('/api/infra',{
    system_id:system.id,kind:'vm',name:'Governance VM '+suffix,
    description:'Original description',details:{environment:'PROD'}
  })
  await page.goto('/')
  await page.getByRole('navigation',{name:'Разделы архитектуры'}).getByRole('button',{name:'Компоненты',exact:true}).click()
  await page.getByRole('combobox',{name:'Система компонентов'}).selectOption(system.id)
  await page.getByRole('group',{name:'Представление компонентов'}).getByRole('button',{name:'Схема',exact:true}).click()
  await page.locator('.react-flow__node').filter({hasText:'Governance VM '+suffix}).first().click()

  const card=page.getByRole('dialog',{name:'Карточка компонента Governance VM '+suffix})
  await expect(card).toBeVisible()
  await card.getByRole('tab',{name:'Управление КЕ'}).click()
  const governance=card.getByRole('region',{name:'Управление конфигурационной единицей'})
  await expect(governance).toContainText('версия 0')
  await governance.getByRole('button',{name:'Редактировать данные КЕ'}).click()
  await governance.getByRole('combobox',{name:'Жизненный цикл КЕ'}).selectOption('active')
  await governance.getByRole('textbox',{name:'Владелец',exact:true}).fill('Business team')
  await governance.getByRole('textbox',{name:'Технический ответственный'}).fill('Infrastructure team')
  await governance.getByRole('combobox',{name:'Критичность'}).selectOption('high')
  await governance.getByRole('textbox',{name:'Источник данных'}).fill('Manual verification')
  await governance.getByRole('textbox',{name:'ID в источнике'}).fill('external-'+suffix)
  await governance.getByRole('textbox',{name:'Причина изменения'}).fill('Validated CI from owner and infrastructure inventory')
  await governance.getByRole('button',{name:'Сохранить паспорт КЕ'}).click()
  await expect(governance).toContainText('версия 1')
  await expect(governance).toContainText('Требуется повторная проверка')
    .catch(async()=>{await expect(governance).toContainText('повторная проверка')})
  await expect(governance).toContainText('Infrastructure team')

  await governance.getByRole('textbox',{name:'Основание проверки'}).fill('Compared with platform documentation')
  await governance.getByRole('button',{name:'Подтвердить актуальность'}).click()
  await expect(governance).toContainText('версия 2')
  await expect(governance).toContainText('Проверена')
  await governance.getByText('История изменений (2)').click()
  await expect(governance).toContainText('Версия 2')
  await expect(governance).toContainText('Версия 1')

  const metadata=await page.request.get(api+'/api/cmdb/records/component:'+item.id)
  expect(metadata.ok()).toBe(true)
  const record=await metadata.json()
  expect(record.owner).toBe('Business team')
  expect(record.verification_status).toBe('verified')
  expect(record.revision).toBe(2)

  await card.getByRole('tab',{name:'Паспорт',exact:true}).click()
  await expect(card).toContainText('Original description')
})

test('CMDB quality endpoint counts unknown and missing fields for unreviewed items',async({page})=>{
  const suffix=Date.now().toString(36)
  const sys=await page.request.post(api+'/api/objects',{data:{kind:'system',name:'Quality '+suffix}})
  expect(sys.status()).toBe(201)
  const system=await sys.json()
  const vm=await page.request.post(api+'/api/infra',{data:{system_id:system.id,kind:'vm',name:'QA VM '+suffix}})
  expect(vm.status()).toBe(201)
  const component=await vm.json()
  const res=await page.request.get(api+'/api/cmdb/quality?stale_days=90')
  expect(res.ok()).toBe(true)
  const data=await res.json()
  const row=data.items.find((x:{ci_id:string})=>x.ci_id==='component:'+component.id)
  expect(row).toBeTruthy()
  expect(row.verified).toBe(false)
  expect(row.missing).toContain('technical_owner')
  expect(row.completeness_percent).toBeLessThan(100)
})
