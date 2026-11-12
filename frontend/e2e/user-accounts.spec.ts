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


test('viewer signs in by individual username without needing access to infrastructure',async({page})=>{
 const username='qa'+Date.now().toString(36)
 const created=await page.request.post('http://127.0.0.1:8001/api/auth/users',{
  headers:{Authorization:'Bearer ci-admin-token-123456789012345678901234'},
  data:{username,display_name:'QA Viewer',password:'qa-named-user-password-12345',role:'viewer'}
 })
 expect(created.status()).toBe(201)
 await page.goto('/')
 await page.getByRole('button',{name:'Войти для редактирования'}).click()
 const login=page.getByRole('dialog',{name:'Вход в Architecture Hub'})
 await login.getByLabel('Логин (для персонального доступа)').fill(username)
 await login.getByLabel('Пароль',{exact:true}).fill('qa-named-user-password-12345')
 await login.getByRole('button',{name:'Войти',exact:true}).click()
 await expect(page.getByRole('button',{name:'Выйти'})).toBeVisible()
 await expect(page.getByText('QA Viewer · Наблюдатель')).toBeVisible()
 await expect(page.getByRole('button',{name:'Пользователи'})).toHaveCount(0)
 await page.reload()
 await expect(page.getByText('QA Viewer · Наблюдатель')).toBeVisible()
})
