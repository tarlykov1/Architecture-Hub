import {test,expect} from '@playwright/test'

test('QA-WORK: parallel and reverse flows have distinct selectable lanes next to a single peer',async({page,request})=>{
  const create=async(path:string,data:object)=>{
    const r=await request.post('http://127.0.0.1:8001/api/'+path,{data})
    expect(r.status(),await r.text()).toBe(201)
    return (await r.json()).id as string
  }
  const system_id=await create('objects',{kind:'system',name:'QA-WORK-Топология-'+Date.now()})
  const component=(name:string)=>create('infra',{kind:'vm',system_id,name})
  const center=await component('QA-WORK-Центр'),peer=await component('QA-WORK-Адаптер'),other=await component('QA-WORK-Справочник')
  const flow=(source_id:string,target_id:string,name:string)=>create('flows',{source_id,target_id,name})
  const logs=await flow(center,peer,'Журнал приложения')
  await flow(center,peer,'Журнал службы')
  await flow(peer,center,'Ответ адаптера')
  await flow(other,center,'Обновление справочника')
  await page.addInitScript(()=>sessionStorage.setItem('architecture-hub:access-token:session','browser-ci-development-token'))
  await page.goto('/topology?component='+center)
  const canvas=page.locator('.topologyCanvas'),panel=page.getByRole('complementary',{name:'Выбранный объект топологии'})
  await expect(canvas.locator('.react-flow__node')).toHaveCount(3)
  await expect(canvas.locator('.react-flow__edge')).toHaveCount(3)
  const count=canvas.getByRole('button',{name:'QA-WORK-Центр → QA-WORK-Адаптер · 2 потока',exact:true})
  await expect(count).toBeVisible()
  const collisions=()=>canvas.evaluate(root=>{
    const labels=[...root.querySelectorAll('.topologyFlowCount')].map(n=>n.getBoundingClientRect())
    const cards=[...root.querySelectorAll('.react-flow__node')].map(n=>n.getBoundingClientRect())
    return labels.some((a,i)=>[...cards,...labels.slice(i+1)].some(b=>a.left<b.right&&a.right>b.left&&a.top<b.bottom&&a.bottom>b.top))
  })
  await expect.poll(collisions).toBe(false)
  const a=await canvas.boundingBox(),b=await panel.boundingBox()
  expect(a!.x+a!.width).toBeLessThanOrEqual(b!.x+1)
  const crossesCard=()=>canvas.evaluate(root=>{
    const cards=[...root.querySelectorAll('.react-flow__node')].map(n=>n.getBoundingClientRect())
    return [...root.querySelectorAll<SVGPathElement>('.react-flow__edge-path')].some(path=>{
      const matrix=path.getScreenCTM()
      if(!matrix)return true
      for(let i=1;i<100;i++){
        const point=path.getPointAtLength(path.getTotalLength()*i/100).matrixTransform(matrix)
        if(cards.some(c=>point.x>c.left+2&&point.x<c.right-2&&point.y>c.top+2&&point.y<c.bottom-2))return true
      }
      return false
    })
  })
  await expect.poll(crossesCard).toBe(false)
  await count.click()
  await expect(panel.locator('.topologyInspectorEntry')).toHaveCount(2)
  await panel.getByRole('button',{name:/Журнал приложения/}).click()
  await expect(page).toHaveURL(new RegExp(logs))
  await expect(panel.getByRole('heading',{name:'Журнал приложения'})).toBeVisible()
  await page.setViewportSize({width:390,height:844})
  await expect.poll(async()=>{
    const map=await canvas.boundingBox(),properties=await panel.boundingBox()
    return !!map&&!!properties&&map.y+map.height<=properties.y+1
  }).toBe(true)
})
