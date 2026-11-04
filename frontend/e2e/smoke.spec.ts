import { expect, test, type Page } from '@playwright/test'

async function navigateTo(page: Page, section: 'Реестр сетей'|'Инциденты'|'Топология сетей') {
  const mobile=page.locator('nav.layerTabs details.mobileSectionMenu')
  if(page.viewportSize()!.width<650){
    await mobile.locator('summary').click()
    await mobile.getByRole('button',{name:section,exact:true}).click()
    return
  }
  const menu=page.locator('nav.layerTabs details.secondaryNavigation')
  await menu.locator('summary').click()
  await menu.getByRole('button',{name:section,exact:true}).click()
}



async function openSystemInRegistry(page: Page, name: string) {
  await page.getByRole('navigation',{name:'Разделы архитектуры'}).getByRole('button',{name:'Системы',exact:true}).click()
  const row=page.locator('.systemsTable tbody tr').filter({has:page.getByRole('button',{name,exact:true})})
  await row.getByRole('button',{name,exact:true}).click()
}

async function openSystemComponents(page: Page, name: string) {
  await page.getByRole('navigation',{name:'Разделы архитектуры'}).getByRole('button',{name:'Системы',exact:true}).click()
  const row=page.locator('.systemsTable tbody tr').filter({has:page.getByRole('button',{name,exact:true})})
  await row.getByRole('button',{name:'Компоненты'}).click()
}

test('Wiki.js entry remains discoverable without configured connector',async({page})=>{
  await page.goto('/')
  const menu=page.getByRole('navigation',{name:'Разделы архитектуры'}).locator('details.secondaryNavigation')
  await menu.locator('summary').click()
  await menu.getByRole('button',{name:'Wiki.js · База знаний',exact:true}).click()
  const knowledge=page.getByRole('region',{name:'База знаний Wiki.js'})
  await expect(knowledge).toBeVisible()
  await expect(knowledge.getByRole('heading',{name:'База знаний · Wiki.js'})).toBeVisible()
  await expect(knowledge.getByRole('status')).toBeVisible()
  await expect(knowledge.getByRole('heading',{name:'Документация по системам'})).toBeVisible()
})

test('workspace navigation is integrated into the single global header',async({page})=>{
  await page.goto('/')
  const header=page.getByRole('banner',{name:'Главная панель Architecture Hub'})
  const navigation=header.getByRole('navigation',{name:'Разделы архитектуры'})
  await expect(navigation).toBeVisible()
  await expect(page.locator('main.main nav.layerTabs')).toHaveCount(0)
  await expect(header.getByRole('button',{name:'Обзор',exact:true})).toBeVisible()
  await navigation.getByRole('button',{name:'Системы',exact:true}).click()
  await expect(navigation.getByRole('button',{name:'Системы',exact:true})).toHaveClass(/current/)
  await navigation.getByRole('button',{name:'Компоненты',exact:true}).click()
  await expect(navigation.getByRole('button',{name:'Компоненты',exact:true})).toHaveClass(/current/)
  await navigation.locator('details.secondaryNavigation summary').click()
  await navigation.getByRole('button',{name:'Реестр сетей',exact:true}).click()
  await expect(navigation.locator('details.secondaryNavigation summary')).toContainText('Реестр сетей')
})

test('system creation has a single action in the create menu',async({page})=>{
  await page.goto('/')
  await expect(page.getByRole('button',{name:'+ Добавить объект'})).toHaveCount(0)
  await page.locator('nav.layerTabs .navEnd summary').click()
  await page.locator('nav.layerTabs .navEnd').getByRole('button',{name:'Система',exact:true}).click()
  const editor=page.getByRole('dialog',{name:'Создать объект архитектуры'})
  await expect(editor).toBeVisible()
  const name='E2E new system '+Date.now()
  await editor.getByRole('textbox',{name:'Название'}).fill(name)
  await editor.getByRole('button',{name:'+ Добавить'}).click()
  await expect(editor).toBeHidden()
  await page.getByRole('navigation',{name:'Разделы архитектуры'}).getByRole('button',{name:'Системы',exact:true}).click()
  await expect(page.locator('.systemsTable').getByRole('button',{name,exact:true})).toBeVisible()
})

test('compact navigation exposes secondary tools without duplicate catalog',async({page})=>{
  await page.goto('/')
  await expect(page.locator('aside.sidebar')).toHaveCount(0)
  await expect(page.locator('.homeMapGraph')).toBeVisible()
  await page.getByRole('navigation',{name:'Разделы архитектуры'}).getByRole('button',{name:'Системы',exact:true}).click()
  await expect(page.locator('.systemsTable')).toBeVisible()
  await navigateTo(page,'Реестр сетей')
  await expect(page.getByRole('textbox',{name:'Поиск сети'})).toBeVisible()
  await navigateTo(page,'Топология сетей')
  await expect(page.getByRole('button',{name:'Редактировать топологию'})).toBeVisible()
})

test('catalog loads and saved workspace views survive reload', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('navigation',{name:'Разделы архитектуры'}).getByRole('button',{name:'Обзор'})).toBeVisible()
  await page.getByRole('button', { name: 'Системы', exact: true }).click()
  const filter = page.getByRole('textbox', { name: 'Фильтр по названию' })
  await filter.fill('ci-nonexistent-system')
  await page.getByRole('button',{name:/Представления/}).click()
  page.once('dialog', dialog => dialog.accept('CI: пустой результат'))
  await page.getByRole('button', { name: 'Сохранить вид' }).click()
  await expect(page.getByRole('combobox', { name: 'Сохранённое представление' })).toHaveValue(/.+/)
  await page.reload()
  await page.getByRole('button', { name: 'Системы', exact: true }).click()
  await page.getByRole('button',{name:/Представления/}).click()
  await page.getByRole('combobox', { name: 'Сохранённое представление' }).selectOption({ label: 'CI: пустой результат' })
  await expect(page.getByRole('textbox', { name: 'Фильтр по названию' })).toHaveValue('ci-nonexistent-system')
  await page.getByRole('button', { name: 'Сбросить' }).click()
  await expect(page.getByRole('textbox', { name: 'Фильтр по названию' })).toHaveValue('')
})

