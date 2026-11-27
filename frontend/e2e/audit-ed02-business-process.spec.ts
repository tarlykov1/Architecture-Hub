import {test,expect} from '@playwright/test'

test('QA-WORK ED-02: process stays in business model after edit, link and reload',async({page})=>{
 await page.addInitScript(()=>sessionStorage.setItem('architecture-hub:access-token:session','browser-ci-development-token'))
 const api='http://127.0.0.1:8001',suffix=Date.now().toString(36)
 const categoryResponse=await page.request.post(api+'/api/business/categories',{
  data:{name:'QA-WORK-ED02 Category '+suffix}
 })
 expect(categoryResponse.status(),await categoryResponse.text()).toBe(201)
 const category=(await categoryResponse.json()).id as string
 const systemResponse=await page.request.post(api+'/api/objects',{
  data:{kind:'system',name:'QA-WORK-ED02 System '+suffix}
 })
 expect(systemResponse.status(),await systemResponse.text()).toBe(201)
 const system=(await systemResponse.json()).id as string
 await page.goto('/')
 const nav=page.getByRole('navigation',{name:'Разделы архитектуры'})
 await nav.getByText('Ещё', {exact:false}).first().click()
 await nav.getByRole('button',{name:'Бизнес-процессы',exact:true}).click()
 await page.getByRole('button',{name:'Создать процесс'}).click()
 const drawer=page.getByRole('dialog',{name:'Редактор бизнес-процесса'})
 await drawer.getByRole('combobox',{name:'Категория бизнес-процесса'}).selectOption(category)
 const initial='QA-WORK-ED02 Process '+suffix
 await drawer.getByRole('textbox',{name:'Название'}).fill(initial)
 await drawer.getByRole('combobox',{name:'Связать с ИС (необязательно)'}).selectOption(system)
 await drawer.getByRole('button',{name:'Сохранить бизнес-процесс'}).click()
 await expect(drawer).toHaveCount(0)
 await expect(page.getByText(initial,{exact:true})).toBeVisible()
 await page.getByRole('button',{name:initial,exact:true}).click()
 await page.getByRole('complementary',{name:'Карточка: '+initial}).getByRole('button',{name:'Редактировать'}).click()
 const editor=page.getByRole('dialog',{name:'Редактор бизнес-процесса'})
 const changed='QA-WORK-ED02 Changed '+suffix
 await editor.getByRole('textbox',{name:'Название'}).fill(changed)
 await editor.getByRole('button',{name:'Сохранить бизнес-процесс'}).click()
 await expect(editor).toHaveCount(0)
 await page.reload()
 await expect(page.getByText(changed,{exact:true})).toBeVisible()
 const processes=(await (await page.request.get(api+'/api/business/processes')).json()) as Array<{id:string;name:string}>
 const p=processes.filter(row=>row.name===changed)
 expect(p).toHaveLength(1)
 const links=(await (await page.request.get(api+'/api/business/system-links')).json()) as Array<{process_id:string;system_id:string}>
 expect(links.some(row=>row.process_id===p[0].id&&row.system_id===system)).toBeTruthy()
 const legacy=(await (await page.request.get(api+'/api/objects')).json()) as Array<{name:string}>
 expect(legacy.some(row=>row.name===initial||row.name===changed)).toBeFalsy()
})
