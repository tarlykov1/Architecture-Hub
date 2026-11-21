import {useEffect,useState} from 'react'
import {ArrowDown,ArrowUp,ChevronRight,Download,Plus,Save,Trash2,X} from 'lucide-react'
import {buildBusinessProcessMarkdown} from './businessProcessDocument'
import './businessProcessPassport.css'

type Api=<T>(url:string,init?:RequestInit)=>Promise<T>
type System={id:string;name:string;kind?:string}
type Component={id:string;name:string;system_id:string}
type Flow={id:string;name:string;source_id:string;target_id:string;protocol?:string;port?:string}
type Attribute={id:string;name:string;code:string;sensitivity?:string}
type Process={id:string;name:string;category_id:string;description?:string}
type Step={
 id:string;position:number;name:string;description:string;responsible:string
 input:string;output:string;system_id:string|null;component_id:string|null
 flow_id:string|null;attribute_ids:string[]
}
export type Passport={
 process_id:string;category_id:string;name:string;description:string
 parent_id:string|null;owner:string;participants:string;result:string
 status:'draft'|'active'|'retired';revision:number;updated_at:string|null;steps:Step[]
}
function freshStep():Step{
 return {id:crypto.randomUUID(),position:0,name:'',description:'',responsible:'',input:'',output:'',
   system_id:null,component_id:null,flow_id:null,attribute_ids:[]}
}
function values(p:Passport){
 return {parent_id:p.parent_id,owner:p.owner,participants:p.participants,
 result:p.result,status:p.status,steps:p.steps.map(s=>({
  id:s.id,name:s.name,description:s.description,responsible:s.responsible,
  input:s.input,output:s.output,system_id:s.system_id,
  component_id:s.component_id,flow_id:s.flow_id,attribute_ids:s.attribute_ids
 }))}
}
export function BusinessProcessPassport({processId,processes,systems,components,flows,
  request,canEdit,onClose,onSaved}:{
 processId:string;processes:Process[];systems:System[];components:Component[];flows:Flow[]
 request:Api;canEdit:boolean;onClose:()=>void;onSaved?:(passport:Passport)=>void
}){
 const [record,setRecord]=useState<Passport|null>(null)
 const [draft,setDraft]=useState<Passport|null>(null)
 const [attributes,setAttributes]=useState<Attribute[]>([])
 const [activeStep,setActiveStep]=useState('')
 const [view,setView]=useState<'steps'|'map'>('steps')
 const [busy,setBusy]=useState(false)
 const [error,setError]=useState('')
 const [message,setMessage]=useState('')
 const [loading,setLoading]=useState(true)
 const [refresh,setRefresh]=useState(0)
 useEffect(()=>{
  let live=true
  setLoading(true);setError('')
  Promise.all([
   request<Passport>('/api/business/process-passports/'+processId),
   request<Attribute[]>('/api/data-attributes').catch(()=>[] as Attribute[])
  ]).then(([data,attrs])=>{
   if(!live)return
   setRecord(data);setDraft({...data,steps:data.steps.map(s=>({...s,attribute_ids:[...s.attribute_ids]}))})
   setAttributes(attrs);setActiveStep('');setMessage('')
  }).catch(e=>{if(live)setError('Не удалось открыть паспорт БП: '+String(e))})
   .finally(()=>{if(live)setLoading(false)})
  return()=>{live=false}
 },[request,processId,refresh])
 const dirty=Boolean(record&&draft&&JSON.stringify(values(record))!==JSON.stringify(values(draft)))
 function close(){
  if(dirty&&!window.confirm('В паспорте БП есть несохранённые изменения. Закрыть?'))return
  onClose()
 }
 useEffect(()=>{
  const onKey=(event:KeyboardEvent)=>{
   if(event.key==='Escape'&&!(event.target instanceof Element&&event.target.closest('select,[aria-haspopup="listbox"]'))){
    event.stopPropagation();close()
   }
  }
  window.addEventListener('keydown',onKey)
  return()=>window.removeEventListener('keydown',onKey)
 })
 function modify(patch:Partial<Passport>){setDraft(row=>row?{...row,...patch}:row)}
 function modifyStep(stepId:string,patch:Partial<Step>){
  setDraft(row=>row?{...row,steps:row.steps.map(s=>s.id===stepId?{...s,...patch}:s)}:row)
 }
 function reorder(stepId:string,delta:number){
  setDraft(row=>{
   if(!row)return row
   const steps=row.steps.slice(),at=steps.findIndex(s=>s.id===stepId),to=at+delta
   if(at<0||to<0||to>=steps.length)return row
   ;[steps[at],steps[to]]=[steps[to],steps[at]]
   return {...row,steps:steps.map((s,i)=>({...s,position:i}))}
  })
 }
 function deleteStep(stepId:string){
  setDraft(row=>row?{...row,steps:row.steps.filter(s=>s.id!==stepId)
    .map((s,i)=>({...s,position:i}))}:row)
  if(activeStep===stepId)setActiveStep('')
 }
 function downloadDocument(){
  if(!record)return
  const markdown=buildBusinessProcessMarkdown(record,processes,systems,components,flows,attributes)
  const blob=new Blob([markdown],{type:'text/markdown;charset=utf-8'})
  const uri=URL.createObjectURL(blob)
  const link=document.createElement('a')
  link.href=uri
  link.download='ArchitectureHub_BP_'+record.name.replace(/[^\p{L}\p{N}_-]+/gu,'_').slice(0,62)+'_v'+record.revision+'.md'
  document.body.appendChild(link);link.click();link.remove()
  window.setTimeout(()=>URL.revokeObjectURL(uri),1000)
 }
 async function save(){
  if(!draft||!record||!canEdit||busy)return
  const trimmed=values(draft)
  if(trimmed.steps.some(s=>!s.name.trim())){
   setError('У каждого шага должно быть название.');return
  }
  setBusy(true);setError('');setMessage('')
  try{
   const saved=await request<Passport>('/api/business/process-passports/'+processId,{
    method:'PUT',body:JSON.stringify({...trimmed,expected_revision:record.revision})
   })
   setRecord(saved);setDraft({...saved,steps:saved.steps.map(s=>({...s,attribute_ids:[...s.attribute_ids]}))})
   setMessage('Паспорт сохранён · версия '+saved.revision)
   onSaved?.(saved)
  }catch(e){setError('Не удалось сохранить паспорт: '+String(e)+'. При конфликте версий обновите данные.')}
  finally{setBusy(false)}
 }
 const data=draft
 const siblings=processes.filter(p=>p.id!==processId&&p.category_id===record?.category_id)
 const names=new Map(components.map(c=>[c.id,c.name]))
 const selected=record?.steps.find(s=>s.id===activeStep)
 return <div className="editorBackdrop businessPassportBackdrop" onClick={close}>
  <section className="businessPassport" role="dialog" aria-modal="true" aria-label="Паспорт бизнес-процесса"
    onClick={e=>e.stopPropagation()}>
   <header className="businessPassportHeader">
    <div><small>Бизнес-архитектура / паспорт</small><h2>{record?.name||processes.find(p=>p.id===processId)?.name||'Бизнес-процесс'}</h2></div>
    <div className="businessPassportHeaderActions">
      {record&&<span className="businessPassportRevision">Версия {record.revision}</span>}
      <button type="button" aria-label="Закрыть паспорт БП" onClick={close}><X size={19}/></button>
    </div>
   </header>
   {loading?<p role="status">Загрузка паспорта…</p>:data&&record?<>
    <div className="businessPassportWorkspace">
     <div className="businessPassportMain">
      <div className="businessPassportTop">
       <div role="group" aria-label="Представление шагов БП">
        <button type="button" aria-pressed={view==='steps'} onClick={()=>setView('steps')}>Шаги</button>
        <button type="button" aria-pressed={view==='map'} onClick={()=>setView('map')}>Схема</button>
       </div>
       <span>{data.steps.length} шагов</span>
       {canEdit&&<button type="button" disabled={busy||data.steps.length>=100} onClick={()=>{
        const step=freshStep();step.position=data.steps.length
        modify({steps:[...data.steps,step]});setView('steps');setActiveStep(step.id)
       }}><Plus size={15}/> Добавить шаг</button>}
      </div>
      {view==='map'?<div className="businessStepMap" role="region" aria-label="Схема шагов бизнес-процесса">
       {data.steps.map((step,i)=><div key={step.id} className="businessStepMapRow">
        <button type="button" aria-pressed={activeStep===step.id} onClick={()=>{
          setView('steps');setActiveStep(step.id)
        }}>
         <small>Шаг {i+1}</small><strong>{step.name||'Без названия'}</strong>
         <span>{systems.find(s=>s.id===step.system_id)?.name||'ИС не указана'}</span>
         {step.flow_id&&<span>{flows.find(f=>f.id===step.flow_id)?.name||'Поток не найден'}</span>}
        </button>
        {i<data.steps.length-1&&<div className="businessStepMapArrow" aria-hidden="true">↓</div>}
       </div>)}
       {!data.steps.length&&<p>Добавьте шаги – схема будет строиться из той же модели.</p>}
      </div>:<div className="businessSteps" role="list" aria-label="Шаги бизнес-процесса">
       {data.steps.map((step,i)=><div role="listitem" className="businessStep" key={step.id}>
         <div className="businessStepHeading">
          <button type="button" className="businessStepSelect" aria-expanded={activeStep===step.id}
            onClick={()=>setActiveStep(activeStep===step.id?'':step.id)}>
            <span>{i+1}</span><strong>{step.name||'Новый шаг'}</strong>
            <small>{systems.find(s=>s.id===step.system_id)?.name||'Без ИС'}{step.flow_id?' · поток':''}</small>
            <ChevronRight size={16}/>
          </button>
          {canEdit&&<div className="businessStepActions">
           <button type="button" aria-label={'Поднять шаг БП '+(i+1)} disabled={busy||i===0} onClick={()=>reorder(step.id,-1)}><ArrowUp size={16}/></button>
           <button type="button" aria-label={'Опустить шаг БП '+(i+1)} disabled={busy||i===data.steps.length-1} onClick={()=>reorder(step.id,1)}><ArrowDown size={16}/></button>
           <button type="button" aria-label={'Удалить шаг БП '+(i+1)} disabled={busy} onClick={()=>deleteStep(step.id)}><Trash2 size={16}/></button>
          </div>}
         </div>
         {activeStep===step.id&&<div className="businessStepFields">
          <label>Название шага<input aria-label="Название шага БП" value={step.name} maxLength={250} disabled={!canEdit||busy} onChange={e=>modifyStep(step.id,{name:e.target.value})}/></label>
          <label>Описание<textarea aria-label="Описание шага БП" value={step.description} maxLength={2000} disabled={!canEdit||busy} onChange={e=>modifyStep(step.id,{description:e.target.value})}/></label>
          <label>Ответственный<input aria-label="Ответственный шага БП" value={step.responsible} maxLength={200} disabled={!canEdit||busy} onChange={e=>modifyStep(step.id,{responsible:e.target.value})}/></label>
          <div className="businessStepFieldGrid">
           <label>Вход<input aria-label="Вход шага БП" value={step.input} maxLength={2000} disabled={!canEdit||busy} onChange={e=>modifyStep(step.id,{input:e.target.value})}/></label>
           <label>Выход<input aria-label="Выход шага БП" value={step.output} maxLength={2000} disabled={!canEdit||busy} onChange={e=>modifyStep(step.id,{output:e.target.value})}/></label>
          </div>
          <label>Используемая ИС<select aria-label="ИС шага БП" value={step.system_id||''} disabled={!canEdit||busy}
            onChange={e=>modifyStep(step.id,{system_id:e.target.value||null,component_id:null})}>
           <option value="">Не выбрана</option>{systems.filter(s=>!s.kind||s.kind==='system').map(s=><option key={s.id} value={s.id}>{s.name}</option>)}
          </select></label>
          <label>Компонент<select aria-label="Компонент шага БП" value={step.component_id||''} disabled={!canEdit||busy||!step.system_id}
            onChange={e=>modifyStep(step.id,{component_id:e.target.value||null})}>
           <option value="">Не выбран</option>{components.filter(c=>c.system_id===step.system_id).map(c=><option key={c.id} value={c.id}>{c.name}</option>)}
          </select></label>
          <label>Технический поток<select aria-label="Поток шага БП" value={step.flow_id||''} disabled={!canEdit||busy}
            onChange={e=>modifyStep(step.id,{flow_id:e.target.value||null})}>
           <option value="">Не выбран</option>{flows.map(f=><option key={f.id} value={f.id}>{f.name} · {names.get(f.source_id)||'Источник'} → {names.get(f.target_id)||'Получатель'}</option>)}
          </select></label>
          <details className="businessStepAttributes"><summary>Атрибуты данных ({step.attribute_ids.length})</summary>
           <p>Ссылки на определения, без фактических значений персональных данных.</p>
           {attributes.length?attributes.map(a=><label key={a.id}><input type="checkbox" disabled={!canEdit||busy}
             checked={step.attribute_ids.includes(a.id)}
             onChange={e=>modifyStep(step.id,{attribute_ids:e.target.checked?[...step.attribute_ids,a.id]:step.attribute_ids.filter(id=>id!==a.id)})}/>
             <span>{a.name} <small>{a.code}</small></span></label>):<p>Атрибуты ещё не добавлены в реестр потоков.</p>}
          </details>
         </div>}
       </div>)}
       {!data.steps.length&&<div className="businessStepsEmpty">Шагов пока нет. Добавьте этап процесса и свяжите его с ИС или потоком.</div>}
      </div>}
     </div>
     <aside className="businessPassportSide" aria-label="Свойства бизнес-процесса">
      <h3>Свойства процесса</h3>
      <label>Владелец<input aria-label="Владелец бизнес-процесса" maxLength={200} value={data.owner} disabled={!canEdit||busy} onChange={e=>modify({owner:e.target.value})}/></label>
      <label>Участники<input aria-label="Участники бизнес-процесса" maxLength={1000} value={data.participants} disabled={!canEdit||busy} onChange={e=>modify({participants:e.target.value})}/></label>
      <label>Ожидаемый результат<textarea aria-label="Результат бизнес-процесса" maxLength={2000} value={data.result} disabled={!canEdit||busy} onChange={e=>modify({result:e.target.value})}/></label>
      <label>Состояние<select aria-label="Состояние бизнес-процесса" value={data.status} disabled={!canEdit||busy}
        onChange={e=>modify({status:e.target.value as Passport['status']})}>
        <option value="draft">Черновик</option><option value="active">Действует</option><option value="retired">Выведен</option>
      </select></label>
      <label>Родительский процесс<select aria-label="Родительский бизнес-процесс" value={data.parent_id||''} disabled={!canEdit||busy}
        onChange={e=>modify({parent_id:e.target.value||null})}>
        <option value="">Корневой процесс</option>{siblings.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}
      </select></label>
      <small>Редактирование названия и категории выполняется в реестре. Паспорт и шаги используют тот же ID бизнес-процесса.</small>
      <div className="businessPassportCounts">
       <strong>{new Set(data.steps.map(s=>s.system_id).filter(Boolean)).size}</strong><span>ИС</span>
       <strong>{new Set(data.steps.map(s=>s.flow_id).filter(Boolean)).size}</strong><span>Потоков</span>
      </div>
      {error&&<p role="alert" className="businessPassportError">{error}</p>}
      {message&&<p role="status" className="businessPassportSuccess">{message}</p>}
      <button type="button" title="Экспорт последней сохранённой версии паспорта" onClick={downloadDocument}><Download size={15}/> Скачать описание БП (.md)</button>
      {canEdit?<div className="businessPassportSaveActions">
       <button type="button" className="primary" disabled={!dirty||busy} onClick={()=>void save()}><Save size={16}/>{busy?'Сохранение…':'Сохранить паспорт'}</button>
       <button type="button" disabled={!dirty||busy} onClick={()=>{setDraft({...record,steps:record.steps.map(s=>({...s,attribute_ids:[...s.attribute_ids]}))});setError('')}}>Отменить изменения</button>
      </div>:<p>Режим просмотра. Для изменений требуются права на бизнес-архитектуру.</p>}
      <button type="button" disabled={busy} onClick={()=>{
       if(dirty&&!window.confirm('Отбросить изменения и загрузить серверную версию?'))return
       setRefresh(v=>v+1)
      }}>Обновить данные</button>
     </aside>
    </div>
   </>:null}
   {!loading&&error&&!data&&<p role="alert" className="businessPassportError">{error}</p>}
  </section>
 </div>
}
