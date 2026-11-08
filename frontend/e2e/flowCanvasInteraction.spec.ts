import {test,expect,type Page} from '@playwright/test'

// Regression tests use the isolated SQLite backend from the Chromium CI job.
test.beforeEach(async({page})=>{
  await page.addInitScript(()=>{
    sessionStorage.setItem('architecture-hub:access-token:session','browser-ci-development-token')
  })
})

async function seed(page:Page){
  const suffix=Date.now().toString(36)
  const create=async(path:string,data:Record<string,unknown>)=>{
    const response=await page.request.post('http://127.0.0.1:8001'+path,{data})
    expect(response.status(),await response.text()).toBe(201)
    return (await response.json()).id as string
  }
  const system=await create('/api/objects',{kind:'system',name:'Canvas UX '+suffix})
  const names=['Source '+suffix,'Hub '+suffix,'Consumer '+suffix]
  const ids=await Promise.all(names.map(name=>create('/api/infra',{system_id:system,kind:'vm',name,description:'UI regression component'})))
  await create('/api/flows',{source_id:ids[0],target_id:ids[1],name:'Source to Hub '+suffix})
  await create('/api/flows',{source_id:ids[1],target_id:ids[2],name:'Hub to Consumer '+suffix})
  return {system,names,ids}
}

async function navigate(page:Page,section:'Потоки'|'Компоненты'){
  await page.goto('/')
  await page.getByRole('navigation',{name:'Разделы архитектуры'}).getByRole('button',{name:section,exact:true}).click()
}

test('flow graph remains centered, clicking a component highlights it and opens its passport',async({page})=>{
  const {system,names,ids}=await seed(page)
  await navigate(page,'Потоки')
  await page.getByRole('combobox',{name:'Система потоков'}).selectOption(system)
  await page.getByRole('combobox',{name:'Детализация схемы потоков'}).selectOption('components')
  const graph=page.locator('[data-active-graph="flows"]')
  await expect(graph.locator('.react-flow__node')).toHaveCount(3)
  const hub=graph.locator('.react-flow__node').filter({hasText:names[1]})
  await expect(hub).toBeVisible()
  await expect.poll(async()=>{
    const card=await hub.boundingBox()
    const canvas=await graph.boundingBox()
    return Boolean(card&&canvas&&card.x>=canvas.x&&card.y>=canvas.y&&
      card.x+card.width<=canvas.x+canvas.width&&card.y+card.height<=canvas.y+canvas.height)
  }).toBe(true)

  await hub.click()
  const dialog=page.getByRole('dialog',{name:'Карточка компонента '+names[1]})
  await expect(dialog).toBeVisible()
  await expect(hub).toHaveCSS('border-top-color','rgb(37, 99, 235)')
  await dialog.getByRole('button',{name:/Закрыть/}).click()
  await expect(dialog).toBeHidden()

  await page.getByText('Настройки потоков и качество данных').click()
  await page.getByRole('combobox',{name:'Показать связи компонента'}).selectOption(ids[1])
  await expect(graph.locator('.react-flow__node')).toHaveCount(3)
  await expect.poll(async()=>{
    const canvas=await graph.boundingBox()
    const nodes=await graph.locator('.react-flow__node').all()
    const bounds=await Promise.all(nodes.map(node=>node.boundingBox()))
    return Boolean(canvas&&bounds.every(b=>b&&b.x>=canvas.x-2&&b.y>=canvas.y-2&&
       b.x+b.width<=canvas.x+canvas.width+2&&b.y+b.height<=canvas.y+canvas.height+2))
  }).toBe(true)
})

test('components diagram opens its right-side passport and keeps selected node highlighted',async({page})=>{
  const {system,names}=await seed(page)
  await navigate(page,'Компоненты')
  await page.getByRole('combobox',{name:'Система компонентов'}).selectOption(system)
  await page.getByRole('group',{name:'Представление компонентов'}).getByRole('button',{name:'Схема',exact:true}).click()
  await page.getByRole('combobox',{name:'Группировка компонентов'}).selectOption('components')
  const graph=page.locator('[data-active-graph="infrastructure"]')
  const node=graph.locator('.react-flow__node').filter({hasText:names[0]})
  await expect(node).toBeVisible()
  await node.click()
  await expect(page.getByRole('dialog',{name:'Карточка компонента '+names[0]})).toBeVisible()
  await expect(node).toHaveCSS('border-top-color','rgb(19, 119, 213)')
})

test('flow utilities are available without occupying permanent rows above the canvas',async({page})=>{
  const {system}=await seed(page)
  await navigate(page,'Потоки')
  await page.getByRole('combobox',{name:'Система потоков'}).selectOption(system)
  await page.getByRole('combobox',{name:'Детализация схемы потоков'}).selectOption('components')
  const graph=page.locator('[data-active-graph="flows"]')
  await expect(graph).toBeVisible()
  const menu=page.locator('details.flowActionsMenu')
  await expect(menu).not.toHaveAttribute('open')
  await expect(menu.getByRole('button',{name:'Справочник атрибутов и состав данных'})).toBeHidden()
  await menu.locator('summary').click()
  await expect(menu.getByRole('button',{name:'Справочник атрибутов и состав данных'})).toBeVisible()
  await expect(menu.getByRole('button',{name:'Сетевой маршрут и средства защиты'})).toBeVisible()
  await menu.locator('summary').click()
  await expect.poll(async()=> (await graph.boundingBox())?.y||999).toBeLessThan(440)
})
