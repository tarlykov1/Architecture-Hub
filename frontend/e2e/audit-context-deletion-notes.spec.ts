import {test,expect} from '@playwright/test'

test.describe.configure({retries:0})
const api='http://127.0.0.1:8001'
async function create(page:import('@playwright/test').Page,path:string,data:Record<string,unknown>){
 const response=await page.request.post(api+path,{data})
 expect(response.status(),await response.text()).toBe(201)
 return (await response.json()).id as string
}
async function editorFor(page:import('@playwright/test').Page,system:string){
 await page.addInitScript(()=>sessionStorage.setItem('architecture-hub:access-token:session','browser-ci-development-token'))
 await page.goto('/flows?system='+system)
 await page.getByRole('button',{name:'Редактор потоков',exact:true}).click()
 const editor=page.getByRole('region',{name:'Редактор архитектурной схемы'})
 await expect(editor).toHaveAttribute('aria-busy','false')
 return editor
}

test('QA-WORK: sticky note is editor-only, persists and can be deleted through right-click',async({page})=>{
 const system=await create(page,'/api/objects',{kind:'system',name:'QA-WORK-NOTES-'+Date.now()})
 const editor=await editorFor(page,system)
 await editor.getByRole('button',{name:'Заметка',exact:true}).click()
 await editor.getByRole('textbox',{name:'Текст новой заметки'}).fill('QA-WORK note: проверить маршрутизацию')
 await editor.getByRole('button',{name:'Добавить заметку',exact:true}).click()
 await expect(editor.locator('.react-flow__node').filter({hasText:'QA-WORK note: проверить маршрутизацию'})).toBeVisible()
 await editor.getByRole('button',{name:'Сохранить расположение'}).click()
 await expect.poll(async()=>{
  const response=await page.request.get(api+'/api/board/layout/'+system)
  return (await response.json() as {notes:Array<{text:string}>}).notes.map(note=>note.text)
 }).toEqual(['QA-WORK note: проверить маршрутизацию'])
 await page.reload()
 // Route selects the editor only after explicit entry.
 await page.getByRole('button',{name:'Редактор потоков',exact:true}).click()
 const again=page.getByRole('region',{name:'Редактор архитектурной схемы'})
 const node=again.locator('.react-flow__node').filter({hasText:'QA-WORK note: проверить маршрутизацию'})
 await expect(node).toBeVisible()
 await node.click({button:'right'})
 const menu=page.getByRole('menu',{name:'Действия с объектом'})
 await menu.getByRole('menuitem',{name:'Удалить'}).click()
 await expect(again.locator('.boardStickyNote')).toHaveCount(0)
 await again.getByRole('button',{name:'Сохранить расположение'}).click()
 await expect.poll(async()=>{
  const response=await page.request.get(api+'/api/board/layout/'+system)
  return (await response.json() as {notes:unknown[]}).notes.length
 }).toBe(0)
})

