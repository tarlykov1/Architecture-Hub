import {expect,test} from '@playwright/test'

test.describe.configure({retries:0})
const api='http://127.0.0.1:8001'

async function create(page:import('@playwright/test').Page,path:string,data:Record<string,unknown>){
  const response=await page.request.post(api+path,{data})
  expect(response.status(),await response.text()).toBe(201)
  return (await response.json()).id as string
}

test('AH-QA-04/05: VM cards and VRF/VLAN titles stay visible after editor to viewer transition',async({page})=>{
  await page.addInitScript(()=>sessionStorage.setItem('architecture-hub:access-token:session','browser-ci-development-token'))
  await page.setViewportSize({width:1363,height:936})
  const suffix=String(Date.now())
  const system=await create(page,'/api/objects',{name:'QA-WORK-GEOMETRY-'+suffix,kind:'system'})
  const a=await create(page,'/api/infra',{system_id:system,name:'QA-WORK-VM-A-'+suffix,kind:'vm',description:'API service'})
  const b=await create(page,'/api/infra',{system_id:system,name:'QA-WORK-VM-B-'+suffix,kind:'vm',description:'Database service'})
  const vrf=await create(page,'/api/networks',{name:'QA-WORK-VRF-'+suffix,kind:'vrf'})
  const vlan=await create(page,'/api/networks',{name:'QA-WORK-VLAN-'+suffix,kind:'vlan'})
  const layout=await page.request.put(api+'/api/board/layout/'+system,{data:{positions:{
    ['network:'+vrf]:{x:35,y:45,width:900,height:620},
    ['network:'+vlan]:{x:85,y:120,width:560,height:360,parent_id:'network:'+vrf},
    [a]:{x:145,y:215,parent_id:'network:'+vlan},
    [b]:{x:430,y:225,parent_id:'network:'+vlan},
  }}})
  expect(layout.status(),await layout.text()).toBe(200)

  await page.goto('/components?system='+system)
  await page.getByRole('group',{name:'Представление компонентов'}).getByRole('button',{name:'Схема',exact:true}).click()
  await page.getByRole('combobox',{name:'Группировка компонентов'}).selectOption('components')
  const map=page.locator('[data-active-graph="infrastructure"].miniArchitecture')
  const viewA=map.locator('.react-flow__node[data-id="'+a+'"]')
  const viewB=map.locator('.react-flow__node[data-id="'+b+'"]')
  const viewVrf=map.locator('.react-flow__node[data-id="network:'+vrf+'"]')
  const viewVlan=map.locator('.react-flow__node[data-id="network:'+vlan+'"]')
  await expect(viewA).toBeVisible()
  await expect(viewB).toBeVisible()
  await expect(viewVrf).toBeVisible()
  await expect(viewVlan).toBeVisible()
  const firstCard=await viewA.boundingBox()
  expect(firstCard).not.toBeNull()
  expect(await viewA.getByRole('button',{name:/Открыть паспорт компонента/}).count()).toBe(0)

  await page.getByRole('button',{name:'Редактировать схему',exact:true}).click()
  const editor=page.getByRole('region',{name:'Редактор архитектурной схемы'})
  await expect(editor).toHaveAttribute('aria-busy','false')
  const editingCard=editor.locator('.react-flow__node[data-id="'+a+'"]')
  await expect(editingCard).toBeVisible()
  const editorBox=await editingCard.boundingBox()
  expect(editorBox).not.toBeNull()
  expect(Math.abs(firstCard!.width-editorBox!.width)).toBeLessThanOrEqual(4)
  expect(Math.abs(firstCard!.height-editorBox!.height)).toBeLessThanOrEqual(4)
  await expect(editor.locator('.react-flow__node[data-id="network:'+vrf+'"]')).toBeVisible()
  await expect(editor.locator('.react-flow__node[data-id="network:'+vlan+'"]')).toBeVisible()

  await page.getByRole('button',{name:'Завершить редактирование',exact:true}).click()
  await expect(editor).toHaveCount(0)
  await expect(viewVrf).toBeVisible()
  await expect(viewVlan).toBeVisible()
  await expect(viewA).toBeVisible()
  const updatedCard=await viewA.boundingBox()
  expect(updatedCard).not.toBeNull()
  expect(Math.abs(updatedCard!.width-firstCard!.width)).toBeLessThanOrEqual(4)
  expect(Math.abs(updatedCard!.height-firstCard!.height)).toBeLessThanOrEqual(4)
  const canvas=await map.boundingBox()
  const root=await viewVrf.boundingBox()
  const nested=await viewVlan.boundingBox()
  expect(canvas&&root&&nested).toBeTruthy()
  for(const box of [root!,nested!]){
    expect(box.y).toBeGreaterThanOrEqual(canvas!.y-3)
    expect(box.x).toBeGreaterThanOrEqual(canvas!.x-3)
    expect(box.y+box.height).toBeLessThanOrEqual(canvas!.y+canvas!.height+3)
    expect(box.x+box.width).toBeLessThanOrEqual(canvas!.x+canvas!.width+3)
  }

  await page.reload()
  await expect(viewVrf).toBeVisible()
  await expect(viewVlan).toBeVisible()
  await expect(viewA).toBeVisible()
})
