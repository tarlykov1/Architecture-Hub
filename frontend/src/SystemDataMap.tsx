import React,{useEffect,useMemo,useState} from 'react'

type System={id:string;name:string}
type Component={id:string;name:string;system_id:string}
type Flow={id:string;name:string;source_id:string;target_id:string;data_description:string;protocol:string;verification:string}
type BusinessProcess={id:string;name:string}
type DataAttribute={id:string;code:string;name:string;sensitivity:string;data_type:string}
type FlowUse={id:string;flow_id:string;attribute_id:string;process_id:string|null;consumer_system_id:string|null;purpose:string;verification:string}
type Request=<T>(url:string,init?:RequestInit)=>Promise<T>
type Props={request:Request;systems:System[];components:Component[];flows:Flow[];processes:BusinessProcess[];initialSystemId:string;onClose:()=>void;onOpenFlow:(flowId:string)=>void}
type RelatedFlow={flow:Flow;from:System|undefined;to:System|undefined;direction:'incoming'|'outgoing'|'internal'|'consumer';attributes:FlowUse[]}

export default function SystemDataMap({request,systems,components,flows,processes,initialSystemId,onClose,onOpenFlow}:Props){
  const [systemId,setSystemId]=useState(initialSystemId)
  const [uses,setUses]=useState<FlowUse[]>([])
  const [attributes,setAttributes]=useState<DataAttribute[]>([])
  const [loading,setLoading]=useState(true)
  const [error,setError]=useState('')
  const [selectedFlow,setSelectedFlow]=useState('')
  const [consumerId,setConsumerId]=useState('')
  const [processId,setProcessId]=useState('')
  const componentsById=useMemo(()=>new Map(components.map(c=>[c.id,c])),[components])
  const systemsById=useMemo(()=>new Map(systems.map(s=>[s.id,s])),[systems])
  const attributesById=useMemo(()=>new Map(attributes.map(a=>[a.id,a])),[attributes])
  useEffect(()=>{
    let active=true
    setLoading(true)
    Promise.all([request<FlowUse[]>('/api/flow-data-uses'),request<DataAttribute[]>('/api/data-attributes')])
      .then(([links,catalog])=>{if(active){setUses(links);setAttributes(catalog);setError('')}})
      .catch(e=>{if(active)setError(String(e))})
      .finally(()=>{if(active)setLoading(false)})
    return()=>{active=false}
  },[request])
  useEffect(()=>{setSelectedFlow('');setConsumerId('');setProcessId('')},[systemId])

  const related:RelatedFlow[]=useMemo(()=>flows.flatMap(flow=>{
    const source=componentsById.get(flow.source_id)
    const target=componentsById.get(flow.target_id)
    const relevantUses=uses.filter(u=>u.flow_id===flow.id)
    const isEndpoint=source?.system_id===systemId||target?.system_id===systemId
    const isConsumer=relevantUses.some(u=>u.consumer_system_id===systemId)
    if(!isEndpoint&&!isConsumer)return []
    const direction=source?.system_id===systemId&&target?.system_id===systemId?'internal':
      source?.system_id===systemId?'outgoing':target?.system_id===systemId?'incoming':'consumer'
    return [{flow,from:systemsById.get(source?.system_id||''),to:systemsById.get(target?.system_id||''),direction,attributes:relevantUses}]
  }),[flows,componentsById,systemsById,uses,systemId])

  const active=related.find(row=>row.flow.id===selectedFlow)
  const showRows=(rows:FlowUse[])=>rows.filter(u=>
    (!consumerId||u.consumer_system_id===consumerId)&&(!processId||u.process_id===processId))
  const consumerIds=[...new Set(related.flatMap(row=>row.attributes.map(u=>u.consumer_system_id).filter((id):id is string=>Boolean(id))))]
  const processIds=[...new Set(related.flatMap(row=>row.attributes.map(u=>u.process_id).filter((id):id is string=>Boolean(id))))]
  const counts=new Set(related.flatMap(row=>row.attributes.map(u=>u.attribute_id)))

  function changeSystem(id:string){setSystemId(id)}
  function viewFlow(id:string){setSelectedFlow(current=>current===id?'':id);setConsumerId('');setProcessId('')}
  function openFlow(id:string){onOpenFlow(id)}

  return <div className="architectureDrawerBackdrop" onMouseDown={event=>{if(event.target===event.currentTarget)onClose()}}>
    <aside className="architectureDrawer systemDataDrawer" role="dialog" aria-modal="true" aria-label="Карта данных информационной системы">
      <div className="flowDataHeading"><div><small>СВЯЗИ · ИНФОРМАЦИОННЫЕ СИСТЕМЫ · ДАННЫЕ</small><h2>Карта данных ИС</h2></div><button type="button" onClick={onClose} aria-label="Закрыть карту данных">Закрыть ×</button></div>
      <label className="flowDataField">Информационная система<select aria-label="Информационная система карты данных" value={systemId} onChange={event=>changeSystem(event.target.value)}>{systems.map(system=><option value={system.id} key={system.id}>{system.name}</option>)}</select></label>
      <p className="hint">Показаны зарегистрированные направления обмена. Наличие записи не подтверждает фактическую передачу данных или сетевую доступность.</p>
      {error&&<p role="alert" className="kisError">{error}</p>}
      {loading?<p role="status">Загрузка карты данных…</p>:<>
        <div className="systemDataStats"><span><strong>{related.length}</strong> потоков</span><span><strong>{counts.size}</strong> атрибутов</span><span><strong>{consumerIds.length}</strong> потребителей данных</span></div>
        <div className="systemDataLinks" aria-label="Связанные потоки ИС">
          {related.map(({flow,from,to,direction,attributes:links})=><div className="systemDataConnection" key={flow.id}>
            <div className="systemDataEndpoints"><button type="button" disabled={!from} onClick={()=>from&&changeSystem(from.id)}>{from?.name||'Источник не указан'}</button><span aria-label="Направление потока">→</span><button type="button" disabled={!to} onClick={()=>to&&changeSystem(to.id)}>{to?.name||'Получатель не указан'}</button></div>
            <button type="button" className="systemDataFlowPick" aria-pressed={selectedFlow===flow.id} onClick={()=>viewFlow(flow.id)}><strong>{flow.name}</strong><small>{direction==='incoming'?'Входящий':direction==='outgoing'?'Исходящий':direction==='internal'?'Внутри ИС':'Используется ИС как потребителем'} · {new Set(links.map(u=>u.attribute_id)).size} описанных атрибутов · {flow.verification||'Не подтверждено'}</small></button>
          </div>)}
          {!related.length&&<p className="hint">Для этой ИС потоки не зарегистрированы. Это не доказывает отсутствие обмена.</p>}
        </div>
        {active&&<section className="systemDataFlowDetail" aria-label="Атрибуты выбранного потока ИС">
          <div className="systemDataFlowHeader"><h3>{active.flow.name}</h3><button type="button" onClick={()=>openFlow(active.flow.id)}>Открыть состав данных</button></div>
          <p>{active.flow.data_description||'Описание состава данных отсутствует'}</p>
          <div className="flowDataQuickFilters" aria-label="Быстрый выбор потребителя">
            <button type="button" aria-pressed={!consumerId} onClick={()=>setConsumerId('')}>Все потребители</button>
            {[...new Set(active.attributes.map(row=>row.consumer_system_id).filter((id):id is string=>Boolean(id)))].map(id=><button type="button" key={id} aria-pressed={consumerId===id} onClick={()=>setConsumerId(id)}>{systemsById.get(id)?.name||'Система не найдена'}</button>)}
          </div>
          <label className="flowDataField">Бизнес-процесс<select aria-label="Бизнес-процесс карты данных" value={processId} onChange={event=>setProcessId(event.target.value)}><option value="">Все бизнес-процессы</option>{processIds.filter(id=>active.attributes.some(row=>row.process_id===id)).map(id=><option key={id} value={id}>{processes.find(p=>p.id===id)?.name||'Неизвестный БП'}</option>)}</select></label>
          <div className="flowDataRows">{showRows(active.attributes).map(row=>{
            const attr=attributesById.get(row.attribute_id)
            return <article key={row.id} className="flowDataRow"><div><strong>{attr?.name||'Атрибут отсутствует в справочнике'}</strong><code>{attr?.code||row.attribute_id}</code></div><small>Потребитель: {systemsById.get(row.consumer_system_id||'')?.name||'Не указан'} · БП: {processes.find(p=>p.id===row.process_id)?.name||'Не указан'}</small><small>Тип: {attr?.data_type||'?'} · {attr?.sensitivity||'unclassified'} · {row.verification}</small>{row.purpose&&<p>{row.purpose}</p>}</article>
          })}{!showRows(active.attributes).length&&<p className="hint">Для данного потребителя и БП атрибуты не описаны.</p>}</div>
        </section>}
      </>}
    </aside>
  </div>
}