test('network registry and incidents navigation do not crash', async ({ page }) => {
  await page.goto('/')
  await navigateTo(page,'Реестр сетей')
  await expect(page.getByRole('heading', { name: 'Реестр сетей' })).toBeVisible()
  await expect(page.getByRole('textbox', { name: 'Поиск сети' })).toBeVisible()
  await navigateTo(page,'Инциденты')
  await expect(page.getByRole('heading', { name: 'Реестр инцидентов' })).toBeVisible()
})

test('team view is saved through API and reused after reload', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Системы', exact: true }).click()
  await page.getByRole('textbox', { name: 'Фильтр по названию' }).fill('e2e-team-filter')
  await page.getByRole('button',{name:/Представления/}).click()
  page.once('dialog', dialog => dialog.accept('E2E team workspace'))
  await page.getByRole('button', { name: 'Сохранить для команды' }).click()
  await expect(page.getByRole('combobox', { name: 'Командное представление' })).toHaveValue(/.+/)
  await page.reload()
  await page.getByRole('button', { name: 'Системы', exact: true }).click()
  await page.getByRole('button',{name:/Представления/}).click()
  await page.getByRole('combobox', { name: 'Командное представление' }).selectOption({ label: 'E2E team workspace' })
  await expect(page.getByRole('textbox', { name: 'Фильтр по названию' })).toHaveValue('e2e-team-filter')
  await page.getByRole('button', { name: 'Удалить общий вид' }).click()
  await expect(page.getByRole('combobox', { name: 'Командное представление' })).toHaveValue('')
})

test('create network and incident from visible forms', async ({ page }) => {
  await page.goto('/')
  await navigateTo(page,'Реестр сетей')
  await page.getByRole('button', { name: '+ Создать сеть' }).click()
  const networkDialog=page.getByRole('dialog', { name: 'Редактор сети' })
  await expect(networkDialog).toBeVisible()
  await networkDialog.getByRole('textbox', { name: 'Название' }).fill('CI-NETWORK-E2E')
  await networkDialog.getByRole('button', { name: 'Сохранить', exact: true }).click()
  await expect(networkDialog).toBeHidden()
  await expect(page.getByRole('cell', { name: 'CI-NETWORK-E2E' })).toBeVisible()
  await navigateTo(page,'Инциденты')
  await page.getByRole('button', { name: '+ Инцидент' }).click()
  const incident=page.locator('.incidentDetail')
  await incident.getByRole('textbox', { name: 'Название' }).fill('CI incident browser test')
  await incident.getByRole('button', { name: 'Сохранить инцидент' }).click()
  await expect(incident.getByRole('heading', { name: 'CI incident browser test' })).toBeVisible()
})

test('selected system downloads a KIS Excel file', async ({ page }) => {
  const name='CI KIS export '+Date.now()
  const created=await page.request.post('http://127.0.0.1:8001/api/objects',{data:{name,kind:'system',description:'Workbook export test'}})
  expect(created.status()).toBe(201)
  await page.goto('/')
  await openSystemInRegistry(page,name)
  await page.locator('nav.layerTabs .navEnd details.layerActions summary').click()
  const exportButton=page.getByRole('button',{name:'Экспорт КИС в Excel'})
  await expect(exportButton).toBeEnabled()
  const [download]=await Promise.all([page.waitForEvent('download'),exportButton.click()])
  expect(download.suggestedFilename()).toMatch(/^KIS_[a-z0-9]+\.xlsx$/)
  const path=await download.path()
  expect(path).toBeTruthy()
})

test('component card shows passport, interfaces and flows tabs', async ({ page }) => {
  const name='UX-TEST Component System '+Date.now()
  const componentName=name+' VM'
  const created=await page.request.post('http://127.0.0.1:8001/api/objects',{data:{name,kind:'system'}})
  expect(created.status()).toBe(201)
  const systemId=(await created.json()).id
  const vm=await page.request.post('http://127.0.0.1:8001/api/infra',{data:{system_id:systemId,name:componentName,kind:'vm',description:'Test node'}})
  expect(vm.status()).toBe(201)
  await page.goto('/')
  await page.getByRole('navigation',{name:'Разделы архитектуры'}).getByRole('button',{name:'Компоненты',exact:true}).click()
  await page.getByRole('combobox',{name:'Система компонентов'}).selectOption(systemId)
  await page.getByRole('textbox',{name:'Фильтр по названию'}).fill(componentName)
  await page.getByRole('group',{name:'Представление компонентов'}).getByRole('button',{name:'Карточки',exact:true}).click()
  await page.getByRole('button',{name:'Карточка компонента'}).click()
  const dialog=page.getByRole('dialog',{name:'Карточка компонента '+componentName})
  await expect(dialog).toBeVisible()
  await expect(dialog.getByText('Test node')).toBeVisible()
  await dialog.getByRole('tab',{name:'Сети'}).click()
  await expect(dialog.getByText('Интерфейсы пока не описаны.')).toBeVisible()
  await dialog.getByRole('tab',{name:'Потоки'}).click()
  await expect(dialog.getByText(/Описанных потоков нет/)).toBeVisible()
  await dialog.getByRole('button',{name:/Закрыть/}).click()
  await expect(dialog).toBeHidden()
})

