import {useEffect, useState} from 'react'
import {ArrowLeft, FileText, Plus, X} from 'lucide-react'
import {Background, Controls, MarkerType, ReactFlow} from '@xyflow/react'
import {DiagramNodeLabel, diagramCardStyle} from './DiagramVisual'
import {AutoFit} from './WorkspaceUI'
import type {AuthProfile} from './UserManagement'
import './technicalDecisions.css'

type Api = <T>(url: string, init?: RequestInit) => Promise<T>
type Item = {id: string; name: string; system_id: string; kind: string}
type Link = {id: string; name: string; source_id: string; target_id: string; protocol: string; port: string}
type ProposedVM = Item & {x: number; y: number}
const states = {draft:'Черновик', in_review:'На согласовании', changes_requested:'На доработке', approved:'Согласовано', published:'Опубликовано'}
const services = {architect:'Архитектура', engineer:'Инфраструктура', security:'Информационная безопасность', business_owner:'Владелец процесса'}
type Service = keyof typeof services
type Decision = {id:string; title:string; system_id:string; status:keyof typeof states; author:string; updated_at:string; revision:number}
type Details = Decision & {description:string; required_services:Service[]; approvals:{service:Service; verdict:string; note:string}[]; proposed_vms:ProposedVM[]; proposed_flows:Link[]; base_changed:boolean}
const path = '/api/technical-decisions'
const dateFormat = new Intl.DateTimeFormat('ru-RU',{day:'2-digit',month:'2-digit',year:'numeric'})
function Status({value}:{value:Decision['status']}) {
  return <span className={'decisionStatus '+value}>{states[value]}</span>
}

