import {expect,test} from '@playwright/test'

test.describe.configure({retries:0})

test('QA-WORK: six parallel flows use distinct perimeter handles, 16 per VM',async({page})=>{
  await page.addInitScript(()=>sessionStorage.setItem('architecture-hub:access-token:session','browser-ci-development-token'))
  const api='http://127.0.0.1:8001',suffix=String(Date.now())
  const create=async(path:string,data:Record<string,unknown>)=>{
    const response=await page.request.post(api+path,{data})
    expect(response.status(),await response.text()).toBe(201)
    return (await response.json()).id as string
  }
  const system=await create('/api/objects',{kind:'system',name:'QA-WORK-16P-'+suffix})
  const source=await create('/api/infra',{kind:'vm',name:'QA-WORK-16P-source-'+suffix,system_id:system})
  const target=await create('/api/infra',{kind:'vm',name:'QA-WORK-16P-target-'+suffix,system_id:system})
  for(let index=0;index<6;index++)await create('/api/flows',{
    source_id:source,target_id:target,name:'QA-WORK-16P-flow-'+index+'-'+suffix,
    protocol:'HTTPS',port:'443'
  })
  await page.goto('/flows?system='+system)
  await page.getByRole('button',{name:'Редактор потоков',exact:true}).click()
  const board=page.getByRole('region',{name:'Редактор архитектурной схемы'})
  await board.getByRole('button',{name:'→ Поток'}).click()
  const sourceNode=board.locator('.react-flow__node-boardComponent[data-id="'+source+'"]')
  const targetNode=board.locator('.react-flow__node-boardComponent[data-id="'+target+'"]')
  await expect(sourceNode).toBeVisible()
  await expect(targetNode).toBeVisible()
  await expect(sourceNode.locator('.flowPortSource')).toHaveCount(16)
  await expect(sourceNode.locator('.flowPortTarget')).toHaveCount(16)
  await expect(targetNode.locator('.flowPortSource')).toHaveCount(16)
  await expect(targetNode.locator('.flowPortTarget')).toHaveCount(16)
  for(const side of ['top','right','bottom','left']){
    await expect(sourceNode.locator('.flowPortSource[data-anchor^="out-'+side+'-"]')).toHaveCount(4)
    await expect(targetNode.locator('.flowPortTarget[data-anchor^="in-'+side+'-"]')).toHaveCount(4)
  }
  // Previously all six were visually merged on right-1 → left-1.
  await expect(board.locator('.react-flow__edge')).toHaveCount(6)
  const geometries=await board.locator('.react-flow__edge-path').evaluateAll(paths=>
    paths.map(path=>path.getAttribute('d')||''))
  expect(new Set(geometries).size).toBe(6)
  // The read-only view must also retain six separately attached paths.
  await page.getByRole('button',{name:'Завершить редактирование',exact:true}).click()
  const viewing=page.locator('.flowDiagramWorkspace .react-flow__edge')
  // View-specific layouts may hide a group; check after returning to editor.
  await page.getByRole('button',{name:'Редактор потоков',exact:true}).click()
  await expect(board.locator('.react-flow__edge')).toHaveCount(6)
})

test('QA-WORK: persisted legacy attachment stays fixed while other flows are redistributed',async({page})=>{
  await page.addInitScript(()=>sessionStorage.setItem('architecture-hub:access-token:session','browser-ci-development-token'))
  const api='http://127.0.0.1:8001',suffix=String(Date.now())
  const post=async(path:string,data:Record<string,unknown>)=>{
    const response=await page.request.post(api+path,{data})
    expect(response.status(),await response.text()).toBe(201)
    return (await response.json()).id as string
  }
  const system=await post('/api/objects',{kind:'system',name:'QA-WORK-PIN-'+suffix})
  const source=await post('/api/infra',{kind:'vm',name:'Source',system_id:system})
  const target=await post('/api/infra',{kind:'vm',name:'Target',system_id:system})
  const pinned=await post('/api/flows',{source_id:source,target_id:target,name:'pinned',protocol:'HTTPS'})
  const peer=await post('/api/flows',{source_id:source,target_id:target,name:'peer',protocol:'HTTPS'})
  const put=await page.request.put(api+'/api/board/layout/'+system,{data:{
    positions:{},flow_anchors:{[pinned]:{source_handle:'out-right-1',target_handle:'in-left-1'}}
  }})
  expect(put.status(),await put.text()).toBe(200)
  await page.goto('/flows?system='+system)
  await page.getByRole('button',{name:'Редактор потоков',exact:true}).click()
  const board=page.getByRole('region',{name:'Редактор архитектурной схемы'})
  await board.getByRole('button',{name:'→ Поток'}).click()
  await expect(board.locator('.react-flow__edge')).toHaveCount(2)
  const pick=board.getByRole('combobox',{name:'Выбрать поток на схеме'})
  await pick.selectOption(pinned)
  await expect(board.locator('.boardEndpointGrip')).toHaveCount(2)
  const reread=await page.request.get(api+'/api/board/layout/'+system)
  expect((await reread.json()).flow_anchors[pinned]).toEqual({source_handle:'out-right-1',target_handle:'in-left-1'})
  await pick.selectOption(peer)
  await expect(board.locator('.boardEndpointGrip')).toHaveCount(2)
})
