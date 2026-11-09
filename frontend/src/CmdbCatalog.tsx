import {useEffect,useMemo,useState} from 'react'

type FieldType='text'|'number'|'boolean'|'choice'
type FieldDef={key:string;label:string;type:FieldType;options:string[]}
type CiClass={
  id:string;label:string;layer:string;required:string[]
  fields:FieldDef[];enabled:boolean;revision:number;is_custom:boolean
}
type Rule={
  id:string;relation_kind:string;source_class:string;target_class:string
  mode:'advisory'|'enforced';enabled:boolean;description:string;revision:number
}
type Catalog={classes:CiClass[]}
type Props={request:<T>(url:string,init?:RequestInit)=>Promise<T>}
const builtInFields=[
  ['owner','Владелец'],['technical_owner','Технический ответственный'],
  ['criticality','Критичность'],['lifecycle','Жизненный цикл'],
  ['source_system','Источник'],['source_record_id','ID в источнике'],['notes','Примечания'],
] as const
const layers=[
  ['application','Прикладной'],['platform','Платформенный'],
  ['infrastructure','Инфраструктура'],['business','Бизнес'],
] as const
const kinds=[
  ['supplies_data_to','Передаёт данные'],['integrates_with','Интегрируется'],
  ['depends_on','Зависит от'],
] as const
const emptyClass=(id=''):CiClass=>({
  id,label:'',layer:'infrastructure',required:[],fields:[],enabled:true,revision:0,is_custom:true
})
const emptyRule=():Rule=>({
  id:'',source_class:'',target_class:'',relation_kind:'supplies_data_to',
  mode:'advisory',enabled:true,description:'',revision:0
})

