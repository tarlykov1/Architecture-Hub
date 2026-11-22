import type {Page} from '@playwright/test'

/** Enter a child workspace through the same menu on desktop and mobile. */
export async function openWorkspace(page:Page,section:'Компоненты'|'Потоки'){
  const nav=page.getByRole('navigation',{name:'Разделы архитектуры'})
  const mobile=nav.locator('details.mobileSectionMenu > summary')
  if(await mobile.isVisible())await mobile.click()
  await nav.getByRole('button',{name:section==='Компоненты'?'Системы':'Потоки',exact:true}).click()
  if(section==='Компоненты'){
    await page.locator('.systemsWorkspaceActions').getByRole('button',{name:'Компоненты',exact:true}).click()
  }else{
    await page.getByRole('button',{name:'Реестр потоков',exact:true}).click()
  }
}
