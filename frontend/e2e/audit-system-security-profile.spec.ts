import {expect,test} from '@playwright/test'

test.describe.configure({retries:0})
const api='http://127.0.0.1:8001'

async function createSystem(page:import('@playwright/test').Page,name:string,attributes:Record<string,unknown>={}){
  const response=await page.request.post(api+'/api/objects',{data:{kind:'system',name,attributes}})
  expect(response.status(),await response.text()).toBe(201)
  return (await response.json()) as {id:string;name:string}
}

test('QA-WORK: PDn flags and protection classes are editable in the IS passport and filterable in the registry',async({page})=>{
  await page.addInitScript(()=>sessionStorage.setItem('architecture-hub:access-token:session','browser-ci-development-token'))
  const suffix=String(Date.now())
  const first=await createSystem(page,'QA-WORK-Security-Yes-'+suffix,{kis_passport:{'Владелец ИС':'ИТ'},marker:'preserved'})
  const second=await createSystem(page,'QA-WORK-Security-Unknown-'+suffix)
  await page.goto('/systems')
  const systems=page.getByRole('region',{name:'Реестр информационных систем'})
  const rows=systems.locator('.systemsTable tbody tr')
  const firstRow=rows.filter({hasText:first.name})
  const secondRow=rows.filter({hasText:second.name})
  await expect(firstRow).toContainText('ПДн: Не выяснено')
  await expect(secondRow).toContainText('ПДн: Не выяснено')

  await systems.getByRole('button',{name:first.name,exact:true}).click()
  const passport=page.getByLabel('Карточка архитектурного объекта')
  await expect(passport.getByRole('region',{name:'ПДн и классы защиты'})).toContainText('Не выяснено')
  await passport.getByRole('button',{name:'Редактировать паспорт КИС'}).click()
  const editor=page.getByRole('dialog',{name:'Редактор паспорта КИС'})
  await editor.getByRole('combobox',{name:'Персональные данные'}).selectOption('yes')
  await editor.getByRole('combobox',{name:'Уровень защищённости ПДн'}).selectOption('UZ2')
  await editor.getByRole('combobox',{name:'Класс защищённости ГИС'}).selectOption('K2')
  await editor.getByRole('textbox',{name:'Внутренний класс ИБ'}).fill('Корпоративный Б')
  await editor.getByRole('checkbox',{name:'Общие ПДн'}).check()
  await editor.getByRole('combobox',{name:'Достоверность сведений ИБ'}).selectOption('verified')
  await editor.getByRole('textbox',{name:'Примечание по ИБ'}).fill('Основание: утверждено службой ИБ')
  await editor.getByRole('button',{name:'Сохранить паспорт'}).click()
  await expect(editor).toHaveCount(0)

  await expect(firstRow).toContainText('ПДн: Обрабатываются')
  await expect(firstRow).toContainText('УЗ-2')
  await expect(firstRow).toContainText('К2')
  await expect(firstRow).toContainText('Корпоративный Б')
  await expect(passport.getByRole('region',{name:'ПДн и классы защиты'})).toContainText('УЗ-2')
  let data=(await (await page.request.get(api+'/api/objects')).json()) as Array<{id:string;attributes:Record<string,any>}>
  const saved=data.find(item=>item.id===first.id)!
  expect(saved.attributes.security_profile).toMatchObject({
    personal_data:'yes',pdn_level:'UZ2',gis_class:'K2',internal_class:'Корпоративный Б',
    categories:['general'],verification:'verified',
  })
  expect(saved.attributes.kis_passport['Владелец ИС']).toBe('ИТ')
  expect(saved.attributes.marker).toBe('preserved')

  const pdFilter=systems.getByRole('combobox',{name:'Фильтр обработки ПДн'})
  await pdFilter.selectOption('yes')
  await expect(firstRow).toBeVisible()
  await expect(secondRow).toHaveCount(0)
  await systems.getByRole('combobox',{name:'Фильтр уровня защищённости ПДн'}).selectOption('UZ2')
  await expect(firstRow).toBeVisible()
  await systems.getByRole('combobox',{name:'Фильтр уровня защищённости ПДн'}).selectOption('UZ1')
  await expect(firstRow).toHaveCount(0)
  await expect(rows).toContainText('Нет систем по выбранным фильтрам')
  await systems.getByRole('button',{name:'Очистить отбор ИБ'}).click()
  await expect(firstRow).toBeVisible()
  await expect(secondRow).toBeVisible()

  await page.reload()
  await expect(firstRow).toContainText('УЗ-2')
  await expect(firstRow).toContainText('ПДн: Обрабатываются')
  await systems.getByRole('button',{name:first.name,exact:true}).click()
  await passport.getByRole('button',{name:'Редактировать паспорт КИС'}).click()
  await editor.getByRole('combobox',{name:'Персональные данные'}).selectOption('no')
  await expect(editor.getByRole('combobox',{name:'Уровень защищённости ПДн'})).toBeDisabled()
  await editor.getByRole('button',{name:'Сохранить паспорт'}).click()
  await expect(firstRow).toContainText('ПДн: Не обрабатываются')
  data=(await (await page.request.get(api+'/api/objects')).json()) as typeof data
  expect(data.find(item=>item.id===first.id)!.attributes.security_profile).toMatchObject({
    personal_data:'no',pdn_level:'',categories:[],
  })
})
