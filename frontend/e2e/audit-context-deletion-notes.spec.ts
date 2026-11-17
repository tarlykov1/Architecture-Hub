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
 return page.getByRole('region',{name:'Редактор архитектурной схемы'})
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
 const edge=editor.locator('.react-flow__edge').filter({has:editor.locator('path')}).first()
 await edge.click({button:'right'})
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
