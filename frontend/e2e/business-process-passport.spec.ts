import {readFile} from 'node:fs/promises'
import {expect,test,type APIRequestContext,type Page} from '@playwright/test'

const api='http://127.0.0.1:8001/api'
async function created(request:APIRequestContext,route:string,data:object){
 const res=await request.post(api+route,{data})
 expect(res.status(),await res.text()).toBe(201)
 return res.json() as Promise<{id:string;name:string}>
}
async function setup(request:APIRequestContext){
 const suffix=Date.now().toString(36)+Math.random().toString(36).slice(2,8)
 const category=await created(request,'/business/categories',{name:'QA-WORK-ProcessArea-'+suffix})
 const main=await created(request,'/business/processes',{name:'QA-WORK-Employee-'+suffix,category_id:category.id})
 const parent=await created(request,'/business/processes',{name:'QA-WORK-People-'+suffix,category_id:category.id})
 const system=await created(request,'/objects',{name:'QA-WORK-HR-'+suffix,kind:'system'})
 const other=await created(request,'/objects',{name:'QA-WORK-Directory-'+suffix,kind:'system'})
 const vm=await created(request,'/infra',{name:'QA-WORK-HR-VM-'+suffix,kind:'vm',system_id:system.id})
 const vm2=await created(request,'/infra',{name:'QA-WORK-Directory-VM-'+suffix,kind:'vm',system_id:other.id})
 const flow=await created(request,'/flows',{name:'QA-WORK-EmployeeFlow-'+suffix,source_id:vm.id,target_id:vm2.id,protocol:'HTTPS',port:'443'})
 const attribute=await created(request,'/data-attributes',{code:'qa.work.proc.'+suffix,name:'Employee reference '+suffix,sensitivity:'internal'})
 return {suffix,main,parent,system,other,vm,vm2,flow,attribute}
}
async function open(page:Page,name:string){
 await page.addInitScript(()=>sessionStorage.setItem('architecture-hub:access-token:session','browser-ci-development-token'))
 await page.goto('/')
 const nav=page.getByRole('navigation',{name:'Разделы архитектуры'})
 if(page.viewportSize()!.width<=720){
   await nav.locator('details.mobileSectionMenu > summary').click()
   await nav.locator('.mobileSectionOptions').getByRole('button',{name:'Бизнес-процессы',exact:true}).click()
 }else{
   await nav.locator('details.secondaryNavigation > summary').click()
   await nav.locator('.secondaryNavigation .layerActionMenu').getByRole('button',{name:'Бизнес-процессы',exact:true}).click()
 }
 const card=page.getByRole('row').filter({has:page.getByRole('button',{name,exact:true})})
 await expect(card).toBeVisible()
 await card.getByRole('button',{name,exact:true}).click()
 await page.getByRole('button',{name:'Паспорт и шаги'}).click()
 return page.getByRole('dialog',{name:'Паспорт бизнес-процесса'})
}

