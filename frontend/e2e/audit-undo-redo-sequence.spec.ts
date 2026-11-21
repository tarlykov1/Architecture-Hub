import {test,expect} from '@playwright/test'

test('AH-QA-19: two sequential VM edits undo/redo in order and Ctrl+Z stays inside text input',async({page})=>{
 await page.addInitScript(()=>sessionStorage.setItem('architecture-hub:access-token:session','browser-ci-development-token'))
 const api='http://127.0.0.1:8001',suffix=String(Date.now())
 const response=await page.request.post(api+'/api/objects',{data:{kind:'system',name:'QA-WORK-SEQ-'+suffix}})
 expect(response.status(),await response.text()).toBe(201)
 const id=(await response.json()).id as string
 await page.goto('/components?system='+id)
 await page.getByRole('group',{name:'Представление компонентов'}).getByRole('button',{name:'Схема'}).click()
 await page.getByRole('button',{name:'Редактировать схему',exact:true}).click()
 const board=page.getByRole('region',{name:'Редактор архитектурной схемы'})
 await expect(board).toHaveAttribute('aria-busy','false')
 const tools=board.getByRole('toolbar',{name:'Инструменты архитектуры'})
 const names=['QA-WORK-SEQ-A-'+suffix,'QA-WORK-SEQ-B-'+suffix]
 for(const name of names){
   await tools.getByRole('button',{name:'+ ВМ'}).click()
   await board.getByPlaceholder('Новая ВМ').fill(name)
   await board.getByRole('button',{name:'Разместить на схеме'}).click()
   await expect(board.locator('.react-flow__node-boardComponent').filter({hasText:name})).toBeVisible()
 }
 const undo=tools.getByRole('button',{name:'Отменить действие'})
 const redo=tools.getByRole('button',{name:'Повторить действие'})
 const reason=board.getByRole('textbox',{name:'Причина изменений'})
 await reason.fill('Editing my description')
 await reason.press('Control+z')
 // Native input undo may change its value, but may not remove a staged VM.
 await expect(board.locator('.react-flow__node-boardComponent').filter({hasText:names[1]})).toBeVisible()
 await undo.click()
 await expect(board.locator('.react-flow__node-boardComponent').filter({hasText:names[1]})).toHaveCount(0)
 await expect(board.locator('.react-flow__node-boardComponent').filter({hasText:names[0]})).toBeVisible()
 await undo.click()
 await expect(board.locator('.react-flow__node-boardComponent')).toHaveCount(0)
 await redo.click()
 await expect(board.locator('.react-flow__node-boardComponent').filter({hasText:names[0]})).toBeVisible()
 await redo.click()
 await expect(board.locator('.react-flow__node-boardComponent').filter({hasText:names[1]})).toBeVisible()
 const registry=(await (await page.request.get(api+'/api/infra')).json()) as Array<{name:string}>
 expect(registry.some(row=>names.includes(row.name))).toBe(false)
})
