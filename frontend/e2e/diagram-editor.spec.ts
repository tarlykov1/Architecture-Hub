import {test,expect} from '@playwright/test'

// These tests use only the temporary SQLite database started by Browser CI.
test.beforeEach(async ({page})=>{
  await page.addInitScript(()=>{
    sessionStorage.setItem('architecture-hub:access-token:session','browser-ci-development-token')
  })
})

async function seedSystem(page:import('@playwright/test').Page){
  const system=await page.request.post('http://127.0.0.1:8001/api/objects',{
    data:{name:'Canvas editor '+Date.now(),kind:'system'}
  })
  expect(system.status()).toBe(201)
  const id=(await system.json()).id as string
  for(const name of ['Editor source','Editor destination']){
    const component=await page.request.post('http://127.0.0.1:8001/api/infra',{
      data:{system_id:id,name,kind:'vm',description:'Test-only diagram node'}
    })
    expect(component.status()).toBe(201)
  }
  return id
}

test('components expose the real palette even when no system is selected or grouping is enabled',async({page})=>{
  const id=await seedSystem(page)
  await page.goto('/')
  await page.getByRole('navigation',{name:'Разделы архитектуры'}).getByRole('button',{name:'Компоненты',exact:true}).click()
  await page.getByRole('group',{name:'Представление компонентов'}).getByRole('button',{name:'Схема',exact:true}).click()
  await page.getByRole('combobox',{name:'Группировка компонентов'}).selectOption('environment')
  await page.getByRole('button',{name:'Редактировать схему'}).click()
  const chooser=page.getByRole('region',{name:'Выбор информационной системы для редактора'})
  await expect(chooser).toBeVisible()
  await chooser.getByRole('combobox',{name:'Выбрать ИС для редактора компонентов'}).selectOption(id)
  const editor=page.getByRole('region',{name:'Редактор архитектурной схемы'})
  await expect(editor).toBeVisible()
  const tools=editor.getByRole('toolbar',{name:'Инструменты архитектуры'})
  await expect(tools.getByRole('button',{name:'Курсор / перемещение'})).toBeVisible()
  await expect(tools.getByRole('button',{name:'+ ВМ'})).toBeVisible()
  await expect(tools.getByRole('button',{name:'→ Поток'})).toBeVisible()
  await expect(tools.getByRole('button',{name:'▭ Сеть / контейнер'})).toBeVisible()
  await expect(editor.locator('.react-flow__node .homeNode')).toHaveCount(2)
  await tools.getByRole('button',{name:'→ Связь / поток'}).click()
  await expect(editor.getByRole('button',{name:'Добавить поток'})).toBeVisible()
  await page.getByRole('button',{name:'Завершить редактирование'}).click()
  await expect(editor).toHaveCount(0)
})

test('flows expose the shared architecture toolbar and use overview card styling',async({page})=>{
  const id=await seedSystem(page)
  await page.goto('/')
  await page.getByRole('navigation',{name:'Разделы архитектуры'}).getByRole('button',{name:'Потоки',exact:true}).click()
  await page.getByRole('group',{name:'Представление потоков'}).getByRole('button',{name:'Схема',exact:true}).click()
  await page.getByRole('button',{name:'Редактор схемы'}).click()
  const chooser=page.getByRole('region',{name:'Выбор информационной системы для редактора потоков'})
  await expect(chooser).toBeVisible()
  await chooser.getByRole('combobox',{name:'Выбрать ИС для редактора потоков'}).selectOption(id)
  const editor=page.getByRole('region',{name:'Редактор архитектурной схемы'})
  await expect(editor).toBeVisible()
  await expect(editor.getByRole('toolbar',{name:'Инструменты архитектуры'})).toBeVisible()
  await expect(editor.locator('.react-flow__node .homeNode')).toHaveCount(2)
  await editor.getByRole('toolbar').getByRole('button',{name:'▭ Сеть / контейнер'}).click()
  await expect(editor.getByText(/первый угол/)).toBeVisible()
  await page.getByRole('button',{name:'Завершить редактирование'}).click()
  await expect(editor).toHaveCount(0)
})
