import {useEffect,useMemo,useState} from 'react'
import './decisionExistingChanges.css'

export type ExistingChange={
  id:string
  kind:'vm'|'flow'
  action:'update'|'remove'
  fields:Record<string,string>
  before:Record<string,string>
  after:Record<string,string>|null
  impacts?:string[]
}
export type ExistingInput=Pick<ExistingChange,'id'|'kind'|'action'|'fields'>

type Vm={id:string;name:string;kind:string;system_id:string;description?:string;details?:Record<string,unknown>}
type Flow={id:string;name:string;source_id:string;target_id:string;protocol:string;port:string;data_description?:string;security?:string;schedule?:string;verification?:string}

const labels:Record<string,string>={
  name:'Название',kind:'Тип',description:'Описание',environment:'Среда',
  source_id:'Источник',target_id:'Получатель',protocol:'Протокол',
  port:'Порт',data_description:'Состав данных',security:'Защита',
  schedule:'Периодичность',verification:'Достоверность',
}
const VM_KEYS=['name','kind','description','environment']
const FLOW_KEYS=['name','source_id','target_id','protocol','port','data_description','security','schedule','verification']

export function existingDiff(change:ExistingChange){
  return (change.action==='remove'?Object.keys(change.before):Object.keys(change.fields))
    .map(key=>({
      key,label:labels[key]||key,
      before:change.before[key]||'—',after:change.after?.[key]||'—',
    }))
}
export function existingSummary(changes:ExistingChange[]){
  return {
    changed:changes.filter(c=>c.action==='update').length,
    removed:changes.filter(c=>c.action==='remove').length,
  }
}

