import {test,expect} from '@playwright/test'

test.describe.configure({retries:0})

test('QA-WORK: grouped flow click never creates a fourth flow; individually selected flow stays isolated',async({page})=>{
 await page.addInitScript(()=>sessionStorage.setItem('architecture-hub:access-token:session','browser-ci-development-token'))
 const api='http://127.0.0.1:8001',suffix=Date.now().toString(36)
 const create=async(path:string,data:Record<string,unknown>)=>{
  const response=await page.request.post(api+path,{data})
  expect(response.status(),await response.text()).toBe(201)
  return (await response.json()).id as string
 }
 const system=await create('/api/objects',{kind:'system',name:'QA-WORK-Group isolation '+suffix})
 const source=await create('/api/infra',{system_id:system,kind:'vm',name:'QA-WORK-Source '+suffix})
 const target=await create('/api/infra',{system_id:system,kind:'vm',name:'QA-WORK-Target '+suffix})
 const other=await create('/api/infra',{system_id:system,kind:'vm',name:'QA-WORK-Other '+suffix})
 const ids:string[]=[]
 for(let index=0;index<3;index++)ids.push(await create('/api/flows',{source_id:source,target_id:target,name:'QA-WORK-Group-'+index+'-'+suffix,protocol:'HTTPS',port:'443'}))
 await page.goto('/flows?system='+system)
 await page.getByRole('button',{name:'Редактор потоков',exact:true}).click()
 const editor=page.getByRole('region',{name:'Редактор архитектурной схемы'})
 await editor.getByRole('button',{name:'→ Поток'}).click()
 // Choosing a painted group is not permission to edit all three records.
 const group=editor.getByRole('button',{name:'Выбрать поток 3 потока'})
 await expect(group).toBeVisible()
 await group.click()
 await expect(editor.getByText('На линии 3 отдельных потоков')).toBeVisible()
 await expect(editor.locator('.boardEndpointGrip')).toHaveCount(0)
 const picker=editor.getByRole('combobox',{name:'Выбрать поток на схеме'})
 await picker.selectOption(ids[1])
 await expect(editor.locator('.boardEndpointGrip')).toHaveCount(2)
 // Clicking another VM while a flow is selected must not stage a new, unrelated flow.
 await editor.locator('.react-flow__node-boardComponent').filter({hasText:'QA-WORK-Other '+suffix}).click()
 await expect(picker).toHaveValue(ids[1])
 await expect(editor.getByRole('button',{name:'Черновик: 0 изменений'})).toBeDisabled()
 // Move the orange endpoint of exactly one of three overlapping records.
 const grip=editor.locator('.boardEndpointGrip[data-flow-end="target"]')
 const alternative=editor.locator('.react-flow__node-boardComponent').filter({hasText:'QA-WORK-Other '+suffix})
 const from=await grip.boundingBox(),destination=await alternative.boundingBox()
 expect(from&&destination).toBeTruthy()
 await page.mouse.move(from!.x+from!.width/2,from!.y+from!.height/2)
 await page.mouse.down()
 await page.mouse.move(destination!.x+destination!.width/2,destination!.y+destination!.height/2,{steps:12})
 await page.mouse.up()
 await expect(editor.getByRole('button',{name:/Черновик: 1 изменений/})).toBeEnabled()
 const staged=editor.locator('.react-flow__edge')
 await expect(staged).toHaveCount(2)
 // Discarding the one staged edit must leave every other Flow ID unchanged.
 await editor.getByRole('button',{name:'Отменить правку потока'}).click()
 await expect(editor.getByRole('button',{name:'Черновик: 0 изменений'})).toBeDisabled()
 const listed=(await (await page.request.get(api+'/api/flows')).json()) as Array<{id:string;source_id:string;target_id:string}>
 expect(ids.map(id=>listed.find(row=>row.id===id)).every(row=>row?.source_id===source&&row?.target_id===target)).toBeTruthy()
})
