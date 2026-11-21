import {useEffect, useState, type CSSProperties} from 'react'
import {ArrowDown, ArrowUp, Plus, Trash2} from 'lucide-react'
import {workspaceRouteUrl} from './workspaceRoutes'
import type {OverviewFlow} from './OverviewFlowEdge'
import './flowSequence.css'

export type SystemExchange = {source: string; target: string; flow: OverviewFlow}
type Api = <T>(url:string,init?:RequestInit)=>Promise<T>
type Step = {id:string;flow_id:string;reply:boolean;note:string;position?:number}
type Scenario = {
  id:string;name:string;description:string;process_id:string|null;
  revision:number;steps:Step[];created_at:string;updated_at:string
}
type Settings = {order:string[];replies:string[]}
type SequenceRow = SystemExchange & {stepId:string;reply:boolean;note:string}

const storageKey='archhub-flow-sequence-v1'
const selectedKey='archhub-flow-scenario-selection-v1'

function readSettings():Settings{
  try{
    const value=JSON.parse(localStorage.getItem(storageKey)||'{}')
    const ids=(list:unknown):string[]=>Array.isArray(list)?list.filter(id=>typeof id==='string'):[]
    return {order:ids(value.order),replies:ids(value.replies)}
  }catch{return {order:[],replies:[]}}
}
function readSelected(){
  try{return localStorage.getItem(selectedKey)||''}catch{return ''}
}
function freshStep(flow_id:string,reply=false):Step{
  return {id:crypto.randomUUID(),flow_id,reply,note:''}
}
function payload(row:Scenario){
  return {
    name:row.name.trim(),description:row.description.trim(),process_id:row.process_id,
    steps:row.steps.map(({id,flow_id,reply,note})=>({id,flow_id,reply,note}))
  }
}