export default function TechnicalDecisions({request, profile, systems, items, flows}:{request:Api; profile:AuthProfile|null; systems:{id:string; name:string; kind:string}[]; items:Item[]; flows:Link[]}) {
  const [rows,setRows] = useState<Decision[]>([])
  const [selection,select] = useState('')
  const [filter,setFilter] = useState('')
  const [query,setQuery] = useState('')
  const [error,setError] = useState('')
  const [loading,setLoading] = useState(true)
  const [attempt,retry] = useState(0)
  const [creating,setCreating] = useState(false)
  const [saving,setSaving] = useState(false)
  const [schema,setSchema] = useState(false)
  const [title,setTitle] = useState('')
  const [system,setSystem] = useState('')
  const canCreate = !!profile && ['admin','architect','development'].includes(profile.role)
  useEffect(()=>{
    let current=true
    setLoading(true);setError('')
    request<Decision[]>(path).then(list=>{if(current)setRows(list)}).catch(err=>{if(current)setError(err.message)}).finally(()=>{if(current)setLoading(false)})
    return ()=>{current=false}
  },[request,attempt])
  const update = (row:Decision) => setRows(prev=>[row,...prev.filter(item=>item.id!==row.id)])
  async function create() {
    setSaving(true);setError('')
    try {
      const row=await request<Details>(path,{method:'POST',body:JSON.stringify({title:title.trim(),system_id:system})})
      update(row);select(row.id);setCreating(false);setTitle('');setFilter('');setQuery('');setSchema(true)
    }catch(err){setError((err as Error).message)}finally{setSaving(false)}
  }
  const visible=rows.filter(row=>(!filter||row.status===filter)&&row.title.toLowerCase().includes(query.trim().toLowerCase()))
  const close=()=>{select('');setSchema(false)}
  return <section className="decisionWorkspace" aria-label="Технические решения">
    {!schema&&<div className="decisionRegister">
      <header><h2>Технические решения</h2>{canCreate&&<button className="primary" onClick={()=>{close();setCreating(true)}}><Plus size={15}/>Создать решение</button>}</header>
      <div className="decisionFilters">
        <div className="decisionFilterTabs" role="group" aria-label="Статус решения">
          {[['','Все'],...Object.entries(states)].map(([key,label])=><button type="button" key={key} aria-pressed={filter===key} onClick={()=>setFilter(key)}>{label}</button>)}
        </div>
        <input type="search" aria-label="Поиск решений" placeholder="Найти решение" value={query} onChange={e=>setQuery(e.target.value)}/>
      </div>
      {loading?<p role="status">Загрузка…</p>:<div className="decisionTable"><table><thead><tr><th>Название</th><th>Статус</th><th>Система</th><th>Обновлено</th></tr></thead>
        <tbody>{visible.map(row=><tr key={row.id} className={selection===row.id?'current':''}>
          <td><button onClick={()=>{setCreating(false);select(row.id)}}><FileText size={15}/>{row.title}</button></td>
          <td><Status value={row.status}/></td><td>{systems.find(s=>s.id===row.system_id)?.name||'—'}</td><td>{dateFormat.format(new Date(row.updated_at))}</td>
        </tr>)}</tbody></table>{!visible.length&&!error&&<p>{rows.length?'Решения по этому запросу не найдены.':'Технических решений пока нет.'}</p>}</div>}
    </div>}
    {creating&&<form className="decisionSide" onSubmit={e=>{e.preventDefault();void create()}}>
      <header><h3>Новое решение</h3><button type="button" aria-label="Закрыть создание" disabled={saving} onClick={()=>setCreating(false)}><X size={16}/></button></header>
      <label>Название<input required maxLength={250} value={title} onChange={e=>setTitle(e.target.value)} autoFocus/></label>
      <label>Информационная система<select required value={system} onChange={e=>setSystem(e.target.value)}><option value="">Выберите систему</option>{systems.filter(s=>s.kind==='system').map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
      <button className="primary" disabled={saving||!title.trim()||!system}>Создать черновик</button>
    </form>}
    {selection&&!creating&&<DecisionInspector key={selection} id={selection} request={request} profile={profile} items={items} flows={flows} schema={schema} openSchema={()=>setSchema(true)} close={close} update={update}/>}
    {error&&<div className="decisionError" role="alert">{error} <button onClick={()=>retry(v=>v+1)}>Обновить список</button></div>}
  </section>
}

function DecisionInspector({id,request,profile,items,flows,schema,openSchema,close,update}:{id:string;request:Api;profile:AuthProfile|null;items:Item[];flows:Link[];schema:boolean;openSchema:()=>void;close:()=>void;update:(row:Decision)=>void}) {
  const [row,setRow]=useState<Details|null>(null)
  const [tab,setTab]=useState<'items'|'review'>('items')
  const [busy,setBusy]=useState(false)
  const [error,setError]=useState('')
  const [attempt,retry]=useState(0)
  const [tool,setTool]=useState<'vm'|'flow'|null>(null)
  const [name,setName]=useState('')
  const [source,setSource]=useState('')
  const [target,setTarget]=useState('')
  const [comment,setComment]=useState('')
  useEffect(()=>{
    let current=true
    setBusy(true);setError('')
    request<Details>(path+'/'+id).then(value=>{if(current)setRow(value)}).catch(err=>{if(current)setError(err.message)}).finally(()=>{if(current)setBusy(false)})
    return ()=>{current=false}
  },[id,request,attempt])
  async function change(suffix:string,body:object,method='POST') {
    setBusy(true);setError('')
    try {
      const next=await request<Details>(path+'/'+id+suffix,{method,body:JSON.stringify(body)})
      setRow(next);update(next);setTool(null);setName('');setComment('')
    }catch(err){setError((err as Error).message)}finally{setBusy(false)}
  }
  if(!row)return <aside className="decisionSide"><header><h3>Решение</h3><button aria-label="Закрыть решение" onClick={close}><X size={16}/></button></header>{error?<p role="alert">{error} <button onClick={()=>retry(v=>v+1)}>Повторить</button></p>:<p role="status">Загрузка…</p>}</aside>
  const revision={expected_revision:row.revision}
  const author=!!profile?.id && row.author==='user:'+profile.id
  const editor=!!profile && (author||['architect','admin','development'].includes(profile.role))
  const editable=editor && ['draft','changes_requested'].includes(row.status)
  const reviewer=profile?.auth_kind==='named_user'&&!author&&row.status==='in_review'&&row.required_services.includes(profile.role as Service)
  const localItems=items.filter(i=>i.system_id===row.system_id)
  const localIds=new Set(localItems.map(i=>i.id))
  const baseFlows=flows.filter(f=>localIds.has(f.source_id)||localIds.has(f.target_id))
  const lines=[...baseFlows,...row.proposed_flows]
  const linkedIds=new Set(lines.flatMap(f=>[f.source_id,f.target_id]))
  const baseline=items.filter(i=>localIds.has(i.id)||linkedIds.has(i.id))
  const choices=[...items,...row.proposed_vms]
  const position=(n:number)=>({x:n%3*305,y:Math.floor(n/3)*140})
  const nodes=[...baseline.map((i,n)=>({id:i.id,position:position(n),data:{label:<DiagramNodeLabel name={i.name} kind={i.kind}/>},style:diagramCardStyle()})),
    ...row.proposed_vms.map(vm=>({id:vm.id,position:{x:vm.x,y:vm.y},data:{label:<DiagramNodeLabel name={vm.name} kind={vm.kind} subtitle="Новая ВМ"/>},style:diagramCardStyle({border:'1px dashed #a46c26'})}))]
  const edges=lines.map((f,i)=>({id:f.id,source:f.source_id,target:f.target_id,label:f.name,markerEnd:{type:MarkerType.ArrowClosed},style:{stroke:i<baseFlows.length?'#777b87':'#7351be',strokeDasharray:i<baseFlows.length?undefined:'5 4'}}))
  function saveProposal() {
    if(!row||!tool||!name.trim())return
    const vm={id:crypto.randomUUID(),system_id:row.system_id,kind:'vm',name:name.trim(),...position(nodes.length)}
    const flow={id:crypto.randomUUID(),source_id:source,target_id:target,name:name.trim(),protocol:'',port:''}
    void change('',{...revision,title:row.title,description:row.description,required_services:row.required_services,
      proposed_vms:tool==='vm'?[...row.proposed_vms,vm]:row.proposed_vms,proposed_flows:tool==='flow'?[...row.proposed_flows,flow]:row.proposed_flows},'PUT')
  }
  const start=(next:'vm'|'flow')=>{setTool(next);setName('');setSource('');setTarget('');setTab('items')}
  return <>
    {schema&&<div className="decisionDrawing"><header><button aria-label="Вернуться к списку" disabled={busy} onClick={close}><ArrowLeft size={16}/></button><h2>{row.title}</h2><Status value={row.status}/></header>
      <div className="decisionCanvas">{nodes.length?<ReactFlow nodes={nodes} edges={edges} nodesDraggable={false} nodesConnectable={false} fitView><AutoFit layoutKey={id+':'+row.revision}/><Background gap={20}/><Controls showInteractive={false}/></ReactFlow>:<p>В этой системе пока нет компонентов.</p>}
        {editable&&<div role="toolbar" aria-label="Инструменты решения" className="decisionTools"><button disabled={busy} onClick={()=>start('vm')}>＋ ВМ</button><button disabled={busy} onClick={()=>start('flow')}>＋ Поток</button></div>}
      </div>
    </div>}
    <aside className="decisionSide" aria-label="Карточка технического решения">
      <header><h3>{schema?'Свойства решения':row.title}</h3><button disabled={busy} aria-label="Закрыть решение" onClick={close}><X size={16}/></button></header>
      <small>Версия {row.revision}</small>
      <nav aria-label="Сведения о решении">{(['items','review'] as const).map(t=><button key={t} aria-pressed={tab===t} onClick={()=>setTab(t)}>{t==='items'?'Состав':'Согласование'}</button>)}</nav>
      {row.base_changed&&<p role="status">Исходная архитектура изменилась после отправки на согласование.</p>}
      {tab==='items'?<>
        {row.description&&<p>{row.description}</p>}
        {row.proposed_vms.map(vm=><div className="decisionItem" key={vm.id}><span>{vm.name}</span><small>Новая ВМ</small></div>)}
        {row.proposed_flows.map(f=><div className="decisionItem" key={f.id}><span>{f.name}</span><small>Новый поток</small></div>)}
        {!row.proposed_vms.length&&!row.proposed_flows.length&&<p>В черновике пока нет изменений.</p>}
        {schema&&tool&&editable&&<form onSubmit={e=>{e.preventDefault();saveProposal()}}>
          <label>{tool==='vm'?'Название ВМ':'Название потока'}<input autoFocus required maxLength={250} value={name} onChange={e=>setName(e.target.value)}/></label>
          {tool==='flow'&&<>{(['Источник','Получатель'] as const).map((label,i)=><label key={label}>{label}<select required value={i?target:source} onChange={e=>i?setTarget(e.target.value):setSource(e.target.value)}><option value="">Выберите компонент</option>{choices.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label>)}</>}
          <button className="primary" disabled={busy||!name.trim()||(tool==='flow'&&(!source||!target||source===target))}>Добавить в черновик</button>
        </form>}
        {!schema&&<button onClick={openSchema}>Открыть схему</button>}
        {editable&&(row.proposed_vms.length+row.proposed_flows.length>0)&&<button className="primary" disabled={busy} onClick={()=>void change('/submit',revision)}>На согласование</button>}
      </>:<>
        {row.required_services.map(service=>{
          const approval=row.approvals.find(a=>a.service===service)
          return <div className="decisionItem" key={service}><span>{services[service]}</span><small>{approval?.verdict==='approved'?'Согласовано':approval?.verdict==='changes_requested'?'На доработку':row.status==='in_review'?'На рассмотрении':'Ожидается'}</small>{approval?.note&&<p>{approval.note}</p>}</div>
        })}
        {reviewer&&<><label>Комментарий<textarea value={comment} maxLength={2000} onChange={e=>setComment(e.target.value)}/></label><div className="decisionActions"><button disabled={busy||comment.trim().length<3} onClick={()=>void change('/review',{...revision,verdict:'changes_requested',note:comment})}>На доработку</button><button className="primary" disabled={busy} onClick={()=>void change('/review',{...revision,verdict:'approved',note:comment})}>Согласовать</button></div></>}
        {editor&&profile?.auth_kind==='named_user'&&row.status==='approved'&&<button className="primary" disabled={busy||row.base_changed} onClick={()=>void change('/publish',revision)}>Опубликовать</button>}
      </>}
      {error&&<div role="alert" className="decisionError">{error} <button onClick={()=>retry(v=>v+1)}>Обновить</button></div>}
    </aside>
  </>
}