test('inspector avoids duplicate architecture action when selected architecture is already open', async ({ page }) => {
  const title='E2E-architecture-context-'+Date.now()
  const result=await page.request.post('http://127.0.0.1:8001/api/objects',{data:{name:title,kind:'system'}})
  expect(result.status()).toBe(201)
  await page.goto('/')
  await openSystemComponents(page,title)
  const panel=page.getByRole('complementary',{name:'Карточка архитектурного объекта'})
  await expect(panel).toHaveCount(0)
  await expect(page.getByRole('combobox',{name:'Система компонентов'})).toBeVisible()
  await expect(page.getByRole('button',{name:'Открыть архитектуру →'})).toHaveCount(0)
})

test('right inspector opens on demand and can be closed to free diagram space', async ({page})=>{
  const name='E2E drawer '+Date.now()
  const created=await page.request.post('http://127.0.0.1:8001/api/objects',{data:{name,kind:'system'}})
  expect(created.status()).toBe(201)
  await page.goto('/')
  const panel=page.getByRole('complementary',{name:'Карточка архитектурного объекта'})
  await expect(panel).toHaveCount(0)
  await openSystemInRegistry(page,name)
  await expect(panel).toBeVisible()
  await panel.getByRole('button',{name:'Закрыть правую панель'}).click()
  await expect(panel).toHaveCount(0)
})

test('infrastructure graph permits connecting components',async({page})=>{
 const systemName='link-test-'+Date.now()
 const resp=await page.request.post('http://127.0.0.1:8001/api/objects',{data:{name:systemName,kind:'system'}})
 expect(resp.ok()).toBeTruthy()
 const id=(await resp.json()).id
 for(const name of ['source-node','target-node'])expect((await page.request.post('http://127.0.0.1:8001/api/infra',{data:{system_id:id,name,kind:'service'}})).ok()).toBeTruthy()
 await page.goto('/')
 await openSystemComponents(page,systemName)
 await page.getByRole('combobox',{name:'Система компонентов'}).selectOption(id)
 await page.getByRole('group',{name:'Представление компонентов'}).getByRole('button',{name:'Схема',exact:true}).click()
 const handles=page.locator('.miniArchitecture .react-flow__handle')
 await expect(handles).toHaveCount(4)
})

test('single component diagram stays compact after auto-fit',async({page})=>{
  const name='Compact component '+Date.now()
  const res=await page.request.post('http://127.0.0.1:8001/api/objects',{data:{name,kind:'system'}})
  expect(res.status()).toBe(201)
  const id=(await res.json()).id
  const vm=await page.request.post('http://127.0.0.1:8001/api/infra',{data:{system_id:id,name:'Only VM',kind:'vm'}})
  expect(vm.status()).toBe(201)
  await page.goto('/')
  await openSystemComponents(page,name)
  const graph=page.locator('.miniArchitecture')
  await expect(graph.locator('.react-flow__node')).toHaveCount(1)
  await expect.poll(async()=>graph.locator('.react-flow__viewport').evaluate(el=>{
    const transform=(el as HTMLElement).style.transform
    const scale=Number(transform.match(/scale\(([^)]+)\)/)?.[1]||0)
    return scale>0&&scale<=0.851
  })).toBe(true)
})

test('component whiteboard packs unlinked nodes and saves dragged placement',async({page})=>{
  const name='Whiteboard '+Date.now()
  const system=await page.request.post('http://127.0.0.1:8001/api/objects',{data:{name,kind:'system'}})
  expect(system.status()).toBe(201)
  const id=(await system.json()).id
  for(let i=0;i<9;i++){
    const result=await page.request.post('http://127.0.0.1:8001/api/infra',{data:{system_id:id,name:'Whiteboard VM '+i,kind:'vm'}})
    expect(result.status()).toBe(201)
  }
  await page.goto('/')
  await openSystemComponents(page,name)
  const graph=page.locator('.miniArchitecture')
  await expect(graph.locator('.react-flow__node')).toHaveCount(9)
  const rows=await graph.locator('.react-flow__node').evaluateAll(nodes=>new Set(nodes.map(n=>Math.round(n.getBoundingClientRect().top/10))).size)
  expect(rows).toBeGreaterThan(1)
  await page.getByRole('button',{name:'Редактировать схему'}).click()
  await expect(page.getByRole('toolbar',{name:'Инструменты схемы компонентов'})).toBeVisible()
  const node=graph.locator('.react-flow__node').first()
  const before=await node.getAttribute('style')
  const rect=await node.boundingBox()
  expect(rect).not.toBeNull()
  await page.mouse.move(rect!.x+rect!.width/2,rect!.y+rect!.height/2)
  await page.mouse.down()
  await page.mouse.move(rect!.x+rect!.width/2+105,rect!.y+rect!.height/2+50,{steps:8})
  await page.mouse.up()
  await expect.poll(async()=>node.getAttribute('style')).not.toBe(before)
  await expect.poll(async()=>page.evaluate((systemId)=>Boolean(JSON.parse(localStorage.getItem('architecture-hub-component-canvas-v1')||'{}')[systemId]),id)).toBe(true)
  await page.reload()
  await openSystemComponents(page,name)
  const stored=await page.evaluate((systemId)=>JSON.parse(localStorage.getItem('architecture-hub-component-canvas-v1')||'{}')[systemId],id)
  expect(Object.keys(stored).length).toBeGreaterThan(0)
})

