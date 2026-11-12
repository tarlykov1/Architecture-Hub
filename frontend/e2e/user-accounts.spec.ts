import {test,expect} from '@playwright/test'

// The test server starts with ephemeral admin-only CI credentials.
test('administrator can open the individual-user management panel',async({page})=>{
 await page.addInitScript(()=>{
  sessionStorage.setItem('architecture-hub:access-token:session','browser-ci-development-token')
 })
 await page.goto('/')
 await page.getByRole('button',{name:'Пользователи'}).click()
 const dialog=page.getByRole('dialog',{name:'Управление пользователями'})
 await expect(dialog).toBeVisible()
 await expect(dialog.getByRole('heading',{name:'Добавить пользователя'})).toBeVisible()
 await expect(dialog.getByLabel('Начальный пароль')).toHaveAttribute('type','password')
 await dialog.getByRole('button',{name:'Закрыть управление пользователями'}).click()
 await expect(dialog).toHaveCount(0)
})

test('new login dialog offers optional username and preserves legacy password path',async({page})=>{
 await page.goto('/')
 await page.getByRole('button',{name:'Войти для редактирования'}).click()
 const dialog=page.getByRole('dialog',{name:'Вход в Architecture Hub'})
 await expect(dialog.getByLabel('Логин (для персонального доступа)')).toBeVisible()
 await expect(dialog.getByLabel('Пароль',{exact:true})).toHaveAttribute('type','password')
 await expect(dialog.getByText('Для прежнего общего пароля оставьте логин пустым.')).toBeVisible()
})
