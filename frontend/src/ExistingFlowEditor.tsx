import {useState, type FormEvent} from 'react'

/** Technical attributes of one persisted directed flow; endpoints stay immutable. */
export type FlowValues = {
 name:string
 protocol:string
 port:string
 security:string
 data_description:string
 schedule:string
 verification:string
}

type Props={
 original:FlowValues
 current:FlowValues
 sourceName:string
 targetName:string
 staged:boolean
 onStage:(values:FlowValues)=>void
 onUndo:()=>void
 onClose:()=>void
}

export default function ExistingFlowEditor({original,current,sourceName,targetName,staged,onStage,onUndo,onClose}:Props){
 const [values,setValues]=useState<FlowValues>(current)
 const [invalid,setInvalid]=useState('')
 const set=(key:keyof FlowValues,value:string)=>{setValues(v=>({...v,[key]:value}));setInvalid('')}
 const submit=(event:FormEvent<HTMLFormElement>)=>{
  event.preventDefault()
  const next={...values,name:values.name.trim()}
  if(!next.name){setInvalid('Название потока обязательно.');return}
  if((Object.keys(next) as Array<keyof FlowValues>).every(k=>next[k]===original[k])){
   setInvalid('Параметры не изменились.');return
  }
  onStage(next)
 }
 return <form className="boardExistingFlowEditor" aria-label="Редактирование существующего потока" onSubmit={submit}>
  <div className="boardExistingFlowHeading"><div><strong>Паспорт сохранённого потока</strong><small>{sourceName} → {targetName}</small></div><button type="button" onClick={onClose} aria-label="Закрыть редактирование потока">✕</button></div>
  <p>Изменения не применяются сразу. Они попадут в черновик и журнал только после подтверждения. Чтобы поменять источник или получателя, создайте новый поток.</p>
  {staged&&<p className="boardExistingFlowStaged" role="status">Изменение этого потока уже добавлено в черновик.</p>}
  <label>Название потока<input required maxLength={250} value={values.name} onChange={e=>set('name',e.target.value)}/></label>
  <div className="boardExistingFlowFields">
   <label>Протокол<input maxLength={80} value={values.protocol} placeholder="Не указан" onChange={e=>set('protocol',e.target.value)}/></label>
   <label>Порт<input maxLength={80} value={values.port} placeholder="Не указан" onChange={e=>set('port',e.target.value)}/></label>
  </div>
  <label>Защита<input maxLength={80} value={values.security} placeholder="unknown" onChange={e=>set('security',e.target.value)}/></label>
  <label>Описание данных<textarea maxLength={4000} rows={3} value={values.data_description} onChange={e=>set('data_description',e.target.value)}/></label>
  <label>Периодичность<input maxLength={160} value={values.schedule} placeholder="По событию / ежедневно" onChange={e=>set('schedule',e.target.value)}/></label>
  <label>Достоверность<select value={values.verification} onChange={e=>set('verification',e.target.value)}>
   <option value="draft">Черновик</option>
   <option value="assumed">Предположение</option>
   <option value="verified">Подтверждено</option>
  </select></label>
  {invalid&&<p role="alert" className="boardFlowValidation">{invalid}</p>}
  <div className="boardExistingFlowActions"><button type="submit">Добавить изменение в черновик</button>{staged&&<button type="button" onClick={()=>{setValues(original);onUndo()}}>Отменить правку потока</button>}</div>
 </form>
}