test('QA-WORK: business passport stores hierarchy, canonical references, step reorder and shared map',async({page,request})=>{
 const {main,parent,system,vm,flow,attribute}=await setup(request)
 const dlg=await open(page,main.name)
 await expect(dlg).toBeVisible()
 await dlg.getByRole('textbox',{name:'Владелец бизнес-процесса'}).fill('HR Owner')
 await dlg.getByRole('textbox',{name:'Участники бизнес-процесса'}).fill('HR, IT')
 await dlg.getByRole('textbox',{name:'Результат бизнес-процесса'}).fill('Employee access requested')
 await dlg.getByRole('combobox',{name:'Состояние бизнес-процесса'}).selectOption('active')
 await dlg.getByRole('combobox',{name:'Родительский бизнес-процесс'}).selectOption(parent.id)
 await dlg.getByRole('button',{name:'Добавить шаг'}).click()
 const step=dlg.locator('.businessStep').last()
 await step.getByRole('textbox',{name:'Название шага БП'}).fill('Receive HR request')
 await step.getByRole('textbox',{name:'Ответственный шага БП'}).fill('HR team')
 await step.getByRole('textbox',{name:'Вход шага БП'}).fill('Approved HR request')
 await step.getByRole('textbox',{name:'Выход шага БП'}).fill('Integration request')
 await step.getByRole('combobox',{name:'ИС шага БП'}).selectOption(system.id)
 await step.getByRole('combobox',{name:'Компонент шага БП'}).selectOption(vm.id)
 await step.getByRole('combobox',{name:'Поток шага БП'}).selectOption(flow.id)
 await step.getByText('Атрибуты данных').click()
 await step.getByRole('checkbox',{name:new RegExp(attribute.name)}).check()
 await dlg.getByRole('button',{name:'Сохранить паспорт'}).click()
 await expect(dlg.getByText('Паспорт сохранён · версия 1')).toBeVisible()
 const url=api+'/business/process-passports/'+main.id
 let saved=await (await request.get(url)).json() as {
   revision:number;parent_id:string;owner:string;steps:Array<{id:string;name:string;system_id:string;component_id:string;flow_id:string;attribute_ids:string[];position:number}>
 }
 expect(saved.revision).toBe(1)
 expect(saved.parent_id).toBe(parent.id)
 expect(saved.owner).toBe('HR Owner')
 expect(saved.steps[0]).toMatchObject({system_id:system.id,component_id:vm.id,flow_id:flow.id,attribute_ids:[attribute.id]})
 const firstId=saved.steps[0].id

 await dlg.getByRole('button',{name:'Добавить шаг'}).click()
 await dlg.getByRole('textbox',{name:'Название шага БП'}).fill('Confirm provisioning')
 await dlg.getByRole('button',{name:'Поднять шаг БП 2'}).click()
 await dlg.getByRole('button',{name:'Сохранить паспорт'}).click()
 await expect(dlg.getByText('Паспорт сохранён · версия 2')).toBeVisible()
 saved=await (await request.get(url)).json()
 expect(saved.steps).toHaveLength(2)
 expect(saved.steps[1].id).toBe(firstId)
 expect(saved.steps.map(x=>x.position)).toEqual([0,1])
 await dlg.getByRole('group',{name:'Представление шагов БП'}).getByRole('button',{name:'Схема'}).click()
 const map=dlg.getByRole('region',{name:'Схема шагов бизнес-процесса'})
 await expect(map).toContainText('Confirm provisioning')
 await expect(map).toContainText('Receive HR request')
 await dlg.getByRole('button',{name:'Закрыть паспорт БП'}).click()
 await page.reload()
 const card=page.getByRole('row').filter({has:page.getByRole('button',{name:main.name,exact:true})})
 await expect(card.locator('td').first()).toHaveCSS('padding-left','26px')
 const categoryRows=page.locator('.registrySplit tbody tr')
 const names=await categoryRows.locator('.entityName').allTextContents()
 expect(names.indexOf(parent.name)).toBeLessThan(names.indexOf(main.name))
 await card.getByRole('button',{name:main.name,exact:true}).click()
 await page.getByRole('button',{name:'Паспорт и шаги'}).click()
 const reopened=page.getByRole('dialog',{name:'Паспорт бизнес-процесса'})
 await expect(reopened.getByRole('textbox',{name:'Владелец бизнес-процесса'})).toHaveValue('HR Owner')
 await expect(reopened.getByText('Confirm provisioning')).toBeVisible()
 expect((await (await request.get(api+'/flows')).json() as {id:string}[]).some(x=>x.id===flow.id)).toBe(true)
 expect((await (await request.get(api+'/objects')).json() as {id:string}[]).some(x=>x.id===main.id)).toBe(false)
})

