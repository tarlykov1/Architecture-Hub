import {useEffect,useState} from 'react'
import CmdbCatalog from './CmdbCatalog'

type RecordData={
  ci_id:string;name:string;ci_class:string;revision:number
  lifecycle:string;owner:string;technical_owner:string;criticality:string
  source_system:string;source_record_id:string;verification_status:string
  verified_at:string|null;notes:string;evidence:string;updated_at:string|null
  custom_values:Record<string,string|number|boolean>
}
type CustomField={key:string;label:string;type:'text'|'number'|'boolean'|'choice';options:string[]}
type ClassEntry={id:string;label:string;fields:CustomField[];required:string[]}
type ClassesResponse={classes:ClassEntry[]}
type HistoryEntry={
  revision:number;action:string;reason:string;actor_role:string
  occurred_at:string;before:Partial<RecordData>;after:Partial<RecordData>
}
type Props={
  ciId:string
  request:<T>(url:string,init?:RequestInit)=>Promise<T>
}
const lifecycleLabels:Record<string,string>={
  unknown:'Не указан',planned:'Планируется',active:'Эксплуатируется',
  maintenance:'На обслуживании',retired:'Выведена из эксплуатации'
}
const criticalityLabels:Record<string,string>={
  unknown:'Не определена',low:'Низкая',medium:'Средняя',high:'Высокая',critical:'Критическая'
}
const editable=[
  'lifecycle','owner','technical_owner','criticality',
  'source_system','source_record_id','notes'
] as const
const formatDate=(date:string|null)=>date?
  new Date(date).toLocaleString('ru-RU',{dateStyle:'medium',timeStyle:'short'}):'Не проверялась'

