import {expect,test} from '@playwright/test'

test.describe.configure({retries:0})
const api='http://127.0.0.1:8001'

test('QA-WORK: attribute is defined in the selected flow, attached immediately and removed without deleting definition',async({page})=>{
 await page.addInitScript(()=>sessionStorage.setItem('architecture-hub:access-token:session','browser-ci-development-token'))
 const suffix=String(Date.now())
 const create=async(path:string,data:Record<string,unknown>)=>{
  const response=await page.request.post(api+path,{data})
  expect(response.status(),await response.text()).toBe(201)
  return (await response.json()) as {id:string}
 }
 const system=(await create('/api/objects',{kind:'system',name:'QA-WORK-ATTR-UI-'+suffix})).id
 const source=(await create('/api/infra',{system_id:system,name:'QA-WORK-SRC-'+suffix,kind:'vm'})).id
 const target=(await create('/api/infra',{system_id:system,name:'QA-WORK-DST-'+suffix,kind:'vm'})).id
 const flow=(await create('/api/flows',{source_id:source,target_id:target,name:'QA-WORK-Flow '+suffix})).id
 const existingName='QA-WORK Existing field '+suffix
 const existing=(await create('/api/data-attributes',{
  code:'QA_WORK_EX_'+suffix,name:existingName,data_type:'string',sensitivity:'internal'
 })).id
 await page.goto('/flows?system='+system)
 await page.getByRole('button',{name:'Редактор потоков',exact:true}).click()
 const editor=page.getByRole('region',{name:'Редактор архитектурной схемы'})
 await editor.getByRole('button',{name:'→ Поток'}).click()
 await editor.getByRole('combobox',{name:'Выбрать поток на схеме'}).selectOption(flow)
 const attrs=editor.getByRole('region',{name:'Атрибуты данных потока'})
 await expect(attrs.getByText('Пока нет атрибутов.')).toBeVisible()
 await attrs.getByRole('button',{name:'+ Добавить атрибут'}).click()
 const add=attrs.getByRole('form',{name:'Добавление атрибута в поток'})
 await expect(add).toBeVisible()
 await add.getByRole('searchbox',{name:'Поиск атрибута'}).fill(existingName)
 await add.getByRole('combobox',{name:'Выбрать существующий атрибут'}).selectOption(existing)
 await add.getByRole('button',{name:'Добавить в поток'}).click()
 await expect(attrs.getByText(existingName,{exact:true})).toBeVisible()
 await expect(attrs.getByRole('form',{name:'Добавление атрибута в поток'})).toHaveCount(0)

 const freshName='QA-WORK Табельный номер '+suffix
 await attrs.getByRole('button',{name:'+ Добавить атрибут'}).click()
 await add.getByRole('button',{name:'Создать новый'}).click()
 await add.getByRole('textbox',{name:'Название нового атрибута'}).fill(freshName)
 await add.getByRole('combobox',{name:'Категория нового атрибута'}).selectOption('personal')
 await add.getByRole('button',{name:'Добавить в поток'}).click()
 await expect(attrs.getByText(freshName,{exact:true})).toBeVisible()
 const map=(await (await page.request.get(api+'/api/flows/'+flow+'/data-map')).json()) as {
  attributes:Array<{id:string;name:string;attribute_id:string;sensitivity:string}>}
 expect(map.attributes.map(a=>a.name).sort()).toEqual([existingName,freshName].sort())
 const created=map.attributes.find(a=>a.name===freshName)!
 expect(created.sensitivity).toBe('personal')
 const definitions=await (await page.request.get(api+'/api/data-attributes')).json() as Array<{id:string;name:string;code:string}>
 expect(definitions.some(a=>a.id===created.attribute_id&&a.code.startsWith('attr_'))).toBe(true)

 page.once('dialog',dialog=>void dialog.accept())
 await attrs.getByRole('button',{name:'Убрать атрибут '+freshName+' из потока'}).click()
 await expect(attrs.getByText(freshName,{exact:true})).toHaveCount(0)
 const remaining=(await (await page.request.get(api+'/api/flows/'+flow+'/data-map')).json()) as typeof map
 expect(remaining.attributes.map(row=>row.name)).toEqual([existingName])
 expect((await (await page.request.get(api+'/api/data-attributes')).json() as typeof definitions)
  .some(a=>a.id===created.attribute_id)).toBe(true)
})
