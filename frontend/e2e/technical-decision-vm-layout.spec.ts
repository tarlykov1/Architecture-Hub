import {expect,test} from '@playwright/test'

// AH-02: technical-decision canvas must behave like the main architecture editor.
// Test only isolated QA-WORK proposals, never published infrastructure.
test('QA-WORK: moving a proposed VM saves its coordinates without modifying live components or flows',async({page,request})=>{
  const api='http://127.0.0.1:8001/api'
  const suffix=Date.now()+'-'+Math.random().toString(36).slice(2,7)
  const title='QA-WORK-ProposalMove-'+suffix
  const systemResponse=await request.post(api+'/objects',{data:{kind:'system',name:title}})
  expect(systemResponse.status()).toBe(201)
  const systemId=(await systemResponse.json()).id as string
  const registeredResponse=await request.post(api+'/infra',{data:{kind:'vm',name:'QA-WORK-LiveVM-'+suffix,system_id:systemId}})
  expect(registeredResponse.status()).toBe(201)
  const liveId=(await registeredResponse.json()).id as string

  const decisionResponse=await request.post(api+'/technical-decisions',{data:{title,system_id:systemId}})
  expect(decisionResponse.status()).toBe(201)
  const decision=await decisionResponse.json() as {id:string;revision:number}
  const vmId=crypto.randomUUID()
  const proposed={id:vmId,kind:'vm',name:'QA-WORK-NewVM-'+suffix,system_id:systemId,x:305,y:140}
  const proposedFlow={
    id:crypto.randomUUID(),name:'QA-WORK-ProposedFlow-'+suffix,
    source_id:liveId,target_id:vmId,protocol:'HTTPS',port:'443'
  }
  const url=api+'/technical-decisions/'+decision.id
  const saved=await request.put(url,{data:{
    title,expected_revision:decision.revision,proposed_vms:[proposed],proposed_flows:[proposedFlow]
  }})
  expect(saved.status(),await saved.text()).toBe(200)

  const liveBefore=await (await request.get(api+'/infra')).json() as {id:string}[]
  const flowBefore=await (await request.get(api+'/flows')).json() as {id:string}[]
  await page.addInitScript(()=>sessionStorage.setItem('architecture-hub:access-token:session','browser-ci-development-token'))
  await page.goto('/decisions')
  await page.getByRole('button',{name:title,exact:true}).click()
  await page.getByRole('button',{name:'Открыть схему'}).click()
  const drawing=page.locator('.decisionCanvas')
  const node=drawing.locator(`.react-flow__node[data-id="${vmId}"]`)
  const registered=drawing.locator(`.react-flow__node[data-id="${liveId}"]`)
  await expect(node).toBeVisible()
  await expect(registered).toBeVisible()
  await expect(node).toHaveClass(/draggable/)
  await expect(registered).not.toHaveClass(/draggable/)
  const bounds=await node.boundingBox()
  expect(bounds).not.toBeNull()
  await page.mouse.move(bounds!.x+bounds!.width/2,bounds!.y+bounds!.height/2)
  await page.mouse.down()
  await page.mouse.move(bounds!.x+bounds!.width/2+160,bounds!.y+bounds!.height/2+65,{steps:18})
  await page.mouse.up()

  await expect.poll(async()=>{
    const data=await (await request.get(url)).json() as {proposed_vms:{id:string;x:number;y:number}[]}
    return data.proposed_vms.find(vm=>vm.id===vmId)?.x||0
  },{timeout:20000}).toBeGreaterThan(proposed.x+20)

  const data=await (await request.get(url)).json() as {
    proposed_vms:{id:string;x:number;y:number}[];proposed_flows:{id:string;source_id:string;target_id:string}[]
  }
  const moved=data.proposed_vms.find(vm=>vm.id===vmId)!
  expect(moved.y).toBeGreaterThan(proposed.y+10)
  expect(data.proposed_flows).toHaveLength(1)
  expect(data.proposed_flows[0]).toMatchObject({
    id:proposedFlow.id,source_id:liveId,target_id:vmId
  })
  expect((await (await request.get(api+'/infra')).json() as {id:string}[]).map(x=>x.id)).toEqual(liveBefore.map(x=>x.id))
  expect((await (await request.get(api+'/flows')).json() as {id:string}[]).map(x=>x.id)).toEqual(flowBefore.map(x=>x.id))

  await page.reload()
  await page.getByRole('button',{name:title,exact:true}).click()
  await page.getByRole('button',{name:'Открыть схему'}).click()
  const reopened=page.locator(`.decisionCanvas .react-flow__node[data-id="${vmId}"]`)
  await expect(reopened).toBeVisible()
  await expect.poll(async()=>{
    const style=await reopened.evaluate(element=>(element as HTMLElement).style.transform)
    const coords=style.match(/translate\(\s*(-?[\d.]+)px,\s*(-?[\d.]+)px\)/)
    return Boolean(coords&&Math.abs(Number(coords[1])-moved.x)<2&&Math.abs(Number(coords[2])-moved.y)<2)
  }).toBe(true)
})

