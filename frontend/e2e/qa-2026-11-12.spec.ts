import {test,expect,type Page} from '@playwright/test'

async function navigate(page:Page,section:'Потоки'|'Компоненты'){
 await page.goto('/')
 await page.getByRole('navigation',{name:'Разделы архитектуры'})
  .getByRole('button',{name:section,exact:true}).click()
}

test('AH-01: public demo network route shows an empty state without a white screen',async({page})=>{
 const exceptions:string[]=[]
 page.on('pageerror',error=>exceptions.push(error.message))
 await navigate(page,'Потоки')
 await expect(page.getByRole('region',{name:'Реестр технических потоков'})).toBeVisible()
 await page.getByRole('button',{name:'Сетевой маршрут',exact:true}).first().click()
 const drawer=page.getByRole('dialog',{name:'Технический маршрут потока'})
 await expect(drawer).toBeVisible()
 await expect(drawer.getByRole('region',{name:'Шаги технического маршрута'}))
  .toContainText('Промежуточные объекты не описаны')
 await expect(page.getByLabel('Версия сборки')).toBeVisible()
 expect(exceptions).toEqual([])
 await drawer.getByRole('button',{name:'Закрыть маршрут'}).click()
 await expect(drawer).toHaveCount(0)
})

test('AH-04: save restriction is visible before editing a demo flow',async({page})=>{
 await navigate(page,'Потоки')
 await expect(page.getByRole('region',{name:'Реестр технических потоков'})).toBeVisible()
 await page.getByRole('button',{name:'Редактировать',exact:true}).first().click()
 const drawer=page.getByRole('dialog',{name:'Редактор потока'})
 await expect(drawer).toBeVisible()
 await expect(drawer.getByRole('status')).toContainText('Демонстрационный режим')
 await expect(drawer.getByRole('button',{name:'Сохранить',exact:true})).toBeDisabled()
 await drawer.getByRole('button',{name:'Закрыть'}).click()
})

test('AH-02: clicking the connection label selects the flow, not its network container',async({page})=>{
 await page.addInitScript(()=>{
  sessionStorage.setItem('architecture-hub:access-token:session','browser-ci-development-token')
 })
 const suffix=String(Date.now())
 const systemResponse=await page.request.post('http://127.0.0.1:8001/api/objects',{
  data:{name:'QA edge label system '+suffix,kind:'system'}
 })
 expect(systemResponse.status()).toBe(201)
 const system=(await systemResponse.json()).id as string
 const vms:string[]=[]
 for(const name of ['QA source '+suffix,'QA receiver '+suffix]){
  const response=await page.request.post('http://127.0.0.1:8001/api/infra',{
   data:{name,system_id:system,kind:'vm'}
  })
  expect(response.status()).toBe(201)
  vms.push((await response.json()).id as string)
 }
 const network=await page.request.post('http://127.0.0.1:8001/api/networks',{
  data:{name:'QA network '+suffix,kind:'zone'}
 })
 expect(network.status()).toBe(201)
 const zoneId=(await network.json()).id as string
 const nic=await page.request.post('http://127.0.0.1:8001/api/network-interfaces',{
  data:{item_id:vms[0],name:'eth0',zone_id:zoneId}
 })
 expect(nic.status()).toBe(201)
 const flow=await page.request.post('http://127.0.0.1:8001/api/flows',{
  data:{source_id:vms[0],target_id:vms[1],name:'QA labelled exchange '+suffix,protocol:'HTTPS',port:'443'}
 })
 expect(flow.status()).toBe(201)
 await navigate(page,'Компоненты')
 await page.getByRole('group',{name:'Представление компонентов'})
  .getByRole('button',{name:'Схема'}).click()
 await page.getByRole('button',{name:'Редактировать схему'}).click()
 const chooser=page.getByRole('combobox',{name:'Выбрать ИС для редактора компонентов'})
 if(await chooser.isVisible())await chooser.selectOption(system)
 const editor=page.getByRole('region',{name:'Редактор архитектурной схемы'})
 await expect(editor.locator('.react-flow__node-boardNetwork')).toHaveCount(1)
 const label=editor.getByRole('button',{name:'Выбрать поток HTTPS:443'})
 await expect(label).toBeVisible()
 await label.click()
 const dock=editor.getByRole('complementary',{name:'Свойства и изменения схемы'})
 await expect(dock.getByRole('form',{name:'Редактирование существующего потока'})
  .getByLabel('Название потока')).toHaveValue('QA labelled exchange '+suffix)
 await expect(dock.getByText('QA network '+suffix,{exact:false})).toHaveCount(0)
})