export function DecisionExistingChanges({
  systemId,items,flows,changes,editable,busy,onSave,onFocus,
  initialTarget,
}:{
  systemId:string
  items:Vm[]
  flows:Flow[]
  changes:ExistingChange[]
  editable:boolean
  busy:boolean
  onSave:(changes:ExistingInput[])=>void
  onFocus?:(kind:'vm'|'flow',id:string)=>void
  initialTarget?:{kind:'vm'|'flow';id:string}|null
}){
  const local=useMemo(()=>items.filter(i=>i.system_id===systemId),[items,systemId])
  const localIds=useMemo(()=>new Set(local.map(i=>i.id)),[local])
  const localFlows=useMemo(()=>flows.filter(f=>localIds.has(f.source_id)||localIds.has(f.target_id)),[flows,localIds])
  const [kind,setKind]=useState<'vm'|'flow'>('vm')
  const [id,setId]=useState('')
  const [action,setAction]=useState<'update'|'remove'>('update')
  const [values,setValues]=useState<Record<string,string>>({})
  const [error,setError]=useState('')
  const [editing,setEditing]=useState(false)
  const selectedVM=local.find(x=>x.id===id)
  const selectedFlow=localFlows.find(x=>x.id===id)
  const selectedChange=changes.find(c=>c.id===id&&c.kind===kind)
  const currentIds=kind==='vm'?local:localFlows
  const registered=kind==='vm'&&selectedVM?{
    name:selectedVM.name,kind:selectedVM.kind,description:selectedVM.description||'',
    environment:String(selectedVM.details?.environment||''),
  }:kind==='flow'&&selectedFlow?{
    name:selectedFlow.name,source_id:selectedFlow.source_id,target_id:selectedFlow.target_id,
    protocol:selectedFlow.protocol||'',port:selectedFlow.port||'',
    data_description:selectedFlow.data_description||'',security:selectedFlow.security||'',
    schedule:selectedFlow.schedule||'',verification:selectedFlow.verification||'draft',
  }:{}
  const keys=kind==='vm'?VM_KEYS:FLOW_KEYS
  const names=new Map(items.map(item=>[item.id,item.name]))
  const fieldName=(key:string,value:string)=>(
    (key==='source_id'||key==='target_id')?names.get(value)||value:value
  )

  function choose(nextKind:'vm'|'flow',nextId:string){
    setKind(nextKind);setId(nextId);setError('')
    const entry=changes.find(c=>c.kind===nextKind&&c.id===nextId)
    setAction(entry?.action||'update')
    const v=nextKind==='vm'?local.find(x=>x.id===nextId):localFlows.find(x=>x.id===nextId)
    if(nextKind==='vm'&&v){
      const vm=v as Vm
      setValues({...{
        name:vm.name,kind:vm.kind,description:vm.description||'',
        environment:String(vm.details?.environment||''),
      },...(entry?.after||{})})
    }else if(nextKind==='flow'&&v){
      const flow=v as Flow
      setValues({...{
        name:flow.name,source_id:flow.source_id,target_id:flow.target_id,
        protocol:flow.protocol||'',port:flow.port||'',data_description:flow.data_description||'',
        security:flow.security||'',schedule:flow.schedule||'',verification:flow.verification||'draft',
      },...(entry?.after||{})})
    }else setValues({})
    setEditing(Boolean(nextId))
  }
  useEffect(()=>{
    if(initialTarget?.id)choose(initialTarget.kind,initialTarget.id)
    // Only react to externally requested targets; never reset ongoing forms
    // when a parent list refreshes from the backend.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[initialTarget?.id,initialTarget?.kind])

  function stage(event:React.FormEvent){
    event.preventDefault()
    if(!editable||busy||!id)return
    const fields:Record<string,string>={}
    for(const key of keys){
      if((values[key]||'')!==(registered[key as keyof typeof registered]||'')){
        fields[key]=values[key]||''
      }
    }
    if(action==='update'&&!Object.keys(fields).length){
      setError('Изменений нет. Укажите отличающееся значение.')
      return
    }
    setError('')
    const next:ExistingInput={
      id,kind,action,fields:action==='remove'?{}:fields,
    }
    onSave([...changes.filter(c=>c.id!==id||c.kind!==kind).map(c=>({
      id:c.id,kind:c.kind,action:c.action,fields:c.fields,
    })),next])
    setEditing(false)
  }
  const count=existingSummary(changes)
  return <section className="decisionExistingChanges" aria-label="Изменения действующей архитектуры">
    <header className="decisionExistingHeader">
      <div><h4>Действующие объекты – план изменений</h4>
        <small>Изменения остаются в проекте и не применяются к реестру.</small>
      </div>
      <span>{count.changed} изменено · {count.removed} к удалению</span>
    </header>
    <div className="decisionExistingList">
      {changes.map(change=>{
        const target=change.kind==='vm'?items.find(i=>i.id===change.id):flows.find(i=>i.id===change.id)
        return <article key={change.kind+':'+change.id} className={'decisionExistingCard '+change.action}>
          <header>
            <span>{change.action==='update'?'Изменится':'Планируется удаление'} · {change.kind==='vm'?'ВМ':'Поток'}</span>
            <strong>{change.before.name||target?.name||change.id}</strong>
            {editable&&<button type="button" disabled={busy} onClick={()=>choose(change.kind,change.id)}>Изменить план</button>}
          </header>
          <table><tbody>{existingDiff(change).map(diff=><tr key={diff.key}>
            <th scope="row">{diff.label}</th><td>{fieldName(diff.key,diff.before)}</td>
            <td aria-label={'После: '+diff.label}>{change.action==='remove'?'Удалить':fieldName(diff.key,diff.after)}</td>
          </tr>)}</tbody></table>
          {!!change.impacts?.length&&<div className="decisionExistingImpacts" role="note">
            <strong>Зависимости, требующие проверки</strong>
            {change.impacts.map(x=><span key={x}>{x}</span>)}
          </div>}
          <div className="decisionExistingActions">
            {onFocus&&<button type="button" onClick={()=>onFocus(change.kind,change.id)}>На схеме</button>}
            {editable&&<button type="button" disabled={busy} onClick={()=>{
              if(!window.confirm('Убрать запланированное изменение? Действующий объект останется без изменений.'))return
              onSave(changes.filter(c=>c.id!==change.id||c.kind!==change.kind).map(c=>({
                id:c.id,kind:c.kind,action:c.action,fields:c.fields,
              })))
            }}>Отменить план</button>}
          </div>
        </article>
      })}
      {!changes.length&&<p className="decisionExistingEmpty">Изменений существующих компонентов и потоков пока нет.</p>}
    </div>
    {editable&&<div className="decisionExistingEditor">
      <h4>Запланировать изменение</h4>
      <label>Тип объекта<select aria-label="Тип изменяемого объекта" value={kind}
        onChange={e=>choose(e.target.value as 'vm'|'flow','')}>
        <option value="vm">Компонент / ВМ</option>
        <option value="flow">Технический поток</option>
      </select></label>
      <label>Объект<select aria-label="Действующий объект для изменения" value={id} onChange={e=>choose(kind,e.target.value)}>
        <option value="">Выберите объект</option>
        {currentIds.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}
      </select></label>
      {id&&editing&&<form onSubmit={stage}>
        <label>Действие<select aria-label="Планируемое действие" value={action} onChange={e=>setAction(e.target.value as 'update'|'remove')}>
          <option value="update">Изменить параметры</option>
          <option value="remove">Запланировать удаление</option>
        </select></label>
        {action==='update'?<div className="decisionExistingFields">
          {keys.map(key=><label key={key}>{labels[key]}
            {(key==='kind'||key==='verification')?<select aria-label={'Новое значение: '+labels[key]} value={values[key]||''}
              onChange={e=>setValues(v=>({...v,[key]:e.target.value}))}>
              {(key==='kind'?['vm','server','host']:['draft','assumed','verified']).map(x=><option key={x} value={x}>{x}</option>)}
            </select>:(key==='source_id'||key==='target_id')?<select aria-label={'Новое значение: '+labels[key]} value={values[key]||''}
              onChange={e=>setValues(v=>({...v,[key]:e.target.value}))}>
              {items.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}
            </select>:key==='description'||key==='data_description'?<textarea
              aria-label={'Новое значение: '+labels[key]} value={values[key]||''}
              onChange={e=>setValues(v=>({...v,[key]:e.target.value}))}/>
            :<input aria-label={'Новое значение: '+labels[key]} value={values[key]||''}
              onChange={e=>setValues(v=>({...v,[key]:e.target.value}))}/>}
          </label>)}
        </div>:<p>Удаление только запланировано. Зависимые технические потоки нужно предварительно отметить к удалению. Реальные объекты не удаляются.</p>}
        {error&&<p role="alert">{error}</p>}
        <div className="decisionExistingActions">
          <button type="submit" className="primary" disabled={busy}>Сохранить в черновик</button>
          <button type="button" onClick={()=>{setEditing(false);setError('')}}>Отмена</button>
        </div>
      </form>}
      {!id&&<small>Для удаления ВМ сначала запланируйте удаление её подключённых потоков и отсоединение сетевых интерфейсов.</small>}
    </div>}
  </section>
}
