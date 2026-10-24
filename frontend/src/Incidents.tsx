import React, {useCallback,useEffect,useState} from 'react'
export type Incident = {id:string;title:string;description:string;status:string;severity:string;owner:string;assignee:string;resolution:string;links:{entity_type:string;entity_id:string}[];created_at:string;updated_at:string}
type Entity = {id:string;name:string;kind?:string}
type Props={request:<T>(url:string,init?:RequestInit)=>Promise<T>;systems:Entity[];components:(Entity&{system_id:string})[];networks:Entity[];flows:(Entity&{source_id:string;target_id:string})[];context?:{entity_type:string;entity_id:string}|null;onClose?:()=>void}
const fresh=()=>({title:'',description:'',status:'open',severity:'medium',owner:'',assignee:'',resolution:'',links:[] as {entity_type:string;entity_id:string}[]})
const statuses:{[key:string]:string}={open:'Открыт',investigating:'В работе',monitoring:'Наблюдение',resolved:'Решён',closed:'Закрыт'}
const levels:{[key:string]:string}={critical:'Критический',high:'Высокий',medium:'Средний',low:'Низкий'}
export default function Incidents({request,systems,components,networks,flows,context,onClose}:Props){
  const [items,setItems]=useState<Incident[]>([])
  const [current,setCurrent]=useState<Incident|null>(null)
  const [editing,setEditing]=useState(false)
  const [form,setForm]=useState(fresh())
  const [affected,setAffected]=useState<{name:string;entity_id:string}[]>([])
  const [error,setError]=useState('')
  const [busy,setBusy]=useState(false)
  const [search,setSearch]=useState('')
  const [filter,setFilter]=useState('all')
  const load=useCallback(()=>{request<Incident[]>('/api/incidents').then(setItems).catch(e=>setError(String(e)))},[request])
  useEffect(()=>{load()},[load])
  function open(item:Incident){setCurrent(item);setForm({...item,links:item.links});setEditing(false);setAffected([]);setError('');request<{potentially_affected:{name:string;entity_id:string}[]}>(`/api/incidents/${item.id}/impact`).then(r=>setAffected(r.potentially_affected)).catch(()=>setAffected([]))}
  function create(){setCurrent(null);setForm({...fresh(),links:context?[context]:[]});setEditing(true);setAffected([]);setError('')}
  async function save(e:React.FormEvent){e.preventDefault();setBusy(true);setError('');try{const saved=await request<Incident>(current?`/api/incidents/${current.id}`:'/api/incidents',{method:current?'PUT':'POST',body:JSON.stringify(form)});await request<Incident[]>('/api/incidents').then(setItems);open(saved)}catch(e){setError(String(e))}finally{setBusy(false)}}
  function name(type:string,id:string){return ({system:systems,component:components,network:networks,flow:flows} as Record<string,Entity[]>)[type]?.find(e=>e.id===id)?.name||id.slice(0,8)}
  const all=[...systems.map(s=>({...s,entity_type:'system'})),...components.map(s=>({...s,entity_type:'component'})),...networks.map(s=>({...s,entity_type:'network'})),...flows.map(s=>({...s,entity_type:'flow'}))]
  const selected=items.filter(x=>(!context||x.links.some(l=>l.entity_type===context.entity_type&&l.entity_id===context.entity_id))&&(filter==='all'||x.status===filter)&&[x.title,x.description,x.owner,x.assignee].join(' ').toLowerCase().includes(search.toLowerCase()))
  return <section className="incidentWorkspace">
    <div className="registryHeader"><div><h2>{context?'Инциденты объекта':'Реестр инцидентов'}</h2><p className="hint">{context?'Зарегистрированные инциденты, непосредственно связанные с объектом':'Общая картина для совещаний и анализа проблем'}</p></div><div className="incidentActions"><button onClick={load}>Обновить</button><button className="primary" onClick={create}>+ Инцидент</button>{onClose&&<button onClick={onClose}>Закрыть</button>}</div></div>
    {!context&&<div className="incidentStats">{['open','investigating','monitoring','resolved','closed'].map(s=><div key={s}><strong>{items.filter(x=>x.status===s).length}</strong><span>{statuses[s]}</span></div>)}</div>}
    <div className="incidentFilters"><input aria-label="Поиск инцидентов" placeholder="Поиск по инцидентам" value={search} onChange={e=>setSearch(e.target.value)}/><select aria-label="Фильтр статуса" value={filter} onChange={e=>setFilter(e.target.value)}><option value="all">Все статусы</option>{Object.entries(statuses).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></div>
    <div className="incidentTable">{selected.map(item=><button className={'incidentRow '+(current?.id===item.id?'incidentActive':'')} key={item.id} onClick={()=>open(item)}><span className={'incidentSeverity severity-'+item.severity}>{levels[item.severity]||item.severity}</span><span><strong>{item.title}</strong><small>{item.links.map(l=>name(l.entity_type,l.entity_id)).join(' · ')||'Нет привязанных объектов'}</small></span><span>{statuses[item.status]||item.status}</span><small>{new Date(item.updated_at).toLocaleDateString('ru-RU')}</small></button>)}</div>
    {!selected.length&&<p className="hint">Нет инцидентов по выбранному фильтру.</p>}
    {(editing||current)&&<div className="incidentDetail">
      <div className="registryHeader"><h3>{editing?(current?'Изменить инцидент':'Новый инцидент'):current?.title}</h3><div className="incidentActions">{current&&!editing&&<button onClick={()=>setEditing(true)}>Редактировать</button>}<button onClick={()=>{setCurrent(null);setEditing(false)}}>Закрыть ×</button></div></div>
      {editing?<form className="incidentForm" onSubmit={save}>
        <label>Название<input required minLength={2} value={form.title} onChange={e=>setForm({...form,title:e.target.value})}/></label>
        <label>Описание<textarea rows={4} value={form.description} onChange={e=>setForm({...form,description:e.target.value})}/></label>
        <div className="formPair"><label>Статус<select value={form.status} onChange={e=>setForm({...form,status:e.target.value})}>{Object.entries(statuses).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></label><label>Критичность<select value={form.severity} onChange={e=>setForm({...form,severity:e.target.value})}>{Object.entries(levels).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></label></div>
        <div className="formPair"><label>Владелец<input value={form.owner} onChange={e=>setForm({...form,owner:e.target.value})}/></label><label>Ответственный<input value={form.assignee} onChange={e=>setForm({...form,assignee:e.target.value})}/></label></div>
        <label>Решение / результат<textarea value={form.resolution} onChange={e=>setForm({...form,resolution:e.target.value})}/></label>
        <label>Связанные объекты <small>(можно отметить несколько)</small><select aria-label="Добавить связанную сущность" value="" onChange={e=>{const [entity_type,entity_id]=e.target.value.split('|');if(entity_type&&!form.links.some(l=>l.entity_type===entity_type&&l.entity_id===entity_id))setForm({...form,links:[...form.links,{entity_type,entity_id}]})}}><option value="">+ Добавить объект</option>{all.map(o=><option key={o.entity_type+o.id} value={o.entity_type+'|'+o.id}>{o.entity_type}: {o.name}</option>)}</select></label>
        <div className="incidentChips">{form.links.map(l=><button type="button" key={l.entity_type+l.entity_id} onClick={()=>setForm({...form,links:form.links.filter(x=>x!==l)})}>{name(l.entity_type,l.entity_id)} ×</button>)}</div>
        {error&&<p className="kisError" role="alert">{error}</p>}<button className="primary" disabled={busy}>{busy?'Сохранение…':'Сохранить инцидент'}</button>
      </form>:current&&<><p>{current.description||'Описание не заполнено'}</p><p><strong>Статус:</strong> {statuses[current.status]} · <strong>Критичность:</strong> {levels[current.severity]}</p><p><strong>Владелец:</strong> {current.owner||'Не указан'} · <strong>Ответственный:</strong> {current.assignee||'Не назначен'}</p><p><strong>Решение:</strong> {current.resolution||'Не указано'}</p><h4>Связанные объекты</h4><div className="incidentChips">{current.links.map(l=><span key={l.entity_type+l.entity_id}>{name(l.entity_type,l.entity_id)}</span>)}</div><h4>Потенциально затронутые системы</h4><p className="hint">Расчёт по текущим связям и потокам – гипотеза, а не подтверждение отказа.</p><div className="incidentChips">{affected.map(x=><span key={x.entity_id}>{x.name}</span>)}{!affected.length&&<small>Дополнительное влияние не обнаружено</small>}</div></>}
    </div>}
  </section>
}
