import {test,expect,type Page} from '@playwright/test'

test.describe.configure({retries:0})

test.beforeEach(async({page})=>{
  await page.addInitScript(()=>sessionStorage.setItem('architecture-hub:access-token:session','browser-ci-development-token'))
})

const api='http://127.0.0.1:8001'
async function setup(page:Page){
  const suffix=String(Date.now())+'-'+String(Math.floor(Math.random()*1000))
  const created=await page.request.post(api+'/api/objects',{data:{kind:'system',name:'QA-WORK-UNDO-'+suffix}})
  expect(created.status(),await created.text()).toBe(201)
  const system=(await created.json()).id as string
  const components:string[]=[]
  for(const name of ['QA-WORK-Undo-Source-'+suffix,'QA-WORK-Undo-Target-'+suffix]){
    const response=await page.request.post(api+'/api/infra',{data:{system_id:system,kind:'vm',name}})
    expect(response.status(),await response.text()).toBe(201)
    components.push((await response.json()).id as string)
  }
  await page.goto('/components?system='+system)
  await page.getByRole('group',{name:'Представление компонентов'}).getByRole('button',{name:'Схема'}).click()
  await page.getByRole('button',{name:'Редактировать схему',exact:true}).click()
  const board=page.getByRole('region',{name:'Редактор архитектурной схемы'})
  await expect(board).toHaveAttribute('aria-busy','false')
  const tools=board.getByRole('toolbar',{name:'Инструменты архитектуры'})
  return {system,suffix,components,board,tools}
}

test('AH-QA-19: create VM, undo/redo twice and keep technical registry unchanged',async({page})=>{
  const {board,tools,suffix}=await setup(page)
  const name='QA-WORK-Undo-New-'+suffix
  const undo=tools.getByRole('button',{name:'Отменить действие'})
  const redo=tools.getByRole('button',{name:'Повторить действие'})
  await expect(undo).toBeDisabled()
  await expect(redo).toBeDisabled()
  await tools.getByRole('button',{name:'+ ВМ'}).click()
  await board.getByPlaceholder('Новая ВМ').fill(name)
  await board.getByRole('button',{name:'Разместить на схеме'}).click()
  const newVM=board.locator('.react-flow__node-boardComponent').filter({hasText:name})
  await expect(newVM).toBeVisible()
  await expect(undo).toBeEnabled()
  await undo.click()
  await expect(newVM).toHaveCount(0)
  await expect(redo).toBeEnabled()
  await redo.click()
  await expect(newVM).toBeVisible()
  await page.keyboard.press('Control+z')
  await expect(newVM).toHaveCount(0)
  await page.keyboard.press('Control+Shift+z')
  await expect(newVM).toBeVisible()
  const rows=(await (await page.request.get(api+'/api/infra')).json()) as Array<{name:string}>
  expect(rows.some(row=>row.name===name)).toBe(false)
})

test('AH-QA-19: moving an existing VM restores coordinates and clears history after save',async({page})=>{
  const {board,tools,components,system}=await setup(page)
  const node=board.locator('.react-flow__node[data-id="'+components[0]+'"]')
  await expect(node).toBeVisible()
  const position=()=>node.evaluate(el=>{
    const transform=new DOMMatrixReadOnly(getComputedStyle(el).transform)
    return {x:transform.m41,y:transform.m42}
  })
  const initial=await position()
  const box=await node.boundingBox()
  expect(box).not.toBeNull()
  await page.mouse.move(box!.x+box!.width/2,box!.y+box!.height/2)
  await page.mouse.down()
  await page.mouse.move(box!.x+box!.width/2+88,box!.y+box!.height/2+45,{steps:10})
  await page.mouse.up()
  await expect.poll(async()=> (await position()).x).toBeGreaterThan(initial.x+25)
  const moved=await position()
  await tools.getByRole('button',{name:'Отменить действие'}).click()
  await expect.poll(async()=> (await position()).x).toBeCloseTo(initial.x,0)
  await tools.getByRole('button',{name:'Повторить действие'}).click()
  await expect.poll(async()=> (await position()).x).toBeCloseTo(moved.x,0)
  await tools.getByRole('button',{name:'Сохранить расположение'}).click()
  await expect(tools.getByRole('button',{name:'Отменить действие'})).toBeDisabled()
  await expect(tools.getByRole('button',{name:'Повторить действие'})).toBeDisabled()
  const layout=await page.request.get(api+'/api/board/layout/'+system)
  expect(layout.status()).toBe(200)
  const saved=(await layout.json()).positions as Record<string,{x:number;y:number}>
  expect(saved[components[0]].x).toBeCloseTo(moved.x,0)
})

test('AH-QA-19: drawing a new flow is reversible without committing an API record',async({page})=>{
  const {board,tools,components}=await setup(page)
  await tools.getByRole('button',{name:'→ Поток'}).click()
  await board.locator('.react-flow__node[data-id="'+components[0]+'"] .boardComponentClickArea').click()
  await board.locator('.react-flow__node[data-id="'+components[1]+'"] .boardComponentClickArea').click()
  await expect(board.locator('.react-flow__edge')).toHaveCount(1)
  await expect(board.getByRole('button',{name:'Проверить изменения (1)'})).toBeVisible()
  await tools.getByRole('button',{name:'Отменить действие'}).click()
  await expect(board.locator('.react-flow__edge')).toHaveCount(0)
  await tools.getByRole('button',{name:'Повторить действие'}).click()
  await expect(board.locator('.react-flow__edge')).toHaveCount(1)
  const rows=(await (await page.request.get(api+'/api/flows')).json()) as Array<{source_id:string;target_id:string}>
  expect(rows.some(row=>row.source_id===components[0]&&row.target_id===components[1])).toBe(false)
})
