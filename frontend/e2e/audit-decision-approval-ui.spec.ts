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
  await expect(page.getByRole('button',{name:/Моё согласование/})).toHaveCount(0)
  const route=inspector.getByRole('group',{name:'Обязательные согласующие службы'})
  await expect(route.getByRole('checkbox',{name:'Инфраструктура'})).toBeChecked()
  await route.getByRole('checkbox',{name:'Информационная безопасность'}).uncheck()
  await route.getByRole('checkbox',{name:'Владелец процесса'}).check()
  await inspector.getByRole('button',{name:'Сохранить маршрут'}).click()
  await expect(route.getByRole('checkbox',{name:'Владелец процесса'})).toBeChecked()
  await expect(inspector.getByRole('status').filter({hasText:'Согласовано: 0 из 2'})).toBeVisible()

  await inspector.getByRole('button',{name:'Отправить на согласование'}).click()
  await expect(inspector).toContainText('На рассмотрении')
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

test('QA-WORK: service queue shows only pending decisions and opens the review tab', async ({page}) => {
  await page.addInitScript(()=>sessionStorage.setItem('architecture-hub:access-token:session','browser-ci-development-token'))
  const profile = {id:'qa-engineer', username:'qa', display_name:'QA engineer', role:'engineer', auth_kind:'named_user'}
  await page.route('**/api/auth/me', route=>route.fulfill({json:profile}))
  const base = {
    system_id:'qa-system', status:'in_review', author:'user:qa-architect', updated_at:'2026-11-22T09:00:00Z',
    revision:3, required_services:['engineer','security'], approvals:[] as {service:string; verdict:string}[],
    title:'QA-WORK-Pending', id:'pending', comments:[], proposed_flows:[], proposed_vms:[], existing_changes:[],
    review_history:[], description:'', base_changed:false
  }
  const rows = [base, {...base,id:'own',title:'QA-WORK-Own',author:'user:qa-engineer'},
    {...base,id:'answered',title:'QA-WORK-Answered',approvals:[{service:'engineer',verdict:'approved'}]},
    {...base,id:'other',title:'QA-WORK-Other',required_services:['security']},
    {...base,id:'draft',title:'QA-WORK-Draft',status:'draft'}]
  await page.route('**/api/technical-decisions', route=>route.fulfill({json:rows}))
  await page.route('**/api/technical-decisions/pending', route=>route.fulfill({json:base}))
  await page.route('**/api/technical-decisions/pending/review', async route=>{
    expect(route.request().postDataJSON()).toMatchObject({expected_revision:3, verdict:'approved'})
    base.approvals.push({service:'engineer',verdict:'approved'})
    await route.fulfill({json:{...base,approvals:[{...base.approvals[0],actor:'qa',created_at:base.updated_at}]}})
  })
  await page.goto('/decisions')
  const queue = page.getByRole('button',{name:/Моё согласование/})
  await expect(queue).toHaveText('Моё согласование · 1')
  await queue.click()
  const table = page.getByRole('table').filter({has:page.getByRole('columnheader',{name:'Обновлено'})})
  await expect(table.getByRole('row')).toHaveCount(2)
  await table.getByRole('button',{name:base.title}).click()
  const inspector = page.getByRole('complementary',{name:'Карточка технического решения'})
  await expect(inspector.getByRole('button',{name:'Согласование',exact:true})).toHaveAttribute('aria-pressed','true')
  await inspector.getByRole('button',{name:'Согласовать',exact:true}).click()
  await expect(queue).toHaveText('Моё согласование · 0')
  await expect(page.getByText('Нет решений, ожидающих ответа вашей службы.')).toBeVisible()
  await inspector.getByRole('button',{name:'Закрыть решение'}).click()
  await page.getByRole('group',{name:'Статус решения'}).getByRole('button',{name:'Все',exact:true}).click()
  await expect(table.getByRole('row').filter({hasText:base.title})).toContainText('Ожидается ответ: Информационная безопасность')
})
