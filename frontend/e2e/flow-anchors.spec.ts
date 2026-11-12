import {test,expect,type Page} from '@playwright/test'

test.beforeEach(async({page})=>{
 await page.addInitScript(()=>{
  sessionStorage.setItem('architecture-hub:access-token:session','browser-ci-development-token')
 })
})

async function seed(page:Page){
 const unique=Date.now()+''+Math.floor(Math.random()*1000)
 const response=await page.request.post('http://127.0.0.1:8001/api/objects',
  {data:{name:'Eight port test '+unique,kind:'system'}})
 expect(response.status()).toBe(201)
 const system=(await response.json()).id as string
 const items=[]
 for(const name of ['Anchor source '+unique,'Anchor target '+unique]){
  const r=await page.request.post('http://127.0.0.1:8001/api/infra',
   {data:{system_id:system,name,kind:'vm',description:'Eight port scenario'}})
  expect(r.status()).toBe(201)
  items.push(await r.json())
 }
 return {system,source:items[0] as {id:string;name:string},target:items[1] as {id:string;name:string}}
}

async function openBoard(page:Page,system:string){
 await page.goto('/')
 await page.getByRole('navigation',{name:'Разделы архитектуры'})
  .getByRole('button',{name:'Компоненты',exact:true}).click()
 await page.getByRole('group',{name:'Представление компонентов'})
  .getByRole('button',{name:'Схема',exact:true}).click()
 await page.getByRole('button',{name:'Редактировать схему'}).click()
 const choose=page.getByRole('combobox',{name:'Выбрать ИС для редактора компонентов'})
 if(await choose.isVisible())await choose.selectOption(system)
 return page.getByRole('region',{name:'Редактор архитектурной схемы'})
}

async function drag(page:Page,start:import('@playwright/test').Locator,end:import('@playwright/test').Locator){
 const a=await start.boundingBox(),b=await end.boundingBox()
 expect(a).not.toBeNull();expect(b).not.toBeNull()
 await page.mouse.move(a!.x+a!.width/2,a!.y+a!.height/2)
 await page.mouse.down()
 await page.mouse.move(b!.x+b!.width/2,b!.y+b!.height/2,{steps:16})
 await page.mouse.up()
}

test('eight real ports on each VM, drawing from chosen exit to chosen entry persists',async({page})=>{
 const {system,source,target}=await seed(page)
 const editor=await openBoard(page,system)
 await editor.getByRole('toolbar',{name:'Инструменты архитектуры'})
  .getByRole('button',{name:'→ Поток'}).click()
 const origin=editor.locator('.react-flow__node[data-id="'+source.id+'"]')
 const recipient=editor.locator('.react-flow__node[data-id="'+target.id+'"]')
 await expect(origin.locator('.flowPortSource')).toHaveCount(8)
 await expect(origin.locator('.flowPortTarget')).toHaveCount(8)
 await expect(recipient.locator('.flowPortSource.boardConnectionHandleActive')).toHaveCount(8)
 await drag(page,origin.locator('[data-anchor="out-bottom-2"]'),
  recipient.locator('[data-anchor="in-top-1"]'))
 await expect(editor.locator('.react-flow__edge')).toHaveCount(1)
 await expect(editor.getByRole('button',{name:'Проверить изменения (1)'})).toBeVisible()
 const dock=editor.getByRole('complementary',{name:'Свойства и изменения схемы'})
 await dock.getByPlaceholder('Например: актуализация схемы ИС после изменения сети')
  .fill('Confirmed chosen anchors for integration')
 await dock.getByRole('button',{name:'Проверить изменения (1)'}).click()
 const review=editor.getByRole('dialog',{name:'Подтверждение изменений архитектуры'})
 await review.getByRole('button',{name:'Подтвердить и записать в журнал'}).click()
 // Confirm the complete sequence: registry transaction AND layout persistence.
 await expect(review).toHaveCount(0)
 const flows=(await (await page.request.get('http://127.0.0.1:8001/api/flows')).json()) as
  Array<{id:string;source_id:string;target_id:string}>
 const saved=flows.find(f=>f.source_id===source.id&&f.target_id===target.id)
 expect(saved).toBeTruthy()
 await expect.poll(async()=>{
   const response=await page.request.get('http://127.0.0.1:8001/api/board/layout/'+system)
   const positions=await response.json() as {flow_anchors:Record<string,{source_handle:string;target_handle:string}>}
   return positions.flow_anchors[saved!.id]
 }).toEqual({source_handle:'out-bottom-2',target_handle:'in-top-1'})
})

