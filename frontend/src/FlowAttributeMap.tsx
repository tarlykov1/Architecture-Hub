import {useEffect,useRef,useState,type FormEvent} from 'react'
import FlowAttributeReview from './FlowAttributeReview'

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
 revision:string
 source_id:string
 target_id:string
 attributes:FlowDataMapEntry[]
}
type CatalogAttribute={id:string;code:string;name:string;description:string;data_type:string;sensitivity:string}
type Props={
 flowId:string
 request:<T>(url:string,init?:RequestInit)=>Promise<T>
}

const sensitivityLabel:Record<string,string>={
 unclassified:'Не указана',internal:'Внутренние данные',
 personal:'Персональные данные',restricted:'Ограниченный доступ'
}
const initialNewAttribute=()=>({name:'',description:'',data_type:'string',sensitivity:'unclassified'})

/**
 * The flow passport is the primary place to define and attach a field.
 * Catalog definitions are shared by flows; actual personal-data values
 * never enter the architecture registry.
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
 const [editing,setEditing]=useState<FlowDataMapEntry|null>(null)
 const [notice,setNotice]=useState('')
 const [addOpen,setAddOpen]=useState(false)
 const [addMode,setAddMode]=useState<'existing'|'new'>('existing')
 const [catalog,setCatalog]=useState<CatalogAttribute[]>([])
 const [catalogLoading,setCatalogLoading]=useState(false)
 const [catalogQuery,setCatalogQuery]=useState('')
 const [catalogSelected,setCatalogSelected]=useState('')
 const [newAttribute,setNewAttribute]=useState(initialNewAttribute)
 const [saving,setSaving]=useState(false)

 useEffect(()=>{
  let active=true
  setLoading(true);setError('');setData(null);setAddOpen(false);setEditing(null);setNotice('')
  void api.current<FlowDataMapResponse>('/api/flows/'+flowId+'/data-map')
   .then(result=>{if(active){setData(result);setLoading(false)}})
   .catch(err=>{if(active){setError(err instanceof Error?err.message:'Не удалось загрузить состав данных');setLoading(false)}})
  return ()=>{active=false}
 },[flowId,revision])

 useEffect(()=>{
  if(!addOpen)return
  let active=true
  setCatalogLoading(true)
  void api.current<CatalogAttribute[]>('/api/data-attributes')
   .then(result=>{if(active){setCatalog(result);setCatalogLoading(false)}})
   .catch(err=>{if(active){setError('Не удалось открыть справочник атрибутов: '+String(err));setCatalogLoading(false)}})
  return ()=>{active=false}
 },[addOpen])

 const entries=data?.attributes||[]
 const processes=Array.from(new Map(entries.map(row=>[row.process_id||'none',row.process_name||'Без бизнес-процесса'])).entries())
 const consumers=Array.from(new Map(entries.map(row=>[row.consumer_system_id||'none',row.consumer_system_name||'Без системы-потребителя'])).entries())
 const filtered=entries.filter(row=>
  (processFilter==='all'||(row.process_id||'none')===processFilter)&&
  (consumerFilter==='all'||(row.consumer_system_id||'none')===consumerFilter))
 const catalogMatches=catalog.filter(attr=>
  [attr.name,attr.code,attr.description].join(' ').toLocaleLowerCase('ru').includes(catalogQuery.toLocaleLowerCase('ru')))
 const linkedWithoutContext=new Set(entries.filter(e=>!e.process_id&&!e.consumer_system_id).map(e=>e.attribute_id))
 const selectedDefinition=catalog.find(attr=>attr.id===catalogSelected)

 function openAdd(){
  setError('');setNotice('');setAddOpen(true);setAddMode('existing')
  setCatalogQuery('');setCatalogSelected('');setNewAttribute(initialNewAttribute())
 }
 async function addAttribute(event:FormEvent){
  event.preventDefault()
  if(!data||saving)return
  if(addMode==='existing'&&!catalogSelected){setError('Выберите атрибут из списка.');return}
  if(addMode==='new'&&!newAttribute.name.trim()){setError('Укажите название нового атрибута.');return}
  setSaving(true);setError('')
  try{
   await api.current('/api/flows/'+flowId+'/attributes',{
    method:'POST',body:JSON.stringify({
     expected_revision:data.revision,
     ...(addMode==='existing'?{attribute_id:catalogSelected}:{
      new_attribute:{...newAttribute,name:newAttribute.name.trim()}
     })
    })
   })
   const label=addMode==='existing'?selectedDefinition?.name||'Атрибут':newAttribute.name.trim()
   setAddOpen(false);setNotice('«'+label+'» добавлен в поток.')
   setRevision(value=>value+1)
  }catch(err){setError('Не удалось добавить атрибут: '+String(err))}
  finally{setSaving(false)}
 }
 async function unlink(row:FlowDataMapEntry){
  if(!data||saving)return
  if(!window.confirm('Убрать «'+row.name+'» из этого потока? Сам атрибут останется в общем справочнике.'))return
  setSaving(true);setError('')
  try{
   await api.current('/api/flows/'+flowId+'/attributes/'+row.id+
    '?expected_revision='+encodeURIComponent(data.revision),{method:'DELETE'})
   setNotice('Атрибут «'+row.name+'» убран из потока.')
   setRevision(value=>value+1)
  }catch(err){setError('Не удалось убрать атрибут: '+String(err))}
  finally{setSaving(false)}
 }

 return <section className="boardFlowDataMap" aria-label="Атрибуты данных потока">
  <div className="boardFlowDataMapHeader">
   <div><strong>Атрибуты потока ({entries.length})</strong>
    <small>Какие поля передаются между системами</small></div>
   <button type="button" aria-label="Обновить состав данных" onClick={()=>{setNotice('');setRevision(n=>n+1)}}>Обновить</button>
  </div>
  <p>Задавайте поля прямо здесь. Определение атрибута сохранится в общем справочнике, поэтому его можно использовать в других потоках. Значения персональных данных здесь не хранятся.</p>
  {!loading&&!error&&<button type="button" className="boardFlowDataAdd" onClick={openAdd} disabled={saving}>{'+ Добавить атрибут'}</button>}
  {notice&&<p role="status" className="boardFlowDataNotice">{notice}</p>}
  {loading&&<p role="status">Загрузка состава данных…</p>}
  {error&&<p role="alert" className="boardFlowReviewError">{error} <button type="button" onClick={()=>{setError('');setRevision(n=>n+1)}}>Обновить</button></p>}
  {!loading&&data&&<>
   {entries.length>0&&(processes.length>1||consumers.length>1)&&<details className="boardFlowDataOptionalFilters">
    <summary>Фильтровать атрибуты</summary>
    <div className="boardFlowDataMapFilters">
     <label>Бизнес-процесс<select aria-label="Фильтр бизнес-процесса" value={processFilter} onChange={event=>setProcessFilter(event.target.value)}><option value="all">Все процессы</option>{processes.map(([id,name])=><option key={id} value={id}>{name}</option>)}</select></label>
     <label>Система-потребитель<select aria-label="Фильтр системы-потребителя" value={consumerFilter} onChange={event=>setConsumerFilter(event.target.value)}><option value="all">Все системы</option>{consumers.map(([id,name])=><option key={id} value={id}>{name}</option>)}</select></label>
    </div>
   </details>}
   {entries.length===0?<p className="boardFlowDataMapEmpty">Пока нет атрибутов. Нажмите «+ Добавить атрибут», чтобы выбрать поле из справочника или создать новое.</p>:
    filtered.length===0?<p className="boardFlowDataMapEmpty">По выбранным фильтрам атрибутов нет.</p>:
    <div className="boardFlowDataMapList">
     {filtered.map(row=><article key={row.id}>
      <div className="boardFlowAttributeTitle"><strong>{row.name}</strong><code>{row.code}</code></div>
      <div><span>{row.data_type}</span><span>{sensitivityLabel[row.sensitivity]||row.sensitivity}</span></div>
      {(row.process_name||row.consumer_system_name)&&<small>{[row.process_name,row.consumer_system_name].filter(Boolean).join(' · ')}</small>}
      {row.purpose&&<p>{row.purpose}</p>}
      <div className="boardFlowDataActions">
       <button type="button" aria-label={'Настроить атрибут '+row.name} onClick={()=>setEditing(row)}>Настроить</button>
       <button type="button" disabled={saving} aria-label={'Убрать атрибут '+row.name+' из потока'} onClick={()=>void unlink(row)}>Убрать из потока</button>
      </div>
     </article>)}
    </div>}
   {addOpen&&<form className="boardFlowQuickAdd" aria-label="Добавление атрибута в поток" onSubmit={event=>void addAttribute(event)}>
    <div className="boardFlowQuickAddHeading"><strong>Добавить атрибут в этот поток</strong>
     <button type="button" onClick={()=>{setAddOpen(false);setError('')}} disabled={saving} aria-label="Закрыть добавление атрибута">×</button>
    </div>
    <div className="boardFlowQuickAddModes" role="group" aria-label="Источник атрибута">
     <button type="button" aria-pressed={addMode==='existing'} className={addMode==='existing'?'current':''} onClick={()=>{setAddMode('existing');setError('')}}>Из справочника</button>
     <button type="button" aria-pressed={addMode==='new'} className={addMode==='new'?'current':''} onClick={()=>{setAddMode('new');setError('')}}>Создать новый</button>
    </div>
    {addMode==='existing'?<>
      <label>Поиск по справочнику
       <input type="search" aria-label="Поиск атрибута" placeholder="Название или код…" value={catalogQuery} onChange={event=>setCatalogQuery(event.target.value)}/>
      </label>
      <label>Атрибут
       <select aria-label="Выбрать существующий атрибут" value={catalogSelected} required disabled={catalogLoading||saving} onChange={event=>setCatalogSelected(event.target.value)}>
        <option value="">Выберите поле</option>
        {catalogMatches.map(attr=><option key={attr.id} value={attr.id} disabled={linkedWithoutContext.has(attr.id)}>
         {attr.name}{linkedWithoutContext.has(attr.id)?' · уже в потоке':''}
        </option>)}
       </select>
      </label>
      {catalogLoading&&<small role="status">Загрузка справочника…</small>}
      {!catalogLoading&&catalogMatches.length===0&&<small>Такого поля ещё нет. Нажмите «Создать новый».</small>}
     </>:<>
      <label>Название поля *
       <input aria-label="Название нового атрибута" required maxLength={250} placeholder="Например, табельный номер" value={newAttribute.name} onChange={event=>setNewAttribute(x=>({...x,name:event.target.value}))}/>
      </label>
      <label>Тип данных
       <select aria-label="Тип нового атрибута" value={newAttribute.data_type} onChange={event=>setNewAttribute(x=>({...x,data_type:event.target.value}))}>
        <option value="string">Текст</option><option value="number">Число</option><option value="date">Дата</option><option value="boolean">Да / нет</option>
       </select>
      </label>
      <label>Категория данных
       <select aria-label="Категория нового атрибута" value={newAttribute.sensitivity} onChange={event=>setNewAttribute(x=>({...x,sensitivity:event.target.value}))}>
        <option value="unclassified">Не определена</option><option value="internal">Внутренние данные</option><option value="personal">Персональные данные</option><option value="restricted">Ограниченный доступ</option>
       </select>
      </label>
      <label>Описание (необязательно)
       <textarea aria-label="Описание нового атрибута" value={newAttribute.description} maxLength={4000} onChange={event=>setNewAttribute(x=>({...x,description:event.target.value}))}/>
      </label>
      <small>Код поля будет создан автоматически; атрибут сразу появится в этом потоке и в общем справочнике.</small>
     </>}
    <div className="boardFlowQuickAddActions">
     <button type="button" disabled={saving} onClick={()=>setAddOpen(false)}>Отмена</button>
     <button type="submit" className="primary" disabled={saving||catalogLoading||(addMode==='existing'?!catalogSelected||linkedWithoutContext.has(catalogSelected):!newAttribute.name.trim())}>
      {saving?'Сохранение…':'Добавить в поток'}
     </button>
    </div>
   </form>}
  </>}
  {editing&&data&&<FlowAttributeReview
   key={flowId+':update:'+editing.id}
   flowId={flowId} revision={data.revision} action="update" entry={editing}
   request={api.current} onCancel={()=>setEditing(null)}
   onSaved={()=>{setEditing(null);setNotice('Параметры атрибута сохранены.');setRevision(n=>n+1)}}/>}
 </section>
}