test('QA-WORK: no silent lost edits and stale-version conflict is shown on mobile',async({page,request})=>{
 await page.setViewportSize({width:390,height:844})
 const {main}=await setup(request)
 const dlg=await open(page,main.name)
 await dlg.getByRole('textbox',{name:'Владелец бизнес-процесса'}).fill('Unsaved Owner')
 page.once('dialog',async dialog=>{
   expect(dialog.message()).toContain('несохранённые изменения')
   await dialog.dismiss()
 })
 await dlg.getByRole('button',{name:'Закрыть паспорт БП'}).click()
 await expect(dlg).toBeVisible()
 await dlg.getByRole('button',{name:'Сохранить паспорт'}).click()
 await expect(dlg.getByText('Паспорт сохранён · версия 1')).toBeVisible()
 await dlg.getByRole('textbox',{name:'Владелец бизнес-процесса'}).fill('Edited locally')
 const external=await request.put(api+'/business/process-passports/'+main.id,{
   data:{expected_revision:1,owner:'Changed by another editor'}
 })
 expect(external.status(),await external.text()).toBe(200)
 await dlg.getByRole('button',{name:'Сохранить паспорт'}).click()
 await expect(dlg.getByRole('alert')).toContainText('При конфликте версий обновите данные')
 page.once('dialog',async dialog=>{
   expect(dialog.message()).toContain('Отбросить изменения')
   await dialog.accept()
 })
 await dlg.getByRole('button',{name:'Обновить данные'}).click()
 await expect(dlg.getByRole('textbox',{name:'Владелец бизнес-процесса'})).toHaveValue('Changed by another editor')
 const width=await page.evaluate(()=>document.documentElement.scrollWidth)
 expect(width).toBeLessThanOrEqual(392)
})


test('QA-WORK: business-process matrices and versioned Markdown export use canonical architecture',async({page,request})=>{
 const {main,system,vm,flow,attribute}=await setup(request)
 const url=api+'/business/process-passports/'+main.id
 const saved=await request.put(url,{data:{
   expected_revision:0,owner:'Architecture owner',status:'active',
   steps:[{
     name:'Transfer identifiers',
     description:'Only identifier definitions, not personal data',
     system_id:system.id,component_id:vm.id,flow_id:flow.id,
     attribute_ids:[attribute.id],responsible:'Integration team',
     input:'Approved reference',output:'Provisioning request'
   }]
 }})
 expect(saved.status(),await saved.text()).toBe(200)
 await page.addInitScript(()=>sessionStorage.setItem('architecture-hub:access-token:session','browser-ci-development-token'))
 await page.goto('/')
 const nav=page.getByRole('navigation',{name:'Разделы архитектуры'})
 if(page.viewportSize()!.width<=720){
   await nav.locator('details.mobileSectionMenu > summary').click()
   await nav.locator('.mobileSectionOptions').getByRole('button',{name:'Бизнес-процессы',exact:true}).click()
 }else{
   await nav.locator('details.secondaryNavigation > summary').click()
   await nav.locator('.secondaryNavigation .layerActionMenu').getByRole('button',{name:'Бизнес-процессы',exact:true}).click()
 }
 await page.getByRole('group',{name:'Представление бизнес-архитектуры'}).getByRole('button',{name:'Матрица зависимостей'}).click()
 const matrix=page.getByRole('region',{name:'Таблица зависимостей БП'})
 await expect(matrix).toBeVisible()
 await expect(matrix.getByRole('button',{name:'Открыть БП '+main.name+' для объекта '+system.name})).toBeVisible()
 await page.getByRole('group',{name:'Тип матрицы БП'}).getByRole('button',{name:'БП × Потоки'}).click()
 await expect(matrix.getByRole('button',{name:'Открыть БП '+main.name+' для объекта '+flow.name})).toBeVisible()
 await matrix.getByRole('button',{name:'Открыть БП '+main.name+' для объекта '+flow.name}).click()
 await page.getByRole('button',{name:'Паспорт и шаги'}).click()
 const dlg=page.getByRole('dialog',{name:'Паспорт бизнес-процесса'})
 await expect(dlg.getByRole('textbox',{name:'Владелец бизнес-процесса'})).toHaveValue('Architecture owner')
 const wait=page.waitForEvent('download')
 await dlg.getByRole('button',{name:'Скачать описание БП (.md)'}).click()
 const download=await wait
 expect(download.suggestedFilename()).toMatch(/^ArchitectureHub_BP_.*\.md$/)
 const path=await download.path()
 expect(path).toBeTruthy()
 const markdown=await readFile(path!,'utf8')
 expect(markdown).toContain('# '+main.name)
 expect(markdown).toContain('Architecture owner')
 expect(markdown).toContain('Transfer identifiers')
 expect(markdown).toContain(flow.name)
 expect(markdown).toContain(attribute.name)
 expect(markdown).toContain('Версия паспорта: 1')
 expect(markdown).toContain('не подтверждает фактическое прохождение трафика')
})
