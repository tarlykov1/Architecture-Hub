import {expect,test} from '@playwright/test'

// AH-QA-18: a navigation label must describe the screen it actually opens.
test('QA-WORK: Systems button labeled Общая карта opens the shared architecture overview',async({page})=>{
  await page.addInitScript(()=>sessionStorage.setItem('architecture-hub:access-token:session','browser-ci-development-token'))
  await page.goto('/systems')
  const systems=page.getByRole('region',{name:'Реестр информационных систем'})
  await expect(systems).toBeVisible()
  await expect(systems.getByRole('button',{name:'Слои архитектуры'})).toHaveCount(0)
  const openMap=page.getByRole('button',{name:'Общая карта',exact:true})
  await expect(openMap).toBeVisible()
  await openMap.click()
  await expect(page).toHaveURL(/\/$/)
  await expect(page.getByRole('region',{name:'Главная карта архитектуры'})).toBeVisible()
})