test('QA-WORK: removing a proposed VM removes only dependent proposal flows',async({page,request})=>{
  const api='http://127.0.0.1:8001/api'
  const suffix=Date.now()+'-'+Math.random().toString(36).slice(2,7)
  const title='QA-WORK-ProposalDelete-'+suffix
  const system=await request.post(api+'/objects',{data:{kind:'system',name:title}})
  expect(system.status()).toBe(201)
  const systemId=(await system.json()).id as string
  const live=await request.post(api+'/infra',{data:{kind:'vm',name:'QA-WORK-Existing-'+suffix,system_id:systemId}})
  expect(live.status()).toBe(201)
  const liveId=(await live.json()).id as string
  const decision=await (await request.post(api+'/technical-decisions',{data:{title,system_id:systemId}})).json() as {id:string;revision:number}
  const vmA={id:crypto.randomUUID(),name:'QA-WORK-Remove-'+suffix,system_id:systemId,kind:'vm',x:305,y:0}
  const vmB={id:crypto.randomUUID(),name:'QA-WORK-Keep-'+suffix,system_id:systemId,kind:'vm',x:610,y:0}
  const attached={id:crypto.randomUUID(),source_id:vmA.id,target_id:vmB.id,name:'QA-WORK-RemoveFlow'}
  const remaining={id:crypto.randomUUID(),source_id:liveId,target_id:vmB.id,name:'QA-WORK-KeepFlow'}
  const url=api+'/technical-decisions/'+decision.id
  const change=await request.put(url,{data:{
    title,expected_revision:decision.revision,proposed_vms:[vmA,vmB],proposed_flows:[attached,remaining]
  }})
  expect(change.status(),await change.text()).toBe(200)
  const liveBefore=await (await request.get(api+'/infra')).json() as {id:string}[]

  await page.addInitScript(()=>sessionStorage.setItem('architecture-hub:access-token:session','browser-ci-development-token'))
  await page.goto('/decisions')
  await page.getByRole('button',{name:title,exact:true}).click()
  await page.getByRole('button',{name:'Открыть схему'}).click()
  page.once('dialog',dialog=>{
    expect(dialog.message()).toContain('связанные проектируемые потоки (1)')
    void dialog.accept()
  })
  await page.getByRole('button',{name:'Удалить ВМ '+vmA.name}).click()
  await expect.poll(async()=>{
    const row=await (await request.get(url)).json() as {proposed_vms:{id:string}[]}
    return row.proposed_vms.length
  }).toBe(1)
  const row=await (await request.get(url)).json() as {
    proposed_vms:{id:string}[];proposed_flows:{id:string}[]
  }
  expect(row.proposed_vms.map(vm=>vm.id)).toEqual([vmB.id])
  expect(row.proposed_flows.map(flow=>flow.id)).toEqual([remaining.id])
  expect((await (await request.get(api+'/infra')).json() as {id:string}[]).map(vm=>vm.id)).toEqual(liveBefore.map(vm=>vm.id))
})
