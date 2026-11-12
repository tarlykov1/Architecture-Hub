import {useEffect,useState} from 'react'
import type {FlowDataMapEntry} from './FlowAttributeMap'

type Operation='add'|'update'|'remove'
type CatalogAttribute={id:string;code:string;name:string}
type Named={id:string;name:string}
type Diff={action:string;id:string;before:Record<string,unknown>|null;after:Record<string,unknown>|null}
type Review={changes:Diff[];count:number;review_required:boolean}

type Props={
 flowId:string
 revision:string
 action:Operation
 entry?:FlowDataMapEntry
 request:<T>(url:string,init?:RequestInit)=>Promise<T>
 onSaved:()=>void
 onCancel:()=>void
}

/** A reviewed, audited metadata edit. No actual attribute values are requested or transmitted. */
export default function FlowAttributeReview({flowId,revision,action,entry,request,onSaved,onCancel}:Props){
 const [attributes,setAttributes]=useState<CatalogAttribute[]>([])
 const [processes,setProcesses]=useState<Named[]>([])
 const [consumers,setConsumers]=useState<Named[]>([])
 const [loading,setLoading]=useState(action!=='remove')
 const [busy,setBusy]=useState(false)
 const [error,setError]=useState('')
 const [attributeId,setAttributeId]=useState(entry?.attribute_id||'')
 const [processId,setProcessId]=useState(entry?.process_id||'')
 const [consumerId,setConsumerId]=useState(entry?.consumer_system_id||'')
 const [purpose,setPurpose]=useState(entry?.purpose||'')
 const [verification,setVerification]=useState(entry?.verification||'draft')
 const [reason,setReason]=useState('')
 const [preview,setPreview]=useState<Review|null>(null)

 useEffect(()=>{
  if(action==='remove')return
  let active=true
  Promise.all([
   request<CatalogAttribute[]>('/api/data-attributes'),
   request<Named[]>('/api/business/processes'),
   request<Named[]>('/api/objects')
  ]).then(([a,p,c])=>{if(active){setAttributes(a);setProcesses(p);setConsumers(c);setLoading(false)}})
   .catch(e=>{if(active){setError('Не удалось загрузить справочники: '+String(e));setLoading(false)}})
  return()=>{active=false}
 },[action,request])

 const operation=action==='remove'
  ?{action,id:entry?.id}
  :{action,id:action==='update'?entry?.id:undefined,
    attribute_id:attributeId,process_id:processId||null,consumer_system_id:consumerId||null,
    purpose,verification}
 const payload={expected_revision:revision,reason:reason.trim(),operations:[operation]}
 const endpoint='/api/flows/'+encodeURIComponent(flowId)+'/data-map/'
 function changed(){setPreview(null);setError('')}
 async function inspect(){
  if(reason.trim().length<3){setError('Укажите причину изменения (не менее 3 символов).');return}
  if(action!=='remove'&&!attributeId){setError('Выберите атрибут из справочника.');return}
  setBusy(true);setError('');setPreview(null)
  try{
   const result=await request<Review>(endpoint+'preview',{method:'POST',body:JSON.stringify(payload)})
   setPreview(result)
  }catch(e){setError('Не удалось проверить изменения: '+String(e))}
  finally{setBusy(false)}
 }
 async function commit(){
  if(!preview)return
  setBusy(true);setError('')
  try{
   await request(endpoint+'commit',{method:'POST',body:JSON.stringify(payload)})
   onSaved()
  }catch(e){
   setPreview(null)
   setError('Изменения не сохранены: '+String(e)+'. Если состав потока изменился, обновите данные и повторите проверку.')
  }finally{setBusy(false)}
 }
 const title=action==='add'?'Добавление атрибута':action==='remove'?'Удаление привязки':'Редактирование привязки'
 return <div className="boardConfirm" role="presentation">
  <section className="boardConfirmInner boardFlowReview" role="dialog" aria-modal="true" aria-label="Изменение состава данных потока">
   <h3>{title}</h3>
   <p>Изменяется только описание состава передаваемых данных. Значения полей не читаются и не записываются.</p>
   {action==='remove'
    ?<p>Привязка «{entry?.name}» будет удалена только из этого потока. Определение атрибута останется в справочнике.</p>
    :<div className="boardFlowReviewFields">
      <label>Атрибут
       <select aria-label="Атрибут привязки" value={attributeId} disabled={loading||busy} onChange={e=>{setAttributeId(e.target.value);changed()}}>
        <option value="">Выберите атрибут</option>
        {attributes.map(a=><option key={a.id} value={a.id}>{a.name} ({a.code})</option>)}
       </select>
      </label>
      <label>Бизнес-процесс
       <select aria-label="Бизнес-процесс привязки" value={processId} disabled={loading||busy} onChange={e=>{setProcessId(e.target.value);changed()}}>
        <option value="">Не указан</option>{processes.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}
       </select>
      </label>
      <label>Система-потребитель
       <select aria-label="Система-потребитель привязки" value={consumerId} disabled={loading||busy} onChange={e=>{setConsumerId(e.target.value);changed()}}>
        <option value="">Не указана</option>{consumers.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}
       </select>
      </label>
      <label>Назначение атрибута
       <textarea aria-label="Назначение атрибута" value={purpose} maxLength={2000} disabled={loading||busy} onChange={e=>{setPurpose(e.target.value);changed()}}/>
      </label>
      <label>Статус подтверждения
       <select aria-label="Статус подтверждения атрибута" value={verification} disabled={loading||busy} onChange={e=>{setVerification(e.target.value);changed()}}>
        <option value="draft">Черновик</option><option value="assumed">Предположение</option><option value="verified">Подтверждено</option>
       </select>
      </label>
     </div>}
   <label className="boardFlowReviewReason">Причина изменения
    <textarea aria-label="Причина изменения состава данных" value={reason} maxLength={1000} disabled={busy} onChange={e=>{setReason(e.target.value);changed()}} placeholder="Например: уточнение состава данных по заявкам"/>
   </label>
   {loading&&<p role="status">Загрузка справочников…</p>}
   {error&&<p className="boardFlowReviewError" role="alert">{error}</p>}
   {preview&&<div className="boardFlowReviewPreview" role="region" aria-label="Предварительный просмотр изменений данных">
     <strong>К подтверждению: {preview.count} операция</strong>
     <small>Проверьте состав, бизнес-процесс, потребителя и основание.</small>
     {preview.changes.map((diff,i)=><div key={i}>
       <strong>{diff.action==='add_flow_attribute'?'Добавить атрибут':diff.action==='remove_flow_attribute'?'Удалить привязку':'Изменить привязку'}</strong>
       <pre>{JSON.stringify({до:diff.before,после:diff.after},null,2)}</pre>
     </div>)}
    </div>}
   <div className="boardFlowReviewActions">
    <button type="button" disabled={busy} onClick={onCancel}>Отмена</button>
    {!preview?<button type="button" className="primary" disabled={busy||loading} onClick={()=>void inspect()}>Проверить изменение данных</button>:
     <button type="button" className="primary" disabled={busy} onClick={()=>void commit()}>Подтвердить и записать в журнал</button>}
   </div>
  </section>
 </div>
}