test('move existing arrow endpoint to another of eight positions and see it on reopened scheme',async({page})=>{
 const {system,source,target}=await seed(page)
 const created=await page.request.post('http://127.0.0.1:8001/api/flows',{
  data:{source_id:source.id,target_id:target.id,name:'Retarget anchor example',protocol:'HTTPS',port:'443'}
 })
 expect(created.status()).toBe(201)
 const flowId=(await created.json()).id as string
 const editor=await openBoard(page,system)
 await editor.locator('.react-flow__edge').first().click()
 await expect(editor.getByRole('button',{name:'Перенести конец стрелки'})).toBeVisible()
 const targetNode=editor.locator('.react-flow__node[data-id="'+target.id+'"]')
 await drag(page,editor.getByRole('button',{name:'Перенести конец стрелки'}),
  targetNode.locator('[data-anchor="in-bottom-2"]'))
 await expect(editor.getByRole('button',{name:'Сохранить расположение'})).toBeEnabled()
 await editor.getByRole('button',{name:'Сохранить расположение'}).click()
 let saved=(await (await page.request.get('http://127.0.0.1:8001/api/board/layout/'+system)).json()) as {
  flow_anchors:Record<string,{source_handle:string;target_handle:string}>
 }
 expect(saved.flow_anchors[flowId].target_handle).toBe('in-bottom-2')
 const model=(await (await page.request.get('http://127.0.0.1:8001/api/flows')).json()) as
  Array<{id:string;source_id:string;target_id:string}>
 expect(model.find(f=>f.id===flowId)).toMatchObject({source_id:source.id,target_id:target.id})
 await page.getByRole('button',{name:'Завершить редактирование'}).click()
 const viewer=page.locator('.miniArchitecture[data-active-graph="infrastructure"]')
 await expect(viewer).toBeVisible()
 const viewed=viewer.locator('.react-flow__edge')
 await expect(viewed).toHaveCount(1)
 await expect(viewer.locator('.react-flow__node[data-id="'+target.id+'"] [data-anchor="in-bottom-2"]')).toHaveCount(1)
 await page.reload()
 const chooser=page.getByRole('combobox',{name:'Система компонентов'})
 if(await chooser.isVisible())await chooser.selectOption(system)
 const editorAgain=await openBoard(page,system)
 await expect(editorAgain.locator('.react-flow__edge')).toHaveCount(1)
 const after=(await (await page.request.get('http://127.0.0.1:8001/api/board/layout/'+system)).json()) as {
  flow_anchors:Record<string,{source_handle:string;target_handle:string}>
 }
 expect(after.flow_anchors[flowId].target_handle).toBe('in-bottom-2')
})


test('top to top and right to left drag each create exactly one flow',async({page})=>{
 const {system,source,target}=await seed(page)
 const editor=await openBoard(page,system)
 await editor.getByRole('toolbar',{name:'Инструменты архитектуры'})
  .getByRole('button',{name:'→ Поток'}).click()
 const origin=editor.locator('.react-flow__node[data-id="'+source.id+'"]')
 const recipient=editor.locator('.react-flow__node[data-id="'+target.id+'"]')
 await expect(origin.locator('.flowPortSource.boardConnectionHandleActive')).toHaveCount(8)

 // Regression for the intermittently failing main CI scenario: the first
 // source/target handles are both above the cards and the pointer travels
 // horizontally across React Flow's pane.
 await drag(page,origin.locator('[data-anchor="out-top-1"]'),
  recipient.locator('[data-anchor="in-top-1"]'))
 await expect(editor.locator('.react-flow__edge')).toHaveCount(1)
 await expect(editor.getByRole('button',{name:'Проверить изменения (1)'})).toBeVisible()

 // Starting a second flow must neither duplicate the first nor lose its
 // chosen port when the component data rerenders after staging.
 await drag(page,origin.locator('[data-anchor="out-right-2"]'),
  recipient.locator('[data-anchor="in-left-2"]'))
 await expect(editor.locator('.react-flow__edge')).toHaveCount(2)
 await expect(editor.getByRole('button',{name:'Проверить изменения (2)'})).toBeVisible()
})

test('reconnect a saved flow to another VM and keep the chosen port after reopening',async({page})=>{
 const {system,source,target}=await seed(page)
 const replacement=await page.request.post('http://127.0.0.1:8001/api/infra',{
  data:{system_id:system,name:'Replacement receiver',kind:'vm'}
 })
 expect(replacement.status()).toBe(201)
 const replacementId=(await replacement.json()).id as string
 const created=await page.request.post('http://127.0.0.1:8001/api/flows',{
  data:{source_id:source.id,target_id:target.id,name:'Existing export',protocol:'HTTPS',port:'443'}
 })
 expect(created.status()).toBe(201)
 const flowId=(await created.json()).id as string
 const readFlows=async()=>(await (await page.request.get('http://127.0.0.1:8001/api/flows')).json()) as
  Array<{id:string;source_id:string;target_id:string;protocol:string;port:string}>
 const editor=await openBoard(page,system)
 await editor.locator('.react-flow__edge').first().click()
 const replacementNode=editor.locator('.react-flow__node[data-id="'+replacementId+'"]')
 const grip=editor.getByRole('button',{name:'Перенести конец стрелки'})
 await expect(grip).toBeVisible()
 await drag(page,grip,replacementNode.locator('[data-anchor="in-top-2"]'))
 const dock=editor.getByRole('complementary',{name:'Свойства и изменения схемы'})
 await expect(dock.getByRole('form',{name:'Редактирование существующего потока'}))
  .toContainText('Replacement receiver')
 expect((await readFlows()).find(f=>f.id===flowId)?.target_id).toBe(target.id)

 const reason=dock.getByPlaceholder('Например: актуализация схемы ИС после изменения сети')
 await reason.fill('Transfer export to replacement receiver')
 await dock.getByRole('button',{name:'Проверить изменения (1)'}).click()
 const review=editor.getByRole('dialog',{name:'Подтверждение изменений архитектуры'})
 await expect(review.getByText('Было: '+source.name+' → '+target.name,{exact:true})).toBeVisible()
 await expect(review.getByText('Станет: '+source.name+' → Replacement receiver',{exact:true})).toBeVisible()
 await review.getByRole('button',{name:'Подтвердить и записать в журнал'}).click()
 await expect(review).toHaveCount(0)
 const saved=await readFlows()
 expect(saved.filter(f=>f.source_id===source.id)).toEqual([
  expect.objectContaining({id:flowId,target_id:replacementId,protocol:'HTTPS',port:'443'})
 ])
 const layout=await page.request.get('http://127.0.0.1:8001/api/board/layout/'+system)
 expect((await layout.json()).flow_anchors[flowId].target_handle).toBe('in-top-2')
 const reopened=await openBoard(page,system)
 const edge=reopened.locator('.react-flow__edge')
 await expect(edge).toHaveCount(1)
 await expect(edge).toHaveAttribute('data-id',new RegExp(replacementId))
})
