import React, {useEffect,useMemo,useState} from 'react'
import './systemTechStack.css'

type Category='language'|'framework'|'runtime'|'database'|'middleware'|'platform'|'os'|'integration'|'tool'|'other'
type Env='prod'|'test'|'dev'|'stage'|'other'|'unknown'
type State='current'|'planned'|'retired'|'unknown'
type Verification='verified'|'unverified'|'assumed'
type Component={id:string;system_id:string;name:string}
type Technology={id:string;system_id:string;component_id:string|null;name:string;category:Category;version:string;environment:Env;vendor:string;lifecycle:State;support_end_date:string|null;verification:Verification;source:string;notes:string}
type Draft=Omit<Technology,'id'|'system_id'|'component_id'|'support_end_date'> & {component_id:string;support_end_date:string}
type Observation={id:string;technology_id:string;source_id:string;observed_at:string;observed_version:string;reachable:boolean|null;notes:string}
type Source={id:string;name:string;kind:string;enabled:boolean;base_url:string}
type Link={source_id:string;target_type:string;target_id:string;relation_kind:string;dashboard_url:string;external_ref:string}
const categories:Record<Category,string>={language:'Языки',framework:'Фреймворки',runtime:'Среды выполнения',database:'СУБД',middleware:'Middleware',platform:'Платформы',os:'Операционные системы',integration:'Интеграции',tool:'Инструменты',other:'Прочее'}
const environments:Record<Env,string>={prod:'PROD',test:'TEST',dev:'DEV',stage:'STAGE',other:'Другое',unknown:'Не указан'}
const lifecycle:Record<State,string>={current:'Используется',planned:'Планируется',retired:'Выведено',unknown:'Неизвестно'}
const verification:Record<Verification,string>={verified:'Подтверждено',assumed:'Предположение',unverified:'Не проверено'}
const blank=():Draft=>({name:'',category:'other',version:'',environment:'unknown',component_id:'',vendor:'',lifecycle:'unknown',support_end_date:'',verification:'unverified',source:'',notes:''})
const readableDate=(value:string|null|undefined)=>value?value.slice(0,10).split('-').reverse().join('.'):'Не указана'
const safeHttp=(url:string)=>{try{const parsed=new URL(url);return (parsed.protocol==='https:'||parsed.protocol==='http:')&&!parsed.username&&!parsed.password?url:''}catch{return ''}}
const observationAge=(value:string)=>{const age=(Date.now()-Date.parse(value))/86400000;return !Number.isFinite(age)?'Дата неизвестна':age>7?'Устаревшая проверка (более 7 дней)':'Данные актуальны (до 7 дней)'}

