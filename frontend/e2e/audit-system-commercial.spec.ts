import {test,expect} from '@playwright/test'

// Contract tests run against the private, disposable browser CI SQLite database.
// No production IS records are modified.
test.describe.configure({retries:0})

test('QA-WORK IS passport: contract, licence, vendor SLA and renewal survive reload',async({page})=>{
 await page.addInitScript(()=>sessionStorage.setItem('architecture-hub:access-token:session','browser-ci-development-token'))
 const suffix=Date.now().toString(36)
 const systemName='QA-WORK-Licensing-'+suffix
 const created=await page.request.post('http://127.0.0.1:8001/api/objects',{data:{kind:'system',name:systemName}})
 expect(created.status(),await created.text()).toBe(201)
 const systemId=(await created.json()).id as string
 const base='http://127.0.0.1:8001/api/systems/'+systemId
 await page.goto('/')
 const nav=page.getByRole('navigation',{name:'Разделы архитектуры'})
 await nav.getByRole('button',{name:'Системы',exact:true}).click()
 await page.getByRole('button',{name:systemName,exact:true}).click()
 const details=page.getByLabel('Карточка архитектурного объекта')
 await details.getByRole('button',{name:'Договоры и лицензии'}).click()
 const section=details.getByRole('region',{name:'Договоры и лицензии ИС'})
 await expect(section).toBeVisible()
 await section.getByRole('button',{name:'+ Договор'}).click()
 const contract=section.getByRole('form',{name:'Редактор договора ИС'})
 await contract.getByRole('textbox',{name:'Предмет / название договора'}).fill('QA-WORK-Лицензирование-'+suffix)
 await contract.getByRole('textbox',{name:'Номер договора'}).fill('QA-WORK-19')
 await contract.getByRole('textbox',{name:'Вендор'}).fill('QA-WORK-Vendor')
 await contract.getByRole('textbox',{name:'Подрядчик / поставщик'}).fill('QA-WORK-Partner')
 await contract.getByRole('textbox',{name:'Уровень поддержки'}).fill('Premium')
 await contract.getByRole('textbox',{name:'Окно поддержки'}).fill('24x7')
 await contract.getByLabel('Дата окончания').fill('2027-12-31')
 await contract.getByLabel('Дата продления').fill('2027-11-15')
 await contract.getByLabel('SLA: реакция, часов').fill('2')
 await contract.getByLabel('SLA: доступность, %').fill('99.9')
 await contract.getByRole('button',{name:'Сохранить договор'}).click()
 await expect(contract).toHaveCount(0)
 await expect(section).toContainText('QA-WORK-Лицензирование-'+suffix)
 await expect(section).toContainText('99.9%')
 let agreements=(await (await page.request.get(base+'/contracts')).json()) as Array<{id:string;renewal_date:string;vendor:string}>
 expect(agreements).toHaveLength(1)
 const agreementId=agreements[0].id
 expect(agreements[0].renewal_date).toBe('2027-11-15')
 await section.getByRole('button',{name:'+ Лицензия'}).click()
 const entitlement=section.getByRole('form',{name:'Редактор лицензии ИС'})
 await entitlement.getByRole('textbox',{name:'Продукт / редакция'}).fill('QA-WORK-Concurrent-'+suffix)
 await entitlement.getByLabel('Тип лицензии').selectOption('concurrent')
 await entitlement.getByLabel('Количество').fill('124')
 await entitlement.getByLabel('Связанный договор').selectOption(agreementId)
 await entitlement.getByLabel('Дата окончания лицензии').fill('2027-12-31')
 await entitlement.getByRole('button',{name:'Сохранить лицензию'}).click()
 await expect(entitlement).toHaveCount(0)
 let licenses=(await (await page.request.get(base+'/licenses')).json()) as Array<{id:string;quantity:number;contract_id:string}>
 expect(licenses).toHaveLength(1)
 expect(licenses[0].contract_id).toBe(agreementId)
 const licenseId=licenses[0].id
 const restricted=section.getByRole('button',{name:'Удалить договор'})
 await expect(restricted).toBeDisabled()
 await section.getByRole('button',{name:'Изменить лицензию'}).click()
 const editLicense=section.getByRole('form',{name:'Редактор лицензии ИС'})
 await editLicense.getByLabel('Количество').fill('150')
 await editLicense.getByRole('button',{name:'Сохранить лицензию'}).click()
 await expect(editLicense).toHaveCount(0)
 licenses=(await (await page.request.get(base+'/licenses')).json()) as typeof licenses
 expect(licenses[0].id).toBe(licenseId)
 expect(licenses[0].quantity).toBe(150)
 // Cancelling an agreement edit must not mutate persisted records.
 await section.getByRole('button',{name:'Изменить договор'}).click()
 const editContract=section.getByRole('form',{name:'Редактор договора ИС'})
 await editContract.getByRole('textbox',{name:'Вендор'}).fill('НЕ СОХРАНЯТЬ')
 await editContract.getByRole('button',{name:'Отмена'}).click()
 agreements=(await (await page.request.get(base+'/contracts')).json()) as typeof agreements
 expect(agreements[0].id).toBe(agreementId)
 expect(agreements[0].vendor).toBe('QA-WORK-Vendor')
 await page.reload()
 await nav.getByRole('button',{name:'Системы',exact:true}).click()
 await page.getByRole('button',{name:systemName,exact:true}).click()
 const reloaded=page.getByLabel('Карточка архитектурного объекта')
 await reloaded.getByRole('button',{name:'Договоры и лицензии'}).click()
 const block=reloaded.getByRole('region',{name:'Договоры и лицензии ИС'})
 await expect(block).toContainText('QA-WORK-Concurrent-'+suffix)
 await expect(block).toContainText('150 шт.')
 await expect(block).toContainText('24x7')
})