export function FlowSequence({exchanges,systems,visible,request,processes=[],canEdit=false}:{
  exchanges:SystemExchange[]
  systems:{id:string;name:string}[]
  visible:Set<string>
  request?:Api
  processes?:{id:string;name:string}[]
  canEdit?:boolean
}){
  const [settings,setSettings]=useState(readSettings)
  const [editing,setEditing]=useState(false)
  const [storageError,setStorageError]=useState(false)
  const [scenarios,setScenarios]=useState<Scenario[]>([])
  const [selected,setSelected]=useState(readSelected)
  const [draft,setDraft]=useState<Scenario|null>(null)
  const [busy,setBusy]=useState(false)
  const [loading,setLoading]=useState(Boolean(request))
  const [error,setError]=useState('')
  const [notice,setNotice]=useState('')
  const [creating,setCreating]=useState(false)
  const [newName,setNewName]=useState('')
  const [newDescription,setNewDescription]=useState('')
  const [newProcess,setNewProcess]=useState('')
  const [newFlowId,setNewFlowId]=useState('')
  useEffect(()=>{
    if(!request){setScenarios([]);setLoading(false);return}
    let active=true
    setLoading(true)
    request<Scenario[]>('/api/flow-scenarios')
      .then(rows=>{if(active){setScenarios(Array.isArray(rows)?rows:[]);setError('')}})
      .catch(e=>{if(active)setError('Не удалось получить сценарии: '+String(e))})
      .finally(()=>{if(active)setLoading(false)})
    return()=>{active=false}
  },[request])

  const selectedScenario=scenarios.find(row=>row.id===selected)
  const current=selectedScenario&&(draft?.id===selectedScenario.id?draft:selectedScenario)
  const dirty=Boolean(current&&draft&&JSON.stringify(payload(draft))!==JSON.stringify(payload(selectedScenario!)))
  const flowById=new Map(exchanges.map(row=>[row.flow.id,row]))
  const ranks=new Map(settings.order.map((id,i)=>[id,i]))
  const orderedLocal=[...exchanges].sort((a,b)=>
    (ranks.get(a.flow.id)??Infinity)-(ranks.get(b.flow.id)??Infinity)
    ||a.flow.name.localeCompare(b.flow.name,'ru')||a.flow.id.localeCompare(b.flow.id)
  )
  const allRows:SequenceRow[]=current
    ?current.steps.flatMap(step=>{
      const found=flowById.get(step.flow_id)
      return found?[{...found,stepId:step.id,reply:step.reply,note:step.note}]:[]
    })
    :orderedLocal.map(found=>({...found,stepId:found.flow.id,reply:settings.replies.includes(found.flow.id),note:''}))
  const missing=current?current.steps.length-allRows.length:0
  const rows=allRows.filter(row=>visible.has(row.source)||visible.has(row.target))
  const involved=new Set(rows.flatMap(row=>[row.source,row.target]))
  const participants=systems.filter(system=>involved.has(system.id)).map(system=>system.id)
  const lanes=new Map(participants.map((id,index)=>[id,index]))
  const names=new Map(systems.map(s=>[s.id,s.name]))
  const canManage=canEdit&&Boolean(request)
  const saveLocal=(next:Settings)=>{
    setSettings(next)
    try{localStorage.setItem(storageKey,JSON.stringify(next));setStorageError(false)}
    catch{setStorageError(true)}
  }
  function changeSelection(next:string){
    if(dirty&&!window.confirm('Есть несохранённые изменения сценария. Отбросить их?'))return
    setSelected(next);setDraft(null);setEditing(false);setCreating(false);setError('');setNotice('')
    try{localStorage.setItem(selectedKey,next)}catch{/* Selection is a convenience only. */}
  }
  function changeDraft(change:(row:Scenario)=>Scenario){
    if(!selectedScenario)return
    setDraft(previous=>change(previous?.id===selectedScenario.id?previous:{...selectedScenario,steps:[...selectedScenario.steps]}))
  }
  function move(index:number,offset:number){
    if(current){
      const src=current.steps.findIndex(step=>step.id===rows[index]?.stepId)
      const target=current.steps.findIndex(step=>step.id===rows[index+offset]?.stepId)
      if(src<0||target<0)return
      changeDraft(old=>{
        const steps=old.steps.slice()
        ;[steps[src],steps[target]]=[steps[target],steps[src]]
        return {...old,steps}
      })
      return
    }
    const order=orderedLocal.map(row=>row.flow.id)
    const a=order.indexOf(rows[index].flow.id),b=order.indexOf(rows[index+offset].flow.id)
    ;[order[a],order[b]]=[order[b],order[a]]
    saveLocal({...settings,order})
  }
  function markReply(id:string,reply:boolean){
    if(current)changeDraft(old=>({...old,steps:old.steps.map(step=>step.id===id?{...step,reply}:step)}))
    else saveLocal({...settings,replies:reply?[...settings.replies,id]:settings.replies.filter(x=>x!==id)})
  }
  async function createScenario(){
    if(!request||!canManage||!newName.trim()||!rows.length)return
    setBusy(true);setError('');setNotice('')
    try{
      const result=await request<Scenario>('/api/flow-scenarios',{method:'POST',body:JSON.stringify({
        name:newName.trim(),description:newDescription.trim(),process_id:newProcess||null,
        steps:rows.map(row=>freshStep(row.flow.id,row.reply)),
      })})
      setScenarios(previous=>[...previous,result].sort((a,b)=>a.name.localeCompare(b.name,'ru')))
      setSelected(result.id);setDraft(result);setEditing(false);setCreating(false);setNewName('');setNewDescription('');setNewProcess('')
      setNotice('Общий сценарий сохранён в реестре.')
      try{localStorage.setItem(selectedKey,result.id)}catch{}
    }catch(e){setError('Не удалось создать сценарий: '+String(e))}
    finally{setBusy(false)}
  }
  async function saveScenario(){
    if(!request||!current||!selectedScenario||!canManage||!dirty)return
    if(!current.name.trim()){setError('Укажите название сценария.');return}
    setBusy(true);setError('');setNotice('')
    try{
      const result=await request<Scenario>('/api/flow-scenarios/'+current.id,{
        method:'PUT',body:JSON.stringify({...payload(current),expected_revision:selectedScenario.revision})
      })
      setScenarios(old=>old.map(row=>row.id===result.id?result:row).sort((a,b)=>a.name.localeCompare(b.name,'ru')))
      setDraft(null);setEditing(false);setNotice('Версия сценария сохранена: '+result.revision)
    }catch(e){setError('Не удалось сохранить сценарий: '+String(e)+'. При конфликте обновите страницу.')}
    finally{setBusy(false)}
  }
  async function deleteScenario(){
    if(!request||!current||!canManage)return
    if(!window.confirm('Удалить общий сценарий «'+current.name+'»? Технические потоки останутся в реестре.'))return
    setBusy(true);setError('');setNotice('')
    try{
      await request('/api/flow-scenarios/'+current.id,{method:'DELETE'})
      setScenarios(old=>old.filter(row=>row.id!==current.id))
      // Deletion is already confirmed; never show an additional unsaved-form
      // prompt or leave the browser pointing to a removed server scenario.
      setSelected('');setDraft(null);setEditing(false);setCreating(false)
      try{localStorage.removeItem(selectedKey)}catch{}
      setNotice('Сценарий удалён. Технические потоки сохранены.')
    }catch(e){setError('Не удалось удалить сценарий: '+String(e))}
    finally{setBusy(false)}
  }
  return <section className="flowSequence" aria-label="Диаграмма последовательности">
    <div className="sequenceTools">
      {request&&<label className="sequenceScenarioSelect">Сценарий
        <select aria-label="Сценарий обмена" value={selectedScenario?.id||''} disabled={busy||loading}
          onChange={event=>changeSelection(event.target.value)}>
          <option value="">Общая последовательность (локально)</option>
          {scenarios.map(row=><option key={row.id} value={row.id}>{row.name}</option>)}
        </select>
      </label>}
      <span>{current
        ?'Общий сценарий · версия '+current.revision+(current.process_id?' · БП: '+(processes.find(p=>p.id===current.process_id)?.name||'Неизвестен'):'')
        :settings.order.length?'Порядок шагов задан в этом браузере':'Потоки по названию · порядок шагов не задан'}</span>
      {(!current||canManage)&&<button type="button" aria-pressed={editing} disabled={busy}
        onClick={()=>setEditing(value=>!value)}>{editing?'Готово':'Настроить шаги'}</button>}
      {canManage&&!current&&rows.length>0&&<button type="button" onClick={()=>setCreating(value=>!value)}>
        <Plus size={14}/> Сохранить как сценарий
      </button>}
      {canManage&&current&&<div className="sequenceSaveActions">
        <button type="button" disabled={busy||!dirty} onClick={()=>void saveScenario()}>Сохранить сценарий</button>
        <button type="button" disabled={busy||!dirty} onClick={()=>{setDraft(null);setEditing(false);setError('')}}>Отменить изменения</button>
        <button type="button" disabled={busy} aria-label="Удалить сценарий" onClick={()=>void deleteScenario()}><Trash2 size={15}/></button>
      </div>}
      {storageError&&<span role="status">Настройки доступны до закрытия страницы.</span>}
    </div>
    {creating&&!current&&<form className="sequenceCreate" onSubmit={event=>{event.preventDefault();void createScenario()}}>
      <label>Название сценария<input aria-label="Название нового сценария" required maxLength={200} value={newName} onChange={e=>setNewName(e.target.value)}/></label>
      <label>Связанный БП<select aria-label="Бизнес-процесс сценария" value={newProcess} onChange={e=>setNewProcess(e.target.value)}>
        <option value="">Не выбран</option>
        {processes.map(process=><option key={process.id} value={process.id}>{process.name}</option>)}
      </select></label>
      <label>Описание<input aria-label="Описание нового сценария" maxLength={2000} value={newDescription} onChange={e=>setNewDescription(e.target.value)}/></label>
      <button type="submit" disabled={busy||!newName.trim()}>Сохранить общий сценарий</button>
      <button type="button" onClick={()=>setCreating(false)}>Отмена</button>
    </form>}
    {current&&editing&&canManage&&<div className="sequenceEditMeta">
      <label>Название<input aria-label="Название выбранного сценария" value={current.name} maxLength={200} onChange={e=>changeDraft(row=>({...row,name:e.target.value}))}/></label>
      <label>Бизнес-процесс<select aria-label="Бизнес-процесс выбранного сценария" value={current.process_id||''} onChange={e=>changeDraft(row=>({...row,process_id:e.target.value||null}))}>
        <option value="">Не выбран</option>{processes.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}
      </select></label>
      <label>Описание<input aria-label="Описание выбранного сценария" value={current.description} maxLength={2000} onChange={e=>changeDraft(row=>({...row,description:e.target.value}))}/></label>
      <label>Добавить поток
        <select aria-label="Поток для нового шага" value={newFlowId} onChange={e=>setNewFlowId(e.target.value)}>
          <option value="">Выберите зарегистрированный поток</option>
          {exchanges.map(x=><option key={x.flow.id} value={x.flow.id}>{x.flow.name}</option>)}
        </select>
      </label>
      <button type="button" disabled={!newFlowId} onClick={()=>changeDraft(row=>({...row,steps:[...row.steps,freshStep(newFlowId)]}))}>Добавить шаг</button>
    </div>}
    {missing>0&&<p role="alert" className="sequenceIssue">{missing} шагов ссылаются на недоступные потоки. Проверьте состав сценария.</p>}
    {error&&<p role="alert" className="sequenceIssue">{error}</p>}
    {notice&&<p role="status" className="sequenceNotice">{notice}</p>}
    {!rows.length?<div className="sequenceEmpty" role="status">Для выбранных систем нет зарегистрированных потоков.</div>:
    <div className="sequenceScroll" tabIndex={0} role="region" aria-label="Участники и шаги обмена">
      <div className="sequenceSheet" style={{'--lanes':participants.length} as CSSProperties}>
        <div className="sequenceHead">{participants.map(id=><strong key={id}>{names.get(id)}</strong>)}</div>
        <ol className="sequenceSteps">{rows.map(({source,target,flow,stepId,reply,note},index)=>{
          const start=lanes.get(source)!,end=lanes.get(target)!
          const same=start===end
          const label=flow.name||flow.data_description||'Поток данных'
          return <li key={stepId} className="sequenceRow">
            <div className={'sequenceMessage'+(start>end?' backwards':'')+(same?' self':'')+(reply?' reply':'')}
              style={{gridColumn:(Math.min(start,end)*2+2)+' / span '+(same?1:2*Math.abs(start-end))}}>
              <a href={workspaceRouteUrl('flows','','',false,flow.id)}
                aria-label={`${index+1}. ${label}. ${names.get(source)} → ${names.get(target)}${reply?'. Ответ':''}`}>
                <span>{index+1}.</span> {label}
              </a>
              <div className="sequenceArrow" aria-hidden="true"/>
              {note&&<small className="sequenceNote">{note}</small>}
              {editing&&<div className="sequenceActions">
                <button type="button" aria-label={'Поднять шаг '+label} disabled={index===0||busy} onClick={()=>move(index,-1)}><ArrowUp size={15}/></button>
                <button type="button" aria-label={'Опустить шаг '+label} disabled={index===rows.length-1||busy} onClick={()=>move(index,1)}><ArrowDown size={15}/></button>
                <label><input type="checkbox" checked={reply} disabled={busy} onChange={()=>markReply(stepId,!reply)}/> Ответ</label>
                {current&&canManage&&<>
                  <input aria-label={'Примечание шага '+(index+1)} value={note}
                    maxLength={1000} onChange={e=>changeDraft(row=>({...row,steps:row.steps.map(step=>step.id===stepId?{...step,note:e.target.value}:step)}))}/>
                  <button type="button" disabled={busy} aria-label={'Удалить шаг '+(index+1)}
                    onClick={()=>changeDraft(row=>({...row,steps:row.steps.filter(step=>step.id!==stepId)}))}><Trash2 size={14}/></button>
                </>}
              </div>}
            </div>
          </li>
        })}</ol>
      </div>
    </div>}
  </section>
}