export default function CmdbRecord({ciId,request}:Props){
  const [record,setRecord]=useState<RecordData|null>(null)
  const [draft,setDraft]=useState<RecordData|null>(null)
  const [history,setHistory]=useState<HistoryEntry[]>([])
  const [isEditing,setIsEditing]=useState(false)
  const [reason,setReason]=useState('')
  const [evidence,setEvidence]=useState('')
  const [busy,setBusy]=useState(false)
  const [loading,setLoading]=useState(true)
  const [error,setError]=useState('')
  const [message,setMessage]=useState('')
  const [schema,setSchema]=useState<ClassEntry[]>([])
  const [showCatalog,setShowCatalog]=useState(false)

  const path='/api/cmdb/records/'+encodeURIComponent(ciId)
  const currentClass=schema.find(item=>item.id===record?.ci_class)
  const updateCustom=(key:string,value:string|number|boolean)=>{
    if(!draft)return
    setDraft({...draft,custom_values:{...draft.custom_values,[key]:value}})
  }
  const reload=async()=>{
    const [next,entries]=await Promise.all([
      request<RecordData>(path),request<HistoryEntry[]>(path+'/history')
    ])
    setRecord(next);setDraft(next);setHistory(entries)
  }
  useEffect(()=>{
    let active=true
    setLoading(true);setError('');setMessage('');setIsEditing(false)
    void Promise.all([request<RecordData>(path),request<HistoryEntry[]>(path+'/history'),
      request<ClassesResponse>('/api/cmdb/classes')])
      .then(([next,entries,catalog])=>{if(active){setRecord(next);setDraft(next);setHistory(entries);setSchema(catalog.classes)}})
      .catch(err=>{if(active)setError('Не удалось загрузить КЕ: '+String(err))})
      .finally(()=>{if(active)setLoading(false)})
    return ()=>{active=false}
  },[path,request])

  const update=async()=>{
    if(!record||!draft)return
    setBusy(true);setError('');setMessage('')
    try{
      const payload={...Object.fromEntries(editable.map(field=>[field,draft[field]])),
        custom_values:draft.custom_values||{}}
      await request<RecordData>(path,{
        method:'PUT',body:JSON.stringify({...payload,expected_revision:record.revision,reason})
      })
      await reload();setIsEditing(false);setReason('')
      setMessage('Паспорт КЕ сохранён. Для новых данных требуется повторная проверка.')
    }catch(err){setError('Не удалось сохранить: '+String(err))}
    finally{setBusy(false)}
  }
  const verify=async()=>{
    if(!record)return
    setBusy(true);setError('');setMessage('')
    try{
      await request<RecordData>(path+'/verify',{
        method:'POST',body:JSON.stringify({expected_revision:record.revision,evidence})
      })
      await reload();setEvidence('')
      setMessage('Сведения КЕ подтверждены, событие записано в историю.')
    }catch(err){setError('Не удалось подтвердить: '+String(err))}
    finally{setBusy(false)}
  }
  return <section className="cmdbRecord" role="region" aria-label="Управление конфигурационной единицей">
    {loading&&<p role="status">Загружаем конфигурационную единицу…</p>}
    {error&&<p role="alert">{error}</p>}
    {message&&<p role="status">{message}</p>}
    {record&&draft&&<>
      <div className="cmdbRecordTop">
        <div><h3>Управление КЕ</h3><p className="hint">Паспорт конфигурации · версия {record.revision}</p></div>
        <span className="cmdbVerificationState">{record.verification_status==='verified'?'Проверена':'Не подтверждена'}</span>
      </div>
      {!isEditing?<div className="cmdbRecordFields">
        <dl>
          <div><dt>Класс</dt><dd>{currentClass?.label||record.ci_class}</dd></div>
          <div><dt>Жизненный цикл</dt><dd>{lifecycleLabels[record.lifecycle]||record.lifecycle}</dd></div>
          <div><dt>Владелец</dt><dd>{record.owner||'Не указан'}</dd></div>
          <div><dt>Технический ответственный</dt><dd>{record.technical_owner||'Не указан'}</dd></div>
          <div><dt>Критичность</dt><dd>{criticalityLabels[record.criticality]||record.criticality}</dd></div>
          <div><dt>Источник</dt><dd>{record.source_system||'Не указан'}</dd></div>
          <div><dt>Идентификатор в источнике</dt><dd>{record.source_record_id||'Не указан'}</dd></div>
          <div><dt>Последняя проверка</dt><dd>{formatDate(record.verified_at)}</dd></div>
          <div><dt>Примечания</dt><dd>{record.notes||'Нет'}</dd></div>
          {currentClass?.fields?.map(field=><div key={field.key}>
            <dt>{field.label}</dt>
            <dd>{field.type==='boolean'
              ? ((record.custom_values||{})[field.key]===true?'Да':(record.custom_values||{})[field.key]===false?'Нет':'Не указано')
              :String((record.custom_values||{})[field.key]??'Не указано')}</dd>
          </div>)}
        </dl>
        <button type="button" onClick={()=>{setDraft({...record});setIsEditing(true);setError('');setMessage('')}}>Редактировать данные КЕ</button>
      </div>:<form className="cmdbRecordForm" onSubmit={event=>{event.preventDefault();void update()}}>
        <label>Жизненный цикл
          <select aria-label="Жизненный цикл КЕ" value={draft.lifecycle} onChange={event=>setDraft({...draft,lifecycle:event.target.value})}>
            <option value="unknown" disabled>Не указан</option>
            {Object.entries(lifecycleLabels).filter(([id])=>id!=='unknown').map(([id,label])=><option key={id} value={id}>{label}</option>)}
          </select>
        </label>
        <label>Владелец <input value={draft.owner} onChange={event=>setDraft({...draft,owner:event.target.value})} maxLength={180}/></label>
        <label>Технический ответственный <input value={draft.technical_owner} onChange={event=>setDraft({...draft,technical_owner:event.target.value})} maxLength={180}/></label>
        <label>Критичность
          <select value={draft.criticality} onChange={event=>setDraft({...draft,criticality:event.target.value})}>
            {Object.entries(criticalityLabels).map(([id,label])=><option key={id} value={id}>{label}</option>)}
          </select>
        </label>
        <label>Источник данных <input value={draft.source_system} maxLength={120} required onChange={event=>setDraft({...draft,source_system:event.target.value})}/></label>
        <label>ID в источнике <input value={draft.source_record_id} maxLength={180} onChange={event=>setDraft({...draft,source_record_id:event.target.value})}/></label>
        <label>Примечания <textarea value={draft.notes} maxLength={2000} onChange={event=>setDraft({...draft,notes:event.target.value})}/></label>
        {(currentClass?.fields||[]).map(field=><label key={field.key}>
          {field.label}{currentClass?.required.includes(field.key)?' *':''}
          {field.type==='boolean'
            ? <select aria-label={field.label} value={String((draft.custom_values||{})[field.key]??'')}
                onChange={event=>updateCustom(field.key,event.target.value===''?'':event.target.value==='true')}>
                <option value="">Не указано</option><option value="true">Да</option><option value="false">Нет</option>
              </select>
            : field.type==='choice'
              ? <select aria-label={field.label} value={String((draft.custom_values||{})[field.key]??'')}
                  onChange={event=>updateCustom(field.key,event.target.value)}>
                  <option value="">Не указано</option>
                  {field.options.map(choice=><option key={choice} value={choice}>{choice}</option>)}
                </select>
              : <input aria-label={field.label} type={field.type==='number'?'number':'text'}
                  value={String((draft.custom_values||{})[field.key]??'')}
                  onChange={event=>updateCustom(field.key,field.type==='number'
                    ?event.target.value===''?'':Number(event.target.value):event.target.value)}/>}
        </label>)}
        <label>Причина изменения <textarea required minLength={5} value={reason} maxLength={1000} onChange={event=>setReason(event.target.value)} placeholder="Что изменено и на основании чего?"/></label>
        <div className="cmdbRecordButtons">
          <button type="submit" className="primary" disabled={busy||reason.trim().length<5}>{busy?'Сохраняем…':'Сохранить паспорт КЕ'}</button>
          <button type="button" disabled={busy} onClick={()=>{setDraft({...record});setReason('');setIsEditing(false);setError('')}}>Отменить</button>
        </div>
        <small>Изменение паспорта сбрасывает прежнее подтверждение. Техническая конфигурация и положение блоков не изменяются.</small>
      </form>}
      {!isEditing&&record.revision>0&&record.lifecycle!=='retired'&&
        <form className="cmdbVerificationForm" onSubmit={event=>{event.preventDefault();void verify()}}>
          <h4>Проверка актуальности</h4>
          <p>Проверяющий подтверждает запись на основании документа или источника. Проверка фиксируется в истории версий.</p>
          <label>Основание проверки <textarea minLength={5} required maxLength={2000} value={evidence} onChange={event=>setEvidence(event.target.value)} placeholder="Например, сверено с владельцем или инвентаризацией"/></label>
          <button type="submit" disabled={busy||evidence.trim().length<5}>Подтвердить актуальность</button>
        </form>}
      <div className="cmdbCatalogEntry">
        <button type="button" aria-expanded={showCatalog} onClick={()=>setShowCatalog(!showCatalog)}>
          {showCatalog?'Скрыть классификатор':'Классификатор и правила CMDB'}
        </button>
        {showCatalog&&<CmdbCatalog request={request} onChange={()=>void request<ClassesResponse>('/api/cmdb/classes').then(catalog=>setSchema(catalog.classes))}/>}
      </div>
      <details className="cmdbAuditHistory">
        <summary>История изменений ({history.length})</summary>
        {history.length===0?<p>Записей истории пока нет.</p>:
          <ol>{history.map(item=><li key={item.revision}>
            <strong>Версия {item.revision} – {item.action==='verification'?'Проверка':'Изменение'}</strong>
            <small>{formatDate(item.occurred_at)} · {item.actor_role}</small>
            <p>{item.reason}</p>
          </li>)}</ol>}
      </details>
    </>}
  </section>
}
