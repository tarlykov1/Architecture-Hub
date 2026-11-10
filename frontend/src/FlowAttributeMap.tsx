import {useEffect,useRef,useState} from 'react'

export type FlowDataMapEntry={
 id:string
 attribute_id:string
 code:string
 name:string
 data_type:string
 sensitivity:string
 process_id:string|null
 process_name:string|null
 consumer_system_id:string|null
 consumer_system_name:string|null
 purpose:string
 verification:string
}
export type FlowDataMapResponse={
 flow_id:string
 source_id:string
 target_id:string
 attributes:FlowDataMapEntry[]
}
type Props={
 flowId:string
 request:<T>(url:string,init?:RequestInit)=>Promise<T>
}

const statusLabel:Record<string,string>={
 draft:'Черновик',assumed:'Предположение',verified:'Подтверждено'
}
const sensitivityLabel:Record<string,string>={
 unclassified:'Не классифицировано',internal:'Внутренние данные',
 personal:'Персональные данные',restricted:'Ограниченный доступ'
}

/** Read-only view of *metadata* used by a flow, separated by BP and consumer.
 * No sensitive attribute values are ever loaded by this component.
 */
export default function FlowAttributeMap({flowId,request}:Props){
 const api=useRef(request)
 api.current=request
 const [data,setData]=useState<FlowDataMapResponse|null>(null)
 const [loading,setLoading]=useState(true)
 const [error,setError]=useState('')
 const [revision,setRevision]=useState(0)
 const [processFilter,setProcessFilter]=useState('all')
 const [consumerFilter,setConsumerFilter]=useState('all')
 useEffect(()=>{
  let active=true
  setLoading(true);setData(null);setError('')
  void api.current<FlowDataMapResponse>('/api/flows/'+flowId+'/data-map')
   .then(result=>{if(active){setData(result);setLoading(false)}})
   .catch(err=>{if(active){setError(err instanceof Error?err.message:'Не удалось загрузить состав данных');setLoading(false)}})
  return ()=>{active=false}
 },[flowId,revision])
 const entries=data?.attributes||[]
 const processes=Array.from(new Map(entries.map(row=>[row.process_id||'none',row.process_name||'Без бизнес-процесса'])).entries())
 const consumers=Array.from(new Map(entries.map(row=>[row.consumer_system_id||'none',row.consumer_system_name||'Без системы-потребителя'])).entries())
 const filtered=entries.filter(row=>
  (processFilter==='all'||(row.process_id||'none')===processFilter)&&
  (consumerFilter==='all'||(row.consumer_system_id||'none')===consumerFilter))
 return <section className="boardFlowDataMap" aria-label="Атрибуты данных потока">
  <div className="boardFlowDataMapHeader">
   <div><strong>Состав передаваемых данных</strong><small>По бизнес-процессам и системам-потребителям</small></div>
   <button type="button" aria-label="Обновить состав данных" onClick={()=>setRevision(n=>n+1)}>Обновить</button>
  </div>
  <p>Показываются определения атрибутов, а не значения данных. Для одного потока разные процессы и системы могут использовать разные наборы полей.</p>
  {loading&&<p role="status">Загрузка состава данных…</p>}
  {!loading&&error&&<p role="alert">Не удалось загрузить состав данных: {error}</p>}
  {!loading&&!error&&<>
   <div className="boardFlowDataMapFilters">
    <label>Бизнес-процесс
     <select aria-label="Фильтр бизнес-процесса" value={processFilter} onChange={event=>setProcessFilter(event.target.value)}>
      <option value="all">Все процессы</option>
      {processes.map(([id,name])=><option key={id} value={id}>{name}</option>)}
     </select>
    </label>
    <label>Система-потребитель
     <select aria-label="Фильтр системы-потребителя" value={consumerFilter} onChange={event=>setConsumerFilter(event.target.value)}>
      <option value="all">Все системы</option>
      {consumers.map(([id,name])=><option key={id} value={id}>{name}</option>)}
     </select>
    </label>
   </div>
   <small className="boardFlowDataMapCount">{filtered.length} из {entries.length} привязок атрибутов</small>
   {entries.length===0?<p className="boardFlowDataMapEmpty">Атрибуты потока пока не описаны в реестре. Структуру данных можно добавить через справочник атрибутов и модель использования потока.</p>:
    filtered.length===0?<p className="boardFlowDataMapEmpty">Для выбранного процесса и потребителя нет атрибутов.</p>:
    <div className="boardFlowDataMapList">
     {filtered.map(row=><article key={row.id}>
      <strong>{row.name}</strong><code>{row.code}</code>
      <div><span>{row.data_type}</span><span>{sensitivityLabel[row.sensitivity]||row.sensitivity}</span><span>{statusLabel[row.verification]||row.verification}</span></div>
      <small>Процесс: {row.process_name||'Не указан'}</small>
      <small>Потребитель: {row.consumer_system_name||'Не указан'}</small>
      {row.purpose&&<p>Назначение: {row.purpose}</p>}
     </article>)}
    </div>}
  </>}
 </section>
}
