import {expect,test} from '@playwright/test'

test.describe.configure({retries:0})

test('AH-QA-09: journal defaults to this IS and full history is explicit',async({page})=>{
  await page.addInitScript(()=>sessionStorage.setItem('architecture-hub:access-token:session','browser-ci-development-token'))
  const api='http://127.0.0.1:8001'
  const create=async(path:string,data:Record<string,unknown>)=>{
    const response=await page.request.post(api+path,{data})
    expect(response.status(),await response.text()).toBe(201)
    return (await response.json()).id as string
  }
  const suffix=String(Date.now())
  const first=await create('/api/objects',{kind:'system',name:'QA-WORK-HISTORY-A-'+suffix})
  const second=await create('/api/objects',{kind:'system',name:'QA-WORK-HISTORY-B-'+suffix})
  await create('/api/infra',{system_id:first,kind:'vm',name:'QA-WORK-A-existing'})
  await create('/api/infra',{system_id:second,kind:'vm',name:'QA-WORK-B-existing'})
  async function audit(system_id:string,label:string) {
    const response=await page.request.post(api+'/api/board/commit',{data:{
      reason:'QA-WORK-'+label+'-'+suffix,changes:[{
        action:'create_vm',id:crypto.randomUUID(),system_id,kind:'vm',name:'QA-WORK-VM-'+label,
      }],
    }})
    expect(response.status(),await response.text()).toBe(200)
  }
  await audit(first,'alpha')
  await audit(second,'beta')

  await page.goto('/components?system='+first)
  await page.getByRole('group',{name:'Представление компонентов'}).getByRole('button',{name:'Схема'}).click()
  await page.getByRole('button',{name:'Редактировать схему',exact:true}).click()
  const board=page.getByRole('region',{name:'Редактор архитектурной схемы'})
  await board.getByRole('button',{name:'История изменений'}).click()
  const dialog=page.getByRole('dialog',{name:'Журнал изменений архитектуры'})
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole('button',{name:'Текущая ИС'})).toHaveAttribute('aria-pressed','true')
  await expect(dialog).toContainText('QA-WORK-alpha-'+suffix)
  await expect(dialog).not.toContainText('QA-WORK-beta-'+suffix)

  await dialog.getByRole('button',{name:'Весь журнал'}).click()
  await expect(dialog.getByRole('button',{name:'Весь журнал'})).toHaveAttribute('aria-pressed','true')
  await expect(dialog).toContainText('QA-WORK-beta-'+suffix)
  await dialog.getByRole('button',{name:'Текущая ИС'}).click()
  await expect(dialog).not.toContainText('QA-WORK-beta-'+suffix)
  await expect(dialog).toContainText('QA-WORK-alpha-'+suffix)
})
