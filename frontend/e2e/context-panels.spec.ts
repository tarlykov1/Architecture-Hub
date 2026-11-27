import { expect, test, type Locator } from '@playwright/test'

for (const width of [390, 1440]) {
  test('flow selection and its tools keep a common right edge at '+width+'px', async ({page,request}) => {
    await page.setViewportSize({width,height:900})
    await page.addInitScript(()=>sessionStorage.setItem('architecture-hub:access-token:session','browser-ci-development-token'))
    async function create(path:string, data:object) {
      const response=await request.post('http://127.0.0.1:8001/api/'+path,{data})
      expect(response.status()).toBe(201)
      return (await response.json()).id as string
    }
    const name='QA-Поток-'+Date.now()
    const system=await create('objects',{name,kind:'system'})
    const source=await create('infra',{system_id:system,name:'Кадры',kind:'vm'})
    const target=await create('infra',{system_id:system,name:'Справочник',kind:'vm'})
    await create('flows',{name,source_id:source,target_id:target})
    await page.goto('/flows?system='+system)
    const row=page.getByRole('button',{name,exact:true})
    await page.getByRole('cell',{name:'Справочник',exact:true}).click()
    const panel=page.getByRole('complementary',{name:'Карточка: '+name})
    async function aligned(element:Locator) {
      await expect(element).toBeVisible()
      const bounds=await element.boundingBox()
      expect(bounds!.width).toBeCloseTo(width<700?width:width*.30,0)
      expect(bounds!.x+bounds!.width).toBeCloseTo(width,0)
    }
    await aligned(panel)
    await expect(panel).toContainText('Кадры → Справочник')
    for(const action of ['Редактировать','Атрибуты','Данные','Маршрут','СЗИ']){
      await panel.getByRole('button',{name:action,exact:true}).click()
      const dialog=page.getByRole('dialog')
      await aligned(dialog)
      await expect(dialog.locator('.panelKind')).toContainText(name)
      await dialog.getByRole('button',{name:/^Закрыть/}).first().click()
      await aligned(panel)
    }
    await panel.getByRole('button',{name:'Закрыть карточку'}).click()
    await expect(panel).toHaveCount(0)
    await expect(row).toBeFocused()
  })
}