export default function SystemTechStack({systemId,components,readOnly,request}:{
 systemId:string;components:Component[];readOnly:boolean;request:<T>(url:string,init?:RequestInit)=>Promise<T>
}){
 const base='/api/systems/'+systemId
 const [rows,setRows]=useState<Technology[]>([])
 const [observations,setObservations]=useState<Observation[]>([])
 const [sources,setSources]=useState<Source[]>([])
 const [links,setLinks]=useState<Link[]>([])
 const [loading,setLoading]=useState(true)
 const [busy,setBusy]=useState(false)
 const [error,setError]=useState('')
 const [notice,setNotice]=useState('')
 const [editingId,setEditingId]=useState('')
 const [editorOpen,setEditorOpen]=useState(false)
 const [draft,setDraft]=useState<Draft>(blank)
 const localComponents=useMemo(()=>components.filter(item=>item.system_id===systemId),[components,systemId])
 const componentMap=useMemo(()=>new Map(localComponents.map(item=>[item.id,item.name])),[localComponents])
 const load=async()=>{
  const [technologies,checks,monitorSources,monitorLinks]=await Promise.all([
   request<Technology[]>(base+'/technologies'),request<Observation[]>(base+'/technology-observations'),
   request<Source[]>('/api/monitoring/sources'),request<Link[]>('/api/monitoring/links')
  ])
  setRows(technologies);setObservations(checks);setSources(monitorSources);setLinks(monitorLinks)
 }
 useEffect(()=>{
  let active=true
  setLoading(true);setError('');setNotice('');setEditorOpen(false);setEditingId('')
  Promise.all([
   request<Technology[]>(base+'/technologies'),request<Observation[]>(base+'/technology-observations'),
   request<Source[]>('/api/monitoring/sources'),request<Link[]>('/api/monitoring/links')
  ]).then(([technologies,checks,monitorSources,monitorLinks])=>{
   if(active){setRows(technologies);setObservations(checks);setSources(monitorSources);setLinks(monitorLinks)}
  }).catch(e=>{if(active)setError('Не удалось загрузить технологический стек: '+String(e))})
   .finally(()=>{if(active)setLoading(false)})
  return()=>{active=false}
 },[base,request])
 const open=(technology?:Technology)=>{
  setDraft(technology?{...technology,component_id:technology.component_id||'',support_end_date:technology.support_end_date||''}:blank())
  setEditingId(technology?.id||'');setError('');setNotice('');setEditorOpen(true)
 }
 const save=async(event:React.FormEvent)=>{
  event.preventDefault()
  if(!draft.name.trim()||busy)return
  setBusy(true);setError('')
  try{
   const payload={...draft,name:draft.name.trim(),version:draft.version.trim(),
    component_id:draft.component_id||null,support_end_date:draft.support_end_date||null}
   const saved=await request<Technology>(base+'/technologies'+(editingId?'/'+editingId:''),{
    method:editingId?'PUT':'POST',body:JSON.stringify(payload)
   })
   setEditingId(saved.id)
   await load()
   setEditorOpen(false);setEditingId('');setNotice('Запись о технологии сохранена')
  }catch(e){setError('Не удалось сохранить технологию: '+String(e))}
  finally{setBusy(false)}
 }
 const remove=async(item:Technology)=>{
  if(busy||!window.confirm('Удалить «'+item.name+'» из учёта технологий?'))return
  setBusy(true);setError('')
  try{
   await request(base+'/technologies/'+item.id,{method:'DELETE'})
   setRows(previous=>previous.filter(row=>row.id!==item.id))
   setObservations(previous=>previous.filter(obs=>obs.technology_id!==item.id))
   setNotice('Технология удалена из паспорта ИС')
  }catch(e){setError('Не удалось удалить запись: '+String(e))}
  finally{setBusy(false)}
 }
 const latestFor=(id:string)=>observations.filter(obs=>obs.technology_id===id)
  .sort((a,b)=>Date.parse(b.observed_at)-Date.parse(a.observed_at))[0]
 const monitorFor=(item:Technology)=>{
  const supported=links.filter(link=>link.relation_kind==='monitors'&&(
   (link.target_type==='system'&&link.target_id===systemId)||
   (link.target_type==='component'&&link.target_id===item.component_id)))
  return supported.map(link=>({link,source:sources.find(src=>src.id===link.source_id)}))
   .filter(entry=>entry.source?.enabled)
 }
 return <section className="systemTechStack" aria-label="Технологический стек ИС">
  <p className="systemTechStackHint">Указывайте технологии и версии по конкретным средам и компонентам. Для анализа уязвимостей важны фактическая версия, дата проверки и источник сведений. Отсутствие проверки не означает отсутствие уязвимостей.</p>
  {loading&&<p role="status">Загружаю стек…</p>}
  {error&&<p role="alert" className="systemTechStackError">{error}</p>}
  {notice&&<p role="status">{notice}</p>}
  {!loading&&<>
   <div className="systemTechStackHeader"><strong>Технологии ({rows.length})</strong>{!readOnly&&<button type="button" onClick={()=>open()}>+ Добавить технологию</button>}</div>
   {!rows.length&&<p className="systemTechStackHint">Стек пока не инвентаризирован. Добавьте версии языков, СУБД, фреймворков, ОС или платформ. Данные не заполняются догадками.</p>}
   {rows.map(item=>{
    const observation=latestFor(item.id)
    const monitors=monitorFor(item)
    const discrepancy=Boolean(observation?.observed_version&&item.version&&observation.observed_version!==item.version)
    return <article key={item.id} className="systemTechStackCard">
     <strong>{item.name}{item.version?' · '+item.version:' · версия неизвестна'}</strong>
     <small>{categories[item.category]} · {environments[item.environment]} · {lifecycle[item.lifecycle]}</small>
     <small>{item.component_id?'Компонент: '+(componentMap.get(item.component_id)||'Не найден'):'Вся ИС'} · {verification[item.verification]}</small>
     {item.vendor&&<p>Производитель: {item.vendor}</p>}
     {item.support_end_date&&<p>Окончание поддержки: {readableDate(item.support_end_date)}</p>}
     {item.source&&<p>Источник заявленных сведений: {item.source}</p>}
     {item.notes&&<p>{item.notes}</p>}
     {observation?<div className="systemTechStackObservation">
       <strong>Последняя проверка: {readableDate(observation.observed_at)}</strong>
       <span>{observationAge(observation.observed_at)}</span>
       <span>Доступность: {observation.reachable==null?'Нет данных':observation.reachable?'Доступна по данным мониторинга':'Недоступна по данным мониторинга'}</span>
       <span>Обнаруженная версия: {observation.observed_version||'Нет данных'}</span>
       {discrepancy&&<strong className="systemTechStackWarning">Обнаруженная версия отличается от указанной в паспорте</strong>}
       {observation.notes&&<span>Комментарий: {observation.notes}</span>}
      </div>:<p className="systemTechStackHint">Фактическая версия и доступность пока не проверялись.</p>}
     {monitors.length?<div className="systemTechStackSources">
       <small>Разрешённые источники мониторинга:</small>
       {monitors.map(({link,source})=>{
        const url=safeHttp(link.dashboard_url||source?.base_url||'')
        return url?<a key={link.source_id} href={url} target="_blank" rel="noopener noreferrer">
         {source?.name||'Мониторинг'} · открыть проверку
        </a>:<small key={link.source_id}>{source?.name||'Мониторинг'} · нет адреса проверки</small>
       })}
      </div>:<p className="systemTechStackHint">Мониторинг этой ИС/компонента пока не связан. Пинг и определение версии автоматически не запускаются.</p>}
     {!readOnly&&<div className="systemTechStackActions"><button type="button" onClick={()=>open(item)}>Редактировать</button><button type="button" disabled={busy} onClick={()=>void remove(item)}>Удалить</button></div>}
    </article>
   })}
   {!readOnly&&editorOpen&&<form className="systemTechStackForm" aria-label="Редактор технологии ИС" onSubmit={save}>
    <h3>{editingId?'Изменить технологию':'Новая технология'}</h3>
    <label>Технология<input required maxLength={250} value={draft.name} placeholder="Например, PostgreSQL" onChange={e=>setDraft(prev=>({...prev,name:e.target.value}))}/></label>
    <label>Категория<select value={draft.category} onChange={e=>setDraft(prev=>({...prev,category:e.target.value as Category}))}>{Object.entries(categories).map(([id,name])=><option key={id} value={id}>{name}</option>)}</select></label>
    <label>Версия (если подтверждена)<input maxLength={120} value={draft.version} placeholder="Например, 16.4" onChange={e=>setDraft(prev=>({...prev,version:e.target.value}))}/></label>
    <label>Среда<select value={draft.environment} onChange={e=>setDraft(prev=>({...prev,environment:e.target.value as Env}))}>{Object.entries(environments).map(([id,name])=><option key={id} value={id}>{name}</option>)}</select></label>
    <label>Где установлено<select value={draft.component_id} onChange={e=>setDraft(prev=>({...prev,component_id:e.target.value}))}><option value="">ИС в целом / компонент не указан</option>{localComponents.map(comp=><option key={comp.id} value={comp.id}>{comp.name}</option>)}</select></label>
    <label>Производитель<input maxLength={250} value={draft.vendor} onChange={e=>setDraft(prev=>({...prev,vendor:e.target.value}))}/></label>
    <label>Состояние<select value={draft.lifecycle} onChange={e=>setDraft(prev=>({...prev,lifecycle:e.target.value as State}))}>{Object.entries(lifecycle).map(([id,name])=><option key={id} value={id}>{name}</option>)}</select></label>
    <label>Окончание поддержки версии<input type="date" value={draft.support_end_date} onChange={e=>setDraft(prev=>({...prev,support_end_date:e.target.value}))}/></label>
    <label>Достоверность<select value={draft.verification} onChange={e=>setDraft(prev=>({...prev,verification:e.target.value as Verification}))}>{Object.entries(verification).map(([id,name])=><option key={id} value={id}>{name}</option>)}</select></label>
    <label>Источник сведений<input maxLength={500} value={draft.source} placeholder="Например, инвентаризация, запрос к владельцу" onChange={e=>setDraft(prev=>({...prev,source:e.target.value}))}/></label>
    <label>Примечание<textarea maxLength={2000} value={draft.notes} onChange={e=>setDraft(prev=>({...prev,notes:e.target.value}))}/></label>
    <div className="systemTechStackActions"><button type="submit" disabled={busy}>{busy?'Сохранение…':'Сохранить технологию'}</button><button type="button" disabled={busy} onClick={()=>{setEditorOpen(false);setEditingId('');setError('')}}>Отмена</button></div>
   </form>}
   <p className="systemTechStackHint">Автоматическая проверка будет доступна только через отдельно авторизованный адаптер мониторинга. Текущие ссылки не дают права на сканирование сетевых адресов и не подтверждают наличие телеметрии.</p>
  </>}
 </section>
}