test('whiteboard connect tool opens technical flow editor without creating a bare line',async({page})=>{
  const name='Connection board '+Date.now()
  const system=await page.request.post('http://127.0.0.1:8001/api/objects',{data:{name,kind:'system'}})
  expect(system.status()).toBe(201)
  const id=(await system.json()).id
  for(const componentName of ['Connector source','Connector target']){
    const result=await page.request.post('http://127.0.0.1:8001/api/infra',{data:{system_id:id,name:componentName,kind:'service'}})
    expect(result.status()).toBe(201)
  }
  await page.goto('/')
  await openSystemComponents(page,name)
  await page.getByRole('button',{name:'Редактировать схему'}).click()
  await page.getByRole('group',{name:'Инструмент доски'}).getByRole('button',{name:'Связать'}).click()
  const nodes=page.locator('.miniArchitecture .react-flow__node')
  await nodes.filter({hasText:'Connector source'}).click()
  await nodes.filter({hasText:'Connector target'}).click()
  await expect(page.getByRole('dialog',{name:'Редактор потока'})).toBeVisible()
  await expect(page.locator('.miniArchitecture .react-flow__edge')).toHaveCount(0)
})

test('neighboring systems toggle reveals cross-system linked components',async({page})=>{
 const stamp=Date.now()
 const names=['Cross source '+stamp,'Cross neighbor '+stamp]
 const systems=[]
 for(const name of names){
  const response=await page.request.post('http://127.0.0.1:8001/api/objects',{data:{name,kind:'system'}})
  expect(response.status()).toBe(201)
  systems.push((await response.json()).id)
 }
 const components=[]
 for(let i=0;i<2;i++){
  const response=await page.request.post('http://127.0.0.1:8001/api/infra',{data:{system_id:systems[i],name:'Cross VM '+i+' '+stamp,kind:'vm'}})
  expect(response.status()).toBe(201)
  components.push((await response.json()).id)
 }
 const flow=await page.request.post('http://127.0.0.1:8001/api/flows',{data:{source_id:components[0],target_id:components[1],name:'cross system integration',protocol:'HTTPS',verification:'draft'}})
 expect(flow.status()).toBe(201)
 await page.goto('/')
 await openSystemComponents(page,names[0])
 const diagram=page.locator('.miniArchitecture')
 await expect(diagram.locator('.react-flow__node')).toHaveCount(1)
 await page.getByRole('checkbox',{name:'Смежные ИС'}).check()
 await expect(diagram.locator('.react-flow__node')).toHaveCount(2)
 await expect(diagram.locator('.react-flow__edge')).toHaveCount(1)
 await expect(diagram.getByText('ВНЕШНЯЯ ИС')).toBeVisible()
 await page.getByRole('checkbox',{name:'Смежные ИС'}).uncheck()
 await expect(diagram.locator('.react-flow__node')).toHaveCount(1)
})

test('infrastructure diagram defaults to view mode and editing is explicit',async({page})=>{
 const name='ReadOnly graph '+Date.now()
 const response=await page.request.post('http://127.0.0.1:8001/api/objects',{data:{name,kind:'system'}})
 expect(response.status()).toBe(201)
 await page.goto('/')
 await openSystemComponents(page,name)
 const edit=page.getByRole('button',{name:'Редактировать схему'})
 await expect(edit).toHaveAttribute('aria-pressed','false')
 await expect(page.getByText(/схема защищена от случайных соединений/)).toBeVisible()
 await edit.click()
 const finish=page.getByRole('button',{name:'Завершить редактирование'})
 await expect(finish).toHaveAttribute('aria-pressed','true')
 await finish.click()
 await expect(edit).toBeVisible()
})

test('topology starts with all components and no arbitrary selected flow',async({page})=>{
 const stamp=Date.now()
 const created=await page.request.post('http://127.0.0.1:8001/api/objects',{data:{name:'Topology focused '+stamp,kind:'system'}})
 expect(created.status()).toBe(201)
 const id=(await created.json()).id
 const itemIds=[]
 for(const name of ['Sender '+stamp,'Receiver '+stamp,'Unlinked '+stamp]){
   const res=await page.request.post('http://127.0.0.1:8001/api/infra',{data:{system_id:id,name,kind:'service'}})
   expect(res.status()).toBe(201)
   itemIds.push((await res.json()).id)
 }
 const f=await page.request.post('http://127.0.0.1:8001/api/flows',{data:{source_id:itemIds[0],target_id:itemIds[1],name:'Topology focused flow',protocol:'HTTPS',verification:'draft'}})
 expect(f.status()).toBe(201)
 await page.goto('/')
 await navigateTo(page,'Топология сетей')
 await page.getByRole('combobox',{name:'Система'}).selectOption(id)
 const diagram=page.locator('.react-flow')
 await page.locator('details.workspaceDisclosure > summary').filter({hasText:'Отображение и направления'}).click()
 await expect(page.getByRole('combobox',{name:'Выбрать поток на схеме'})).toHaveValue('')
 await expect(page.getByRole('checkbox',{name:'Показать компоненты без потоков'})).toBeChecked()
 await expect(diagram.locator('.react-flow__node[data-id^="host:"]')).toHaveCount(3)
 await page.getByRole('checkbox',{name:'Все потоки'}).check()
 await expect(diagram.locator('.react-flow__edge')).toHaveCount(1)
})


