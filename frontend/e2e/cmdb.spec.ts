import {test,expect} from '@playwright/test'

const api='http://127.0.0.1:8001'
test.beforeEach(async({page})=>{
  await page.addInitScript(()=>{
    sessionStorage.setItem('architecture-hub:access-token:session','browser-ci-development-token')
  })
})

test('CMDB impact tab shows directed dependencies without leaving the component card',async({page})=>{
  const id=Date.now().toString(36)
  const create=async(path:string,data:Record<string,unknown>)=>{
    const res=await page.request.post(api+path,{data})
    expect(res.status(),await res.text()).toBe(201)
    return await res.json()
  }
  const system=await create('/api/objects',{kind:'system',name:'CMDB E2E '+id})
  const vm1=await create('/api/infra',{system_id:system.id,name:'CMDB source '+id,kind:'vm'})
  const vm2=await create('/api/infra',{system_id:system.id,name:'CMDB recipient '+id,kind:'vm'})
  await create('/api/flows',{source_id:vm1.id,target_id:vm2.id,name:'CMDB test flow '+id,protocol:'HTTPS',port:'443'})

  await page.goto('/')
  await page.getByRole('navigation',{name:'Разделы архитектуры'}).getByRole('button',{name:'Компоненты',exact:true}).click()
  await page.getByRole('combobox',{name:'Система компонентов'}).selectOption(system.id)
  await page.getByRole('group',{name:'Представление компонентов'}).getByRole('button',{name:'Схема',exact:true}).click()
  await page.locator('.react-flow__node').filter({hasText:'CMDB source '+id}).first().click()

  const card=page.getByRole('dialog',{name:'Карточка компонента CMDB source '+id})
  await expect(card).toBeVisible()
  await card.getByRole('tab',{name:'Влияние CMDB'}).click()
  const view=card.getByRole('region',{name:'Анализ влияния CMDB'})
  await expect(view).toBeVisible()
  await expect(view).toContainText('CMDB recipient '+id)
  await expect(view).toContainText('Связь требует проверки')
  await expect(view).toContainText('Потенциальное влияние')
  await view.getByRole('button',{name:'Открыть КЕ'}).first().click()
  await expect(page.getByRole('dialog',{name:'Карточка компонента CMDB recipient '+id})).toBeVisible()
})
