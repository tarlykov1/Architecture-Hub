import {test,expect} from '@playwright/test'

test('password form exchanges a password for a server session and persists only the session',async({page})=>{
 const entered='only-an-e2e-test-password'
 let submissions=0
 await page.route('**/api/auth/login',async route=>{
  const request=route.request()
  const payload=request.postDataJSON() as {password:string}
  expect(payload.password).toBe(entered)
  expect(request.url()).not.toContain(entered)
  submissions++
  await route.fulfill({status:200,contentType:'application/json',
   headers:{'Cache-Control':'no-store'},
   body:JSON.stringify({access_token:'browser-ci-development-token',token_type:'bearer',expires_in:28800})})
 })
 await page.goto('/')
 await page.getByRole('button',{name:'Войти для редактирования'}).click()
 const dialog=page.getByRole('dialog',{name:'Вход в Architecture Hub'})
 await expect(dialog.getByRole('heading',{name:'Вход по паролю'})).toBeVisible()
 const input=dialog.getByLabel('Пароль',{exact:true})
 await expect(input).toHaveAttribute('type','password')
 await input.fill(entered)
 await dialog.getByRole('button',{name:'Войти',exact:true}).click()
 await expect(page.getByRole('button',{name:'Выйти'})).toBeVisible()
 expect(submissions).toBe(1)
 expect(await page.evaluate(()=>sessionStorage.getItem('architecture-hub:access-token:session'))).toBe('browser-ci-development-token')
 expect(await page.evaluate((value)=>JSON.stringify(sessionStorage).includes(value),entered)).toBe(false)
 await page.reload()
 await expect(page.getByRole('button',{name:'Выйти'})).toBeVisible()
})

test('wrong password reports error inside dialog and does not leave a session',async({page})=>{
 await page.route('**/api/auth/login',async route=>{
  await route.fulfill({status:401,contentType:'application/json',body:'{"detail":"Authentication required"}'})
 })
 await page.goto('/')
 await page.getByRole('button',{name:'Войти для редактирования'}).click()
 const dialog=page.getByRole('dialog',{name:'Вход в Architecture Hub'})
 await dialog.getByLabel('Пароль',{exact:true}).fill('wrong-password')
 await dialog.getByRole('button',{name:'Войти',exact:true}).click()
 await expect(dialog.getByRole('alert')).toContainText('Неверный логин или пароль')
 await expect(page.getByRole('button',{name:'Выйти'})).toHaveCount(0)
 expect(await page.evaluate(()=>sessionStorage.getItem('architecture-hub:access-token:session'))).toBeNull()
})

test('legacy service key remains possible for administrators during migration',async({page})=>{
 await page.goto('/')
 await page.getByRole('button',{name:'Войти для редактирования'}).click()
 const dialog=page.getByRole('dialog',{name:'Вход в Architecture Hub'})
 await dialog.getByRole('button',{name:'Служебный вход по ключу'}).click()
 await expect(dialog.getByRole('heading',{name:'Служебный вход'})).toBeVisible()
 await dialog.getByLabel('Технический ключ',{exact:true}).fill('browser-ci-development-token')
 await dialog.getByRole('button',{name:'Войти',exact:true}).click()
 await expect(page.getByRole('button',{name:'Выйти'})).toBeVisible()
})
