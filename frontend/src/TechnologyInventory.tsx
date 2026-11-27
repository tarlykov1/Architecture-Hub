import React, {useCallback,useEffect,useState} from 'react'
import './technologyInventory.css'

type RecordItem={
 id:string;system_id:string;system_name:string;component_id:string|null;component_name:string
 name:string;category:string;version:string;environment:string;lifecycle:string;verification:string
 support_end_date:string|null;out_of_support:boolean;observed_version:string;reachable:boolean|null
 observed_at:string|null;observation_source:string;version_mismatch:boolean
}
type Response={count:number;items:RecordItem[]}
const categoryLabels:Record<string,string>={language:'Язык',framework:'Фреймворк',runtime:'Runtime',database:'СУБД',middleware:'Middleware',platform:'Платформа',os:'ОС',integration:'Интеграция',tool:'Инструмент',other:'Прочее'}
const envLabels:Record<string,string>={prod:'PROD',test:'TEST',dev:'DEV',stage:'STAGE',other:'Другое',unknown:'Не указана'}
const shortDate=(v:string|null)=>v?v.slice(0,10).split('-').reverse().join('.'):'—'
const stale=(v:string|null)=>v?Date.now()-Date.parse(v)>7*86400000:true

export default function TechnologyInventory({request,onOpenSystem}:{
 request:<T>(url:string,init?:RequestInit)=>Promise<T>
 onOpenSystem:(id:string)=>void
}){
 const [query,setQuery]=useState('')
 const [env,setEnv]=useState('')
 const [category,setCategory]=useState('')
 const [result,setResult]=useState<Response>({count:0,items:[]})
 const [busy,setBusy]=useState(false)
 const [error,setError]=useState('')
 const search=useCallback(async(q:string,e:string,c:string)=>{
  setBusy(true);setError('')
  try{
   const params=new URLSearchParams()
   if(q.trim())params.set('q',q.trim())
   if(e)params.set('environment',e)
   if(c)params.set('category',c)
   const rows=await request<Response>('/api/technology-inventory'+(params.size?'?'+params.toString():''))
   setResult(rows)
  }catch(err){setError('Не удалось получить реестр технологий: '+String(err))}
  finally{setBusy(false)}
 },[request])
 useEffect(()=>{void search('','','')},[search])
 return <section className="technologyInventory" aria-label="Реестр технологий всех ИС">
  <header><h3>Технологии и версии всех ИС</h3><p>Поиск установленных технологий для анализа уязвимостей. Версия в паспорте и версия, полученная от мониторинга, показываются отдельно. Это не сканер уязвимостей.</p></header>
  <form onSubmit={e=>{e.preventDefault();void search(query,env,category)}} className="technologyInventoryFilters">
   <label>Технология, версия или ИС<input aria-label="Поиск технологии и версии" value={query} placeholder="PostgreSQL, Python 3.11, Windows…" onChange={e=>setQuery(e.target.value)}/></label>
   <label>Среда<select aria-label="Среда инвентаризации" value={env} onChange={e=>setEnv(e.target.value)}><option value="">Все среды</option>{Object.entries(envLabels).map(([key,value])=><option key={key} value={key}>{value}</option>)}</select></label>
   <label>Категория<select aria-label="Категория технологии" value={category} onChange={e=>setCategory(e.target.value)}><option value="">Все категории</option>{Object.entries(categoryLabels).map(([key,value])=><option key={key} value={key}>{value}</option>)}</select></label>
   <button type="submit" disabled={busy}>{busy?'Поиск…':'Найти'}</button>
   <button type="button" onClick={()=>{setQuery('');setEnv('');setCategory('');void search('','','')}}>Сбросить</button>
  </form>
  {error&&<p role="alert">{error}</p>}
  <p role="status">Найдено записей: {result.count}</p>
  <div className="technologyInventoryScroll"><table>
   <thead><tr><th>Технология</th><th>Версия в паспорте</th><th>Где установлена</th><th>Среда</th><th>Мониторинг</th><th>Поддержка</th></tr></thead>
   <tbody>{result.items.map(item=><tr key={item.id}>
    <td><button className="entityName" title="Открыть технологический стек ИС" onClick={()=>onOpenSystem(item.system_id)}>{item.name}</button><small>{categoryLabels[item.category]||item.category}</small></td>
    <td>{item.version||'Не указана'}{item.version_mismatch&&<strong className="technologyInventoryWarning">Версии различаются</strong>}</td>
    <td><button type="button" onClick={()=>onOpenSystem(item.system_id)}>{item.system_name||'Неизвестная ИС'}</button><small>{item.component_name||'ИС в целом'}</small></td>
    <td>{envLabels[item.environment]||item.environment}<small>{item.verification==='verified'?'Подтверждено':item.verification==='assumed'?'Предположение':'Не проверено'}</small></td>
    <td>{item.observed_at?<><span>{item.reachable===null?'Доступность неизвестна':item.reachable?'Доступна':'Недоступна'}</span><small>Версия: {item.observed_version||'Нет данных'}</small><small>{shortDate(item.observed_at)} · {item.observation_source||'Источник не указан'}{stale(item.observed_at)?' · Устаревшая проверка':''}</small></>:<span>Нет проверки</span>}</td>
    <td>{item.out_of_support?<strong className="technologyInventoryWarning">Поддержка закончилась</strong>:item.support_end_date?shortDate(item.support_end_date):'Не указано'}</td>
   </tr>)}</tbody>
  </table></div>
  {!result.count&&!busy&&<p>В реестре нет совпадающих технологий. Можно добавить их через паспорт соответствующей ИС.</p>}
 </section>
}
