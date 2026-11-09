import {expect,test} from '@playwright/test'

const api='http://127.0.0.1:8001'
test.beforeEach(async({page})=>{
  await page.addInitScript(()=>{
    sessionStorage.setItem('architecture-hub:access-token:session','browser-ci-development-token')
  })
})

test('admin creates a CI class in the right inspector and the custom field appears in the passport',async({page})=>{
  const suffix=Date.now().toString(36)
  const ciClass='edge_'+suffix
  const create=async(path:string,data:Record<string,unknown>)=>{
    const response=await page.request.post(api+path,{data})
    expect(response.status(),await response.text()).toBe(201)
    return response.json()
  }
  const system=await create('/api/objects',{kind:'system',name:'Catalog system '+suffix})
  const component=await create('/api/infra',{
    system_id:system.id,kind:ciClass,name:'Catalog component '+suffix
  })
  await page.goto('/')
  await page.getByRole('navigation',{name:'Разделы архитектуры'})
    .getByRole('button',{name:'Компоненты',exact:true}).click()
  await page.getByRole('combobox',{name:'Система компонентов'}).selectOption(system.id)
  await page.getByRole('group',{name:'Представление компонентов'})
    .getByRole('button',{name:'Схема',exact:true}).click()
  await page.locator('.react-flow__node').filter({hasText:'Catalog component '+suffix}).first().click()
  const card=page.getByRole('dialog',{name:'Карточка компонента Catalog component '+suffix})
  await card.getByRole('tab',{name:'Управление КЕ'}).click()
  const governance=card.getByRole('region',{name:'Управление конфигурационной единицей'})
  await governance.getByRole('button',{name:'Классификатор и правила CMDB'}).click()
  const catalog=governance.getByRole('region',{name:'Настройки классификатора CMDB'})
  await expect(catalog).toBeVisible()
  const classPanel=catalog.locator('.cmdbCatalogPanel').first()
  await classPanel.getByRole('combobox',{name:'Выбрать класс CMDB'}).selectOption('')
  await classPanel.getByRole('textbox',{name:'Код класса CMDB'}).fill(ciClass)
  await classPanel.getByRole('textbox',{name:'Название класса'}).fill('Тестовый шлюз')
  await classPanel.getByRole('button',{name:'+ Поле'}).click()
  await classPanel.getByRole('textbox',{name:'Код поля 1'}).fill('region')
  await classPanel.getByRole('textbox',{name:'Название поля'}).fill('Регион')
  await classPanel.getByRole('combobox',{name:'Тип'}).selectOption('choice')
  await classPanel.getByRole('textbox',{name:'Варианты через запятую'}).fill('Зона А, Зона Б')
  await classPanel.getByRole('checkbox',{name:'Регион'}).check()
  await classPanel.getByRole('textbox',{name:'Причина изменения'}).fill('Пилот модели классов в редакторе')
  await classPanel.getByRole('button',{name:'Сохранить класс'}).click()
  await expect(classPanel).toContainText('Тестовый шлюз')
  await governance.getByRole('button',{name:'Скрыть классификатор'}).click()
  await governance.getByRole('button',{name:'Редактировать данные КЕ'}).click()
  await expect(governance.getByRole('combobox',{name:'Регион'})).toBeVisible()
  await governance.getByRole('combobox',{name:'Регион'}).selectOption('Зона А')
  await governance.getByRole('combobox',{name:'Жизненный цикл КЕ'}).selectOption('active')
  await governance.getByRole('textbox',{name:'Причина изменения'}).fill('Сохранение данных новой конфигурационной единицы')
  await governance.getByRole('button',{name:'Сохранить паспорт КЕ'}).click()
  await expect(governance).toContainText('версия 1')
  await expect(governance).toContainText('Зона А')
  const response=await page.request.get(api+'/api/cmdb/records/component:'+component.id)
  expect(response.ok()).toBe(true)
  expect((await response.json()).custom_values.region).toBe('Зона А')
})
