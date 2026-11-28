import {expect, test} from '@playwright/test'
import {publicDemoResponse} from '../src/publicDemo'

for (const width of [390, 1440]) {
  test(`shared flow sequence preserves endpoints, order and navigation at ${width}px`, async ({page}) => {
    await page.setViewportSize({width, height:900})
    await page.addInitScript(()=>sessionStorage.setItem('architecture-hub:access-token:session','browser-ci-development-token'))
    const items=publicDemoResponse('/api/infra') as {id:string}[]
    const base=(publicDemoResponse('/api/flows') as {id:string}[])[0]
    const flows=[
      {...base,id:'exchange-A',name:'А. Отправка',source_id:items[0].id,target_id:items[2].id},
      {...base,id:'exchange-B',name:'Б. Обратно',source_id:items[2].id,target_id:items[0].id},
      {...base,id:'exchange-C',name:'В. Запись',source_id:items[0].id,target_id:items[1].id},
    ]
    await page.route('**/api/**', route=>{
      const path=new URL(route.request().url()).pathname
      if(path==='/api/auth/me')return route.fulfill({json:{role:'admin',auth_kind:'development'}})
      return route.fulfill({json:path==='/api/flows'?flows:publicDemoResponse(path)})
    })
    const system=(publicDemoResponse('/api/objects') as {id:string}[])[0].id
    await page.goto('/flows?system='+system)
    await page.getByRole('navigation',{name:'Представления потоков'}).getByRole('button',{name:'Карта',exact:true}).click()
    const picker=page.getByLabel('Система потоков',{exact:true})
    await expect(picker).toHaveValue(system)
    await page.reload()
    await expect(picker).toHaveValue(system)
    await page.getByRole('button',{name:'Реестр потоков',exact:true}).click()
    await expect(page.getByLabel('Система потоков',{exact:true})).toHaveValue(system)
    await page.goBack()
    await expect(picker).toHaveValue(system)
    await picker.selectOption('')
    await expect(page.getByRole('navigation',{name:'Представления потоков'}).getByRole('button',{name:'Карта',exact:true})).toHaveAttribute('aria-pressed','true')
    await page.getByRole('button',{name:'Последовательность'}).click()
    const diagram=page.getByRole('region',{name:'Диаграмма последовательности'})
    const steps=diagram.getByRole('listitem')
    await expect(steps).toHaveCount(3)
    await expect(diagram.locator('.sequenceHead strong')).toHaveCount(2)
    await expect(steps.nth(1).locator('.backwards')).toHaveCount(1)
    await expect(steps.nth(2).locator('.self')).toHaveCount(1)
    await expect(page.locator('.homeMapGraph')).toHaveCount(0)
    await expect(diagram.getByRole('link').first()).toHaveAttribute('href','/flows?flow=exchange-A')
    await diagram.getByRole('button',{name:'Настроить шаги'}).click()
    await steps.nth(1).getByRole('checkbox',{name:'Ответ'}).check()
    await steps.nth(1).getByRole('button',{name:'Поднять шаг Б. Обратно'}).click()
    await page.reload()
    await expect(steps.first()).toContainText('1. Б. Обратно')
    await expect(steps.first().locator('.reply.backwards')).toHaveCount(1)
    await page.getByRole('button',{name:'Карта',exact:true}).click()
    await expect(page.locator('.homeMapGraph')).toBeVisible()
    await page.goBack()
    await expect(steps.first()).toContainText('Б. Обратно')
    expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width+2)
    await page.getByRole('textbox',{name:'Поиск на карте'}).fill('несуществующий участник')
    await expect(page.getByText('Для выбранных систем нет зарегистрированных потоков.')).toBeVisible()
    await page.goto('/components')
    await page.getByRole('group',{name:'Представление компонентов'}).getByRole('button',{name:'Схема'}).click()
    await expect(page.getByText('Выберите ИС для просмотра её компонентов.',{exact:false})).toBeVisible()
    await expect(page.locator('.react-flow')).toHaveCount(0)
  })
}