export default function CmdbCatalog({request}:Props){
  const [classes,setClasses]=useState<CiClass[]>([])
  const [rules,setRules]=useState<Rule[]>([])
  const [selected,setSelected]=useState('')
  const [classDraft,setClassDraft]=useState<CiClass>(emptyClass())
  const [ruleDraft,setRuleDraft]=useState<Rule>(emptyRule())
  const [reason,setReason]=useState('')
  const [ruleReason,setRuleReason]=useState('')
  const [error,setError]=useState('')
  const [notice,setNotice]=useState('')
  const [loading,setLoading]=useState(true)
  const [busy,setBusy]=useState(false)
  const [history,setHistory]=useState<{resource_kind:string;resource_id:string;reason:string;actor_role:string}[]>([])
  const load=async()=>{
    const [catalog,links,events]=await Promise.all([
      request<Catalog>('/api/cmdb/classes'),
      request<Rule[]>('/api/cmdb/relationship-rules'),
      request<typeof history>('/api/cmdb/schema/history?limit=15')
    ])
    setClasses(catalog.classes);setRules(links);setHistory(events)
    return catalog.classes
  }

  useEffect(()=>{
    let alive=true
    setLoading(true)
    void Promise.all([
      request<Catalog>('/api/cmdb/classes'),
      request<Rule[]>('/api/cmdb/relationship-rules'),
      request<typeof history>('/api/cmdb/schema/history?limit=15'),
    ]).then(([catalog,links,events])=>{
      if(!alive)return
      setClasses(catalog.classes);setRules(links);setHistory(events)
      setClassDraft(catalog.classes[0]||emptyClass())
      setSelected(catalog.classes[0]?.id||'')
    }).catch(err=>{if(alive)setError(String(err))})
      .finally(()=>{if(alive)setLoading(false)})
    return ()=>{alive=false}
  },[request])

  const chooseClass=(id:string)=>{
    setSelected(id);setClassDraft(classes.find(item=>item.id===id)||emptyClass())
    setError('');setNotice('');setReason('')
  }
  const fields=useMemo(()=>[...builtInFields.map(([key,label])=>({key,label})),
    ...classDraft.fields.map(field=>({key:field.key,label:field.label||field.key}))], [classDraft.fields])
  const updateField=(index:number,field:FieldDef)=>{
    setClassDraft(previous=>({...previous,fields:previous.fields.map((item,i)=>i===index?field:item)}))
  }
  const saveClass=async(event:React.FormEvent)=>{
    event.preventDefault()
    setBusy(true);setError('');setNotice('')
    try{
      await request('/api/cmdb/classes/'+encodeURIComponent(classDraft.id),{
        method:'PUT',body:JSON.stringify({
          expected_revision:classDraft.revision,label:classDraft.label,
          layer:classDraft.layer,required:classDraft.required,
          fields:classDraft.fields,enabled:classDraft.enabled,reason
        })
      })
      const updated=await load()
      const current=updated.find(item=>item.id===classDraft.id)
      if(current){setClassDraft(current);setSelected(current.id)}
      setReason('');setNotice('Определение класса КЕ сохранено.')
    }catch(err){setError('Ошибка сохранения класса: '+String(err))}
    finally{setBusy(false)}
  }
  const chooseRule=(id:string)=>{
    setRuleDraft(rules.find(rule=>rule.id===id)||emptyRule());setRuleReason('');setError('');setNotice('')
  }
  const saveRule=async(event:React.FormEvent)=>{
    event.preventDefault();setBusy(true);setError('');setNotice('')
    try{
      const {id,revision,...values}=ruleDraft
      await request(id?'/api/cmdb/relationship-rules/'+id:'/api/cmdb/relationship-rules',{
        method:id?'PUT':'POST',body:JSON.stringify({
          ...values,...(id?{expected_revision:revision}:{}),reason:ruleReason
        })
      })
      await load();setRuleDraft(emptyRule());setRuleReason('')
      setNotice('Правило связи сохранено. Строгий режим применяется только к новым и изменяемым связям.')
    }catch(err){setError('Ошибка сохранения правила: '+String(err))}
    finally{setBusy(false)}
  }
  return <section className="cmdbCatalog" aria-label="Настройки классификатора CMDB">
    <p>Классы определяют состав паспортов. Правила управляют допустимыми направленными связями. Существующие связи не удаляются.</p>
    {loading&&<p role="status">Загружаем классификатор…</p>}
    {error&&<p role="alert">{error}</p>}
    {notice&&<p role="status">{notice}</p>}
    <div className="cmdbCatalogPanel">
      <h4>Классы конфигурационных единиц</h4>
      <label>Выбрать класс
        <select aria-label="Выбрать класс CMDB" value={selected} onChange={event=>chooseClass(event.target.value)}>
          <option value="">Новый класс</option>
          {classes.map(item=><option key={item.id} value={item.id}>{item.label} ({item.id})</option>)}
        </select>
      </label>
      <form className="cmdbCatalogForm" onSubmit={event=>void saveClass(event)}>
        <label>Код класса (не меняется после создания)
          <input aria-label="Код класса CMDB" value={classDraft.id} readOnly={classDraft.revision>0||classes.some(item=>item.id===classDraft.id)}
            pattern="[a-z][a-z0-9_]{1,49}" required placeholder="integration_adapter"
            onChange={event=>setClassDraft({...classDraft,id:event.target.value})}/>
        </label>
        <label>Название класса
          <input required maxLength={120} value={classDraft.label} onChange={event=>setClassDraft({...classDraft,label:event.target.value})}/>
        </label>
        <label>Архитектурный слой
          <select value={classDraft.layer} onChange={event=>setClassDraft({...classDraft,layer:event.target.value})}>
            {layers.map(([id,label])=><option key={id} value={id}>{label}</option>)}
          </select>
        </label>
        <fieldset className="cmdbCatalogRequired">
          <legend>Обязательные поля</legend>
          {fields.map(({key,label},i)=><label key={key||'new-'+i}>
            <input type="checkbox" checked={classDraft.required.includes(key)} disabled={!key}
              onChange={event=>setClassDraft({...classDraft,required:event.target.checked?
                [...classDraft.required,key]:classDraft.required.filter(v=>v!==key)})}/>
            {label||'Новое поле'}
          </label>)}
        </fieldset>
        <div className="cmdbCatalogFields">
          <div className="cmdbCatalogSectionHead"><strong>Дополнительные поля паспорта</strong>
            <button type="button" onClick={()=>setClassDraft({...classDraft,fields:[...classDraft.fields,
              {key:'',label:'',type:'text',options:[]}]})}>+ Поле</button></div>
          {classDraft.fields.map((field,index)=><div className="cmdbCatalogField" key={index}>
            <label>Код поля<input aria-label={'Код поля '+(index+1)} required value={field.key} pattern="[a-z][a-zA-Z0-9_]*"
              onChange={event=>updateField(index,{...field,key:event.target.value})}/></label>
            <label>Название поля<input required value={field.label}
              onChange={event=>updateField(index,{...field,label:event.target.value})}/></label>
            <label>Тип
              <select value={field.type} onChange={event=>updateField(index,{...field,type:event.target.value as FieldType})}>
                <option value="text">Текст</option><option value="number">Число</option>
                <option value="boolean">Да / Нет</option><option value="choice">Список</option>
              </select>
            </label>
            {field.type==='choice'&&<label>Варианты через запятую
              <input value={field.options.join(', ')} onChange={event=>updateField(index,{
                ...field,options:event.target.value.split(',').map(x=>x.trim()).filter(Boolean)
              })}/></label>}
            <button type="button" onClick={()=>setClassDraft(previous=>({
              ...previous,fields:previous.fields.filter((_,i)=>i!==index),
              required:previous.required.filter(key=>key!==field.key)
            }))}>Убрать поле</button>
          </div>)}
        </div>
        <label className="cmdbCatalogToggle"><input type="checkbox" checked={classDraft.enabled}
          onChange={event=>setClassDraft({...classDraft,enabled:event.target.checked})}/> Класс активен</label>
        <label>Причина изменения<input required minLength={5} maxLength={1000} value={reason}
          onChange={event=>setReason(event.target.value)} placeholder="Зачем меняем определение класса?"/></label>
        <button type="submit" className="primary" disabled={busy||reason.trim().length<5}>
          {busy?'Сохраняем…':'Сохранить класс'}
        </button>
      </form>
    </div>
    <div className="cmdbCatalogPanel">
      <h4>Правила связей</h4>
      <p>Рекомендательный режим только предупреждает. Строгий – отклоняет новые связи из данного класса к неразрешённым типам.</p>
      <label>Настроить правило
        <select aria-label="Выбрать правило связи" value={ruleDraft.id} onChange={event=>chooseRule(event.target.value)}>
          <option value="">Новое правило</option>
          {rules.map(rule=><option key={rule.id} value={rule.id}>
            {rule.source_class} → {rule.target_class} · {rule.relation_kind} {rule.enabled?'':'(выключено)'}
          </option>)}
        </select>
      </label>
      <form className="cmdbCatalogForm" onSubmit={event=>void saveRule(event)}>
        <label>Тип связи
          <select value={ruleDraft.relation_kind} onChange={event=>setRuleDraft({...ruleDraft,relation_kind:event.target.value})}>
            {kinds.map(([id,label])=><option key={id} value={id}>{label}</option>)}
          </select>
        </label>
        <label>Класс источника
          <select required aria-label="Класс источника связи" value={ruleDraft.source_class} onChange={event=>setRuleDraft({...ruleDraft,source_class:event.target.value})}>
            <option value="">Выбрать</option>{classes.filter(c=>c.enabled).map(c=><option key={c.id} value={c.id}>{c.label}</option>)}
          </select>
        </label>
        <label>Класс получателя
          <select required aria-label="Класс получателя связи" value={ruleDraft.target_class} onChange={event=>setRuleDraft({...ruleDraft,target_class:event.target.value})}>
            <option value="">Выбрать</option>{classes.filter(c=>c.enabled).map(c=><option key={c.id} value={c.id}>{c.label}</option>)}
          </select>
        </label>
        <label>Применение
          <select value={ruleDraft.mode} onChange={event=>setRuleDraft({...ruleDraft,mode:event.target.value as Rule['mode']})}>
            <option value="advisory">Рекомендательное</option><option value="enforced">Строгое</option>
          </select>
        </label>
        <label>Описание<input maxLength={1000} value={ruleDraft.description} onChange={event=>setRuleDraft({...ruleDraft,description:event.target.value})}/></label>
        <label className="cmdbCatalogToggle"><input type="checkbox" checked={ruleDraft.enabled}
          onChange={event=>setRuleDraft({...ruleDraft,enabled:event.target.checked})}/> Правило активно</label>
        <label>Причина изменения<input minLength={5} required maxLength={1000} value={ruleReason}
          onChange={event=>setRuleReason(event.target.value)}/></label>
        <button type="submit" disabled={busy||ruleReason.trim().length<5}>Сохранить правило</button>
      </form>
    </div>
    <details className="cmdbCatalogPanel">
      <summary>История настройки классификатора ({history.length})</summary>
      {history.length===0?<p>Изменений нет.</p>:<ol>
        {history.map((event,i)=><li key={i}>
          <strong>{event.resource_kind}: {event.resource_id}</strong>
          <small>{event.actor_role} · {event.reason}</small>
        </li>)}
      </ol>}
    </details>
  </section>
}