const demoSystem='11111111-1111-4111-8111-111111111111'

test('AH-QA-001/002: guest can open both CMDB tabs and close the VM card',async({page})=>{
 const exceptions:string[]=[]
 page.on('pageerror',error=>exceptions.push(error.message))
 await page.goto('/components?system='+demoSystem)
 const vm=page.getByRole('row').filter({hasText:'DEMO-WEB-01'})
 await vm.getByRole('button',{name:'Открыть',exact:true}).click()
 const card=page.getByRole('dialog',{name:'Карточка компонента DEMO-WEB-01'})
 for(const tab of ['Влияние CMDB','Управление КЕ']){
  await card.getByRole('tab',{name:tab,exact:true}).click()
  await expect(card.getByText(/Войдите, чтобы посмотреть/)).toBeVisible()
 }
 await card.getByRole('button',{name:'Закрыть',exact:false}).first().click()
 await expect(card).toHaveCount(0)
 await expect(vm).toBeVisible()
 expect(exceptions).toEqual([])
})

test('AH-QA-003/004: passport link survives reload and empty search can be reset',async({page})=>{
 await page.goto('/systems')
 const registry=page.getByRole('table')
 await expect(registry.getByRole('button',{name:'Паспорт',exact:true})).toHaveCount(2)
 await registry.getByRole('row').filter({hasText:'Демо: портал сотрудников'}).getByRole('button',{name:'Паспорт'}).click()
 const passport=page.getByRole('complementary',{name:'Карточка архитектурного объекта'})
 await passport.getByRole('button',{name:'Развернуть карточку'}).click()
 await expect(page).toHaveURL('/systems?passport='+demoSystem+'&expanded=1')
 await page.reload()
 await expect(passport.getByRole('heading',{name:'Демо: портал сотрудников'})).toBeVisible()
 await expect(passport.getByRole('button',{name:'Свернуть карточку'})).toBeVisible()
 await page.goBack()
 await expect(page).toHaveURL('/systems')
 await expect(passport).toHaveCount(0)
 await page.getByRole('textbox',{name:'Фильтр по названию'}).fill('QA-WORK-ABSENT')
 await expect(registry.getByRole('status')).toHaveText('Системы не найдены.')
 await page.getByRole('button',{name:'Сбросить',exact:true}).click()
 await expect(registry.getByRole('button',{name:'Паспорт',exact:true})).toHaveCount(2)
})

