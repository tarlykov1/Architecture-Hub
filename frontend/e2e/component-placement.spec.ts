import {test,expect} from '@playwright/test'
import {openWorkspace} from './workspaceNavigation'

test('mobile placement shows host roles, workloads and all flows in a selected direction',async({page,request})=>{
  await page.setViewportSize({width:393,height:800})
  await page.addInitScript(()=>sessionStorage.setItem('architecture-hub:access-token:session','browser-ci-development-token'))
  async function create(path:string,data:Record<string,unknown>){
    const response=await request.post('http://127.0.0.1:8001/api/'+path,{data})
    expect(response.status(),await response.text()).toBe(201)
    return (await response.json()).id as string
  }
  const system_id=await create('objects',{kind:'system',name:'QA-WORK-Placement-'+Date.now()})
  const host=await create('infra',{system_id,name:'QA-WORK-AppHost',kind:'vm',description:'Backend / Workers'})
  const source_id=await create('infra',{system_id,parent_id:host,name:'QA-WORK-App',kind:'application'})
  const target_id=await create('infra',{system_id,parent_id:host,name:'QA-WORK-Queue',kind:'queue'})
  for(const name of ['First','Second'])await create('flows',{source_id,target_id,name,protocol:'AMQP',port:'5672'})
  await create('flows',{source_id:target_id,target_id:source_id,name:'Reply'})
  await page.goto('/')
  await openWorkspace(page,'Компоненты')
  await page.getByLabel('Система компонентов').selectOption(system_id)
  await page.getByRole('button',{name:'Размещение',exact:true}).click()
  const diagram=page.getByRole('region',{name:'Размещение компонентов по ВМ'})
  await expect(diagram.getByText('Backend / Workers')).toBeVisible()
  await expect(diagram.locator('.react-flow__edge-path')).toHaveCount(2)
  await diagram.getByRole('button',{name:/Выбрать поток .*2 потока/}).click()
  const detail=diagram.getByRole('complementary',{name:'Потоки направления'})
  await expect(detail.getByRole('listitem')).toHaveCount(2)
  await expect(detail).toContainText('Second')
  await detail.getByRole('button',{name:'Закрыть'}).click()
  await diagram.getByRole('button',{name:/^QA-WORK-Queue/}).click()
  await expect(page.getByRole('dialog',{name:/Карточка компонента QA-WORK-Queue/})).toBeVisible()
})
