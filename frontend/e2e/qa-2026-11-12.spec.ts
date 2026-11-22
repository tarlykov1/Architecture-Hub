import {openWorkspace} from './workspaceNavigation'
import {test,expect,type Page} from '@playwright/test'

async function navigate(page:Page,section:'Потоки'|'Компоненты'){
 await page.goto('/')
 await openWorkspace(page,section)
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
 const label=editor.getByRole('button',{name:'Выбрать поток QA labelled exchange '+suffix})
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
 await editor.getByRole('button',{name:'Выбрать поток Демо: запросы портала'}).click()
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
 await expect(mode.getByRole('button',{name:'Бизнес-связи'})).toHaveAttribute('aria-pressed','true')
 await expect(map.locator('.react-flow')).toHaveCount(1)
 await mode.getByRole('button',{name:'Бизнес-связи'}).click()
 await expect(mode.getByRole('button',{name:'Бизнес-связи'})).toHaveAttribute('aria-pressed','true')
 await map.locator('.overviewLegend summary').click()
 await expect(map.getByText(/не направление передачи данных/)).toBeVisible()
 await expect(mode.getByRole('button',{name:'Сети и зоны'})).toHaveCount(0)
 await mode.getByRole('button',{name:'Потоки данных'}).click()
 await navigate(page,'Потоки')
 await expect(page.getByRole('region',{name:'Реестр технических потоков'})).toBeVisible()
 await expect(page.locator('[data-active-graph="flows"]')).toHaveCount(0)
 await page.getByRole('link',{name:'Общая карта связей'}).click()
 await expect(map).toBeVisible()
})

test('Guest overview handles an empty area catalog without drawing a region',async({page})=>{
 await page.goto('/')
 const map=page.getByRole('region',{name:'Главная карта архитектуры'})
 await expect(map.locator('.react-flow__node').filter({hasText:'Демо: портал сотрудников'})).toHaveCount(1)
 await expect(map.locator('.systemAreaLabel')).toHaveCount(0)
 await expect(map.locator('.react-flow__node-layerRegion')).toHaveCount(0)
 await expect(map.getByRole('button',{name:'Изменить состав бизнес-областей'})).toHaveCount(0)
})

test('Overview labels a shared system once for each selected business area',async({page})=>{
 await page.addInitScript(()=>sessionStorage.setItem('architecture-hub:access-token:session','browser-ci-development-token'))
 const api='http://127.0.0.1:8001',suffix=String(Date.now())
 const create=async(path:string,data:Record<string,unknown>)=>{
  const response=await page.request.post(api+path,{data})
  expect(response.status(),await response.text()).toBe(201)
  return (await response.json()).id as string
 }
 const system=await create('/api/objects',{kind:'system',name:'QA-WORK-Overlay system '+suffix})
 const first=await create('/api/business/categories',{name:'QA-WORK-Overlay first '+suffix})
 const second=await create('/api/business/categories',{name:'QA-WORK-Overlay second '+suffix})
 for(const [index,category_id] of [first,second].entries()){
  const process=await create('/api/business/processes',{name:'QA-WORK-Overlay process '+index+' '+suffix,category_id})
  await create('/api/business/system-links',{process_id:process,system_id:system,role:'consumer'})
 }
 await page.goto('/')
 const map=page.getByRole('region',{name:'Главная карта архитектуры'})
 const card=map.locator('.react-flow__node[data-id="'+system+'"]')
 await expect(card).toHaveCount(1)
 const before=await card.evaluate(node=>(node as HTMLElement).style.transform)
 const firstChoice=map.getByRole('button',{name:'QA-WORK-Overlay first '+suffix})
 const secondChoice=map.getByRole('button',{name:'QA-WORK-Overlay second '+suffix})
 await firstChoice.click()
 await expect(firstChoice).toHaveAttribute('aria-pressed','true')
 await expect(card.locator('.systemAreaLabel')).toHaveText(['QA-WORK-Overlay first '+suffix])
 await secondChoice.click()
 await expect(secondChoice).toHaveAttribute('aria-pressed','true')
 await expect(card.locator('.systemAreaLabel')).toHaveCount(2)
 await expect(card).toContainText('QA-WORK-Overlay second '+suffix)
 await expect(map.locator('.react-flow__node-layerRegion')).toHaveCount(0)
 expect(await card.evaluate(node=>(node as HTMLElement).style.transform)).toBe(before)
 await firstChoice.click()
 await expect(card.locator('.systemAreaLabel')).toHaveText(['QA-WORK-Overlay second '+suffix])
 const participants=map.getByRole('checkbox',{name:'Только участники'})
 await participants.check()
 await expect(map.locator('.react-flow__node')).toHaveCount(1)
 await expect(card.locator('.systemAreaLabel')).toHaveCount(1)
 await participants.uncheck()
 expect(await card.evaluate(node=>(node as HTMLElement).style.transform)).toBe(before)
 await secondChoice.click()
 await expect(card.locator('.systemAreaLabel')).toHaveCount(0)

})

