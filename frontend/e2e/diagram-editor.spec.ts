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
  await tools.getByRole('button',{name:'→ Поток'}).click()
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

test('floating canvas palette keeps the workspace clear and opens properties on the right',async({page})=>{
  const id=await seedSystem(page)
  await page.goto('/')
  await page.getByRole('navigation',{name:'Разделы архитектуры'}).getByRole('button',{name:'Потоки',exact:true}).click()
  await page.getByRole('button',{name:'Редактор схемы'}).click()
  await page.getByRole('combobox',{name:'Выбрать ИС для редактора потоков'}).selectOption(id)
  const editor=page.getByRole('region',{name:'Редактор архитектурной схемы'})
  const stage=editor.locator('.boardEditorStage')
  const canvas=editor.locator('.boardCanvas')
  const toolbar=editor.getByRole('toolbar',{name:'Инструменты архитектуры'})
  await expect(toolbar).toBeVisible()
  await expect(editor.locator('.boardDock')).toHaveCount(0)
  const pane=await canvas.boundingBox(),rail=await toolbar.boundingBox()
  expect(pane&&rail&&rail.x>=pane.x&&rail.x+rail.width<pane.x+110).toBeTruthy()

  await toolbar.getByRole('button',{name:'→ Поток'}).click()
  const dock=editor.getByRole('complementary',{name:'Свойства и изменения схемы'})
  await expect(dock).toBeVisible()
  await expect(dock.getByLabel('Откуда')).toBeVisible()
  await expect(dock.getByLabel('Куда')).toBeVisible()
  const canvasBox=await canvas.boundingBox(),dockBox=await dock.boundingBox()
  expect(canvasBox&&dockBox&&canvasBox.x+canvasBox.width<=dockBox.x+2).toBeTruthy()
  await dock.getByRole('button',{name:'Закрыть настройки инструмента'}).click()
  await expect(dock).toHaveCount(0)
})

test('flow tool selects endpoints on canvas and opens its settings without a horizontal form',async({page})=>{
  const id=await seedSystem(page)
  await page.goto('/')
  await page.getByRole('navigation',{name:'Разделы архитектуры'}).getByRole('button',{name:'Компоненты',exact:true}).click()
  await page.getByRole('group',{name:'Представление компонентов'}).getByRole('button',{name:'Схема',exact:true}).click()
  await page.getByRole('button',{name:'Редактировать схему'}).click()
  await page.getByRole('combobox',{name:'Выбрать ИС для редактора компонентов'}).selectOption(id)
  const editor=page.getByRole('region',{name:'Редактор архитектурной схемы'})
  const toolbar=editor.getByRole('toolbar',{name:'Инструменты архитектуры'})
  await toolbar.getByRole('button',{name:'→ Поток'}).click()
  const source=editor.locator('.react-flow__node').filter({hasText:'Editor source'})
  const target=editor.locator('.react-flow__node').filter({hasText:'Editor destination'})
  await source.click()
  const dock=editor.getByRole('complementary',{name:'Свойства и изменения схемы'})
  await expect(dock.getByLabel('Откуда')).not.toHaveValue('')
  await target.click()
  await expect(dock.getByLabel('Куда')).not.toHaveValue('')
  await dock.getByLabel('Порт').fill('443')
  await dock.getByRole('button',{name:'Добавить поток'}).click()
  await expect(dock.getByRole('button',{name:/Проверить изменения/})).toBeVisible()
  await expect(editor.locator('.boardInspectorBackdrop')).toHaveCount(0)
})

test('component properties open in a non-modal right dock without hiding the diagram',async({page})=>{
  const id=await seedSystem(page)
  await page.goto('/')
  await page.getByRole('navigation',{name:'Разделы архитектуры'}).getByRole('button',{name:'Компоненты',exact:true}).click()
  await page.getByRole('group',{name:'Представление компонентов'}).getByRole('button',{name:'Схема',exact:true}).click()
  await page.getByRole('button',{name:'Редактировать схему'}).click()
  await page.getByRole('combobox',{name:'Выбрать ИС для редактора компонентов'}).selectOption(id)
  const editor=page.getByRole('region',{name:'Редактор архитектурной схемы'})
  await editor.locator('.react-flow__node').filter({hasText:'Editor source'}).click()
  const dialog=editor.getByRole('dialog',{name:/Паспорт компонента Editor source/})
  await expect(dialog).toBeVisible()
  await expect(editor.locator('.boardInspectorBackdrop')).toHaveCount(0)
  await expect(editor.locator('.boardCanvas')).toBeVisible()
  await dialog.getByRole('button',{name:'Закрыть паспорт'}).click()
  await expect(editor.locator('.boardDock')).toHaveCount(0)
})
