import {test,expect} from '@playwright/test'

test('register a switch in an office and find it on the system resource map',async({page,request})=>{
  const name='QA-WORK-Equipment-'+Date.now()
  async function create(path:string,data:object){
    const response=await request.post('http://127.0.0.1:8001/api/'+path,{data})
    expect(response.status(),await response.text()).toBe(201)
    return (await response.json()).id as string
  }
  const system=await create('objects',{name,kind:'system'})
  const vm=await create('infra',{name:name+'-VM',kind:'vm',system_id:system})
  await page.addInitScript(()=>sessionStorage.setItem('architecture-hub:access-token:session','browser-ci-development-token'))
  await page.goto('/systems')
  await page.getByRole('button',{name:'Оборудование',exact:true}).click()
  const dialog=page.getByRole('region',{name:'Оборудование'})
  await dialog.getByRole('button',{name:'+ Объект',exact:true}).click()
  await dialog.getByLabel('Название',{exact:true}).fill(name+'-SW')
  await dialog.locator('label').filter({hasText:/^Тип/}).locator('select').selectOption('switch')
  await dialog.getByLabel('Размещение оборудования').selectOption('new')
  await dialog.getByLabel('Город',{exact:true}).fill('Санкт-Петербург')
  await dialog.getByLabel('Кабинет / помещение').fill('412')
  await dialog.getByLabel('Инвентарный номер').fill(name)
  await dialog.getByLabel('Связанные компоненты').selectOption(vm)
  await dialog.getByRole('button',{name:'Сохранить объект'}).click()
  await expect(dialog.getByRole('status')).toContainText('сохранён')
  await expect(dialog.getByRole('row').filter({hasText:name+'-SW'})).toContainText('412')
  await dialog.getByRole('button',{name:'К реестру ИС'}).click()
  await page.getByRole('row').filter({has:page.getByRole('button',{name,exact:true})}).getByRole('button',{name:'Ресурсная карта'}).click()
  const map=page.getByRole('region',{name:'Ресурсная карта ИС'})
  await expect(map.getByText(name+'-SW',{exact:true})).toBeVisible()
  await expect(map.getByText(/Коммутатор · Санкт-Петербург › 412/)).toBeVisible()
  await expect(map.locator('.react-flow__edge-path')).toHaveCount(2)
})
