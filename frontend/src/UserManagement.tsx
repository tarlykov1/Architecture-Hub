import React,{useEffect,useState} from 'react'

export type AccountRole='admin'|'architect'|'engineer'|'security'|'business_owner'|'viewer'
export type AuthProfile={id:string|null;username:string|null;display_name:string|null;role:AccountRole;auth_kind:string;permissions?:Record<string,'read'|'write'>}
type AuthAccount={id:string;username:string;display_name:string;role:AccountRole;enabled:boolean;created_at:string|null}
type Api=<T>(url:string,init?:RequestInit)=>Promise<T>
const options:{value:AccountRole;label:string}[]=[
 {value:'admin',label:'Администратор'},
 {value:'architect',label:'Архитектор'},
 {value:'engineer',label:'Инженер'},
 {value:'security',label:'ИБ'},
 {value:'business_owner',label:'Владелец процесса'},
 {value:'viewer',label:'Наблюдатель'},
]
export const roleLabel=(role:string)=>options.find(item=>item.value===role)?.label||role

function AccountRow({account,request,onUpdated}:{account:AuthAccount;request:Api;onUpdated:()=>Promise<void>}){
 const [role,setRole]=useState<AccountRole>(account.role)
 const [display,setDisplay]=useState(account.display_name)
 const [enabled,setEnabled]=useState(account.enabled)
 const [nextPassword,setNextPassword]=useState('')
 const [busy,setBusy]=useState(false)
 const [error,setError]=useState('')
 const [notice,setNotice]=useState('')
 const save=async()=>{
  setBusy(true);setError('');setNotice('')
  try{
   await request('/api/auth/users/'+account.id,{method:'PATCH',body:JSON.stringify({role,display_name:display,enabled})})
   setNotice('Сохранено. Старые сессии прекращены при смене роли или блокировке.')
   await onUpdated()
  }catch(err){setError((err as Error).message)}finally{setBusy(false)}
 }
 const reset=async()=>{
  if(nextPassword.length<12){setError('Новый пароль должен содержать минимум 12 символов.');return}
  setBusy(true);setError('');setNotice('')
  try{
   await request('/api/auth/users/'+account.id+'/reset-password',{method:'POST',body:JSON.stringify({password:nextPassword})})
   setNextPassword('');setNotice('Пароль заменён. Предыдущие сессии пользователя отозваны.')
  }catch(err){setError((err as Error).message)}finally{setBusy(false)}
 }
 return <article className="accountRow">
  <div className="accountRowIdentity"><strong>{account.username}</strong><small>{account.enabled?'Активен':'Заблокирован'}</small></div>
  <div className="accountRowFields">
   <label>Отображаемое имя<input value={display} maxLength={120} onChange={e=>setDisplay(e.target.value)}/></label>
   <label>Роль<select value={role} onChange={e=>setRole(e.target.value as AccountRole)}>{options.map(o=><option key={o.value} value={o.value}>{o.label}</option>)}</select></label>
   <label className="accountCheckbox"><input type="checkbox" checked={enabled} onChange={e=>setEnabled(e.target.checked)}/> Активен</label>
   <button disabled={busy||role===account.role&&display===account.display_name&&enabled===account.enabled} onClick={()=>void save()}>Сохранить изменения</button>
  </div>
  <div className="accountPasswordReset"><label>Новый пароль пользователю<input type="password" autoComplete="new-password" minLength={12} value={nextPassword} onChange={e=>setNextPassword(e.target.value)} placeholder="Не менее 12 символов"/></label><button type="button" disabled={busy||nextPassword.length<12} onClick={()=>void reset()}>Сбросить пароль</button></div>
  {notice&&<p role="status" className="accountSuccess">{notice}</p>}
  {error&&<p role="alert" className="accountError">{error}</p>}
 </article>
}