test('Architecture regions save selected IS membership and color in server storage',async({page})=>{
 await page.addInitScript(()=>sessionStorage.setItem('architecture-hub:access-token:session','browser-ci-development-token'))
 const suffix=String(Date.now())
 const base='http://127.0.0.1:8001'
 const system=await page.request.post(base+'/api/objects',{data:{name:'QA-WORK-Layer owner '+suffix,kind:'system'}})
 expect(system.status()).toBe(201)
 const systemId=(await system.json()).id as string
 const category=await page.request.post(base+'/api/business/categories',{data:{name:'QA-WORK-Layer category '+suffix}})
 expect(category.status()).toBe(201)
 const categoryId=(await category.json()).id as string
 const process=await page.request.post(base+'/api/business/processes',{data:{name:'QA-WORK-Layer process '+suffix,category_id:categoryId}})
 expect(process.status()).toBe(201)
 const processId=(await process.json()).id as string
 const link=await page.request.post(base+'/api/business/system-links',{data:{process_id:processId,system_id:systemId,role:'consumer'}})
 expect(link.status()).toBe(201)
 await page.goto('/')
 const map=page.getByRole('region',{name:'Главная карта архитектуры'})
 await map.getByRole('button',{name:'Изменить состав бизнес-областей'}).click()
 const fixedSystem=map.locator('.react-flow__node').filter({hasText:'QA-WORK-Layer owner '+suffix}).first()
 await expect(fixedSystem).toHaveAttribute('class',/react-flow__node/)
 const tools=map.getByRole('toolbar',{name:'Инструменты слоёв'})
 await map.getByRole('complementary',{name:'Свойства архитектурной области'}).getByRole('combobox',{name:'Выбрать архитектурную область'}).selectOption('business:'+categoryId)
 const editor=map.getByRole('region',{name:'Состав области'})
 await expect(editor).toBeVisible()
 await expect(editor.getByRole('checkbox',{name:'QA-WORK-Layer owner '+suffix})).toBeChecked()
 await editor.getByRole('checkbox',{name:'QA-WORK-Layer owner '+suffix}).uncheck()
 const dock=map.getByRole('complementary',{name:'Свойства архитектурной области'})
 await dock.getByLabel('Цвет выбранной области').fill('#315dcc')
 await map.getByRole('button',{name:'Сохранить области'}).click()
 await expect(map.getByRole('button',{name:'Изменить состав бизнес-областей'})).toBeVisible()
 const response=await page.request.get(base+'/api/diagrams/layer-regions')
 expect(response.status()).toBe(200)
 const area=(await response.json() as Array<{group_key:string;members:string[];color:string;opacity:number;width:number}>).find(item=>item.group_key==='business:'+categoryId)
 expect(area).toBeTruthy()
 expect(area?.members).not.toContain(systemId)
 expect(area?.color).toBe('#315dcc')
 // Presentation membership must not rewrite canonical business membership.
 const links=await (await page.request.get(base+'/api/business/system-links')).json() as Array<{process_id:string;system_id:string}>
 expect(links.some(item=>item.process_id===processId&&item.system_id===systemId)).toBe(true)
 await page.reload()
 await expect(map.getByRole('button',{name:'Изменить состав бизнес-областей'})).toBeVisible()
 await map.getByRole('button',{name:'Изменить состав бизнес-областей'}).click()
 const restoredDock=map.getByRole('complementary',{name:'Свойства архитектурной области'})
 await restoredDock.getByRole('combobox',{name:'Выбрать архитектурную область'}).selectOption('business:'+categoryId)
 await expect(restoredDock.getByLabel('Цвет выбранной области')).toHaveValue('#315dcc')
})

test('QA-WORK: mobile layer editor preserves separate tools, canvas and properties',async({page})=>{
 await page.setViewportSize({width:390,height:844})
 await page.addInitScript(()=>sessionStorage.setItem('architecture-hub:access-token:session','browser-ci-development-token'))
 await page.goto('/')
 const map=page.getByRole('region',{name:'Главная карта архитектуры'})
 await expect(map).toBeVisible()
 await map.getByRole('button',{name:'Изменить состав бизнес-областей'}).click()
 const tools=map.getByRole('toolbar',{name:'Инструменты слоёв'})
 const canvas=map.locator('.homeLayerEditorStage .homeMapGraph')
 const dock=map.getByRole('complementary',{name:'Свойства архитектурной области'})
 await expect(tools).toBeVisible()
 await expect(canvas).toBeVisible()
 await expect(dock).toBeVisible()
 const rail=await tools.boundingBox(),stage=await canvas.boundingBox(),properties=await dock.boundingBox()
 expect(rail&&stage&&properties).toBeTruthy()
 // At mobile widths the inspector is beneath the canvas, never over it.
 expect(rail!.x+rail!.width<=stage!.x+3).toBe(true)
 expect(properties!.y>=stage!.y+stage!.height-3).toBe(true)
 await tools.getByRole('button',{name:'Отменить изменения областей'}).click()
 await expect(map.getByRole('button',{name:'Изменить состав бизнес-областей'})).toBeVisible()
})