test('topology editor creates and updates a flow via API',async({page})=>{
 const stamp=Date.now()
 const created=await page.request.post('http://127.0.0.1:8001/api/objects',{data:{name:'Topology editor '+stamp,kind:'system'}})
 expect(created.status()).toBe(201)
 const id=(await created.json()).id
 for(const name of ['Editor source '+stamp,'Editor target '+stamp]){
  const res=await page.request.post('http://127.0.0.1:8001/api/infra',{data:{system_id:id,name,kind:'service'}})
  expect(res.status()).toBe(201)
 }
 await page.goto('/')
 await navigateTo(page,'Топология сетей')
 await page.getByRole('combobox',{name:'Система'}).selectOption(id)
 await page.getByRole('button',{name:'Редактировать топологию'}).click()
 await page.getByRole('button',{name:'+ Создать поток'}).click()
 const dialog=page.getByRole('dialog',{name:'Редактор потока данных'})
 await dialog.getByLabel('Источник').selectOption({label:'Editor source '+stamp})
 await dialog.getByLabel('Получатель').selectOption({label:'Editor target '+stamp})
 await dialog.getByLabel('Название').fill('Editor flow '+stamp)
 await dialog.getByLabel('Протокол').fill('HTTPS')
 await dialog.getByRole('button',{name:'Сохранить поток'}).click()
 await expect(dialog).toHaveCount(0)
 await page.reload()
 await navigateTo(page,'Топология сетей')
 await page.getByRole('combobox',{name:'Система'}).selectOption(id)
 await page.getByRole('checkbox',{name:'Все потоки'}).check()
 await expect(page.locator('.react-flow__edge')).toHaveCount(1)
})

async function uxSystem(page: Page) {
  const name='UX-TEST workspace '+Date.now()+'-'+Math.random().toString(36).slice(2,7)
  const created=await page.request.post('http://127.0.0.1:8001/api/objects',{data:{name,kind:'system',description:'Isolated browser UX scenario'}})
  expect(created.status()).toBe(201)
  const id=(await created.json()).id as string
  const components=[] as string[]
  for(const suffix of ['API','VM']) {
    const result=await page.request.post('http://127.0.0.1:8001/api/infra',{data:{system_id:id,name:name+' '+suffix,kind:suffix==='VM'?'vm':'service'}})
    expect(result.status()).toBe(201)
    components.push((await result.json()).id)
  }
  return {id,name,components}
}

test('component group overview opens real members and keeps editing locked',async({page})=>{
  const system=await uxSystem(page)
  await page.goto('/')
  await page.getByRole('navigation',{name:'Разделы архитектуры'}).getByRole('button',{name:'Компоненты',exact:true}).click()
  await page.getByRole('combobox',{name:'Система компонентов'}).selectOption(system.id)
  await page.getByRole('group',{name:'Представление компонентов'}).getByRole('button',{name:'Схема',exact:true}).click()
  await page.getByRole('combobox',{name:'Группировка компонентов'}).selectOption('environment')
  const diagram=page.locator('[data-active-graph="infrastructure"]')
  await expect(diagram.locator('.react-flow__node')).toHaveCount(1)
  await expect(page.getByRole('button',{name:'Редактировать схему',exact:true})).toBeDisabled()
  await expect(diagram.locator('.react-flow__node').first()).toContainText('2 компонентов')
  await diagram.locator('.react-flow__node').first().click()
  await expect(diagram.locator('.react-flow__node')).toHaveCount(2)
  await page.getByRole('button',{name:'← Ко всем группам'}).click()
  await expect(diagram.locator('.react-flow__node')).toHaveCount(1)
  await page.getByRole('combobox',{name:'Группировка компонентов'}).selectOption('components')
  await expect(diagram.locator('.react-flow__node')).toHaveCount(2)
  await expect(page.getByRole('button',{name:'Редактировать схему',exact:true})).toBeEnabled()
})

test('systems are read-only until editing is explicitly enabled and leaving resets it',async({page})=>{
  const system=await uxSystem(page)
  await page.goto('/')
  await page.getByRole('navigation',{name:'Разделы архитектуры'}).getByRole('button',{name:'Системы',exact:true}).click()
  await page.getByRole('textbox',{name:'Фильтр по названию'}).fill(system.name)
  await expect(page.locator('.systemsTable')).toBeVisible()
  await expect(page.locator('.systemsTable').getByRole('button',{name:system.name,exact:true})).toBeVisible()
  await page.getByRole('button',{name:'Редактор схемы',exact:true}).click()
  const diagram=page.locator('[data-active-graph="systems"]')
  const node=diagram.locator('.react-flow__node').filter({hasText:system.name})
  await expect(node).toBeVisible()
  const edit=page.getByRole('button',{name:'Редактировать схему',exact:true})
  await expect(edit).toHaveAttribute('aria-pressed','false')
  await expect(diagram.locator('.react-flow__controls-interactive')).toHaveCount(0)
  const position=await node.evaluate(element=>(element as HTMLElement).style.transform)
  const box=await node.boundingBox()
  expect(box).toBeTruthy()
  const mutations: string[]=[]
  page.on('request',request=>{if(request.method()==='POST'&&request.url().includes('/api/relations'))mutations.push(request.url())})
  await page.mouse.move(box!.x+box!.width/2,box!.y+20)
  await page.mouse.down()
  await page.mouse.move(box!.x+box!.width/2+90,box!.y+70,{steps:8})
  await page.mouse.up()
  await expect.poll(()=>node.evaluate(element=>(element as HTMLElement).style.transform)).toBe(position)
  expect(mutations).toEqual([])
  await edit.click()
  await expect(page.getByRole('button',{name:'Завершить редактирование',exact:true})).toHaveAttribute('aria-pressed','true')
  await page.getByRole('navigation',{name:'Разделы архитектуры'}).getByRole('button',{name:'Обзор',exact:true}).click()
  await page.getByRole('navigation',{name:'Разделы архитектуры'}).getByRole('button',{name:'Системы',exact:true}).click()
  await expect(edit).toHaveAttribute('aria-pressed','false')
})