export default function UserManagement({request,onClose}:{request:Api;onClose:()=>void}){
 const [accounts,setAccounts]=useState<AuthAccount[]>([])
 const [loading,setLoading]=useState(true)
 const [username,setUsername]=useState('')
 const [displayName,setDisplayName]=useState('')
 const [password,setPassword]=useState('')
 const [role,setRole]=useState<AccountRole>('viewer')
 const [busy,setBusy]=useState(false)
 const [error,setError]=useState('')
 const [notice,setNotice]=useState('')
 const reload=async()=>setAccounts(await request<AuthAccount[]>('/api/auth/users'))
 useEffect(()=>{let alive=true;request<AuthAccount[]>('/api/auth/users')
  .then(users=>{if(alive)setAccounts(users)}).catch(err=>{if(alive)setError((err as Error).message)})
  .finally(()=>{if(alive)setLoading(false)})
  return()=>{alive=false}
 },[request])
 const create=async(event:React.FormEvent)=>{
  event.preventDefault()
  setError('');setNotice('');setBusy(true)
  try{
   await request('/api/auth/users',{method:'POST',body:JSON.stringify({username,display_name:displayName,password,role})})
   setUsername('');setDisplayName('');setPassword('');setRole('viewer')
   await reload();setNotice('Пользователь создан. Передайте логин и временный пароль отдельно через защищённый канал.')
  }catch(err){setError((err as Error).message)}finally{setBusy(false)}
 }
 return <div className="editorBackdrop accountBackdrop">
  <section className="accountDialog" role="dialog" aria-modal="true" aria-label="Управление пользователями">
   <header><div><h2>Пользователи Architecture Hub</h2><p>У каждого сотрудника свой пароль и роль. Изменения прав применяются на сервере.</p></div><button type="button" onClick={onClose} aria-label="Закрыть управление пользователями">×</button></header>
   <form className="accountCreateForm" onSubmit={event=>void create(event)}>
    <h3>Добавить пользователя</h3>
    <div className="accountFormGrid">
     <label>Логин<input required pattern="[a-z][a-z0-9._-]{2,63}" minLength={3} maxLength={64} value={username} onChange={e=>setUsername(e.target.value.toLowerCase())} autoComplete="off" placeholder="ivan.petrov"/></label>
     <label>Имя сотрудника<input maxLength={120} value={displayName} onChange={e=>setDisplayName(e.target.value)} placeholder="Иван Петров"/></label>
     <label>Роль<select value={role} onChange={e=>setRole(e.target.value as AccountRole)}>{options.map(o=><option key={o.value} value={o.value}>{o.label}</option>)}</select></label>
     <label>Начальный пароль<input type="password" required minLength={12} maxLength={256} autoComplete="new-password" value={password} onChange={e=>setPassword(e.target.value)}/></label>
    </div>
    <button className="primary" type="submit" disabled={busy}>{busy?'Создание…':'Создать пользователя'}</button>
   </form>
   {notice&&<p className="accountSuccess" role="status">{notice}</p>}
   {error&&<p className="accountError" role="alert">{error}</p>}
   <section className="accountList" aria-label="Список пользователей">
    <h3>Учётные записи ({accounts.length})</h3>
    {loading?<p>Загружаем пользователей…</p>:accounts.length?accounts.map(account=><AccountRow key={account.id} account={account} request={request} onUpdated={reload}/>):<p>Пока нет отдельных пользователей. Создайте первую запись.</p>}
   </section>
  </section>
 </div>
}

export function ChangePasswordDialog({request,onClose,onChanged}:{request:Api;onClose:()=>void;onChanged:()=>void}){
 const [current,setCurrent]=useState('')
 const [next,setNext]=useState('')
 const [repeat,setRepeat]=useState('')
 const [busy,setBusy]=useState(false)
 const [error,setError]=useState('')
 const submit=async(event:React.FormEvent)=>{
  event.preventDefault()
  if(next!==repeat){setError('Пароли не совпадают.');return}
  setBusy(true);setError('')
  try{
   await request('/api/auth/change-password',{method:'POST',body:JSON.stringify({current_password:current,new_password:next})})
   onChanged()
  }catch(err){setError((err as Error).message)}finally{setBusy(false)}
 }
 return <div className="editorBackdrop"><section className="editorDialog" role="dialog" aria-modal="true" aria-label="Смена личного пароля">
  <div className="dialogHead"><h2>Сменить пароль</h2><button type="button" aria-label="Закрыть смену пароля" onClick={onClose}>×</button></div>
  <p>После смены пароля все предыдущие сеансы этой учётной записи будут завершены.</p>
  <form className="detailForm" onSubmit={event=>void submit(event)}>
   <label>Текущий пароль<input type="password" required autoComplete="current-password" value={current} onChange={e=>setCurrent(e.target.value)}/></label>
   <label>Новый пароль<input type="password" required minLength={12} autoComplete="new-password" value={next} onChange={e=>setNext(e.target.value)}/></label>
   <label>Повтор нового пароля<input type="password" required minLength={12} autoComplete="new-password" value={repeat} onChange={e=>setRepeat(e.target.value)}/></label>
   {error&&<p role="alert" className="accountError">{error}</p>}
   <button className="primary" type="submit" disabled={busy||next.length<12}>{busy?'Сохранение…':'Сменить пароль'}</button>
  </form>
 </section></div>
}
