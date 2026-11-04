import React, {useCallback,useEffect,useMemo,useState} from 'react'

type Flow={id:string;name:string;source_id:string;target_id:string;data_description:string}
type ObjectItem={id:string;name:string}
type Component={id:string;name:string;system_id:string}
type Process={id:string;name:string}
type Attribute={id:string;code:string;name:string;description:string;data_type:string;sensitivity:string}
type Use={id:string;flow_id:string;attribute_id:string;process_id:string|null;consumer_system_id:string|null;purpose:string;verification:string}
type DataMap={attributes:(Use&{code:string;name:string;consumer_system_name:string|null;process_name:string|null;sensitivity:string})[]}
type Request=<T>(url:string,init?:RequestInit)=>Promise<T>
type Props={request:Request;flows:Flow[];systems:ObjectItem[];components:Component[];processes:Process[];initialFlowId:string;onClose:()=>void}

const emptyAttribute={code:'',name:'',description:'',data_type:'string',sensitivity:'unclassified'}
const sensitivityNames:Record<string,string>={unclassified:'Не классифицировано',internal:'Внутренние',personal:'Персональные',restricted:'Ограниченный доступ'}
const statuses:Record<string,string>={draft:'Черновик',assumed:'Предполагается',verified:'Подтверждено'}

export default function FlowDataCatalog({request,flows,systems,components,processes,initialFlowId,onClose}:Props){
  const [tab,setTab]=useState<'map'|'catalog'>('map')
  const [flowId,setFlowId]=useState(initialFlowId||flows[0]?.id||'')
  const [attributes,setAttributes]=useState<Attribute[]>([])
  const [uses,setUses]=useState<Use[]>([])
  const [loading,setLoading]=useState(true)
  const [busy,setBusy]=useState(false)
  const [error,setError]=useState('')
  const [notice,setNotice]=useState('')
  const [query,setQuery]=useState('')
  const [attrDraft,setAttrDraft]=useState(emptyAttribute)
  const [editId,setEditId]=useState('')
  const [attrFormOpen,setAttrFormOpen]=useState(false)
  const [linkAttribute,setLinkAttribute]=useState('')
  const [linkSystem,setLinkSystem]=useState('')
  const [linkProcess,setLinkProcess]=useState('')
  const [linkPurpose,setLinkPurpose]=useState('')
  const [linkStatus,setLinkStatus]=useState('draft')
  const [filterSystem,setFilterSystem]=useState('')
  const [filterProcess,setFilterProcess]=useState('')
  const [map,setMap]=useState<DataMap|null>(null)

  const reload=useCallback(async()=>{
    try{
      const [a,u]=await Promise.all([request<Attribute[]>('/api/data-attributes'),request<Use[]>('/api/flow-data-uses')])
      setAttributes(a);setUses(u);setError('')
    }catch(e){setError('Не удалось загрузить справочник: '+String(e))}
    finally{setLoading(false)}
  },[request])
  useEffect(()=>{void reload()},[reload])
  useEffect(()=>{
    if(!flowId){setMap(null);return}
    let active=true
    request<DataMap>('/api/flows/'+encodeURIComponent(flowId)+'/data-map')
      .then(result=>{if(active)setMap(result)})
      .catch(e=>{if(active){setMap(null);setError(String(e))}})
    return()=>{active=false}
  },[flowId,request,uses])

  const selected=flows.find(f=>f.id===flowId)
  const source=components.find(c=>c.id===selected?.source_id)
  const target=components.find(c=>c.id===selected?.target_id)
  const relevant=uses.filter(u=>u.flow_id===flowId)
  const filtered=(map?.attributes||[]).filter(row=>
    (!filterSystem||row.consumer_system_id===filterSystem)&&
    (!filterProcess||row.process_id===filterProcess))
  const uniqueAttrs=useMemo(()=>new Set(relevant.map(u=>u.attribute_id)).size,[relevant])
  const catalogRows=attributes.filter(a=>(a.code+' '+a.name+' '+a.description).toLowerCase().includes(query.toLowerCase()))

  function editAttribute(a?:Attribute){
    if(a){setEditId(a.id);setAttrDraft({code:a.code,name:a.name,description:a.description,data_type:a.data_type,sensitivity:a.sensitivity})}
    else{setEditId('');setAttrDraft(emptyAttribute)}
    setAttrFormOpen(true);setTab('catalog');setError('')
  }
  async function saveAttribute(e:React.FormEvent){
    e.preventDefault();setBusy(true);setError('')
    try{
      await request('/api/data-attributes'+(editId?'/'+editId:''),{method:editId?'PUT':'POST',body:JSON.stringify(attrDraft)})
      setAttrFormOpen(false);setEditId('');setNotice('Атрибут сохранён');await reload()
    }catch(e){setError('Не удалось сохранить атрибут: '+String(e))}finally{setBusy(false)}
  }
  async function addLink(e:React.FormEvent){
    e.preventDefault()
    if(!flowId||!linkAttribute)return
    setBusy(true);setError('')
    try{
      await request('/api/flow-data-uses',{method:'POST',body:JSON.stringify({
        flow_id:flowId,attribute_id:linkAttribute,consumer_system_id:linkSystem||null,
        process_id:linkProcess||null,purpose:linkPurpose,verification:linkStatus
      })})
      setLinkAttribute('');setLinkPurpose('');setNotice('Атрибут привязан к потоку');await reload()
    }catch(e){setError('Не удалось добавить привязку: '+String(e))}finally{setBusy(false)}
  }
  async function unlink(id:string){
    if(!window.confirm('Удалить привязку атрибута? Сам атрибут останется в справочнике.'))return
    setBusy(true);setError('')
    try{await request('/api/flow-data-uses/'+id,{method:'DELETE'});setNotice('Привязка удалена');await reload()}
    catch(e){setError('Не удалось удалить привязку: '+String(e))}finally{setBusy(false)}
  }
  function close(){
    if(attrFormOpen&&attrDraft.code.trim()&&!window.confirm('Закрыть справочник без сохранения атрибута?'))return
    onClose()
  }
  return <div className="architectureDrawerBackdrop" onMouseDown={e=>{if(e.target===e.currentTarget)close()}}>
    <aside className="architectureDrawer flowDataDrawer" role="dialog" aria-modal="true" aria-label="Атрибуты потоков данных">
      <div className="flowDataHeading"><div><small>АРХИТЕКТУРА ДАННЫХ</small><h2>Атрибуты потоков</h2></div><button type="button" onClick={close} aria-label="Закрыть справочник">Закрыть ×</button></div>
      <p className="hint">Справочник хранит определения полей, но не значения персональных данных. Один атрибут может участвовать в разных потоках и бизнес-процессах.</p>
      <div className="componentInspectorTabs" role="tablist" aria-label="Представление данных"><button type="button" role="tab" aria-selected={tab==='map'} className={tab==='map'?'current':''} onClick={()=>setTab('map')}>Данные потока</button><button type="button" role="tab" aria-selected={tab==='catalog'} className={tab==='catalog'?'current':''} onClick={()=>setTab('catalog')}>Справочник ({attributes.length})</button></div>
      {loading&&<p role="status">Загрузка атрибутов…</p>}
      {error&&<p className="kisError" role="alert">{error}</p>}
      {notice&&<p className="hint" role="status">{notice}</p>}
      {tab==='map'&&<>
        <label className="flowDataField">Поток данных<select aria-label="Выбрать поток для атрибутов" value={flowId} onChange={e=>{setFlowId(e.target.value);setFilterProcess('');setFilterSystem('')}}><option value="">Выберите поток</option>{flows.map(f=><option key={f.id} value={f.id}>{f.name}</option>)}</select></label>
        {selected&&<div className="flowDataRoute"><strong>{source?.name||'Источник'} → {target?.name||'Получатель'}</strong><small>{systems.find(s=>s.id===source?.system_id)?.name||'Неизвестная ИС'} → {systems.find(s=>s.id===target?.system_id)?.name||'Неизвестная ИС'}</small><p>{selected.data_description||'Описание состава данных отсутствует'}</p></div>}
        {selected&&<><div className="flowDataCount"><strong>{uniqueAttrs}</strong><span>уникальных атрибутов · {relevant.length} привязок к потребителям и процессам</span></div>
          <div className="flowDataFilters"><label>Система-потребитель<select aria-label="Фильтр системы-потребителя" value={filterSystem} onChange={e=>setFilterSystem(e.target.value)}><option value="">Все системы</option>{systems.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></label><label>Бизнес-процесс<select aria-label="Фильтр бизнес-процесса" value={filterProcess} onChange={e=>setFilterProcess(e.target.value)}><option value="">Все БП</option>{processes.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label></div>
          <div className="flowDataQuickFilters" aria-label="Быстрый выбор потребителя"><button type="button" aria-pressed={!filterSystem&&!filterProcess} onClick={()=>{setFilterSystem('');setFilterProcess('')}}>Все данные</button>{systems.filter(system=>relevant.some(row=>row.consumer_system_id===system.id)).map(system=><button key={system.id} type="button" aria-pressed={filterSystem===system.id} onClick={()=>{setFilterSystem(system.id);setFilterProcess('')}}>{system.name} · {new Set(relevant.filter(row=>row.consumer_system_id===system.id).map(row=>row.attribute_id)).size}</button>)}</div>
          <div className="flowDataRows" aria-label="Состав данных выбранного потока">{filtered.map(row=><article key={row.id} className="flowDataRow"><div><strong>{row.name}</strong><code>{row.code}</code></div><small>{row.consumer_system_name||'Без конкретного потребителя'} · {row.process_name||'Без привязки к БП'}</small><small>{sensitivityNames[row.sensitivity]||row.sensitivity} · {statuses[row.verification]||row.verification}</small>{row.purpose&&<p>{row.purpose}</p>}<button type="button" disabled={busy} onClick={()=>void unlink(row.id)}>Убрать из потока</button></article>)}{!filtered.length&&<p className="hint">Атрибутов для выбранного контекста нет. Это не подтверждает отсутствие данных в реальной интеграции.</p>}</div>
          <form className="flowDataLinkForm" onSubmit={addLink}><h3>Привязать атрибут</h3><label>Атрибут<select required aria-label="Атрибут для привязки" value={linkAttribute} onChange={e=>setLinkAttribute(e.target.value)}><option value="">Выберите из справочника</option>{attributes.map(a=><option key={a.id} value={a.id}>{a.name} ({a.code})</option>)}</select></label><div className="flowDataFilters"><label>Потребитель<select aria-label="Потребитель атрибута" value={linkSystem} onChange={e=>setLinkSystem(e.target.value)}><option value="">Для всех / не указан</option>{systems.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></label><label>Бизнес-процесс<select aria-label="Процесс атрибута" value={linkProcess} onChange={e=>setLinkProcess(e.target.value)}><option value="">Без привязки</option>{processes.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label></div><label>Для чего используется<textarea value={linkPurpose} onChange={e=>setLinkPurpose(e.target.value)} placeholder="Например, поиск сотрудника в справочнике"/></label><label>Достоверность<select value={linkStatus} onChange={e=>setLinkStatus(e.target.value)}><option value="draft">Черновик</option><option value="assumed">Предположение</option><option value="verified">Подтверждено</option></select></label><div className="drawerFormActions"><button type="button" onClick={()=>editAttribute()}>+ Новый атрибут</button><button type="submit" className="primary" disabled={busy||!linkAttribute}>{busy?'Сохранение…':'Привязать'}</button></div></form>
        </>}
      </>}
      {tab==='catalog'&&<><div className="flowDataCatalogToolbar"><input type="search" aria-label="Поиск атрибутов" placeholder="Код, название, описание…" value={query} onChange={e=>setQuery(e.target.value)}/><button type="button" onClick={()=>editAttribute()}>+ Атрибут</button></div>
        {attrFormOpen&&<form className="flowDataLinkForm" onSubmit={saveAttribute}><h3>{editId?'Редактировать атрибут':'Новый атрибут'}</h3><label>Уникальный код<input required pattern="[A-Za-z0-9_.-]+" maxLength={160} value={attrDraft.code} onChange={e=>setAttrDraft({...attrDraft,code:e.target.value})} placeholder="employee.department_code"/></label><label>Название<input required maxLength={250} value={attrDraft.name} onChange={e=>setAttrDraft({...attrDraft,name:e.target.value})}/></label><label>Описание<textarea maxLength={4000} value={attrDraft.description} onChange={e=>setAttrDraft({...attrDraft,description:e.target.value})}/></label><label>Тип данных<input maxLength={80} value={attrDraft.data_type} onChange={e=>setAttrDraft({...attrDraft,data_type:e.target.value})}/></label><label>Классификация<select value={attrDraft.sensitivity} onChange={e=>setAttrDraft({...attrDraft,sensitivity:e.target.value})}>{Object.entries(sensitivityNames).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label><div className="drawerFormActions"><button type="button" onClick={()=>setAttrFormOpen(false)}>Отмена</button><button className="primary" disabled={busy}>{busy?'Сохранение…':'Сохранить атрибут'}</button></div></form>}
        <div className="flowDataRows">{catalogRows.map(a=><article key={a.id} className="flowDataRow"><div><strong>{a.name}</strong><code>{a.code}</code></div><p>{a.description||'Описание не заполнено'}</p><small>{a.data_type} · {sensitivityNames[a.sensitivity]||a.sensitivity}</small><button type="button" onClick={()=>editAttribute(a)}>Редактировать</button></article>)}{!catalogRows.length&&<p className="hint">Атрибуты не найдены.</p>}</div>
      </>}
    </aside>
  </div>
}