test('overview passport and components retain the same system context',async({page})=>{
  const system=await uxSystem(page)
  await page.goto('/')
  await page.getByRole('textbox',{name:'Поиск на карте'}).fill(system.name)
  const searchResults=page.getByRole('region',{name:'Результаты поиска по архитектуре'})
  await searchResults.getByRole('button',{name:'Открыть паспорт ИС из поиска: '+system.name}).click()
  const passport=page.getByRole('complementary',{name:'Карточка архитектурного объекта'})
  await expect(passport.getByRole('heading',{name:system.name,exact:true})).toBeVisible()
  await expect(page.locator('.homeMapGraph')).toBeVisible()
  await passport.getByRole('button',{name:'Закрыть правую панель'}).click()
  await searchResults.getByRole('button',{name:'Выбрать ИС из поиска: '+system.name}).click()
  const selection=page.getByRole('complementary',{name:'Выбранная информационная система'})
  await selection.getByRole('button',{name:'Компоненты',exact:true}).click()
  await expect(page.getByRole('combobox',{name:'Система компонентов'})).toHaveValue(system.id)
  await expect(page.locator('[data-active-graph="infrastructure"] .react-flow__node')).toHaveCount(2)
  await expect(passport).toHaveCount(0)
})

test('passport buttons inside separate map nodes always open the matching system',async({page})=>{
  const first='Passport A '+Date.now()
  const second='Passport B '+Date.now()
  for(const name of [first,second]){
    const created=await page.request.post('http://127.0.0.1:8001/api/objects',{data:{name,kind:'system'}})
    expect(created.status()).toBe(201)
  }
  await page.goto('/')
  const inspector=page.getByRole('complementary',{name:'Карточка архитектурного объекта'})
  for(const name of [first,second,first]){
    await page.getByRole('textbox',{name:'Поиск на карте'}).fill(name)
    const searchResults=page.getByRole('region',{name:'Результаты поиска по архитектуре'})
    await searchResults.getByRole('button',{name:'Открыть паспорт ИС из поиска: '+name}).click()
    await expect(inspector.getByRole('heading',{name,exact:true})).toBeVisible()
  }
})

test('component views are exclusive and bulk actions appear with a selection',async({page})=>{
  const system=await uxSystem(page)
  await page.goto('/')
  await page.getByRole('navigation',{name:'Разделы архитектуры'}).getByRole('button',{name:'Компоненты',exact:true}).click()
  await page.getByRole('combobox',{name:'Система компонентов'}).selectOption(system.id)
  const views=page.getByRole('group',{name:'Представление компонентов'})
  await views.getByRole('button',{name:'Реестр',exact:true}).click()
  const registry=page.getByRole('region',{name:'Архитектурный реестр'})
  await expect(registry).toBeVisible()
  await expect(page.locator('.infraGrid')).toHaveCount(0)
  await expect(page.locator('[data-active-graph="infrastructure"]')).toHaveCount(0)
  await expect(page.getByLabel('Массовое изменение',{exact:true})).toHaveCount(0)
  await registry.getByRole('checkbox',{name:'Выбрать все отображаемые'}).check()
  await expect(page.getByLabel('Массовое изменение',{exact:true})).toBeVisible()
  await views.getByRole('button',{name:'Карточки',exact:true}).click()
  await expect(registry).toHaveCount(0)
  await expect(page.locator('.infraGrid .infraCard')).toHaveCount(2)
  await views.getByRole('button',{name:'Схема',exact:true}).click()
  await expect(page.locator('.infraGrid')).toHaveCount(0)
  await expect(page.locator('[data-active-graph="infrastructure"] .react-flow__node')).toHaveCount(2)
  await expect(page.getByRole('button',{name:'Редактировать схему',exact:true})).toHaveAttribute('aria-pressed','false')
})

test('registry columns are configurable and persist after reload',async({page})=>{
  await uxSystem(page)
  await page.goto('/')
  await page.getByRole('navigation',{name:'Разделы архитектуры'}).getByRole('button',{name:'Компоненты',exact:true}).click()
  const registry=page.getByRole('region',{name:'Архитектурный реестр'})
  await expect(registry).toBeVisible()
  await expect(registry.locator('.architectureRegistryTableWrap th').filter({hasText:'Владелец'})).toHaveCount(0)
  await registry.locator('.registryColumnPicker summary').click()
  await registry.getByRole('group',{name:'Видимые столбцы реестра'}).getByRole('checkbox',{name:'Владелец'}).check()
  await expect(registry.locator('.architectureRegistryTableWrap th').filter({hasText:'Владелец'})).toHaveCount(1)
  await page.reload()
  await page.getByRole('navigation',{name:'Разделы архитектуры'}).getByRole('button',{name:'Компоненты',exact:true}).click()
  await expect(page.getByRole('region',{name:'Архитектурный реестр'}).locator('.architectureRegistryTableWrap th').filter({hasText:'Владелец'})).toBeVisible()
})

test('component view choice survives a reload',async({page})=>{
  await uxSystem(page)
  await page.goto('/')
  await page.getByRole('navigation',{name:'Разделы архитектуры'}).getByRole('button',{name:'Компоненты',exact:true}).click()
  const views=page.getByRole('group',{name:'Представление компонентов'})
  await views.getByRole('button',{name:'Карточки',exact:true}).click()
  await expect(page.locator('.infraGrid .infraCard').first()).toBeVisible()
  await page.reload()
  await page.getByRole('navigation',{name:'Разделы архитектуры'}).getByRole('button',{name:'Компоненты',exact:true}).click()
  await expect(page.getByRole('group',{name:'Представление компонентов'}).getByRole('button',{name:'Карточки',exact:true})).toHaveAttribute('aria-pressed','true')
})

