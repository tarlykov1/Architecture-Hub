import {test,expect} from '@playwright/test'

// These tests use only the temporary SQLite database started by Browser CI.
test.beforeEach(async ({page})=>{
  await page.addInitScript(()=>{
    sessionStorage.setItem('architecture-hub:access-token:session','browser-ci-development-token')
  })
})

async function seedSystem(page:import('@playwright/test').Page){
  const system=await page.request.post('http://127.0.0.1:8001/api/objects',{
    data:{name:'QA-WORK-Canvas editor '+Date.now(),kind:'system'}
  })
  expect(system.status()).toBe(201)
  const id=(await system.json()).id as string
  for(const name of ['QA-WORK-Editor source','QA-WORK-Editor destination']){
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

test('flow editor uses the shared architecture tools without restoring a duplicate flow diagram',async({page})=>{
  const id=await seedSystem(page)
  await page.goto('/flows')
  await expect(page.getByRole('region',{name:'Реестр технических потоков'})).toBeVisible()
  await expect(page.locator('[data-active-graph="flows"]')).toHaveCount(0)
  await page.getByRole('combobox',{name:'Система потоков'}).selectOption(id)
  await page.getByRole('button',{name:'Редактор потоков',exact:true}).click()
  const editor=page.getByRole('region',{name:'Редактор архитектурной схемы'})
  await expect(editor).toBeVisible()
  const tools=editor.getByRole('toolbar',{name:'Инструменты архитектуры'})
  await expect(tools.getByRole('button',{name:'Курсор / перемещение'})).toBeVisible()
  await expect(tools.getByRole('button',{name:'→ Поток'})).toBeVisible()
  await expect(tools.getByRole('button',{name:'▭ Сеть / контейнер'})).toBeVisible()
  await expect(editor.locator('.react-flow__node .homeNode')).toHaveCount(2)
  await tools.getByRole('button',{name:'▭ Сеть / контейнер'}).click()
  await expect(editor.getByText(/протяните прямоугольник/)).toBeVisible()
  await page.getByRole('button',{name:'Вернуться в реестр',exact:true}).click()
  await expect(editor).toHaveCount(0)
  await expect(page.getByRole('region',{name:'Реестр технических потоков'})).toBeVisible()
})

test('flow editor keeps the tool rail clear and opens selected properties on the right',async({page})=>{
  const id=await seedSystem(page)
  await page.goto('/flows')
  await page.getByRole('combobox',{name:'Система потоков'}).selectOption(id)
  await page.getByRole('button',{name:'Редактор потоков',exact:true}).click()
  const editor=page.getByRole('region',{name:'Редактор архитектурной схемы'})
  const stage=editor.locator('.boardEditorStage')
  const canvas=editor.locator('.boardCanvas')
  const toolbar=editor.getByRole('toolbar',{name:'Инструменты архитектуры'})
  await expect(stage).toBeVisible()
  await expect(toolbar).toBeVisible()
  await expect(editor.locator('.boardDock')).toHaveCount(0)
  const pane=await canvas.boundingBox(),rail=await toolbar.boundingBox()
  expect(pane&&rail&&rail.x+rail.width<=pane.x+2).toBeTruthy()

  await toolbar.getByRole('button',{name:'→ Поток'}).click()
  const dock=editor.getByRole('complementary',{name:'Свойства и изменения схемы'})
  await expect(dock).toBeVisible()
  await expect(dock.getByLabel('Откуда')).toBeVisible()
  await expect(dock.getByLabel('Куда',{exact:true})).toBeVisible()
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
  const source=editor.locator('.react-flow__node').filter({hasText:'QA-WORK-Editor source'})
  const target=editor.locator('.react-flow__node').filter({hasText:'QA-WORK-Editor destination'})
  await source.click()
  const dock=editor.getByRole('complementary',{name:'Свойства и изменения схемы'})
  await expect(dock.getByLabel('Откуда')).not.toHaveValue('')
  await target.click()
  await expect(dock.getByLabel('Куда',{exact:true})).not.toHaveValue('')
  // A second card click stages the directed arrow immediately; properties can be
  // edited independently, instead of requiring a separate "add" form action.
  await expect(editor.locator('.react-flow__edge')).toHaveCount(1)
  const drafted=dock.getByRole('region',{name:'Параметры нарисованного потока'})
  await expect(drafted).toBeVisible()
  await drafted.getByLabel('Порт').fill('443')
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
  await editor.locator('.react-flow__node').filter({hasText:'QA-WORK-Editor source'}).click()
  const dialog=editor.getByRole('dialog',{name:/Паспорт компонента QA-WORK-Editor source/})
  await expect(dialog).toBeVisible()
  await expect(editor.locator('.boardInspectorBackdrop')).toHaveCount(0)
  await expect(editor.locator('.boardCanvas')).toBeVisible()
  await dialog.getByRole('button',{name:'Закрыть паспорт'}).click()
  await expect(editor.locator('.boardDock')).toHaveCount(0)
})


test('tool labels are visible; dragging creates a container and cancelling removes it',async({page})=>{
  const systemId=await seedSystem(page)
  await page.goto('/')
  await page.getByRole('navigation',{name:'Разделы архитектуры'}).getByRole('button',{name:'Компоненты',exact:true}).click()
  await page.getByRole('group',{name:'Представление компонентов'}).getByRole('button',{name:'Схема',exact:true}).click()
  await page.getByRole('button',{name:'Редактировать схему'}).click()
  await page.getByRole('combobox',{name:'Выбрать ИС для редактора компонентов'}).selectOption(systemId)
  const editor=page.getByRole('region',{name:'Редактор архитектурной схемы'})
  const tools=editor.getByRole('toolbar',{name:'Инструменты архитектуры'})
  for(const label of ['Выбрать','Добавить ВМ','Поток','Контейнер','Вписать','Сохранить','История']){
    await expect(tools.getByText(label,{exact:true})).toBeVisible()
  }
  await tools.getByRole('button',{name:'▭ Сеть / контейнер'}).click()
  const dock=editor.getByRole('complementary',{name:'Свойства и изменения схемы'})
  await dock.getByRole('textbox',{name:'Название сети'}).fill('Drawn network container')
  const overlay=editor.getByRole('region',{name:'Поле рисования контейнера'})
  const box=await overlay.boundingBox()
  expect(box).not.toBeNull()
  const start={x:box!.x+145,y:box!.y+125},end={x:start.x+240,y:start.y+195}
  await page.mouse.move(start.x,start.y)
  await page.mouse.down()
  await page.mouse.move(end.x,end.y,{steps:6})
  await expect(editor.locator('.boardNetworkPreview')).toBeVisible()
  await page.mouse.up()
  await expect(editor.locator('.react-flow__node').filter({hasText:'Drawn network container'})).toBeVisible()
  await expect(editor.getByRole('button',{name:'Отменить черновик'})).toBeVisible()
  await editor.getByRole('button',{name:'Отменить черновик'}).click()
  await expect(editor.locator('.react-flow__node').filter({hasText:'Drawn network container'})).toHaveCount(0)
})

test('staged VM remains visible and can be reviewed, then removed by cancelling draft',async({page})=>{
  const id=await seedSystem(page)
  await page.goto('/')
  await page.getByRole('navigation',{name:'Разделы архитектуры'}).getByRole('button',{name:'Компоненты',exact:true}).click()
  await page.getByRole('group',{name:'Представление компонентов'}).getByRole('button',{name:'Схема',exact:true}).click()
  await page.getByRole('button',{name:'Редактировать схему'}).click()
  await page.getByRole('combobox',{name:'Выбрать ИС для редактора компонентов'}).selectOption(id)
  const editor=page.getByRole('region',{name:'Редактор архитектурной схемы'})
  await editor.getByRole('toolbar',{name:'Инструменты архитектуры'}).getByRole('button',{name:'+ ВМ'}).click()
  const dock=editor.getByRole('complementary',{name:'Свойства и изменения схемы'})
  await dock.getByRole('textbox',{name:'Имя ВМ'}).fill('Staged VM draft')
  await dock.getByRole('button',{name:'Разместить на схеме'}).click()
  await expect(editor.locator('.react-flow__node').filter({hasText:'Staged VM draft'})).toHaveCount(1)
  await expect(editor.getByRole('button',{name:'Проверить изменения (1)'})).toBeVisible()
  await editor.getByRole('button',{name:'Отменить черновик'}).click()
  await expect(editor.locator('.react-flow__node').filter({hasText:'Staged VM draft'})).toHaveCount(0)
  await expect(editor.locator('.boardDock')).toHaveCount(0)
})

test('dragged VM saves its own coordinates and never mutates flows or NICs',async({page})=>{
  const id=await seedSystem(page)
  const api='http://127.0.0.1:8001'
  const inventory=await (await page.request.get(api+'/api/infra')).json() as Array<{id:string;system_id:string;name:string}>
  const vm=inventory.find(item=>item.system_id===id&&item.name==='QA-WORK-Editor source')
  expect(vm).toBeTruthy()
  const destination=inventory.find(item=>item.system_id===id&&item.name==='QA-WORK-Editor destination')
  expect(destination).toBeTruthy()
  // Nonempty controls: a saved VM move must preserve an actual technical flow
  // and an existing NIC, not merely compare two empty collections.
  const flowCreated=await page.request.post(api+'/api/flows',{data:{
    source_id:vm!.id,target_id:destination!.id,name:'QA-WORK-VM-drag-preserved-flow'
  }})
  expect(flowCreated.status()).toBe(201)
  const nicCreated=await page.request.post(api+'/api/network-interfaces',{data:{
    item_id:vm!.id,name:'eth0',ip_address:''
  }})
  expect(nicCreated.status()).toBe(201)
  const vmIds=new Set(inventory.filter(item=>item.system_id===id).map(item=>item.id))
  const scopedFlows=async()=>{
    const all=await (await page.request.get(api+'/api/flows')).json() as Array<{source_id:string;target_id:string}>
    return all.filter(flow=>vmIds.has(flow.source_id)||vmIds.has(flow.target_id))
  }
  const scopedInterfaces=async()=>{
    const all=await (await page.request.get(api+'/api/network-interfaces')).json() as Array<{item_id:string}>
    return all.filter(nic=>vmIds.has(nic.item_id))
  }
  const beforeFlows=await scopedFlows(),beforeNICs=await scopedInterfaces()

  await page.goto('/components')
  await page.getByRole('group',{name:'Представление компонентов'}).getByRole('button',{name:'Схема'}).click()
  await page.getByRole('button',{name:'Редактировать схему'}).click()
  await page.getByRole('combobox',{name:'Выбрать ИС для редактора компонентов'}).selectOption(id)
  const editor=page.getByRole('region',{name:'Редактор архитектурной схемы'})
  const tools=editor.getByRole('toolbar',{name:'Инструменты архитектуры'})
  const source=editor.locator('.react-flow__node-boardComponent').filter({hasText:'QA-WORK-Editor source'})
  await expect(source).toBeVisible()
  const bounds=await source.boundingBox()
  expect(bounds).not.toBeNull()
  const start={x:bounds!.x+bounds!.width/2,y:bounds!.y+24}
  await page.mouse.move(start.x,start.y)
  await page.mouse.down()
  await page.mouse.move(start.x+115,start.y+90,{steps:12})
  await page.mouse.up()
  // A real drag must move the rendered VM before the save becomes enabled.
  await expect.poll(async()=>{
    const now=await source.boundingBox()
    return Boolean(now&&Math.hypot(now.x-bounds!.x,now.y-bounds!.y)>30)
  }).toBe(true)
  await expect(tools.getByRole('button',{name:'Сохранить расположение'})).toBeEnabled()
  await tools.getByRole('button',{name:'Сохранить расположение'}).click()
  await expect(editor.getByText('Расположение схемы сохранено.',{exact:false})).toBeVisible()

  const layoutResponse=await page.request.get(api+'/api/board/layout/'+id)
  expect(layoutResponse.ok()).toBeTruthy()
  const layout=await layoutResponse.json() as {positions:Record<string,{x:number;y:number}>}
  expect(layout.positions[vm!.id]).toBeDefined()
  const saved={...layout.positions[vm!.id]}
  expect(Number.isFinite(saved.x)&&Number.isFinite(saved.y)).toBe(true)
  expect(await scopedFlows()).toEqual(beforeFlows)
  expect(await scopedInterfaces()).toEqual(beforeNICs)

  await page.getByRole('button',{name:'Завершить редактирование'}).click()
  await page.getByRole('button',{name:'Редактировать схему'}).click()
  const reopened=page.getByRole('region',{name:'Редактор архитектурной схемы'})
    .locator('.react-flow__node-boardComponent').filter({hasText:'QA-WORK-Editor source'})
  await expect(reopened).toBeVisible()
  
  await expect.poll(async()=>{
    const transform=await reopened.evaluate(node=>(node as HTMLElement).style.transform)
    const matches=transform.match(/translate\(\s*(-?[\d.]+)px,\s*(-?[\d.]+)px\)/)
    return Boolean(matches&&Math.abs(Number(matches[1])-saved.x)<2&&Math.abs(Number(matches[2])-saved.y)<2)
  }).toBe(true)
  expect(await scopedFlows()).toEqual(beforeFlows)
  expect(await scopedInterfaces()).toEqual(beforeNICs)
})

test('closing KIS passport editor keeps the selected system card open',async({page})=>{
  const systemId=await seedSystem(page)
  const objects=await (await page.request.get('http://127.0.0.1:8001/api/objects')).json()
  const system=objects.find((item:{id:string})=>item.id===systemId)
  expect(system).toBeTruthy()
  await page.goto('/')
  await page.getByRole('navigation',{name:'Разделы архитектуры'}).getByRole('button',{name:'Системы',exact:true}).click()
  await page.getByRole('button',{name:system.name,exact:true}).click()
  const card=page.getByRole('complementary',{name:'Карточка архитектурного объекта'})
  await expect(card).toBeVisible()
  await card.getByRole('button',{name:'Редактировать паспорт КИС'}).click()
  const editor=page.getByRole('dialog',{name:'Редактор паспорта КИС'})
  await expect(editor).toBeVisible()
  await editor.getByRole('button',{name:'Закрыть ×'}).click()
  await expect(editor).toHaveCount(0)
  await expect(card).toBeVisible()
  await expect(card.getByRole('heading',{name:system.name})).toBeVisible()
})


test('network tool marks the required name and returns from history to the editor',async({page})=>{
  const systemId=await seedSystem(page)
  await page.goto('/')
  await page.getByRole('navigation',{name:'Разделы архитектуры'}).getByRole('button',{name:'Компоненты',exact:true}).click()
  await page.getByRole('group',{name:'Представление компонентов'}).getByRole('button',{name:'Схема',exact:true}).click()
  await page.getByRole('button',{name:'Редактировать схему'}).click()
  await page.getByRole('combobox',{name:'Выбрать ИС для редактора компонентов'}).selectOption(systemId)
  const editor=page.getByRole('region',{name:'Редактор архитектурной схемы'})
  await editor.getByRole('toolbar',{name:'Инструменты архитектуры'}).getByRole('button',{name:'▭ Сеть / контейнер'}).click()
  const field=editor.getByRole('textbox',{name:/Название сети/})
  await expect(field).toHaveAttribute('aria-required','true')
  await expect(editor.getByText(/Обязательное поле: сначала укажите название/)).toBeVisible()
  const layer=editor.getByRole('region',{name:'Поле рисования контейнера'})
  const box=await layer.boundingBox()
  expect(box).not.toBeNull()
  await page.mouse.move(box!.x+180,box!.y+130)
  await page.mouse.down()
  await page.mouse.move(box!.x+450,box!.y+320,{steps:5})
  await page.mouse.up()
  await expect(editor.getByText(/Контейнер не создан/)).toBeVisible()
  await expect(field).toBeFocused()
  await editor.getByRole('toolbar').getByRole('button',{name:'История изменений'}).click()
  await expect(editor.getByRole('dialog',{name:'Журнал изменений архитектуры'})).toBeVisible()
  await editor.getByRole('button',{name:'Вернуться к редактированию'}).click()
  await expect(editor.getByRole('dialog',{name:'Журнал изменений архитектуры'})).toHaveCount(0)
  await expect(editor.getByRole('toolbar',{name:'Инструменты архитектуры'})).toBeVisible()
})

test('an existing VRF is draggable and its saved geometry is audited',async({page})=>{
  const systemId=await seedSystem(page)
  const components=await page.request.get('http://127.0.0.1:8001/api/infra')
  expect(components.ok()).toBeTruthy()
  const vm=(await components.json()).find((item:{system_id:string})=>item.system_id===systemId)
  expect(vm).toBeTruthy()
  const network=await page.request.post('http://127.0.0.1:8001/api/networks',{
    data:{name:'Movable VRF '+Date.now(),kind:'vrf'}
  })
  expect(network.status()).toBe(201)
  const id=(await network.json()).id as string
  const nic=await page.request.post('http://127.0.0.1:8001/api/network-interfaces',{
    data:{item_id:vm.id,name:'eth0',vrf_id:id}
  })
  expect(nic.status()).toBe(201)
  await page.goto('/')
  await page.getByRole('navigation',{name:'Разделы архитектуры'}).getByRole('button',{name:'Компоненты',exact:true}).click()
  await page.getByRole('group',{name:'Представление компонентов'}).getByRole('button',{name:'Схема',exact:true}).click()
  await page.getByRole('button',{name:'Редактировать схему'}).click()
  await page.getByRole('combobox',{name:'Выбрать ИС для редактора компонентов'}).selectOption(systemId)
  const editor=page.getByRole('region',{name:'Редактор архитектурной схемы'})
  const node=editor.locator('.react-flow__node').filter({hasText:'Movable VRF'})
  await expect(node).toBeVisible()
  const original=await node.boundingBox()
  expect(original).not.toBeNull()
  await page.mouse.move(original!.x+35,original!.y+20)
  await page.mouse.down()
  await page.mouse.move(original!.x+135,original!.y+100,{steps:8})
  await page.mouse.up()
  const moved=await node.boundingBox()
  expect(moved).not.toBeNull()
  expect(Math.abs(moved!.x-original!.x)+Math.abs(moved!.y-original!.y)).toBeGreaterThan(5)
  const grouping=page.getByRole('dialog',{name:'Подтверждение вложенности'})
  if(await grouping.isVisible())await grouping.getByRole('button',{name:'Подтвердить связь'}).click()
  const save=editor.getByRole('button',{name:'Сохранить расположение'})
  await expect(save).toBeEnabled()
  await save.click()
  const response=await page.request.get('http://127.0.0.1:8001/api/board/layout/'+systemId)
  expect(response.ok()).toBeTruthy()
  const geometry=(await response.json()).positions['network:'+id]
  expect(geometry).toBeTruthy()
  expect(geometry.width).toBeGreaterThanOrEqual(140)
  expect(geometry.height).toBeGreaterThanOrEqual(90)
  await editor.getByRole('toolbar').getByRole('button',{name:'История изменений'}).click()
  await expect(editor.getByRole('dialog',{name:'Журнал изменений архитектуры'})).toContainText('Сохранено расположение элементов схемы')
})


test('topology component inspector opens the same editable passport as Components', async({page})=>{
  const systemId=await seedSystem(page)
  const infra=await page.request.get('http://127.0.0.1:8001/api/infra')
  expect(infra.ok()).toBeTruthy()
  const component=(await infra.json()).find((item:{system_id:string})=>item.system_id===systemId)
  expect(component).toBeTruthy()
  await page.goto('/topology?component='+component.id)
  const sidebar=page.getByRole('complementary',{name:'Выбранный объект топологии'})
  await expect(sidebar).toBeVisible()
  await expect(sidebar.getByRole('button',{name:'Редактировать паспорт'})).toBeVisible()
  await sidebar.getByRole('button',{name:'Редактировать паспорт'}).click()
  const passport=page.getByRole('dialog',{name:'Карточка компонента '+component.name})
  await expect(passport).toBeVisible()
  await expect(passport.getByRole('textbox',{name:'Название',exact:true})).toHaveValue(component.name)
  await expect(passport.getByRole('button',{name:'Сохранить',exact:true})).toBeVisible()
  await passport.getByRole('button',{name:'Отмена'}).click()
  await expect(passport.getByRole('button',{name:'Редактировать паспорт'})).toBeVisible()
})


test('moving a VRF drags nested VLAN and independent VM while preserving network membership',async({page})=>{
  const systemId=await seedSystem(page)
  const timestamp=String(Date.now())
  const vrfRes=await page.request.post('http://127.0.0.1:8001/api/networks',{data:{name:'VRF-PROD-'+timestamp,kind:'vrf'}})
  expect(vrfRes.status()).toBe(201)
  const vlanRes=await page.request.post('http://127.0.0.1:8001/api/networks',{data:{name:'VLAN-100-'+timestamp,kind:'vlan'}})
  expect(vlanRes.status()).toBe(201)
  const vrf=(await vrfRes.json()).id as string
  const vlan=(await vlanRes.json()).id as string
  const vmRes=await page.request.post('http://127.0.0.1:8001/api/infra',{data:{
    system_id:systemId,kind:'vm',name:'Standalone nested VM '+timestamp
  }})
  expect(vmRes.status()).toBe(201)
  const vm=(await vmRes.json()).id as string
  const start={
    ['network:'+vrf]:{x:40,y:45,width:960,height:650},
    ['network:'+vlan]:{x:85,y:130,width:475,height:350,parent_id:'network:'+vrf},
    [vm]:{x:135,y:185,parent_id:'network:'+vlan}
  }
  const layout=await page.request.put('http://127.0.0.1:8001/api/board/layout/'+systemId,{data:{positions:start}})
  expect(layout.ok(),await layout.text()).toBeTruthy()
  await page.goto('/')
  await page.getByRole('navigation',{name:'Разделы архитектуры'}).getByRole('button',{name:'Компоненты',exact:true}).click()
  await page.getByRole('group',{name:'Представление компонентов'}).getByRole('button',{name:'Схема',exact:true}).click()
  await page.getByRole('combobox',{name:'Система компонентов'}).selectOption(systemId)
  await expect(page.locator('.miniArchitecture .react-flow__node[data-id="network:'+vrf+'"]')).toBeVisible()
  await expect(page.locator('.miniArchitecture .react-flow__node[data-id="network:'+vlan+'"]')).toBeVisible()
  await page.getByRole('button',{name:'Редактировать схему'}).click()
  const board=page.getByRole('region',{name:'Редактор архитектурной схемы'})
  const root=board.locator('.react-flow__node[data-id="network:'+vrf+'"]')
  const child=board.locator('.react-flow__node[data-id="network:'+vlan+'"]')
  const member=board.locator('.react-flow__node[data-id="'+vm+'"]')
  await expect(root).toBeVisible()
  await expect(child).toBeVisible()
  await expect(member).toBeVisible()
  const rootBefore=await root.boundingBox()
  expect(rootBefore).not.toBeNull()
  const x=rootBefore!.x+45,y=rootBefore!.y+17
  await page.mouse.move(x,y)
  await page.mouse.down()
  await page.mouse.move(x+120,y+75,{steps:12})
  await page.mouse.up()
  // Depending on surrounding zones the moved VRF may require a new parent
  // confirmation. Either outcome is valid, but it must not block saving.
  const groupPrompt=page.getByRole('dialog',{name:'Подтверждение вложенности'})
  if(await groupPrompt.isVisible())await groupPrompt.getByRole('button',{name:'Подтвердить связь'}).click()
  const save=board.getByRole('button',{name:'Сохранить расположение'})
  await expect(save).toBeEnabled()
  await save.click()
  const response=await page.request.get('http://127.0.0.1:8001/api/board/layout/'+systemId)
  expect(response.ok()).toBeTruthy()
  const saved=(await response.json()).positions as Record<string,{x:number;y:number;width?:number;height?:number}>
  const deltaX=saved['network:'+vrf].x-start['network:'+vrf].x
  const deltaY=saved['network:'+vrf].y-start['network:'+vrf].y
  expect(Math.abs(deltaX)+Math.abs(deltaY)).toBeGreaterThan(5)
  expect(saved['network:'+vlan].x).toBeCloseTo(start['network:'+vlan].x+deltaX,1)
  expect(saved['network:'+vlan].y).toBeCloseTo(start['network:'+vlan].y+deltaY,1)
  expect(saved[vm].x).toBeCloseTo(start[vm].x+deltaX,1)
  expect(saved[vm].y).toBeCloseTo(start[vm].y+deltaY,1)
  const interfaces=(await (await page.request.get('http://127.0.0.1:8001/api/network-interfaces')).json()) as Array<{item_id:string}>
  expect(interfaces.filter(n=>n.item_id===vm)).toEqual([])
  await page.getByRole('button',{name:'Завершить редактирование'}).click()
  await expect(page.locator('.miniArchitecture .react-flow__node[data-id="network:'+vrf+'"]')).toBeVisible()
  await expect(page.locator('.miniArchitecture .react-flow__node[data-id="network:'+vlan+'"]')).toBeVisible()
})

test('creating a VRF inside an existing VRF is rejected before being staged',async({page})=>{
  const systemId=await seedSystem(page)
  const id=(await (await page.request.post('http://127.0.0.1:8001/api/networks',{
    data:{name:'Parent VRF '+Date.now(),kind:'vrf'}
  })).json()).id as string
  await page.request.put('http://127.0.0.1:8001/api/board/layout/'+systemId,{
    data:{positions:{['network:'+id]:{x:70,y:70,width:1100,height:800}}}
  })
  await page.goto('/')
  await page.getByRole('navigation',{name:'Разделы архитектуры'}).getByRole('button',{name:'Компоненты',exact:true}).click()
  await page.getByRole('group',{name:'Представление компонентов'}).getByRole('button',{name:'Схема',exact:true}).click()
  await page.getByRole('button',{name:'Редактировать схему'}).click()
  await page.getByRole('combobox',{name:'Выбрать ИС для редактора компонентов'}).selectOption(systemId)
  const board=page.getByRole('region',{name:'Редактор архитектурной схемы'})
  await expect(board.locator('.react-flow__node[data-id="network:'+id+'"]')).toBeVisible()
  await board.getByRole('toolbar',{name:'Инструменты архитектуры'}).getByRole('button',{name:'▭ Сеть / контейнер'}).click()
  const dock=board.getByRole('complementary',{name:'Свойства и изменения схемы'})
  await dock.getByRole('textbox',{name:/Название сети/}).fill('Invalid nested VRF')
  await dock.getByRole('combobox',{name:'Тип'}).selectOption('vrf')
  const overlay=board.getByRole('region',{name:'Поле рисования контейнера'})
  const root=board.locator('.react-flow__node[data-id="network:'+id+'"]')
  const bounds=await root.boundingBox()
  expect(bounds).not.toBeNull()
  const px=bounds!.x+bounds!.width/2,py=bounds!.y+bounds!.height/2
  await page.mouse.move(px,py)
  await page.mouse.down()
  await page.mouse.up()
  await expect(board.getByText(/VRF нельзя создавать внутри другой VRF/)).toBeVisible()
  await expect(board.locator('.react-flow__node').filter({hasText:'Invalid nested VRF'})).toHaveCount(0)
})


test('dragging VLAN into and out of VRF requires confirmation and resizing zone with mouse persists',async({page})=>{
  const systemId=await seedSystem(page)
  const suffix=String(Date.now())
  const makeNetwork=async(kind:'vrf'|'vlan')=>{
    const response=await page.request.post('http://127.0.0.1:8001/api/networks',{
      data:{name:'Nested test '+kind+' '+suffix,kind}
    })
    expect(response.status()).toBe(201)
    return (await response.json()).id as string
  }
  const vrf=await makeNetwork('vrf'),vlan=await makeNetwork('vlan')
  const positions={
    ['network:'+vrf]:{x:180,y:95,width:760,height:540},
    ['network:'+vlan]:{x:1010,y:180,width:240,height:190}
  }
  const seeded=await page.request.put('http://127.0.0.1:8001/api/board/layout/'+systemId,{data:{positions}})
  expect(seeded.ok(),await seeded.text()).toBeTruthy()
  await page.goto('/')
  await page.getByRole('navigation',{name:'Разделы архитектуры'}).getByRole('button',{name:'Компоненты',exact:true}).click()
  await page.getByRole('group',{name:'Представление компонентов'}).getByRole('button',{name:'Схема',exact:true}).click()
  await page.getByRole('button',{name:'Редактировать схему'}).click()
  await page.getByRole('combobox',{name:'Выбрать ИС для редактора компонентов'}).selectOption(systemId)
  const board=page.getByRole('region',{name:'Редактор архитектурной схемы'})
  const parent=board.locator('.react-flow__node[data-id="network:'+vrf+'"]')
  const child=board.locator('.react-flow__node[data-id="network:'+vlan+'"]')
  await expect(parent).toBeVisible()
  await expect(child).toBeVisible()
  const vrfBox=await parent.boundingBox(),original=await child.boundingBox()
  expect(vrfBox).not.toBeNull();expect(original).not.toBeNull()
  const from={x:original!.x+30,y:original!.y+18}
  const into={x:vrfBox!.x+vrfBox!.width*.24,y:vrfBox!.y+vrfBox!.height*.24}
  await page.mouse.move(from.x,from.y)
  await page.mouse.down()
  await page.mouse.move(into.x,into.y,{steps:20})
  await page.mouse.up()
  const prompt=page.getByRole('dialog',{name:'Подтверждение вложенности'})
  await expect(prompt).toBeVisible()
  await expect(prompt).toContainText('Добавить объект в группу?')
  await prompt.getByRole('button',{name:'Подтвердить связь'}).click()
  await board.getByRole('button',{name:'Сохранить расположение'}).click()
  const read=async()=> (await (await page.request.get('http://127.0.0.1:8001/api/board/layout/'+systemId)).json()).positions as Record<string,{x:number;y:number;width?:number;height?:number;parent_id?:string}>
  await expect.poll(async()=>(await read())['network:'+vlan]?.parent_id).toBe('network:'+vrf)

  const next=await child.boundingBox()
  expect(next).not.toBeNull()
  await page.mouse.move(next!.x+30,next!.y+18)
  await page.mouse.down()
  await page.mouse.move(from.x,from.y,{steps:20})
  await page.mouse.up()
  await expect(prompt).toBeVisible()
  await expect(prompt).toContainText('Вывести объект из группы?')
  await prompt.getByRole('button',{name:'Подтвердить связь'}).click()
  await board.getByRole('button',{name:'Сохранить расположение'}).click()
  await expect.poll(async()=>(await read())['network:'+vlan]?.parent_id||null).toBe(null)

  const grips=parent.locator('.react-flow__resize-control.handle')
  await expect(grips.first()).toBeVisible()
  const before=(await read())['network:'+vrf]!.width!
  const grip=await grips.last().boundingBox()
  expect(grip).not.toBeNull()
  await page.mouse.move(grip!.x+grip!.width/2,grip!.y+grip!.height/2)
  await page.mouse.down()
  await page.mouse.move(grip!.x+grip!.width/2+60,grip!.y+grip!.height/2+45,{steps:12})
  await page.mouse.up()
  await board.getByRole('button',{name:'Сохранить расположение'}).click()
  const after=(await read())['network:'+vrf]!.width!
  expect(Math.abs(after-before)).toBeGreaterThan(10)
})


test('placing VM inside VLAN requests confirmation and optional NIC is saved only after review',async({page})=>{
  const systemId=await seedSystem(page)
  const vlanRes=await page.request.post('http://127.0.0.1:8001/api/networks',{
    data:{name:'VM placement VLAN '+Date.now(),kind:'vlan'}
  })
  expect(vlanRes.status()).toBe(201)
  const vlan=(await vlanRes.json()).id as string
  const seeded=await page.request.put('http://127.0.0.1:8001/api/board/layout/'+systemId,{
    data:{positions:{['network:'+vlan]:{x:180,y:120,width:800,height:620}}}
  })
  expect(seeded.ok()).toBeTruthy()
  await page.goto('/')
  await page.getByRole('navigation',{name:'Разделы архитектуры'}).getByRole('button',{name:'Компоненты',exact:true}).click()
  await page.getByRole('group',{name:'Представление компонентов'}).getByRole('button',{name:'Схема',exact:true}).click()
  await page.getByRole('button',{name:'Редактировать схему'}).click()
  await page.getByRole('combobox',{name:'Выбрать ИС для редактора компонентов'}).selectOption(systemId)
  const board=page.getByRole('region',{name:'Редактор архитектурной схемы'})
  const rect=board.locator('.react-flow__node[data-id="network:'+vlan+'"]')
  await expect(rect).toBeVisible()
  await board.getByRole('toolbar',{name:'Инструменты архитектуры'}).getByRole('button',{name:'+ ВМ'}).click()
  await board.getByRole('textbox',{name:'Имя ВМ'}).fill('VM nested '+Date.now())
  const name=await board.getByRole('textbox',{name:'Имя ВМ'}).inputValue()
  const bounds=await rect.boundingBox()
  expect(bounds).not.toBeNull()
  await page.mouse.click(bounds!.x+bounds!.width*.64,bounds!.y+bounds!.height*.62)
  const confirm=page.getByRole('dialog',{name:'Подтверждение вложенности'})
  await expect(confirm).toBeVisible()
  await expect(confirm).toContainText('Добавить объект в группу')
  await confirm.getByRole('combobox',{name:/Техническая привязка интерфейса к VLAN/}).selectOption('new')
  await confirm.getByRole('textbox',{name:'Имя нового интерфейса'}).fill('eth0')
  await confirm.getByRole('button',{name:'Подтвердить связь'}).click()
  const infraBefore=(await (await page.request.get('http://127.0.0.1:8001/api/infra')).json()) as Array<{id:string;name:string}>
  expect(infraBefore.some(v=>v.name===name)).toBe(false)
  await board.getByRole('button',{name:'Сохранить изменения схемы'}).click()
  await board.getByPlaceholder('Например: актуализация схемы ИС после изменения сети').fill('Confirm VM nested into VLAN with explicit NIC')
  await board.getByRole('button',{name:/Проверить изменения/}).click()
  await page.getByRole('dialog',{name:'Подтверждение изменений архитектуры'}).getByRole('button',{name:'Подтвердить и записать в журнал'}).click()
  const infra=(await (await page.request.get('http://127.0.0.1:8001/api/infra')).json()) as Array<{id:string;name:string}>
  const vm=infra.find(v=>v.name===name)
  expect(vm).toBeTruthy()
  const interfaces=(await (await page.request.get('http://127.0.0.1:8001/api/network-interfaces')).json()) as Array<{item_id:string;name:string;vlan_id:string|null}>
  expect(interfaces.some(n=>n.item_id===vm!.id&&n.name==='eth0'&&n.vlan_id===vlan)).toBe(true)
  const positions=(await (await page.request.get('http://127.0.0.1:8001/api/board/layout/'+systemId)).json()).positions as Record<string,{parent_id?:string}>
  expect(positions[vm!.id]?.parent_id).toBe('network:'+vlan)
})


test('saved flow edits are reviewed from VM passport and survive reloading the diagram',async({page})=>{
  const systemId=await seedSystem(page)
  const infra=(await (await page.request.get('http://127.0.0.1:8001/api/infra')).json())
    .filter((v:{system_id:string})=>v.system_id===systemId) as Array<{id:string;name:string}>
  const source=infra.find(v=>v.name==='QA-WORK-Editor source')!,target=infra.find(v=>v.name==='QA-WORK-Editor destination')!
  const created=await page.request.post('http://127.0.0.1:8001/api/flows',{data:{
    source_id:source.id,target_id:target.id,name:'HR data batch',protocol:'TCP',
    port:'443',security:'unknown',data_description:'Employee identifier',schedule:'daily',verification:'draft'
  }})
  expect(created.status()).toBe(201)
  const flowId=(await created.json()).id as string
  await page.goto('/')
  await page.getByRole('navigation',{name:'Разделы архитектуры'}).getByRole('button',{name:'Компоненты',exact:true}).click()
  await page.getByRole('group',{name:'Представление компонентов'}).getByRole('button',{name:'Схема',exact:true}).click()
  await page.getByRole('button',{name:'Редактировать схему'}).click()
  await page.getByRole('combobox',{name:'Выбрать ИС для редактора компонентов'}).selectOption(systemId)
  const editor=page.getByRole('region',{name:'Редактор архитектурной схемы'})
  await editor.locator('.react-flow__node').filter({hasText:'QA-WORK-Editor source'}).click()
  const inspector=editor.getByRole('dialog',{name:'Паспорт компонента QA-WORK-Editor source'})
  await expect(inspector.getByRole('button',{name:'Открыть параметры потока'})).toBeVisible()
  await inspector.getByRole('button',{name:'Открыть параметры потока'}).click()
  const savedEditor=editor.getByRole('form',{name:'Редактирование существующего потока'})
  await expect(savedEditor).toBeVisible()
  await expect(savedEditor.getByRole('textbox',{name:'Название потока'})).toHaveValue('HR data batch')
  await savedEditor.getByRole('textbox',{name:'Название потока'}).fill('HR data verified')
  await savedEditor.getByRole('textbox',{name:'Протокол'}).fill('HTTPS')
  await savedEditor.getByRole('textbox',{name:'Порт'}).fill('8443')
  await savedEditor.getByRole('textbox',{name:'Защита'}).fill('TLS')
  await savedEditor.getByRole('textbox',{name:'Описание данных'}).fill('Employee identifier and workplace')
  await savedEditor.getByRole('textbox',{name:'Периодичность'}).fill('hourly')
  await savedEditor.getByRole('combobox',{name:'Достоверность'}).selectOption('verified')
  await savedEditor.getByRole('button',{name:'Добавить изменение в черновик'}).click()
  await expect(editor.getByRole('button',{name:'Проверить изменения (1)'})).toBeVisible()
  const notSaved=(await (await page.request.get('http://127.0.0.1:8001/api/flows')).json()).find((x:{id:string})=>x.id===flowId)
  expect(notSaved.port).toBe('443')
  const dock=editor.getByRole('complementary',{name:'Свойства и изменения схемы'})
  await dock.getByPlaceholder('Например: актуализация схемы ИС после изменения сети').fill('Confirmed technical flow attributes')
  await dock.getByRole('button',{name:'Проверить изменения (1)'}).click()
  const review=editor.getByRole('dialog',{name:'Подтверждение изменений архитектуры'})
  await expect(review).toContainText('update_flow')
  await review.getByRole('button',{name:'Подтвердить и записать в журнал'}).click()
  await expect(review).toHaveCount(0)
  const updated=(await (await page.request.get('http://127.0.0.1:8001/api/flows')).json()).find((x:{id:string})=>x.id===flowId)
  expect(updated).toMatchObject({name:'HR data verified',protocol:'HTTPS',port:'8443',
    security:'TLS',data_description:'Employee identifier and workplace',schedule:'hourly',verification:'verified'})
  await page.reload()
  await page.getByRole('navigation',{name:'Разделы архитектуры'}).getByRole('button',{name:'Компоненты',exact:true}).click()
  await page.getByRole('group',{name:'Представление компонентов'}).getByRole('button',{name:'Схема',exact:true}).click()
  await page.getByRole('button',{name:'Редактировать схему'}).click()
  // On reload the application may remember the chosen IS and open the editor directly.
  const chooser=page.getByRole('combobox',{name:'Выбрать ИС для редактора компонентов'})
  if(await chooser.isVisible())await chooser.selectOption(systemId)
  const refreshed=page.getByRole('region',{name:'Редактор архитектурной схемы'})
  await refreshed.locator('.react-flow__node').filter({hasText:'QA-WORK-Editor source'}).click()
  await refreshed.getByRole('dialog',{name:'Паспорт компонента QA-WORK-Editor source'}).getByRole('button',{name:'Открыть параметры потока'}).click()
  await expect(refreshed.getByRole('form',{name:'Редактирование существующего потока'}).getByRole('textbox',{name:'Порт'})).toHaveValue('8443')
})

test('one grouped arrow exposes its separate saved flow records',async({page})=>{
  const systemId=await seedSystem(page)
  const infra=(await (await page.request.get('http://127.0.0.1:8001/api/infra')).json())
    .filter((v:{system_id:string})=>v.system_id===systemId) as Array<{id:string;name:string}>
  const source=infra.find(v=>v.name==='QA-WORK-Editor source')!,target=infra.find(v=>v.name==='QA-WORK-Editor destination')!
  for(const name of ['Payroll','Work schedule']){
    const result=await page.request.post('http://127.0.0.1:8001/api/flows',{
      data:{source_id:source.id,target_id:target.id,name,protocol:'HTTPS',port:'443'}
    })
    expect(result.status()).toBe(201)
  }
  await page.goto('/')
  await page.getByRole('navigation',{name:'Разделы архитектуры'}).getByRole('button',{name:'Компоненты',exact:true}).click()
  await page.getByRole('group',{name:'Представление компонентов'}).getByRole('button',{name:'Схема',exact:true}).click()
  await page.getByRole('button',{name:'Редактировать схему'}).click()
  await page.getByRole('combobox',{name:'Выбрать ИС для редактора компонентов'}).selectOption(systemId)
  const editor=page.getByRole('region',{name:'Редактор архитектурной схемы'})
  await expect(editor.locator('.react-flow__edge')).toHaveCount(1)
  await editor.locator('.react-flow__edge').first().click()
  const selection=editor.getByRole('region',{name:'Потоки выбранной стрелки'})
  await expect(selection).toBeVisible()
  await expect(selection.getByRole('button')).toHaveCount(2)
  await selection.getByRole('button',{name:/Payroll/}).click()
  const form=editor.getByRole('form',{name:'Редактирование существующего потока'})
  await expect(form.getByRole('textbox',{name:'Название потока'})).toHaveValue('Payroll')
  await expect(form.getByRole('textbox',{name:'Протокол'})).toHaveValue('HTTPS')
})


test('unsaved architecture draft stays a compact overlay without shrinking the canvas',async({page})=>{
 const system=await seedSystem(page)
 await page.goto('/')
 await page.getByRole('navigation',{name:'Разделы архитектуры'})
  .getByRole('button',{name:'Компоненты',exact:true}).click()
 await page.getByRole('group',{name:'Представление компонентов'})
  .getByRole('button',{name:'Схема',exact:true}).click()
 await page.getByRole('button',{name:'Редактировать схему'}).click()
 const chooser=page.getByRole('combobox',{name:'Выбрать ИС для редактора компонентов'})
 if(await chooser.isVisible())await chooser.selectOption(system)
 const editor=page.getByRole('region',{name:'Редактор архитектурной схемы'})
 const canvas=editor.locator('.boardCanvas')
 const initial=await canvas.boundingBox()
 expect(initial).not.toBeNull()
 await editor.getByRole('toolbar',{name:'Инструменты архитектуры'})
  .getByRole('button',{name:'+ ВМ'}).click()
 await editor.getByPlaceholder('Новая ВМ').fill('QA draft VM')
 await editor.getByRole('button',{name:'Разместить на схеме'}).click()
 const banner=editor.locator('.boardPendingBanner')
 await expect(banner).toBeVisible()
 await expect(banner).toContainText('Не сохранено: 1 ВМ')
 await expect(banner).toHaveCSS('position','absolute')
 const overlay=await banner.boundingBox()
 const after=await canvas.boundingBox()
 expect(overlay&&after).toBeTruthy()
 expect(overlay!.height).toBeLessThan(140)
 expect(Math.abs(after!.height-initial!.height)).toBeLessThan(5)
 expect(after!.height).toBeGreaterThan(430)
})
