import {test,expect} from '@playwright/test'

test('AH-QA-207: first VM tap opens its passport; dragging does not',async({page})=>{
 await page.addInitScript(()=>sessionStorage.setItem('architecture-hub:access-token:session','browser-ci-development-token'))
 const api='http://127.0.0.1:8001/api',stamp=String(Date.now())
 const sys=await page.request.post(api+'/objects',{data:{kind:'system',name:'QA-WORK-FIRST-TAP-'+stamp}})
 expect(sys.status(),await sys.text()).toBe(201)
 const system=(await sys.json()).id as string
 const created=await page.request.post(api+'/infra',{data:{
  system_id:system,kind:'vm',name:'QA-WORK-Tap-VM-'+stamp,description:'First click regression'
 }})
 expect(created.status(),await created.text()).toBe(201)
 const vm=(await created.json()).id as string
 await page.goto('/components?system='+system)
 await page.getByRole('group',{name:'Представление компонентов'}).getByRole('button',{name:'Схема'}).click()
 await page.getByRole('button',{name:'Редактировать схему',exact:true}).click()
 const chooser=page.getByRole('combobox',{name:'Выбрать ИС для редактора компонентов'})
 if(await chooser.isVisible())await chooser.selectOption(system)
 const board=page.getByRole('region',{name:'Редактор архитектурной схемы'})
 const node=board.locator('.react-flow__node-boardComponent[data-id="'+vm+'"]')
 await expect(node).toBeVisible()
 const inspector=board.getByRole('dialog',{name:'Паспорт компонента QA-WORK-Tap-VM-'+stamp})
 for(let n=0;n<3;n++){
  await node.click()
  await expect(inspector,'The same VM should open on the first click').toBeVisible()
  await expect(inspector).toContainText('First click regression')
  await inspector.getByRole('button',{name:'Закрыть паспорт'}).click()
  await expect(inspector).toHaveCount(0)
 }

 // A real drag must never be interpreted as a pointer tap.
 await expect(board).toHaveAttribute('aria-busy','false')
 const before=await node.boundingBox()
 expect(before).not.toBeNull()
 await page.mouse.move(before!.x+before!.width/2,before!.y+before!.height/2)
 await page.mouse.down()
 await page.mouse.move(before!.x+before!.width/2+65,before!.y+before!.height/2+35,{steps:12})
 await page.mouse.up()
 await expect(inspector).toHaveCount(0)
 await expect.poll(async()=> (await node.boundingBox())?.x??0).toBeGreaterThan(before!.x+25)
})
