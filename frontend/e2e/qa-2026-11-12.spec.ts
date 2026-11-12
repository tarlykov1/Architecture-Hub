import {test,expect,type Page} from '@playwright/test'

async function navigate(page:Page,section:'Потоки'|'Компоненты'){
 await page.goto('/')
 await page.getByRole('navigation',{name:'Разделы архитектуры'})
  .getByRole('button',{name:section,exact:true}).click()
}

test('AH-01: public demo network route shows an empty state without a white screen',async({page})=>{
 const exceptions:string[]=[]
 page.on('pageerror',error=>exceptions.push(error.message))
 await navigate(page,'Потоки')
 await page.getByRole('group',{name:'Представление потоков'})
  .getByRole('button',{name:'Карточки'}).click()
 await page.getByRole('button',{name:'Сетевой маршрут',exact:true}).first().click()
 const drawer=page.getByRole('dialog',{name:'Технический маршрут потока'})
 await expect(drawer).toBeVisible()
 await expect(drawer.getByRole('region',{name:'Шаги технического маршрута'}))
  .toContainText('Промежуточные объекты не описаны')
 await expect(page.getByLabel('Версия сборки')).toBeVisible()
 expect(exceptions).toEqual([])
 await drawer.getByRole('button',{name:'Закрыть маршрут'}).click()
 await expect(drawer).toHaveCount(0)
})

test('AH-04: save restriction is visible before editing a demo flow',async({page})=>{
 await navigate(page,'Потоки')
 await page.getByRole('group',{name:'Представление потоков'})
  .getByRole('button',{name:'Карточки'}).click()
 await page.getByRole('button',{name:'Редактировать',exact:true}).first().click()
 const drawer=page.getByRole('dialog',{name:'Редактор потока'})
 await expect(drawer).toBeVisible()
 await expect(drawer.getByRole('status')).toContainText('Демонстрационный режим')
 await expect(drawer.getByRole('button',{name:'Сохранить',exact:true})).toBeDisabled()
 await drawer.getByRole('button',{name:'Закрыть'}).click()
})

test('AH-02: clicking the connection label selects the flow, not its network container',async({page})=>{
 await page.addInitScript(()=>{
  sessionStorage.setItem('architecture-hub:access-token:session','browser-ci-development-token')
 })
 const suffix=String(Date.now())
 const systemResponse=await page.request.post('http://127.0.0.1:8001/api/objects',{
  data:{name:'QA edge label system '+suffix,kind:'system'}
 })
 expect(systemResponse.status()).toBe(201)
 const system=(await systemResponse.json()).id as string
 const vms:string[]=[]
 for(const name of ['QA source '+suffix,'QA receiver '+suffix]){
  const response=await page.request.post('http://127.0.0.1:8001/api/infra',{
   data:{name,system_id:system,kind:'vm'}
  })
  expect(response.status()).toBe(201)
  vms.push((await response.json()).id as string)
 }
 const network=await page.request.post('http://127.0.0.1:8001/api/networks',{
  data:{name:'QA network '+suffix,kind:'zone'}
 })
 expect(network.status()).toBe(201)
 const zoneId=(await network.json()).id as string
 const nic=await page.request.post('http://127.0.0.1:8001/api/network-interfaces',{
  data:{item_id:vms[0],name:'eth0',zone_id:zoneId}
 })
 expect(nic.status()).toBe(201)
 const flow=await page.request.post('http://127.0.0.1:8001/api/flows',{
  data:{source_id:vms[0],target_id:vms[1],name:'QA labelled exchange '+suffix,protocol:'HTTPS',port:'443'}
 })
 expect(flow.status()).toBe(201)
 await navigate(page,'Компоненты')
 await page.getByRole('group',{name:'Представление компонентов'})
  .getByRole('button',{name:'Схема'}).click()
 await page.getByRole('button',{name:'Редактировать схему'}).click()
 const chooser=page.getByRole('combobox',{name:'Выбрать ИС для редактора компонентов'})
 if(await chooser.isVisible())await chooser.selectOption(system)
 const editor=page.getByRole('region',{name:'Редактор архитектурной схемы'})
 await expect(editor.locator('.react-flow__node-boardNetwork')).toHaveCount(1)
 const label=editor.getByRole('button',{name:'Выбрать поток HTTPS:443'})
 await expect(label).toBeVisible()
 await label.click()
 const dock=editor.getByRole('complementary',{name:'Свойства и изменения схемы'})
 await expect(dock.getByRole('form',{name:'Редактирование существующего потока'})
  .getByLabel('Название потока')).toHaveValue('QA labelled exchange '+suffix)
 await expect(dock.getByText('QA network '+suffix,{exact:false})).toHaveCount(0)
})
