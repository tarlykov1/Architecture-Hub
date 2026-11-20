import {expect,test} from '@playwright/test'

test.describe.configure({retries:0})

test('AH-QA-15: incident editor in system passport stays open and preserves its context',async({page})=>{
  await page.addInitScript(()=>sessionStorage.setItem('architecture-hub:access-token:session','browser-ci-development-token'))
  const api='http://127.0.0.1:8001'
  const suffix=String(Date.now())
  const systemResponse=await page.request.post(api+'/api/objects',{data:{kind:'system',name:'QA-WORK-Incident-Passport-'+suffix}})
  expect(systemResponse.status(),await systemResponse.text()).toBe(201)
  const system=(await systemResponse.json()) as {id:string;name:string}
  const incidentResponse=await page.request.post(api+'/api/incidents',{data:{
    title:'QA-WORK-Incident-'+suffix,description:'Incident editing from IS passport',
    status:'open',severity:'medium',links:[{entity_type:'system',entity_id:system.id}],
  }})
  expect(incidentResponse.status(),await incidentResponse.text()).toBe(201)
  const incident=(await incidentResponse.json()) as {id:string}
  await page.goto('/systems')
  await page.getByRole('button',{name:system.name,exact:true}).click()
  const passport=page.getByLabel('Карточка архитектурного объекта')
  await passport.getByRole('button',{name:'Инциденты',exact:true}).click()
  await passport.getByRole('button',{name:'QA-WORK-Incident-'+suffix}).click()
  const view=page.getByRole('dialog',{name:'Просмотр инцидента'})
  await expect(view).toBeVisible()
  await view.getByRole('button',{name:'Редактировать'}).click()
  const edit=page.getByRole('dialog',{name:'Редактор инцидента'})
  await expect(edit).toBeVisible()
  await expect(passport).toBeVisible()
  await edit.getByRole('textbox',{name:'Описание'}).fill('Unsaved edit must stay in incident dialog')
  page.once('dialog',dialog=>dialog.accept())
  await page.keyboard.press('Escape')
  await expect(edit).toHaveCount(0)
  await expect(passport).toBeVisible()
  await passport.getByRole('button',{name:'QA-WORK-Incident-'+suffix}).click()
  await page.getByRole('dialog',{name:'Просмотр инцидента'}).getByRole('button',{name:'Редактировать'}).click()
  await edit.getByRole('textbox',{name:'Описание'}).fill('QA-WORK-incident-edited-and-saved')
  await edit.getByRole('button',{name:'Сохранить инцидент'}).click()
  await expect(page.getByRole('dialog',{name:'Просмотр инцидента'})).toContainText('QA-WORK-incident-edited-and-saved')
  await expect(passport).toBeVisible()
  const persisted=await page.request.get(api+'/api/incidents/'+incident.id)
  expect(persisted.status()).toBe(200)
  expect((await persisted.json()).description).toBe('QA-WORK-incident-edited-and-saved')
})
