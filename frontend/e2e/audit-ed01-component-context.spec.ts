import {test,expect} from '@playwright/test'

// ED-01: the create dialog must not infer a parent IS from an unrelated selection.
test('QA-WORK ED-01: explicit IS context, cancel, switch and persisted component',async({page})=>{
 await page.addInitScript(()=>{
  sessionStorage.setItem('architecture-hub:access-token:session','browser-ci-development-token')
 })
 const api='http://127.0.0.1:8001', suffix=String(Date.now())
 async function createSystem(label:string){
  const response=await page.request.post(api+'/api/objects',{
   data:{kind:'system',name:'QA-WORK-'+label+'-'+suffix}
  })
  expect(response.status(),await response.text()).toBe(201)
  return (await response.json()).id as string
 }
 const first=await createSystem('ED01-A')
 const second=await createSystem('ED01-B')
 await page.goto('/')
 const navigation=page.getByRole('navigation',{name:'Разделы архитектуры'})
 await navigation.getByRole('button',{name:'Компоненты',exact:true}).click()
 await page.getByRole('combobox',{name:'Система компонентов'}).selectOption(first)
 // The top-level create action is a details menu, not a second component editor.
 await navigation.getByText('Создать',{exact:true}).click()
 await navigation.getByRole('button',{name:'Компонент',exact:true}).click()
 const dialog=page.getByRole('dialog').filter({hasText:'Новый компонент'})
 const parent=dialog.getByRole('combobox',{name:'Родительская информационная система'})
 await expect(parent).toHaveValue(first)
 await parent.selectOption(second)
 await expect(dialog.getByRole('combobox',{name:'Родительская информационная система'})).toHaveValue(second)
 await dialog.getByRole('button',{name:'Закрыть ×'}).click()
 await expect(dialog).toHaveCount(0)

 // Reopening from the scoped component registry restores the selected IS, not an old draft.
 await navigation.getByText('Создать',{exact:true}).click()
 await navigation.getByRole('button',{name:'Компонент',exact:true}).click()
 const reopened=page.getByRole('dialog').filter({hasText:'Новый компонент'})
 await expect(reopened.getByRole('combobox',{name:'Родительская информационная система'})).toHaveValue(first)
 await reopened.getByRole('combobox',{name:'Родительская информационная система'}).selectOption(second)
 const name='QA-WORK-ED01-SERVICE-'+suffix
 await reopened.getByPlaceholder('Имя ВМ / сервиса / API').fill(name)
 await reopened.getByRole('combobox',{name:'Тип компонента'}).selectOption('service')
 await reopened.getByRole('button',{name:'Добавить компонент'}).click()
 await expect(reopened).toHaveCount(0)
 await expect(page.getByRole('combobox',{name:'Система компонентов'})).toHaveValue(second)
 await expect(page.getByRole('region',{name:'Архитектурный реестр'})).toContainText(name)
 await page.reload()
 await expect(page.getByRole('region',{name:'Архитектурный реестр'})).toContainText(name)
 const response=await page.request.get(api+'/api/infra')
 expect(response.ok()).toBeTruthy()
 const created=(await response.json() as Array<{id:string;name:string;system_id:string}>).filter(item=>item.name===name)
 expect(created).toHaveLength(1)
 expect(created[0].system_id).toBe(second)
 await page.getByRole('group',{name:'Представление компонентов'}).getByRole('button',{name:'Схема'}).click()
 await expect(page.locator('[data-active-graph="infrastructure"]')).toContainText(name)
})
