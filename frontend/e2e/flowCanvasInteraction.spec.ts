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
  const systemName='QA-WORK-Canvas UX '+suffix
  const system=await create('/api/objects',{kind:'system',name:systemName})
  const names=['QA-WORK-Source '+suffix,'QA-WORK-Hub '+suffix,'QA-WORK-Consumer '+suffix]
  const ids=await Promise.all(names.map(name=>create('/api/infra',{system_id:system,kind:'vm',name,description:'UI regression component'})))
  await create('/api/flows',{source_id:ids[0],target_id:ids[1],name:'Source to Hub '+suffix})
  await create('/api/flows',{source_id:ids[1],target_id:ids[2],name:'Hub to Consumer '+suffix})
  return {system,systemName,names,ids}
}

async function navigate(page:Page,section:'Потоки'|'Компоненты'){
  await page.goto('/')
  await page.getByRole('navigation',{name:'Разделы архитектуры'}).getByRole('button',{name:section,exact:true}).click()
}

test('flow registry opens the unified overview map with the original IS focused',async({page})=>{
  const errors:string[]=[]
  page.on('pageerror',error=>errors.push(error.message))
  const {system,systemName}=await seed(page)
  await navigate(page,'Потоки')
  await page.getByRole('combobox',{name:'Система потоков'}).selectOption(system)
  const registry=page.getByRole('region',{name:'Реестр технических потоков'})
  await expect(registry.locator('.infraCard')).toHaveCount(2)
  await expect(page.locator('[data-active-graph="flows"]')).toHaveCount(0)
  await registry.getByRole('link',{name:'На карте'}).first().click()

  const map=page.getByRole('region',{name:'Главная карта архитектуры'})
  await expect(map).toBeVisible()
  expect(errors).toEqual([])
  const source=map.locator('.react-flow__node').filter({hasText:systemName})
  await expect(source).toBeVisible()
  // Focus must survive the first map mount; it used to be cleared by an
  // unrelated inspector-close effect.
  await expect(source).toHaveCSS('border-top-color','rgb(37, 99, 235)')
  const rect=await source.boundingBox(),canvas=await map.locator('.homeMapGraph').boundingBox()
  expect(rect&&canvas&&rect.x>=canvas.x&&rect.y>=canvas.y&&rect.x+rect.width<=canvas.x+canvas.width+2).toBeTruthy()
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

test('flow utilities remain available from More while flow workspace is a registry',async({page})=>{
  const {system}=await seed(page)
  await navigate(page,'Потоки')
  await page.getByRole('combobox',{name:'Система потоков'}).selectOption(system)
  await expect(page.getByRole('region',{name:'Реестр технических потоков'})).toBeVisible()
  await expect(page.locator('[data-active-graph="flows"]')).toHaveCount(0)
  const menu=page.locator('details.flowActionsMenu')
  await expect(menu).not.toHaveAttribute('open','')
  await expect(menu.getByRole('button',{name:'Справочник атрибутов и состав данных'})).toBeHidden()
  await menu.locator('summary').click()
  await expect(menu.getByRole('button',{name:'Справочник атрибутов и состав данных'})).toBeVisible()
  await expect(menu.getByRole('button',{name:'Сетевой маршрут и средства защиты'})).toBeVisible()
  await menu.locator('summary').click()
  await expect(menu).not.toHaveAttribute('open','')
})


test('QA-WORK: mobile flow registry links to one shared architecture map',async({page})=>{
  await page.setViewportSize({width:390,height:844})
  const {system,systemName}=await seed(page)
  await page.goto('/flows?system='+system)
  const registry=page.getByRole('region',{name:'Реестр технических потоков'})
  await expect(registry.getByRole('link',{name:'На карте'}).first()).toBeVisible()
  await registry.getByRole('link',{name:'На карте'}).first().click()
  await expect(page).toHaveURL(new RegExp('\\?focus='+system))
  const map=page.getByRole('region',{name:'Главная карта архитектуры'})
  await expect(map).toBeVisible()
  await expect(map.locator('.react-flow__node').filter({hasText:systemName})).toHaveCount(1)
  await expect(map.getByRole('group',{name:'Режим архитектурных областей'})).toBeVisible()
  await map.getByRole('button',{name:'Наложить оба'}).click()
  await expect(map.getByRole('button',{name:'Наложить оба'})).toHaveAttribute('aria-pressed','true')
})