test('access dialog masks the key, contains focus and returns focus on Escape',async({page})=>{
  await page.goto('/')
  const trigger=page.getByRole('button',{name:'Ключ доступа',exact:true})
  await trigger.click()
  const dialog=page.getByRole('dialog',{name:'Вход в Architecture Hub'})
  const key=dialog.getByLabel('Ключ',{exact:true})
  await expect(key).toHaveAttribute('type','password')
  await key.fill('UX-TEST-unsent-key')
  await dialog.getByRole('button',{name:'Войти',exact:true}).focus()
  await page.keyboard.press('Tab')
  await expect(dialog.getByRole('button',{name:'Закрыть вход'})).toBeFocused()
  await page.keyboard.press('Shift+Tab')
  await expect(dialog.getByRole('button',{name:'Войти',exact:true})).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
  await expect(trigger).toBeFocused()
  await trigger.click()
  await expect(key).toHaveValue('')
})

test('opening an editor dismisses the create menu and does not stack dialogs',async({page})=>{
  await page.goto('/')
  const menu=page.locator('nav.layerTabs .navEnd details.layerActions')
  await menu.locator('summary').click()
  await menu.getByRole('button',{name:'Система',exact:true}).click()
  const dialog=page.getByRole('dialog',{name:'Создать объект архитектуры'})
  await expect(dialog).toBeVisible()
  await expect(menu).not.toHaveAttribute('open','')
  await expect(page.locator('.editorBackdrop')).toHaveCount(1)
  await dialog.getByRole('button',{name:'Закрыть ×'}).click()
  await expect(page.locator('.editorBackdrop')).toHaveCount(0)
  await menu.locator('summary').click()
  await menu.getByRole('button',{name:'Поток',exact:true}).click()
  await expect(page.getByRole('dialog',{name:'Редактор потока'})).toBeVisible()
  await expect(menu).not.toHaveAttribute('open','')
  await expect(page.locator('.editorBackdrop')).toHaveCount(1)
})

test('action menus close after choosing an action, outside click and Escape',async({page})=>{
  await page.goto('/')
  const menu=page.locator('nav.layerTabs .navEnd details.layerActions')
  const trigger=menu.locator('summary')
  await trigger.click()
  await menu.getByRole('button',{name:'Система',exact:true}).click()
  await expect(menu).not.toHaveAttribute('open','')
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog',{name:'Создать объект архитектуры'})).toHaveCount(0)
  await trigger.click()
  await page.keyboard.press('Escape')
  await expect(menu).not.toHaveAttribute('open','')
  await expect(trigger).toBeFocused()
  await trigger.click()
  await page.getByRole('textbox',{name:'Поиск на карте'}).click({position:{x:12,y:12}})
  await expect(menu).not.toHaveAttribute('open','')
})

for(const width of [390,768,1440]) {
  test('workspace navigation and content stay within viewport at '+width+'px',async({page})=>{
    await page.setViewportSize({width,height:900})
    const errors: string[]=[]
    page.on('pageerror',error=>errors.push(error.message))
    await page.goto('/')
    const assertNoOverflow=async()=>{
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1)).toBe(true)
      const main=page.locator('main.main')
      const box=await main.boundingBox()
      expect(box).toBeTruthy()
      expect(box!.x+box!.width).toBeLessThanOrEqual(width+1)
    }
    await assertNoOverflow()
    await expect(page.locator('aside.sidebar')).toHaveCount(0)
    await assertNoOverflow()
    for(const name of ['Системы','Компоненты','Потоки']) {
      const nav=page.getByRole('navigation',{name:'Разделы архитектуры'})
      if(width<650){
        const mobile=nav.locator('details.mobileSectionMenu')
        await mobile.locator('summary').click()
        await mobile.getByRole('button',{name,exact:true}).click()
      }else{
        await nav.getByRole('button',{name,exact:true}).click()
      }
      await assertNoOverflow()
    }
    for(const section of ['Реестр сетей','Топология сетей','Инциденты'] as const) {
      await navigateTo(page,section)
      await assertNoOverflow()
    }
    expect(errors).toEqual([])
  })
}

