import {test,expect} from '@playwright/test'

// The test server starts with ephemeral admin-only CI credentials.
test('administrator can open the individual-user management panel',async({page})=>{
 await page.route('**/api/auth/me',async route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({id:null,username:null,display_name:null,role:'admin',auth_kind:'service_key'})}))
 await page.route('**/api/auth/users',async route=>route.fulfill({status:200,contentType:'application/json',body:'[]'}))
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


test('viewer signs in and the interface handles forbidden collections gracefully',async({page})=>{
 const username='qa-viewer'
 await page.route('**/api/auth/login',async route=>{
  const supplied=route.request().postDataJSON() as {username:string;password:string}
  expect(supplied.username).toBe(username)
  await route.fulfill({status:200,contentType:'application/json',
   body:JSON.stringify({access_token:'mock-individual-session',token_type:'bearer',expires_in:28800})})
 })
 await page.route('**/api/auth/me',async route=>route.fulfill({
  status:200,contentType:'application/json',
  body:JSON.stringify({id:'123e4567-e89b-42d3-a456-426614174000',username,display_name:'QA Viewer',role:'viewer',auth_kind:'named_user'})
 }))
 for(const path of ['/api/infra','/api/flows','/api/networks','/api/network-interfaces']){
  await page.route('**'+path,async route=>route.fulfill({
   status:403,contentType:'application/json',body:'{"detail":"Insufficient permissions"}'
  }))
 }
 await page.goto('/')
 await page.getByRole('button',{name:'Войти для редактирования'}).click()
 const login=page.getByRole('dialog',{name:'Вход в Architecture Hub'})
 await login.getByLabel('Логин (для персонального доступа)').fill(username)
 await login.getByLabel('Пароль',{exact:true}).fill('only-a-test-password')
 await login.getByRole('button',{name:'Войти',exact:true}).click()
 await expect(page.getByRole('button',{name:'Выйти'})).toBeVisible()
 await expect(page.getByText('QA Viewer · Наблюдатель')).toBeVisible()
 await expect(page.getByRole('button',{name:'Пользователи'})).toHaveCount(0)
 await page.reload()
 await expect(page.getByText('QA Viewer · Наблюдатель')).toBeVisible()
})
