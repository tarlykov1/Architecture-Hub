import React, {useEffect, useState} from 'react'
import './monitoring.css'

type Source={id:string;name:string;kind:string;base_url:string;system_id:string|null;enabled:boolean;description:string}
type Link={id:string;source_id:string;target_type:'component'|'system';target_id:string;relation_kind:'monitors'|'visualizes';dashboard_url:string;external_ref:string;notes:string}
type System={id:string;name:string}
type Props={
 targetType:'component'|'system'
 targetId:string
 request:<T>(url:string,init?:RequestInit)=>Promise<T>
 systems?:System[]
}

function safeExternalLink(url:string):string|undefined{
 try{
  const parsed=new URL(url)
  return (parsed.protocol==='https:'||parsed.protocol==='http:')&&!parsed.username&&!parsed.password?url:undefined
 }catch{return undefined}
}

/** Optional telemetry catalog. No real-time state is invented or derived from the link. */
export default function MonitoringPanel({targetType,targetId,request,systems=[]}:Props){
 const [sources,setSources]=useState<Source[]>([])
 const [links,setLinks]=useState<Link[]>([])
 const [loading,setLoading]=useState(true)
 const [error,setError]=useState('')
 const [notice,setNotice]=useState('')
 const [busy,setBusy]=useState(false)
 const [newSource,setNewSource]=useState({name:'',kind:'grafana',base_url:'',system_id:'',description:''})
 const [linkDraft,setLinkDraft]=useState({source_id:'',relation_kind:'monitors',dashboard_url:'',external_ref:'',notes:''})
 const [showSourceForm,setShowSourceForm]=useState(false)
 const [showLinkForm,setShowLinkForm]=useState(false)

 const refresh=async()=>{
  const [all,attached]=await Promise.all([
   request<Source[]>('/api/monitoring/sources'),
   request<Link[]>('/api/monitoring/links?target_type='+targetType+'&target_id='+encodeURIComponent(targetId))
  ])
  setSources(all);setLinks(attached)
 }
 useEffect(()=>{
  let active=true
  setLoading(true);setError('')
  void Promise.all([
   request<Source[]>('/api/monitoring/sources'),
   request<Link[]>('/api/monitoring/links?target_type='+targetType+'&target_id='+encodeURIComponent(targetId))
  ]).then(([all,attached])=>{if(active){setSources(all);setLinks(attached)}})
    .catch(e=>{if(active)setError('Не удалось загрузить мониторинг: '+String(e))})
    .finally(()=>{if(active)setLoading(false)})
  return ()=>{active=false}
 },[request,targetId,targetType])

 const createSource=async(event:React.FormEvent)=>{
  event.preventDefault()
  setBusy(true);setError('');setNotice('')
  try{
   const created=await request<Source>('/api/monitoring/sources',{method:'POST',
    body:JSON.stringify({...newSource,system_id:newSource.system_id||null,enabled:true})})
   await refresh()
   setLinkDraft(value=>({...value,source_id:created.id}))
   setShowSourceForm(false);setShowLinkForm(true)
   setNewSource({name:'',kind:'grafana',base_url:'',system_id:'',description:''})
   setNotice('Источник создан. Теперь привяжите его к этому объекту.')
  }catch(e){setError('Источник не сохранён: '+String(e))}
  finally{setBusy(false)}
 }

 const createLink=async(event:React.FormEvent)=>{
  event.preventDefault()
  setBusy(true);setError('');setNotice('')
  try{
   await request('/api/monitoring/links',{method:'POST',body:JSON.stringify({
    ...linkDraft,target_type:targetType,target_id:targetId
   })})
   await refresh()
   setShowLinkForm(false)
   setLinkDraft({source_id:'',relation_kind:'monitors',dashboard_url:'',external_ref:'',notes:''})
   setNotice('Привязка сохранена в реестре и истории изменений.')
  }catch(e){setError('Привязка не сохранена: '+String(e))}
  finally{setBusy(false)}
 }

 const removeLink=async(id:string)=>{
  if(!window.confirm('Удалить привязку мониторинга? Сам источник останется в реестре.'))return
  setBusy(true);setError('');setNotice('')
  try{
   await request('/api/monitoring/links/'+id,{method:'DELETE'})
   await refresh();setNotice('Привязка удалена.')
  }catch(e){setError('Не удалось удалить привязку: '+String(e))}
  finally{setBusy(false)}
 }
 return <section className="monitoringPanel" aria-label="Мониторинг объекта">
  <div className="monitoringPanelHeading"><h3>Мониторинг</h3><small>Связи с источниками и дашбордами</small></div>
  {loading?<p className="monitoringHint" role="status">Загрузка источников…</p>:<>
   {!links.length&&!error&&<p className="monitoringHint">Мониторинг не настроен. Это не означает, что объект недоступен.</p>}
   {links.map(link=>{
    const source=sources.find(s=>s.id===link.source_id)
    const url=safeExternalLink(link.dashboard_url||source?.base_url||'')
    return <article className="monitoringLink" key={link.id}>
     <div><strong>{source?.name||'Источник отсутствует'}</strong><small>{source?.kind||'other'} · {link.relation_kind==='monitors'?'Мониторит':'Визуализирует'}{source&&!source.enabled?' · отключён':''}</small></div>
     {link.external_ref&&<small>Идентификатор: {link.external_ref}</small>}
     {link.notes&&<small>{link.notes}</small>}
     <div className="monitoringLinkActions">{url&&<a href={url} rel="noopener noreferrer" target="_blank">Открыть дашборд ↗</a>}<button disabled={busy} type="button" onClick={()=>void removeLink(link.id)}>Удалить связь</button></div>
    </article>
   })}
   {!!error&&<p role="alert" className="monitoringError">{error}</p>}
   {!!notice&&<p role="status" className="monitoringNotice">{notice}</p>}
   <div className="monitoringActions">
    <button type="button" onClick={()=>{setShowLinkForm(v=>!v);setShowSourceForm(false)}}>+ Привязать мониторинг</button>
    <button type="button" onClick={()=>{setShowSourceForm(v=>!v);setShowLinkForm(false)}}>+ Источник</button>
   </div>
   {showLinkForm&&<form className="monitoringForm" onSubmit={createLink} aria-label="Новая привязка мониторинга">
    <label>Источник
     <select required value={linkDraft.source_id} onChange={e=>setLinkDraft(v=>({...v,source_id:e.target.value}))}>
      <option value="">Выберите источник</option>
      {sources.map(s=><option key={s.id} value={s.id}>{s.name} · {s.kind}</option>)}
     </select>
    </label>
    {!sources.length&&<p className="monitoringHint">Сначала создайте источник.</p>}
    <label>Тип связи<select value={linkDraft.relation_kind} onChange={e=>setLinkDraft(v=>({...v,relation_kind:e.target.value}))}>
     <option value="monitors">Мониторит</option><option value="visualizes">Визуализирует</option>
    </select></label>
    <label>URL дашборда <input type="url" placeholder="https://grafana.example/d/…" value={linkDraft.dashboard_url} onChange={e=>setLinkDraft(v=>({...v,dashboard_url:e.target.value}))}/></label>
    <label>Внешний идентификатор <input value={linkDraft.external_ref} maxLength={250} onChange={e=>setLinkDraft(v=>({...v,external_ref:e.target.value}))}/></label>
    <label>Комментарий <textarea value={linkDraft.notes} maxLength={1000} onChange={e=>setLinkDraft(v=>({...v,notes:e.target.value}))}/></label>
    <button className="primary" disabled={busy||!linkDraft.source_id} type="submit">Сохранить привязку</button>
   </form>}
   {showSourceForm&&<form className="monitoringForm" onSubmit={createSource} aria-label="Новый источник мониторинга">
    <label>Название <input required maxLength={200} value={newSource.name} onChange={e=>setNewSource(v=>({...v,name:e.target.value}))}/></label>
    <label>Тип<select value={newSource.kind} onChange={e=>setNewSource(v=>({...v,kind:e.target.value}))}>
      <option value="grafana">Grafana</option><option value="prometheus">Prometheus</option><option value="zabbix">Zabbix</option><option value="other">Другая система</option>
    </select></label>
    <label>Адрес системы <input type="url" required placeholder="https://grafana.example" value={newSource.base_url} onChange={e=>setNewSource(v=>({...v,base_url:e.target.value}))}/></label>
    {!!systems.length&&<label>Связать с существующей ИС
     <select value={newSource.system_id} onChange={e=>setNewSource(v=>({...v,system_id:e.target.value}))}>
      <option value="">Не связывать</option>
      {systems.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}
     </select></label>}
    <label>Описание <textarea value={newSource.description} maxLength={1000} onChange={e=>setNewSource(v=>({...v,description:e.target.value}))}/></label>
    <button className="primary" disabled={busy} type="submit">Создать источник</button>
   </form>}
   <p className="monitoringHint">Метрики CPU, RAM и доступности появятся на следующем этапе. Здесь только реальные ссылки и связи, без демонстрационных показателей.</p>
  </>}
 </section>
}