test('QA-WORK: network records remain intact and absent from overview',async({page})=>{
 const api='http://127.0.0.1:8001',suffix=String(Date.now())
 const create=async(path:string,data:Record<string,unknown>)=>{
  const response=await page.request.post(api+path,{data})
  expect(response.status(),await response.text()).toBe(201)
  return (await response.json()).id as string
 }
 const system=await create('/api/objects',{kind:'system',name:'QA-WORK-Overview system '+suffix})
 const source=await create('/api/infra',{system_id:system,kind:'vm',name:'QA-WORK-Source '+suffix})
 const target=await create('/api/infra',{system_id:system,kind:'vm',name:'QA-WORK-Target '+suffix})
 const vrf=await create('/api/networks',{name:'QA-WORK-VRF '+suffix,kind:'vrf'})
 const nic=await create('/api/network-interfaces',{item_id:source,name:'eth0',vrf_id:vrf})
 const flow=await create('/api/flows',{source_id:source,target_id:target,name:'QA-WORK-Flow '+suffix})
 await page.goto('/')
 const map=page.getByRole('region',{name:'Главная карта архитектуры'})
 await expect(map.getByRole('button',{name:'Сети и зоны'})).toHaveCount(0)
 await expect(map.getByText('QA-WORK-VRF '+suffix)).toHaveCount(0)
 const objects=await (await page.request.get(api+'/api/objects')).json() as Array<{id:string;name:string}>
 expect(objects.find(item=>item.id===system)?.name).toBe('QA-WORK-Overview system '+suffix)
 const nics=await (await page.request.get(api+'/api/network-interfaces')).json() as Array<{id:string;vrf_id:string}>
 const flows=await (await page.request.get(api+'/api/flows')).json() as Array<{id:string;source_id:string;target_id:string}>
 expect(nics.find(item=>item.id===nic)?.vrf_id).toBe(vrf)
 expect(flows.find(item=>item.id===flow)).toMatchObject({source_id:source,target_id:target})
})

test('QA-WORK: stale layer drafts cannot overwrite a newer architecture region',async({page})=>{
 await page.addInitScript(()=>sessionStorage.setItem('architecture-hub:access-token:session','browser-ci-development-token'))
 const api='http://127.0.0.1:8001',suffix=String(Date.now())
 const category=await page.request.post(api+'/api/business/categories',{
   data:{name:'QA-WORK-Concurrent region '+suffix}
 })
 expect(category.status()).toBe(201)
 const key='business:'+(await category.json()).id
 const url=api+'/api/diagrams/layer-regions/'+key
 const baseline={x:100,y:80,width:420,height:290,color:'#336699',opacity:.32,members:[],expected_revision:null}
 const first=await page.request.put(url,{data:baseline})
 expect(first.status()).toBe(200,await first.text())
 expect((await first.json()).revision).toBe(1)

 await page.goto('/')
 const map=page.getByRole('region',{name:'Главная карта архитектуры'})
 await map.getByRole('button',{name:'Изменить состав бизнес-областей'}).click()
 const dock=map.getByRole('complementary',{name:'Свойства архитектурной области'})
 await dock.getByRole('combobox',{name:'Выбрать архитектурную область'}).selectOption(key)
 await dock.getByLabel('Цвет выбранной области').fill('#234567')
 await expect(map.getByRole('button',{name:'Сохранить области'})).toBeEnabled()

 // Another editor commits a newer revision while this browser keeps its draft.
 const remote=await page.request.put(url,{data:{...baseline,x:555,color:'#6622aa',expected_revision:1}})
 expect(remote.status()).toBe(200,await remote.text())
 expect((await remote.json()).revision).toBe(2)
 await map.getByRole('button',{name:'Сохранить области'}).click()
 await expect(dock.getByRole('alert')).toContainText(/изменена|конкурентн/i)
 await expect(dock.getByRole('button',{name:'Обновить области и отбросить мой черновик'})).toBeVisible()
 // The failed operation must preserve the full unsaved local draft.
 await expect(dock.getByLabel('Цвет выбранной области')).toHaveValue('#234567')
 await expect(map.getByRole('button',{name:'Сохранить области'})).toBeEnabled()
 const actual=await page.request.get(api+'/api/diagrams/layer-regions')
 const stored=(await actual.json() as Array<{group_key:string;x:number;revision:number}>).find(row=>row.group_key===key)
 expect(stored).toMatchObject({group_key:key,x:555,revision:2})

 // Recovery is explicit: only clicking refresh drops the local draft.
 await dock.getByRole('button',{name:'Обновить области и отбросить мой черновик'}).click()
 await expect(map.getByRole('button',{name:'Изменить состав бизнес-областей'})).toBeVisible()
 await map.getByRole('button',{name:'Изменить состав бизнес-областей'}).click()
 const reopened=map.getByRole('complementary',{name:'Свойства архитектурной области'})
 await reopened.getByRole('combobox',{name:'Выбрать архитектурную область'}).selectOption(key)

 await expect(reopened.getByLabel('Цвет выбранной области')).toHaveValue('#6622aa')
})
