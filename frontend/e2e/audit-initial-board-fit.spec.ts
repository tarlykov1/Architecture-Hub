import {test,expect} from '@playwright/test'

test.beforeEach(async({page})=>{
 await page.addInitScript(()=>sessionStorage.setItem('architecture-hub:access-token:session','browser-ci-development-token'))
})

test('AH-QA-04: saved VRF/VLAN fit after hydration and stay fixed during drag',async({page})=>{
 const api='http://127.0.0.1:8001/api'
 const suffix=Date.now().toString()
 const create=async(path:string,data:Record<string,unknown>)=>{
  const response=await page.request.post(api+path,{data})
  expect(response.status(),await response.text()).toBe(201)
  return (await response.json()).id as string
 }
 const system=await create('/objects',{kind:'system',name:'QA-WORK-FIT-'+suffix})
 for(const name of ['source','target'])
  await create('/infra',{system_id:system,kind:'vm',name:'QA-WORK-FIT-'+name+'-'+suffix})
 const vrf=await create('/networks',{name:'QA-WORK-FIT-VRF-'+suffix,kind:'vrf'})
 const vlan=await create('/networks',{name:'QA-WORK-FIT-VLAN-'+suffix,kind:'vlan'})
 const saved=await page.request.put(api+'/board/layout/'+system,{data:{positions:{
  ['network:'+vrf]:{x:180,y:95,width:760,height:540},
  ['network:'+vlan]:{x:1010,y:180,width:240,height:190}
 }}})
 expect(saved.status(),await saved.text()).toBe(200)

 await page.goto('/')
 await page.getByRole('navigation',{name:'Разделы архитектуры'})
  .getByRole('button',{name:'Компоненты',exact:true}).click()
 await page.getByRole('group',{name:'Представление компонентов'})
  .getByRole('button',{name:'Схема',exact:true}).click()
 await page.getByRole('button',{name:'Редактировать схему'}).click()
 await page.getByRole('combobox',{name:'Выбрать ИС для редактора компонентов'}).selectOption(system)
 const editor=page.getByRole('region',{name:'Редактор архитектурной схемы'})
 await expect(editor).toHaveAttribute('aria-busy','false')
 const canvas=editor.locator('.boardCanvas')
 const parent=editor.locator('.react-flow__node[data-id="network:'+vrf+'"]')
 const child=editor.locator('.react-flow__node[data-id="network:'+vlan+'"]')
 await expect(parent).toBeVisible()
 await expect(child).toBeVisible()

 // The actual rendered network rectangles, not just their centers, must fit
 // inside the viewport after loading the persisted positions.
 await expect.poll(async()=>{
  const area=await canvas.boundingBox(),rects=await Promise.all([parent.boundingBox(),child.boundingBox()])
  if(!area||rects.some(r=>!r))return false
  return rects.every(rect=>rect!.x>=area.x-2&&rect!.y>=area.y-2&&
   rect!.x+rect!.width<=area.x+area.width+2&&rect!.y+rect!.height<=area.y+area.height+2)
 },{timeout:10000,message:'Persisted VRF and VLAN must fit wholly in the editable canvas'}).toBe(true)

 const viewport=editor.locator('.react-flow__viewport')
 const viewportBefore=await viewport.evaluate(el=>getComputedStyle(el).transform)
 const p=await parent.boundingBox(),c=await child.boundingBox()
 expect(p&&c).toBeTruthy()
 const from={x:c!.x+30,y:c!.y+18}
 const target={x:p!.x+p!.width*.42,y:p!.y+p!.height*.4}
 await page.mouse.move(from.x,from.y)
 await page.mouse.down()
 await page.mouse.move(target.x,target.y,{steps:20})
 await page.mouse.up()

 const confirm=page.getByRole('dialog',{name:'Подтверждение вложенности'})
 await expect(confirm).toBeVisible()
 await expect(confirm).toContainText('Добавить объект в группу?')
 await expect.poll(async()=>await viewport.evaluate(el=>getComputedStyle(el).transform))
  .toBe(viewportBefore)
 await confirm.getByRole('button',{name:'Отменить перенос'}).click()
})
