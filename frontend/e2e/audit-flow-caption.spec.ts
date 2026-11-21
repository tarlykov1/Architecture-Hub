import {test,expect} from '@playwright/test'

test('AH-QA-13: one flow shows its name on the edge and keeps full accessible title',async({page})=>{
  await page.addInitScript(()=>sessionStorage.setItem('architecture-hub:access-token:session','browser-ci-development-token'))
  const api='http://127.0.0.1:8001',suffix=String(Date.now())
  const create=async(path:string,data:Record<string,unknown>)=>{
    const result=await page.request.post(api+path,{data})
    expect(result.status(),await result.text()).toBe(201)
    return (await result.json()).id as string
  }
  const system=await create('/api/objects',{kind:'system',name:'QA-WORK-CAPTION-'+suffix})
  const source=await create('/api/infra',{system_id:system,kind:'vm',name:'QA-WORK-source'})
  const target=await create('/api/infra',{system_id:system,kind:'vm',name:'QA-WORK-target'})
  const flowName='QA-WORK-Exchange-Name-More-Than-Thirty-Four-Characters'
  const flow=await create('/api/flows',{source_id:source,target_id:target,name:flowName,protocol:'HTTPS',port:'443'})
  await page.goto('/flows?system='+system)
  await page.getByRole('button',{name:'Редактор потоков',exact:true}).click()
  const board=page.getByRole('region',{name:'Редактор архитектурной схемы'})
  const edge=board.getByRole('button',{name:'Выбрать поток '+flowName})
  await expect(edge).toBeVisible()
  await expect(edge).toHaveAttribute('title',flowName)
  await expect(edge).toContainText('QA-WORK-Exchange-Name')
  await expect(edge).not.toContainText('HTTPS:443')
  await expect(edge).toContainText('…')
  await edge.click()
  await expect(board.getByRole('combobox',{name:'Выбрать поток на схеме'})).toHaveValue(flow)
})