test('topology fits tall groups after loading, resize and catalog collapse',async({page})=>{
  const name='UX-TEST tall topology '+Date.now()
  const created=await page.request.post('http://127.0.0.1:8001/api/objects',{data:{name,kind:'system'}})
  expect(created.status()).toBe(201)
  const id=(await created.json()).id
  for(let i=0;i<25;i++){
    const item=await page.request.post('http://127.0.0.1:8001/api/infra',{data:{system_id:id,name:name+' VM '+i,kind:'vm'}})
    expect(item.status()).toBe(201)
  }
  await page.goto('/')
  await navigateTo(page,'Топология сетей')
  await page.getByRole('combobox',{name:'Система',exact:true}).selectOption(id)
  const canvas=page.locator('.topologyCanvas')
  await expect(canvas.locator('.react-flow__node[data-id^="host:"]')).toHaveCount(25)
  const contained=()=>canvas.evaluate(root=>{
    const box=root.getBoundingClientRect()
    // Canvas border and fractional CSS scaling can differ by a few device pixels.
    // A 4 CSS-pixel tolerance still detects any materially clipped graph node.
    const tolerance=4
    return [...root.querySelectorAll('.react-flow__node')].every(node=>{
      const r=node.getBoundingClientRect()
      return r.left>=box.left-tolerance&&r.right<=box.right+tolerance&&r.top>=box.top-tolerance&&r.bottom<=box.bottom+tolerance
    })
  })
  const initial=await canvas.evaluate(root=>{
    const box=root.getBoundingClientRect()
    const nodes=[...root.querySelectorAll('.react-flow__node')].map(node=>{
      const r=node.getBoundingClientRect()
      return {id:node.getAttribute('data-id'),x:Math.round(r.left-box.left),y:Math.round(r.top-box.top),right:Math.round(r.right-box.right),bottom:Math.round(r.bottom-box.bottom)}
    })
    return {canvas:{width:box.width,height:box.height},viewport:root.querySelector<HTMLElement>('.react-flow__viewport')?.style.transform,clipped:nodes.filter(n=>n.x< -4||n.y< -4||n.right>box.width+4||n.bottom>box.height+4).slice(0,5)}
  })
  console.log('TOPOLOGY_INITIAL_DIAGNOSTICS',JSON.stringify(initial))
  await expect.poll(contained).toBe(true)
  await expect(page.locator('aside.sidebar')).toHaveCount(0)
  await expect.poll(contained).toBe(true)
  await page.setViewportSize({width:1000,height:720})
  // ResizeObserver and React Flow update the viewport asynchronously.
  // Allow the final measured layout to settle without weakening containment.
  const samples: Array<{t:number;ok:boolean; transform:string|null; bad:string[]}>=[]
  const since=Date.now()
  try {
    await expect.poll(async()=>{
      const sample=await canvas.evaluate(root=>{
        const box=root.getBoundingClientRect()
        const bad=[...root.querySelectorAll('.react-flow__node')].filter(node=>{
          const r=node.getBoundingClientRect()
          return r.left<box.left-4||r.right>box.right+4||r.top<box.top-4||r.bottom>box.bottom+4
        }).map(n=>{const r=n.getBoundingClientRect();return [n.getAttribute('data-id')||'unknown',r.left-box.left,r.top-box.top,r.right-box.right,r.bottom-box.bottom].map(String).join(':')})
        return {ok:bad.length===0,transform:root.querySelector<HTMLElement>('.react-flow__viewport')?.style.transform||null,bad:bad.slice(0,3)}
      })
      if(samples.length<50)samples.push({t:Date.now()-since,...sample})
      return sample.ok
    },{timeout:15000,intervals:[100,250,500]}).toBe(true)
  } catch (error) {
    console.log('TOPOLOGY_RESIZE_SAMPLES',JSON.stringify(samples))
    const diagnostics=await canvas.evaluate(root=>{
      const box=root.getBoundingClientRect()
      const nodes=[...root.querySelectorAll('.react-flow__node')].map(node=>{
        const r=node.getBoundingClientRect()
        return {id:node.getAttribute('data-id'),left:Math.round(r.left-box.left),right:Math.round(r.right-box.right),top:Math.round(r.top-box.top),bottom:Math.round(r.bottom-box.bottom)}
      })
      const pane=root.querySelector('.react-flow__viewport') as HTMLElement|null
      return {canvas:{width:box.width,height:box.height},transform:pane?.style.transform,clipped:nodes.filter(n=>n.left< -2||n.top< -2||n.right>box.width+2||n.bottom>box.height+2).slice(0,12)}
    })
    console.log('TOPOLOGY_RESIZE_DIAGNOSTICS',JSON.stringify(diagnostics))
    throw error
  }
})


test('each main section has its own URL and reload preserves the current section',async({page})=>{
  await page.goto('/')
  const nav=page.getByRole('navigation',{name:'Разделы архитектуры'})
  const sections=[
    ['Системы','/systems'],
    ['Компоненты','/components'],
    ['Потоки','/flows'],
    ['Обзор','/'],
  ] as const
  for(const [title,path] of sections){
    await nav.getByRole('button',{name:title,exact:true}).click()
    await expect(page).toHaveURL(new RegExp(path==='/'?'\\/$':'\\'+path+'$'))
    await page.reload()
    await expect(nav.getByRole('button',{name:title,exact:true})).toHaveClass(/current/)
  }
  await navigateTo(page,'Реестр сетей')
  await expect(page).toHaveURL(/\/networks$/)
  await page.reload()
  await expect(page.getByRole('heading',{name:'Реестр сетей'})).toBeVisible()
  await navigateTo(page,'Топология сетей')
  await expect(page).toHaveURL(/\/topology$/)
  await page.reload()
  await expect(page.getByRole('button',{name:'Редактировать топологию'})).toBeVisible()
})

test('direct links preserve system context and browser back-forward navigation',async({page})=>{
  const name='Deep link '+Date.now()
  const response=await page.request.post('http://127.0.0.1:8001/api/objects',{data:{name,kind:'system'}})
  expect(response.status()).toBe(201)
  const id=(await response.json()).id
  await page.goto('/components?system='+id)
  await expect(page.getByRole('combobox',{name:'Система компонентов'})).toHaveValue(id)
  await page.reload()
  await expect(page.getByRole('combobox',{name:'Система компонентов'})).toHaveValue(id)
  await page.getByRole('navigation',{name:'Разделы архитектуры'}).getByRole('button',{name:'Потоки',exact:true}).click()
  await expect(page).toHaveURL(/\/flows$/)
  await page.goBack()
  await expect(page).toHaveURL(new RegExp('/components\\?system='+id+'$'))
  await expect(page.getByRole('combobox',{name:'Система компонентов'})).toHaveValue(id)
  await page.goForward()
  await expect(page).toHaveURL(/\/flows$/)
  await expect(page.getByRole('navigation',{name:'Разделы архитектуры'}).getByRole('button',{name:'Потоки',exact:true})).toHaveClass(/current/)
})

test('all secondary workspaces have directly accessible routes',async({page})=>{
  const paths=['/business','/networks','/topology','/incidents','/knowledge']
  for(const path of paths){
    await page.goto(path)
    await expect(page).toHaveURL(new RegExp(path+'$'))
    await expect(page.getByRole('navigation',{name:'Разделы архитектуры'})).toBeVisible()
    await expect(page.locator('main.main')).toBeVisible()
  }
})
