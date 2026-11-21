import {test,expect} from '@playwright/test'

test('QA-WORK: review route, submit, anchored comment and honest personal-signature requirements',async({page})=>{
  await page.addInitScript(()=>sessionStorage.setItem(
    'architecture-hub:access-token:session','browser-ci-development-token'))
  const api='http://127.0.0.1:8001/api'
  const stamp=Date.now().toString()
  const system=await page.request.post(api+'/objects',{
    data:{name:'QA-WORK-Signoff-System-'+stamp,kind:'system'}
  })
  expect(system.status(),await system.text()).toBe(201)
  const systemId=(await system.json()).id as string
  const created=await page.request.post(api+'/technical-decisions',{
    data:{title:'QA-WORK-Signoff-'+stamp,system_id:systemId}
  })
  expect(created.status(),await created.text()).toBe(201)
  const decision=await created.json() as {id:string;revision:number}
  const url=api+'/technical-decisions/'+decision.id
  const proposedVm={id:crypto.randomUUID(),system_id:systemId,
    kind:'vm',name:'QA-WORK-New-VM-'+stamp,x:250,y:120}
  const staged=await page.request.put(url,{data:{
    title:'QA-WORK-Signoff-'+stamp,expected_revision:decision.revision,
    proposed_vms:[proposedVm],required_services:['engineer','security']
  }})
  expect(staged.status(),await staged.text()).toBe(200)

  await page.goto('/decisions')
  await page.getByRole('button',{name:'QA-WORK-Signoff-'+stamp,exact:true}).click()
  const inspector=page.getByRole('complementary',{name:'Карточка технического решения'})
  await inspector.getByRole('button',{name:'Согласование',exact:true}).click()
  const route=inspector.getByRole('group',{name:'Обязательные согласующие службы'})
  await expect(route.getByRole('checkbox',{name:'Инфраструктура'})).toBeChecked()
  await route.getByRole('checkbox',{name:'Информационная безопасность'}).uncheck()
  await route.getByRole('checkbox',{name:'Владелец процесса'}).check()
  await inspector.getByRole('button',{name:'Сохранить маршрут'}).click()
  await expect(route.getByRole('checkbox',{name:'Владелец процесса'})).toBeChecked()
  await expect(inspector.getByRole('status').filter({hasText:'Согласовано: 0 из 2'})).toBeVisible()

  await inspector.getByRole('button',{name:'Отправить на согласование'}).click()
  await expect(inspector).toContainText('Ожидает согласования')
  await expect(inspector).toContainText('Служебный ключ не заменяет персональную подпись.')
  await expect(inspector.getByRole('button',{name:'Согласовать',exact:true})).toHaveCount(0)
  const stored=(await (await page.request.get(url)).json()) as
    {status:string;required_services:string[]}
  expect(stored.status).toBe('in_review')
  expect([...stored.required_services].sort()).toEqual(['business_owner','engineer'])

  await inspector.getByRole('combobox',{name:'Объект комментария'})
    .selectOption('vm:'+proposedVm.id)
  await inspector.getByRole('textbox',{name:'Комментарий',exact:true})
    .fill('QA-WORK: проверить согласование ёмкости хранилища')
  await inspector.getByRole('button',{name:'Добавить комментарий'}).click()
  await expect(inspector).toContainText('QA-WORK: проверить согласование ёмкости хранилища')
  await page.reload()
  await page.getByRole('button',{name:'QA-WORK-Signoff-'+stamp,exact:true}).click()
  await inspector.getByRole('button',{name:'Согласование',exact:true}).click()
  await expect(inspector).toContainText('QA-WORK: проверить согласование ёмкости хранилища')
})