test('QA-WORK: right-click deletes only chosen flow and blocks a connected VM',async({page})=>{
 const suffix=Date.now().toString(36)
 const system=await create(page,'/api/objects',{kind:'system',name:'QA-WORK-CONTEXT-'+suffix})
 const source=await create(page,'/api/infra',{system_id:system,kind:'vm',name:'QA-WORK-Context source '+suffix})
 const target=await create(page,'/api/infra',{system_id:system,kind:'vm',name:'QA-WORK-Context target '+suffix})
 const spare=await create(page,'/api/infra',{system_id:system,kind:'vm',name:'QA-WORK-Context spare '+suffix})
 const flow=await create(page,'/api/flows',{source_id:source,target_id:target,name:'QA-WORK-Context flow '+suffix})
 const editor=await editorFor(page,system)
 await editor.locator('.react-flow__node-boardComponent').filter({hasText:'QA-WORK-Context source '+suffix}).click({button:'right'})
 let menu=page.getByRole('menu',{name:'Действия с объектом'})
 await expect(menu.getByRole('menuitem',{name:'Удалить'})).toBeDisabled()
 await expect(menu).toContainText('Связанный поток:')
 await menu.getByRole('button',{name:'Закрыть меню'}).click()
 // SVG <g> edges have no reliable click box; use the visible edge caption.
 const caption=editor.getByRole('button',{name:/Выбрать поток/}).first()
 await expect(caption).toBeVisible()
 await caption.click({button:'right'})
 menu=page.getByRole('menu',{name:'Действия с объектом'})
 page.once('dialog',dialog=>dialog.accept())
 await menu.getByRole('menuitem',{name:'Удалить'}).click()
 await expect.poll(async()=>{
  const rows=(await (await page.request.get(api+'/api/flows')).json()) as Array<{id:string}>
  return rows.some(row=>row.id===flow)
 }).toBe(false)
 // A now-unconnected component can be removed without affecting its peer.
 await editor.locator('.react-flow__node-boardComponent').filter({hasText:'QA-WORK-Context spare '+suffix}).click({button:'right'})
 menu=page.getByRole('menu',{name:'Действия с объектом'})
 page.once('dialog',dialog=>dialog.accept())
 await menu.getByRole('menuitem',{name:'Удалить'}).click()
 await expect.poll(async()=>{
  const rows=(await (await page.request.get(api+'/api/infra')).json()) as Array<{id:string}>
  return [rows.some(row=>row.id===source),rows.some(row=>row.id===target),rows.some(row=>row.id===spare)]
 }).toEqual([true,true,false])
})

test('QA-WORK: VLAN context menu blocks attached NIC and deletes a free VLAN only',async({page})=>{
 const suffix=Date.now().toString(36)
 const system=await create(page,'/api/objects',{kind:'system',name:'QA-WORK-VLAN-CONTEXT-'+suffix})
 const vm=await create(page,'/api/infra',{system_id:system,kind:'vm',name:'QA-WORK-NIC owner '+suffix})
 const vlan=await create(page,'/api/networks',{kind:'vlan',name:'QA-WORK-VLAN-used '+suffix})
 const free=await create(page,'/api/networks',{kind:'vlan',name:'QA-WORK-VLAN-free '+suffix})
 await create(page,'/api/network-interfaces',{item_id:vm,name:'QA-WORK-eth0',vlan_id:vlan})
 const layout=await page.request.put(api+'/api/board/layout/'+system,{data:{positions:{
  ['network:'+vlan]:{x:80,y:80,width:540,height:340},
  ['network:'+free]:{x:700,y:80,width:540,height:340}
 }}})
 expect(layout.status(),await layout.text()).toBe(200)
 const editor=await editorFor(page,system)
 const usedNode=editor.locator('.react-flow__node-boardNetwork').filter({hasText:'QA-WORK-VLAN-used '+suffix})
 const freeNode=editor.locator('.react-flow__node-boardNetwork').filter({hasText:'QA-WORK-VLAN-free '+suffix})
 await expect(usedNode).toBeVisible()
 await expect(freeNode).toBeVisible()
 let box=await usedNode.boundingBox()
 expect(box).not.toBeNull()
 await page.mouse.click(box!.x+18,box!.y+18,{button:'right'})
 let menu=page.getByRole('menu',{name:'Действия с объектом'})
 await expect(menu.getByRole('menuitem',{name:'Удалить'})).toBeDisabled()
 await expect(menu).toContainText('QA-WORK-eth0')
 await menu.getByRole('button',{name:'Закрыть меню'}).click()
 box=await freeNode.boundingBox()
 expect(box).not.toBeNull()
 await page.mouse.click(box!.x+18,box!.y+18,{button:'right'})
 menu=page.getByRole('menu',{name:'Действия с объектом'})
 await expect(menu.getByRole('menuitem',{name:'Удалить'})).toBeEnabled()
 page.once('dialog',dialog=>dialog.accept())
 await menu.getByRole('menuitem',{name:'Удалить'}).click()
 await expect.poll(async()=>{
  const rows=(await (await page.request.get(api+'/api/networks')).json()) as Array<{id:string}>
  return [rows.some(row=>row.id===vlan),rows.some(row=>row.id===free)]
 }).toEqual([true,false])
})