test('AH-QA-005/006: opening a flow fits both endpoints and a guest can discard local edits',async({page})=>{
 await page.setViewportSize({width:1363,height:936})
 await page.goto('/flows?system='+demoSystem)
 await page.getByRole('button',{name:'Редактор потоков',exact:true}).click()
 const editor=page.getByRole('region',{name:'Редактор архитектурной схемы'})
 await editor.getByRole('button',{name:'Выбрать поток HTTPS:443'}).click()
 const dock=editor.getByRole('complementary',{name:'Свойства и изменения схемы'})
 const flow=dock.getByRole('form',{name:'Редактирование существующего потока'})
 await expect(flow).toBeVisible()
 await expect.poll(async()=>editor.locator('.boardCanvas').evaluate(canvas=>{
  const bounds=canvas.getBoundingClientRect()
  const nodes=Array.from(canvas.querySelectorAll('.react-flow__node-boardComponent'))
  return nodes.length===2&&nodes.every(node=>{
   const rect=node.getBoundingClientRect()
   return rect.left>=bounds.left&&rect.right<=bounds.right&&rect.top>=bounds.top&&rect.bottom<=bounds.bottom
  })
 })).toBe(true)
 await flow.getByLabel('Порт',{exact:true}).fill('444')
 await flow.getByRole('button',{name:'Добавить изменение в черновик'}).click()
 await expect(dock.getByText('Для проверки и сохранения изменений войдите по паролю.')).toBeVisible()
 await expect(dock.getByLabel('Причина изменений')).toHaveCount(0)
 await expect(dock.getByRole('button',{name:/Проверить изменения/})).toHaveCount(0)
 page.once('dialog',dialog=>dialog.accept())
 await dock.getByRole('button',{name:'Отменить черновик'}).click()
 await expect(editor.getByRole('button',{name:'Черновик: 0 изменений'})).toBeDisabled()
})

test('Unified overview changes relation semantics without duplicating the flow graph',async({page})=>{
 await page.goto('/')
 const map=page.getByRole('region',{name:'Главная карта архитектуры'})
 const mode=map.getByRole('group',{name:'Тип связей на архитектурной карте'})
 await expect(mode.getByRole('button',{name:'Потоки данных'})).toHaveAttribute('aria-pressed','true')
 await expect(map.locator('.react-flow')).toHaveCount(1)
 await mode.getByRole('button',{name:'Бизнес-связи'}).click()
 await expect(mode.getByRole('button',{name:'Бизнес-связи'})).toHaveAttribute('aria-pressed','true')
 await expect(map.getByText(/не направление передачи данных/)).toBeVisible()
 await mode.getByRole('button',{name:'Сети и зоны'}).click()
 await expect(map.getByText(/не означает наличие разрешённого маршрута/)).toBeVisible()
 await navigate(page,'Потоки')
 await expect(page.getByRole('region',{name:'Реестр технических потоков'})).toBeVisible()
 await expect(page.locator('[data-active-graph="flows"]')).toHaveCount(0)
 await page.getByRole('button',{name:'Общая карта связей'}).click()
 await expect(map).toBeVisible()
})

test('Architecture overlay layers overlap without moving system and VM nodes',async({page})=>{
 await page.goto('/')
 const map=page.getByRole('region',{name:'Главная карта архитектуры'})
 const toolbar=map.getByLabel('Накладываемые слои')
 const systemNodes=map.locator('.react-flow__node').filter({hasText:'Демо: портал сотрудников'})
 const getPosition=()=>systemNodes.first().getAttribute('style')
 const initial=await getPosition()
 const businessLayer=toolbar.getByRole('checkbox',{name:'Бизнес-категории'})
 const networkLayer=toolbar.getByRole('checkbox',{name:'Сети и зоны'})
 await businessLayer.check()
 await networkLayer.check()
 await expect(toolbar.getByRole('checkbox',{name:'Бизнес-категории'})).toBeChecked()
 await expect(toolbar.getByRole('checkbox',{name:'Сети и зоны'})).toBeChecked()
 // The view can gain or lose translucent group nodes, but base coordinates stay fixed.
 expect(await getPosition()).toBe(initial)
 await toolbar.getByRole('checkbox',{name:'Показать ВМ и компоненты'}).check()
 const componentPositions=await map.locator('.react-flow__node').filter({hasText:'DEMO-WEB-01'}).first().getAttribute('style')
 await businessLayer.uncheck()
 await networkLayer.uncheck()
 expect(await map.locator('.react-flow__node').filter({hasText:'DEMO-WEB-01'}).first().getAttribute('style')).toBe(componentPositions)
})
