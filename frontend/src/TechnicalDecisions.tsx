import {useEffect, useState} from 'react'
import {ArrowLeft, FileText, Plus, X, Undo2, Redo2, MousePointer2, GitBranch, Monitor, Maximize2} from 'lucide-react'
import {Background, ConnectionMode, Controls, MarkerType, ReactFlow, type Connection} from '@xyflow/react'
import {SystemComposition} from './SystemComposition'
import {DiagramNodeLabel, diagramCardStyle} from './DiagramVisual'
import {diagramPortNodes,useDiagramMeasurements} from './DiagramPortNode'
import {autoFlowPorts} from './flowPorts'
import {flowPortError} from './fieldValidation'
import {ObstacleAwareEdge} from './ObstacleAwareEdge'
import {AutoFit} from './WorkspaceUI'
import type {AuthProfile} from './UserManagement'
import {buildTechnicalDecisionMarkdown} from './technicalDecisionDocument'
import {DecisionExistingChanges,type ExistingChange,type ExistingInput,existingSummary} from './DecisionExistingChanges'
import './technicalDecisions.css'

type Api = <T>(url: string, init?: RequestInit) => Promise<T>
type Item = {id: string; name: string; system_id: string; kind: string;parent_id?:string|null;description?:string;details?:Record<string,unknown>}
type Link = {id: string; name: string; source_id: string; target_id: string; protocol: string; port: string; source_handle?:string; target_handle?:string; data_description?:string;security?:string;schedule?:string;verification?:string}
type ProposedVM = Item & {x: number; y: number; description?:string; environment?:string}
type VMForm = {name:string;kind:'vm'|'server'|'host';description:string;environment:string}
type ProposalSnapshot = {vms:ProposedVM[];flows:Link[];existing:ExistingChange[]}
const blankVM = ():VMForm=>({name:'',kind:'vm',description:'',environment:''})
const decisionEdgeTypes={proposal:ObstacleAwareEdge}
const emptyFlow:Link={id:'',source_id:'',target_id:'',source_handle:'',target_handle:'',name:'',protocol:'',port:'',data_description:'',security:'',schedule:'',verification:'draft'}
const states = {draft:'Черновик', in_review:'На согласовании', changes_requested:'На доработке', approved:'Согласовано', published:'Опубликовано'}
const services = {architect:'Архитектура', engineer:'Инфраструктура', security:'Информационная безопасность', business_owner:'Владелец процесса'}
type Service = keyof typeof services
type Decision = {id:string; title:string; system_id:string; status:keyof typeof states; author:string; author_name?:string; updated_at:string; revision:number; required_services:Service[]; approvals:Review[]}
type Review = {service:Service; verdict:'approved'|'changes_requested'; note:string; actor:string; actor_name?:string; created_at:string; revision?:number}
type DecisionComment = {id:string; actor:string; actor_name?:string; body:string; anchor_kind:'decision'|'vm'|'flow';anchor_id:string;created_at:string}
type Details = Decision & {description:string; review_history:Review[]; comments:DecisionComment[]; proposed_vms:ProposedVM[]; proposed_flows:Link[]; existing_changes:ExistingChange[]; base_changed:boolean}
const path = '/api/technical-decisions'
const dateFormat = new Intl.DateTimeFormat('ru-RU',{day:'2-digit',month:'2-digit',year:'numeric'})
function pendingServices(row:Decision) {
  if (row.status !== 'in_review') return []
  return row.required_services.filter(service => !row.approvals.some(vote => vote.service === service && vote.verdict === 'approved'))
}
function Status({value}:{value:Decision['status']}) {
  return <span className={'decisionStatus '+value}>{states[value]}</span>
}

export default function TechnicalDecisions({request, profile, systems, items, flows}:{request:Api; profile:AuthProfile|null; systems:{id:string; name:string; kind:string}[]; items:Item[]; flows:Link[]}) {
  const [rows,setRows] = useState<Decision[]>([])
  const [selection,select] = useState('')
  const [openReview,setOpenReview] = useState(false)
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
      update(row);select(row.id);setOpenReview(false);setCreating(false);setTitle('');setFilter('');setQuery('');setSchema(true)
    }catch(err){setError((err as Error).message)}finally{setSaving(false)}
  }
  const myService = profile?.auth_kind === 'named_user' && profile.role in services ? profile.role as Service : null
  const myQueue = myService ? rows.filter(row =>
    row.author !== 'user:'+profile?.id && pendingServices(row).includes(myService)
  ) : []
  const showQueue = filter === 'mine' && !!myService
  const filtered = showQueue ? myQueue : rows.filter(row => !filter || filter === 'mine' || row.status === filter)
  const visible = filtered.filter(row => row.title.toLowerCase().includes(query.trim().toLowerCase()))
  const close=()=>{select('');setSchema(false)}
  return <section className="decisionWorkspace" aria-label="Технические решения">
    {!schema&&<div className="decisionRegister">
      <header><h2>Технические решения</h2>{canCreate&&<button className="primary" onClick={()=>{close();setCreating(true)}}><Plus size={15}/>Создать решение</button>}</header>
      <div className="decisionFilters">
        <div className="decisionFilterTabs" role="group" aria-label="Статус решения">
          {myService && <button type="button" aria-pressed={showQueue} onClick={()=>setFilter('mine')}>Моё согласование · {myQueue.length}</button>}
          {[['','Все'],...Object.entries(states)].map(([key,label])=><button type="button" key={key} aria-pressed={filter===key} onClick={()=>setFilter(key)}>{label}</button>)}
        </div>
        <input type="search" aria-label="Поиск решений" placeholder="Найти решение" value={query} onChange={e=>setQuery(e.target.value)}/>
      </div>
      {loading?<p role="status">Загрузка…</p>:<div className="decisionTable"><table><thead><tr><th scope="col">Название</th><th scope="col">Статус</th><th scope="col">Система</th><th scope="col">Обновлено</th></tr></thead>
        <tbody>{visible.map(row=><tr key={row.id} className={selection===row.id?'current':''}>
          <td><button onClick={()=>{setCreating(false);setOpenReview(showQueue);select(row.id)}}><FileText size={15}/>{row.title}</button></td>
          <td><Status value={row.status}/>{row.status==='in_review'&&<small className="decisionPendingServices">Ожидается ответ: {pendingServices(row).map(service=>services[service]).join(', ')||'—'}</small>}</td><td>{systems.find(s=>s.id===row.system_id)?.name||'—'}</td><td>{dateFormat.format(new Date(row.updated_at))}</td>
        </tr>)}</tbody></table>{!visible.length&&!error&&<p>{showQueue&&!query.trim()?'Нет решений, ожидающих ответа вашей службы.':rows.length?'Решения по этому запросу не найдены.':'Технических решений пока нет.'}</p>}</div>}
    </div>}
    {creating&&<form className="decisionSide" onSubmit={e=>{e.preventDefault();void create()}}>
      <header><h3>Новое решение</h3><button type="button" aria-label="Закрыть создание" disabled={saving} onClick={()=>setCreating(false)}><X size={16}/></button></header>
      <label>Название<input required maxLength={250} value={title} onChange={e=>setTitle(e.target.value)} autoFocus/></label>
      <label>Информационная система<select aria-label="Информационная система" required value={system} onChange={e=>setSystem(e.target.value)}><option value="">Выберите систему</option>{systems.filter(s=>s.kind==='system').map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
      <button className="primary" disabled={saving||!title.trim()||!system}>Создать черновик</button>
    </form>}
    {selection&&!creating&&<DecisionInspector key={selection+':'+openReview} initialReview={openReview} id={selection} request={request} profile={profile} items={items} flows={flows} systemName={systems.find(s=>s.id===rows.find(x=>x.id===selection)?.system_id)?.name||''} schema={schema} openSchema={()=>setSchema(true)} close={close} update={update}/>}
    {error&&<div className="decisionError" role="alert">{error} <button onClick={()=>retry(v=>v+1)}>Обновить список</button></div>}
  </section>
}

function DecisionInspector({id,initialReview,request,profile,items,flows,systemName,schema,openSchema,close,update}:{id:string;initialReview:boolean;request:Api;profile:AuthProfile|null;items:Item[];flows:Link[];systemName:string;schema:boolean;openSchema:()=>void;close:()=>void;update:(row:Decision)=>void}) {
 const measurements=useDiagramMeasurements()
  const [row,setRow]=useState<Details|null>(null)
  const [tab,setTab]=useState<'items'|'changes'|'review'>(initialReview?'review':'items')
  const [busy,setBusy]=useState(false)
  const [error,setError]=useState('')
  const [attempt,retry]=useState(0)
  const [tool,setTool]=useState<'vm'|'flow'|null>(null)
  const [name,setName]=useState('')
  const [newVM,setNewVM]=useState<VMForm>(blankVM)
  const [selectedVMId,setSelectedVMId]=useState('')
  const [vmForm,setVmForm]=useState<VMForm>(blankVM)
  const [menu,setMenu]=useState<null|{kind:'vm'|'flow';id:string;x:number;y:number}>(null)
  const [changeFocus,setChangeFocus]=useState<null|{kind:'vm'|'flow';id:string}>(null)
  const [existingFormDirty,setExistingFormDirty]=useState(false)
  const [undoStack,setUndoStack]=useState<ProposalSnapshot[]>([])
  const [redoStack,setRedoStack]=useState<ProposalSnapshot[]>([])
  const [draft,setDraft]=useState<Link>(emptyFlow)
  const [viewFlowId,setViewFlowId]=useState('')
  const [drawing,setDrawing]=useState(false)
  // React Flow needs a controlled position during drag; only committed on mouseup.
  const [dragPositions,setDragPositions]=useState<Record<string,{x:number;y:number}>>({})
  const [comment,setComment]=useState('')
  const [discussion,setDiscussion]=useState('')
  const [commentTarget,setCommentTarget]=useState('decision:')
  const [route,setRoute]=useState<Service[]>([])
  useEffect(()=>{
    let current=true
    setBusy(true);setError('')
    request<Details>(path+'/'+id).then(value=>{if(current){setRow(value);setRoute(value.required_services)}}).catch(err=>{if(current)setError(err.message)}).finally(()=>{if(current)setBusy(false)})
    return ()=>{current=false}
  },[id,request,attempt])
  async function change(suffix:string,body:object,method='POST') {
    setBusy(true);setError('')
    try {
      const next=await request<Details>(path+'/'+id+suffix,{method,body:JSON.stringify(body)})
      setRow(next);setRoute(next.required_services);update(next);setViewFlowId('');setSelectedVMId('');setTool(null);setName('');setComment('');setDiscussion('')
      if(suffix!=='/comments'){setUndoStack([]);setRedoStack([])}
    }catch(err){setError((err as Error).message)}finally{setBusy(false)}
  }
  useEffect(()=>{
    const key=(event:KeyboardEvent)=>{
      if(!schema||!row||!['draft','changes_requested'].includes(row.status)||(event.ctrlKey===false&&event.metaKey===false))return
      if(event.target instanceof Element&&event.target.closest('input,textarea,select,[contenteditable="true"]'))return
      const k=event.key.toLowerCase()
      const redo=(k==='z'&&event.shiftKey)||k==='y'
      const undo=k==='z'&&!event.shiftKey
      if(!redo&&!undo)return
      const button=document.querySelector<HTMLButtonElement>(redo?'[data-decision-redo]':'[data-decision-undo]')
      if(button&&!button.disabled){event.preventDefault();button.click()}
    }
    document.addEventListener('keydown',key)
    return()=>document.removeEventListener('keydown',key)
  },[schema,row?.status,undoStack.length,redoStack.length,busy])
  useEffect(()=>{
    if(!menu)return
    const hide=(event:MouseEvent)=>{
      if(!(event.target instanceof Element)||!event.target.closest('.decisionContextMenu'))setMenu(null)
    }
    const escape=(event:KeyboardEvent)=>{if(event.key==='Escape')setMenu(null)}
    document.addEventListener('mousedown',hide);document.addEventListener('keydown',escape)
    return()=>{document.removeEventListener('mousedown',hide);document.removeEventListener('keydown',escape)}
  },[menu])
  if(!row)return <aside className="decisionSide"><header><h3>Решение</h3><button aria-label="Закрыть решение" onClick={close}><X size={16}/></button></header>{error?<p role="alert">{error} <button onClick={()=>retry(v=>v+1)}>Повторить</button></p>:<p role="status">Загрузка…</p>}</aside>
  const loaded=row
  const revision={expected_revision:row.revision}
  const author=!!profile?.id && row.author==='user:'+profile.id
  const editor=!!profile && (author||['architect','admin','development'].includes(profile.role))
  const editable=editor && ['draft','changes_requested'].includes(row.status)
  const reviewer=profile?.auth_kind==='named_user'&&!author&&row.status==='in_review'&&row.required_services.includes(profile.role as Service)
  const routeChanged=[...route].sort().join('|')!==[...row.required_services].sort().join('|')
  const approvedCount=row.required_services.filter(service=>row.approvals.some(vote=>vote.service===service&&vote.verdict==='approved')).length
  const canSubmit=editable&&!routeChanged&&row.required_services.length>0&&(row.proposed_vms.length+row.proposed_flows.length+row.existing_changes.length>0)
  const canComment=!!profile&&profile.role!=='viewer'
  function saveRoute(){
    if(!row||!editable||!route.length||!routeChanged)return
    void change('',{...revision,title:row.title,description:row.description,
      required_services:route,proposed_vms:row.proposed_vms,proposed_flows:row.proposed_flows,existing_changes:row.existing_changes},'PUT')
  }
  function sendComment(){
    if(!discussion.trim()||!canComment)return
    const [anchor_kind,anchor_id='']=commentTarget.split(':')
    void change('/comments',{body:discussion.trim(),anchor_kind,anchor_id})
  }
  function downloadDocument(){
    const markdown=buildTechnicalDecisionMarkdown(loaded,systemName,items)
    const blob=new Blob([markdown],{type:'text/markdown;charset=utf-8'})
    const uri=URL.createObjectURL(blob)
    const element=document.createElement('a')
    element.href=uri
    element.download='ArchitectureHub_'+loaded.title.replace(/[^\p{L}\p{N}_-]+/gu,'_').slice(0,65)+'_v'+loaded.revision+'.md'
    document.body.appendChild(element)
    element.click()
    element.remove()
    window.setTimeout(()=>URL.revokeObjectURL(uri),1000)
  }
  const localItems=items.filter(i=>i.system_id===loaded.system_id)
  const localIds=new Set(localItems.map(i=>i.id))
  const baseFlows=flows.filter(f=>localIds.has(f.source_id)||localIds.has(f.target_id))
  const currentChanges=new Map(loaded.existing_changes.map(c=>[c.kind+':'+c.id,c]))
  const projectedFlows=baseFlows.map(flow=>{
    const change=currentChanges.get('flow:'+flow.id)
    return change?.action==='update'?{...flow,...change.after}:flow
  })
  const lines=[...projectedFlows,...loaded.proposed_flows]
  const linkedIds=new Set(lines.flatMap(f=>[f.source_id,f.target_id]))
  const baseline=items.filter(i=>localIds.has(i.id)||linkedIds.has(i.id))
  const choices=[...items,...loaded.proposed_vms]
  const proposedPositions=loaded.proposed_vms
  const proposedVmIds=new Set(proposedPositions.map(vm=>vm.id))
  const selectedVM=choices.find(vm=>vm.id===selectedVMId)
  const selectedProposedVM=loaded.proposed_vms.find(vm=>vm.id===selectedVMId)
  const vmFormDirty=!!selectedProposedVM&&(vmForm.name!==selectedProposedVM.name||vmForm.kind!==selectedProposedVM.kind||vmForm.description!==(selectedProposedVM.description||'')||vmForm.environment!==(selectedProposedVM.environment||''))
  const editingFlow=loaded.proposed_flows.find(flow=>flow.id===draft.id)
  const flowFormDirty=tool==='flow'&&(editingFlow?JSON.stringify({...emptyFlow,...editingFlow})!==JSON.stringify({...emptyFlow,...draft}):Boolean(draft.name||draft.source_id||draft.target_id||draft.protocol||draft.port||draft.data_description||draft.security||draft.schedule))
  const newVMFormDirty=tool==='vm'&&Boolean(name.trim()||newVM.description.trim()||newVM.environment.trim())
  const hasUnsavedForm=vmFormDirty||flowFormDirty||newVMFormDirty||existingFormDirty
  function exitEditor(){
    if(hasUnsavedForm&&!window.confirm('Есть несохранённые изменения. Закрыть без сохранения?'))return
    close()
  }
  function inspectVM(vmId:string){
    if(busy)return
    if(hasUnsavedForm&&!window.confirm('Отбросить несохранённые изменения?'))return
    const vm=choices.find(x=>x.id===vmId)
    if(!vm)return
    setMenu(null);setSelectedVMId(vmId);setViewFlowId('');setTool(null);setTab('items');setError('')
    setVmForm({name:vm.name,kind:vm.kind==='server'||vm.kind==='host'?vm.kind:'vm',description:(vm as ProposedVM).description||'',environment:(vm as ProposedVM).environment||''})
  }
  function deleteProposedVM(vmId:string){
    if(!editable||busy)return
    const vm=loaded.proposed_vms.find(item=>item.id===vmId)
    if(!vm)return
    const attached=loaded.proposed_flows.filter(flow=>flow.source_id===vmId||flow.target_id===vmId)
    const message=attached.length?'Удалить ВМ «'+vm.name+'» и связанные проектируемые потоки ('+attached.length+')?':'Удалить проектируемую ВМ «'+vm.name+'»?'
    if(!window.confirm(message))return
    setSelectedVMId('');setMenu(null)
    persist(loaded.proposed_vms.filter(item=>item.id!==vmId),loaded.proposed_flows.filter(flow=>flow.source_id!==vmId&&flow.target_id!==vmId))
  }
  let cell=0
  function nextGridPosition(){
    // An external endpoint can join the canvas after a VM already occupies its grid cell.
    let point:{x:number;y:number}
    do {
      point={x:cell%3*305,y:Math.floor(cell/3)*140}
      cell++
    }while(proposedPositions.some(vm=>Math.abs(vm.x-point.x)<260&&Math.abs(vm.y-point.y)<110))
    return point
  }
  const nodes=[...baseline.map(i=>{
      const change=currentChanges.get('vm:'+i.id)
      const projected=change?.action==='update'?{...i,...change.after}:i
      const parent=items.find(item=>item.id===i.parent_id)
      return {type:'diagramPort',id:i.id,position:nextGridPosition(),draggable:false,
        data:{label:<DiagramNodeLabel name={projected.name} kind={projected.kind}
          subtitle={change?.action==='remove'?'Планируется удаление':change?.action==='update'?'Изменение':''} detail={parent?'Размещение: '+parent.name:undefined}/>},
        style:diagramCardStyle(change?{border:change.action==='remove'?'2px dashed #ae7648':'2px solid #6550ad'}:{})}
    }),
    ...loaded.proposed_vms.map(vm=>({type:'diagramPort',id:vm.id,position:dragPositions[vm.id]||{x:vm.x,y:vm.y},draggable:editable&&!busy,data:{label:<DiagramNodeLabel name={vm.name} kind={vm.kind} subtitle="Новая ВМ"/>},style:diagramCardStyle({border:'1px dashed #a46c26'})}))]
  const positions=new Map(nodes.map(n=>[n.id,n.position]))
  const proposedIds=new Set(loaded.proposed_flows.map(f=>f.id))
  function openFlow(flow:Link) {
    if(hasUnsavedForm&&!window.confirm('Отбросить несохранённые изменения?'))return
    setMenu(null);setSelectedVMId('');setViewFlowId('');setTool('flow');setDraft({...emptyFlow,...flow});setTab('items');setError('')
  }
  const viewedFlow=lines.find(f=>f.id===viewFlowId)
  function inspectFlow(f:Link){
    if(busy)return
    if(editable&&proposedIds.has(f.id)){openFlow(f);return}
    if(hasUnsavedForm&&!window.confirm('Отбросить несохранённые изменения?'))return
    setSelectedVMId('');setTool(null);setViewFlowId(f.id);setTab('items')
  }
  const edges=lines.flatMap(f=>{
    const a=positions.get(f.source_id),b=positions.get(f.target_id)
    if(!a||!b)return []
    const ports=autoFlowPorts(a,b)
    const proposed=proposedIds.has(f.id)
    return [{id:f.id,source:f.source_id,target:f.target_id,type:'proposal',
      sourceHandle:f.source_handle||ports.source_handle,targetHandle:(f.target_handle||ports.target_handle).replace('in-','out-'),
      markerEnd:{type:MarkerType.ArrowClosed,color:currentChanges.get('flow:'+f.id)?.action==='remove'?'#b37343':proposed?'#6652ae':'#737786'},
      ariaLabel:f.name,data:{caption:proposed||viewFlowId===f.id?f.name:'',onSelect:()=>inspectFlow(f)},
      style:{stroke:currentChanges.get('flow:'+f.id)?.action==='remove'?'#b37343':proposed?'#6652ae':'#737786',
        strokeWidth:currentChanges.get('flow:'+f.id)?2.3:1.5,
        strokeDasharray:currentChanges.get('flow:'+f.id)?.action==='remove'?'4 6':proposed?'6 4':undefined}}]
  })
  const flowError=flowPortError(draft.port)
  const sameEnds=!!draft.source_id&&draft.source_id===draft.target_id
  const outside=!!draft.source_id&&!!draft.target_id&&!choices.some(i=>i.system_id===loaded.system_id&&(i.id===draft.source_id||i.id===draft.target_id))
  function connect(c:Connection){
    if(!editable||busy||c.source===c.target)return
    openFlow({...emptyFlow,source_id:c.source,target_id:c.target,source_handle:c.sourceHandle||'',target_handle:(c.targetHandle||'').replace('out-','in-')})
  }
  async function writeProposal(vms:ProposedVM[],links:Link[],action:'edit'|'undo'|'redo'='edit',existing:ExistingInput[]=loaded.existing_changes) {
    if(!editable||busy)return false
    const before={vms:loaded.proposed_vms,flows:loaded.proposed_flows,existing:loaded.existing_changes}
    if(JSON.stringify(before.vms)===JSON.stringify(vms)&&JSON.stringify(before.flows)===JSON.stringify(links)
      &&JSON.stringify(before.existing.map(c=>({kind:c.kind,id:c.id,action:c.action,fields:c.fields})))===JSON.stringify(existing.map(c=>({kind:c.kind,id:c.id,action:c.action,fields:c.fields}))))return true
    setBusy(true);setError('')
    try{
      const next=await request<Details>(path+'/'+id,{method:'PUT',body:JSON.stringify({
        ...revision,title:loaded.title,description:loaded.description,required_services:loaded.required_services,
        proposed_vms:vms,proposed_flows:links,existing_changes:existing,
      })})
      setRow(next);setRoute(next.required_services);update(next)
      setTool(null);setViewFlowId('');setSelectedVMId('');setMenu(null);setDragPositions({})
      if(action==='edit'){setUndoStack(stack=>[...stack.slice(-39),before]);setRedoStack([])}
      else if(action==='undo'){setUndoStack(stack=>stack.slice(0,-1));setRedoStack(stack=>[...stack.slice(-39),before])}
      else {setRedoStack(stack=>stack.slice(0,-1));setUndoStack(stack=>[...stack.slice(-39),before])}
      return true
    }catch(err){
      setError('Не удалось сохранить изменения: '+(err as Error).message)
      setDragPositions({})
      return false
    }finally{setBusy(false)}
  }
  function persist(vms:ProposedVM[],links:Link[]) {
    void writeProposal(vms,links)
  }
  function undoProposal(){
    if(!undoStack.length)return
    const snapshot=undoStack[undoStack.length-1]
    void writeProposal(snapshot.vms,snapshot.flows,'undo',snapshot.existing)
  }
  function redoProposal(){
    if(!redoStack.length)return
    const snapshot=redoStack[redoStack.length-1]
    void writeProposal(snapshot.vms,snapshot.flows,'redo',snapshot.existing)
  }
  function saveVMProperties(){
    if(!selectedProposedVM||!vmForm.name.trim()||!vmFormDirty)return
    persist(loaded.proposed_vms.map(vm=>vm.id===selectedProposedVM.id?{
      ...vm,name:vmForm.name.trim(),kind:vmForm.kind,
      description:vmForm.description.trim(),environment:vmForm.environment.trim(),
    }:vm),loaded.proposed_flows)
  }
  async function moveProposedVm(vmId:string,position:{x:number;y:number}) {
    if(!editable||busy)return
    const vm=loaded.proposed_vms.find(item=>item.id===vmId)
    if(!vm)return
    if(Math.abs(vm.x-position.x)<0.5&&Math.abs(vm.y-position.y)<0.5){setDragPositions({});return}
    await writeProposal(loaded.proposed_vms.map(item=>item.id===vmId?{...item,x:position.x,y:position.y}:item),loaded.proposed_flows)
  }
  function saveProposal() {
    if(!row)return
    if(tool==='vm'&&name.trim()){
      const vm={id:crypto.randomUUID(),system_id:loaded.system_id,kind:newVM.kind,name:name.trim(),description:newVM.description.trim(),environment:newVM.environment.trim(),...nextGridPosition()}
      persist([...loaded.proposed_vms,vm],loaded.proposed_flows)
    }else if(tool==='flow'&&draft.name.trim()&&draft.source_id&&draft.target_id&&!sameEnds&&!outside&&!flowError){
      const flow={...draft,id:draft.id||crypto.randomUUID(),name:draft.name.trim(),protocol:draft.protocol.trim(),port:draft.port.trim(),data_description:draft.data_description?.trim()||'',security:draft.security?.trim()||'',schedule:draft.schedule?.trim()||'',verification:draft.verification||'draft'}
      persist(loaded.proposed_vms,draft.id?loaded.proposed_flows.map(f=>f.id===draft.id?flow:f):[...loaded.proposed_flows,flow])
    }
  }
  return <>
    {schema&&<div className="decisionDrawing"><header><button aria-label="Вернуться к списку" disabled={busy} onClick={exitEditor}><ArrowLeft size={16}/></button><h2>{row.title}</h2><Status value={row.status}/></header>
      <div className="decisionCanvas">{nodes.length?<ReactFlow nodes={measurements.apply(nodes)} edges={edges} onNodesChange={changes=>{
        measurements.record(changes)
        if(!editable||busy)return
        const positionChanges=changes.filter(change=>change.type==='position'&&change.position&&proposedVmIds.has(change.id))
        if(positionChanges.length)setDragPositions(previous=>{
          const next={...previous}
          for(const change of positionChanges)if(change.type==='position'&&change.position){
            next[change.id]={x:change.position.x,y:change.position.y}
          }
          return next
        })
      }} nodeTypes={diagramPortNodes} edgeTypes={decisionEdgeTypes} connectionMode={ConnectionMode.Loose} nodesDraggable={editable&&!busy} nodesConnectable={editable&&!busy} deleteKeyCode={null}
        onNodeDragStop={(_,node)=>{if(proposedVmIds.has(node.id))void moveProposedVm(node.id,node.position)}}
        onNodeClick={(_,node)=>inspectVM(node.id)}
        onNodeContextMenu={(event,node)=>{
          event.preventDefault()
          setMenu({kind:'vm',id:node.id,x:Math.min(event.clientX,window.innerWidth-250),y:Math.min(event.clientY,window.innerHeight-210)})
        }}
        onEdgeContextMenu={(event,edge)=>{
          event.preventDefault()
          setMenu({kind:'flow',id:edge.id,x:Math.min(event.clientX,window.innerWidth-250),y:Math.min(event.clientY,window.innerHeight-210)})
        }}
        onConnectStart={()=>setDrawing(true)} onConnectEnd={()=>setDrawing(false)} onConnect={connect}
        onEdgeClick={(_,edge)=>{const f=lines.find(f=>f.id===edge.id);if(f)inspectFlow(f)}}
        isValidConnection={c=>c.source!==c.target} fitView><AutoFit layoutKey={id} suspended={drawing}/><Background gap={20}/><Controls showInteractive={false}/></ReactFlow>:<p>В этой системе пока нет компонентов.</p>}
        {editable&&<div role="toolbar" aria-label="Инструменты решения" className="decisionTools">
          <button type="button" disabled={busy} title="Выбрать объект" aria-label="Выбрать объект" onClick={()=>{setMenu(null);setTool(null);setSelectedVMId('');setViewFlowId('')}}><MousePointer2 size={16}/> Выбрать</button>
          <button type="button" disabled={busy} onClick={()=>{
            if(hasUnsavedForm&&!window.confirm('Отбросить несохранённые изменения?'))return
            setSelectedVMId('');setViewFlowId('');setTool('vm');setTab('items');setName('');setNewVM(blankVM())
          }}><Monitor size={15}/> ＋ ВМ</button>
          <button type="button" disabled={busy} onClick={()=>openFlow(emptyFlow)}><GitBranch size={15}/> ＋ Поток</button>
          <button type="button" data-decision-undo title="Отменить последнее изменение черновика (Ctrl+Z)" aria-label="Отменить изменение черновика" disabled={busy||!undoStack.length} onClick={undoProposal}><Undo2 size={16}/></button>
          <button type="button" data-decision-redo title="Повторить изменение черновика (Ctrl+Shift+Z)" aria-label="Повторить изменение черновика" disabled={busy||!redoStack.length} onClick={redoProposal}><Redo2 size={16}/></button>
          <span className="decisionToolCount" title="Действующая архитектура отображается только для чтения">{row.proposed_vms.length} ВМ · {row.proposed_flows.length} потоков</span>
        </div>}
        {menu&&<div className="decisionContextMenu" role="menu" aria-label="Действия с объектом" style={{position:'fixed',left:Math.max(8,menu.x),top:Math.max(8,menu.y),zIndex:250}}>
          <button type="button" role="menuitem" onClick={()=>{
            if(menu.kind==='vm')inspectVM(menu.id)
            else {const f=lines.find(flow=>flow.id===menu.id);if(f)inspectFlow(f)}
            setMenu(null)
          }}>{menu.kind==='vm'?'Открыть карточку':'Открыть поток'}</button>
          {editable&&menu.kind==='vm'&&proposedVmIds.has(menu.id)&&<button type="button" role="menuitem" onClick={()=>deleteProposedVM(menu.id)}>Удалить проектируемую ВМ</button>}
          {editable&&menu.kind==='vm'&&!proposedVmIds.has(menu.id)&&localIds.has(menu.id)&&<button type="button" role="menuitem" onClick={()=>{
            setChangeFocus({kind:'vm',id:menu.id});setTab('changes');setTool(null);setMenu(null)
          }}>Запланировать изменение ВМ</button>}
          {editable&&menu.kind==='flow'&&!proposedIds.has(menu.id)&&baseFlows.some(f=>f.id===menu.id)&&<button type="button" role="menuitem" onClick={()=>{
            setChangeFocus({kind:'flow',id:menu.id});setTab('changes');setTool(null);setMenu(null)
          }}>Запланировать изменение потока</button>}
          {editable&&menu.kind==='flow'&&proposedIds.has(menu.id)&&<button type="button" role="menuitem" onClick={()=>{
            if(window.confirm('Удалить проектируемый поток?'))persist(row.proposed_vms,row.proposed_flows.filter(flow=>flow.id!==menu.id))
            setMenu(null)
          }}>Удалить проектируемый поток</button>}
          <button type="button" role="menuitem" onClick={()=>setMenu(null)}>Закрыть меню</button>
        </div>}
      </div>
    </div>}
    <aside className="decisionSide" aria-label="Карточка технического решения">
      <header><h3>{schema?'Свойства решения':row.title}</h3><button disabled={busy} aria-label="Закрыть решение" onClick={exitEditor}><X size={16}/></button></header>
      <small>Версия {row.revision} · Автор: {row.author_name||row.author}</small>
      <nav aria-label="Сведения о решении">{(['items','changes','review'] as const).map(t=><button key={t} aria-pressed={tab===t} onClick={()=>{
          if(hasUnsavedForm&&!window.confirm('Отбросить несохранённые изменения?'))return
          setTab(t);setTool(null);setSelectedVMId('');setViewFlowId('')
        }}>{t==='items'?'Состав':t==='changes'?'Изменения':'Согласование'}</button>)}</nav>
      {row.base_changed&&<p role="status">Исходная архитектура изменилась после отправки на согласование. Для подписи требуется пересогласование обновлённой версии.</p>}
      {tab==='items'?<>
        {row.description&&<p>{row.description}</p>}
        {schema&&<details><summary>Текущее размещение компонентов ИС</summary><SystemComposition flows={flows} items={items.filter(item=>item.system_id===row.system_id)} onOpen={inspectVM}/></details>}
        {schema&&selectedVM?<section className="decisionVmDetails" aria-label="Паспорт выбранной ВМ">
          <h4>{selectedProposedVM?'Проектируемая ВМ':['vm','server','host'].includes(selectedVM.kind)?'Действующая ВМ или сервер':'Действующий компонент'}</h4>
          {selectedProposedVM&&editable?<form onSubmit={event=>{event.preventDefault();saveVMProperties()}}>
            <label>Имя проектируемой ВМ<input aria-label="Имя проектируемой ВМ" required maxLength={250} value={vmForm.name} onChange={event=>setVmForm({...vmForm,name:event.target.value})}/></label>
            <label>Тип<select aria-label="Тип проектируемой ВМ" value={vmForm.kind} onChange={event=>setVmForm({...vmForm,kind:event.target.value as VMForm['kind']})}>
              <option value="vm">ВМ</option><option value="server">Сервер</option><option value="host">Хост</option>
            </select></label>
            <label>Среда<input aria-label="Среда проектируемой ВМ" maxLength={120} value={vmForm.environment} onChange={event=>setVmForm({...vmForm,environment:event.target.value})} placeholder="prod / test / dev"/></label>
            <label>Описание<textarea aria-label="Описание проектируемой ВМ" maxLength={4000} value={vmForm.description} onChange={event=>setVmForm({...vmForm,description:event.target.value})}/></label>
            <small>Позиция: {Math.round(selectedProposedVM.x)}, {Math.round(selectedProposedVM.y)}. Перемещайте ВМ на схеме.</small>
            <div className="decisionActions">
              <button className="primary" disabled={busy||!vmFormDirty||!vmForm.name.trim()}>Сохранить свойства ВМ</button>
              <button type="button" disabled={busy} onClick={()=>deleteProposedVM(selectedProposedVM.id)}>Удалить ВМ</button>
            </div>
          </form>:<>
            <strong>{selectedVM.name}</strong>
            <small>Действующий реестр защищён от изменений черновика.</small>
            {editable&&!selectedProposedVM&&localIds.has(selectedVM.id)&&<button type="button"
              onClick={()=>{setChangeFocus({kind:'vm',id:selectedVM.id});setSelectedVMId('');setTab('changes')}}>Запланировать изменение этой ВМ</button>}
            {selectedProposedVM&&<small>Позиция: {Math.round(selectedProposedVM.x)}, {Math.round(selectedProposedVM.y)}</small>}
          </>}
          <button type="button" onClick={()=>setSelectedVMId('')}>К составу решения</button>
        </section>:schema&&viewedFlow?<section className="decisionFlowDetails">
          <strong>{viewedFlow.name}</strong>
          <small>{proposedIds.has(viewedFlow.id)?'Проектируемый поток':'Поток из реестра'}</small>
          <p>{choices.find(c=>c.id===viewedFlow.source_id)?.name} → {choices.find(c=>c.id===viewedFlow.target_id)?.name}</p>
          <small>{[viewedFlow.protocol,viewedFlow.port].filter(Boolean).join(' ')||'Протокол и порт не указаны'}</small>
          {viewedFlow.data_description&&<p>{viewedFlow.data_description}</p>}
          {viewedFlow.security&&<small>Защита: {viewedFlow.security}</small>}
          {viewedFlow.schedule&&<small>Периодичность: {viewedFlow.schedule}</small>}
          {editable&&!proposedIds.has(viewedFlow.id)&&<button type="button" onClick={()=>{
            setChangeFocus({kind:'flow',id:viewedFlow.id});setViewFlowId('');setTab('changes')
          }}>Запланировать изменение этого потока</button>}
          <button onClick={()=>setViewFlowId('')}>К составу решения</button>
        </section>:schema&&tool&&editable?<form key={tool} onSubmit={e=>{e.preventDefault();saveProposal()}}>
          <label>{tool==='vm'?'Название ВМ':'Название потока'}<input autoFocus required maxLength={250} value={tool==='vm'?name:draft.name} onChange={e=>tool==='vm'?setName(e.target.value):setDraft({...draft,name:e.target.value})}/></label>
          {tool==='vm'&&<>
            <label>Тип<select aria-label="Тип новой ВМ" value={newVM.kind} onChange={e=>setNewVM({...newVM,kind:e.target.value as VMForm['kind']})}>
              <option value="vm">ВМ</option><option value="server">Сервер</option><option value="host">Хост</option>
            </select></label>
            <label>Среда<input maxLength={120} value={newVM.environment} onChange={e=>setNewVM({...newVM,environment:e.target.value})}/></label>
            <label>Описание<textarea maxLength={4000} value={newVM.description} onChange={e=>setNewVM({...newVM,description:e.target.value})}/></label>
          </>}
          {tool==='flow'&&<>
            {!draft.source_id&&!draft.target_id&&<small>Выберите компоненты в списках или протяните стрелку между точками на схеме.</small>}
            {(['source','target'] as const).map(end=><label key={end}>{end==='source'?'Источник':'Получатель'}<select aria-label={end==='source'?'Источник':'Получатель'} required value={draft[`${end}_id`]} onChange={e=>setDraft({...draft,[end+'_id']:e.target.value,[end+'_handle']:''})}><option value="">Выберите компонент</option>{choices.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label>)}
            <button type="button" disabled={!draft.source_id||!draft.target_id} onClick={()=>setDraft({...draft,source_id:draft.target_id,target_id:draft.source_id,source_handle:draft.target_handle?.replace('in-','out-'),target_handle:draft.source_handle?.replace('out-','in-')})}>Поменять направление</button>
            <div className="decisionFlowFields"><label>Протокол<input maxLength={80} value={draft.protocol} onChange={e=>setDraft({...draft,protocol:e.target.value})}/></label><label>Порт<input maxLength={80} inputMode="numeric" value={draft.port} onChange={e=>setDraft({...draft,port:e.target.value})}/></label></div>
            <label>Состав передаваемых данных<textarea aria-label="Данные проектируемого потока" maxLength={4000} value={draft.data_description||''} onChange={e=>setDraft({...draft,data_description:e.target.value})}/></label>
            <label>Защита<input aria-label="Защита проектируемого потока" maxLength={80} value={draft.security||''} onChange={e=>setDraft({...draft,security:e.target.value})} placeholder="Не указана"/></label>
            <label>Периодичность<input aria-label="Периодичность проектируемого потока" maxLength={160} value={draft.schedule||''} onChange={e=>setDraft({...draft,schedule:e.target.value})}/></label>
            <label>Достоверность<select aria-label="Достоверность проектируемого потока" value={draft.verification||'draft'} onChange={e=>setDraft({...draft,verification:e.target.value as Link['verification']})}>
              <option value="draft">Черновик</option><option value="assumed">Предполагается</option><option value="verified">Подтверждено</option>
            </select></label>
            {(sameEnds||outside||flowError)&&<small role="alert">{sameEnds?'Выберите два разных компонента.':outside?'Один из компонентов должен принадлежать системе решения.':flowError}</small>}
          </>}
          <div className="decisionActions"><button className="primary" disabled={busy||(tool==='vm'?!name.trim():!draft.name.trim()||!draft.source_id||!draft.target_id||sameEnds||outside||!!flowError)}>{tool==='flow'&&draft.id?'Сохранить поток':'Добавить в черновик'}</button>
          <button type="button" disabled={busy} onClick={()=>{
            if(hasUnsavedForm&&!window.confirm('Отбросить несохранённые изменения?'))return
            setTool(null)
          }}>Отмена</button>
          {tool==='flow'&&draft.id&&<button type="button" disabled={busy} onClick={()=>{if(window.confirm('Удалить поток из этого черновика?'))persist(row.proposed_vms,row.proposed_flows.filter(f=>f.id!==draft.id))}}>Удалить поток</button>}</div>
        </form>:<>
          {row.proposed_vms.map(vm=><div className="decisionItem" key={vm.id}>
            <button type="button" onClick={()=>{openSchema();inspectVM(vm.id)}}>{vm.name}</button><small>Новая ВМ</small>
            {editable&&<button type="button" disabled={busy} aria-label={'Удалить ВМ '+vm.name} onClick={()=>deleteProposedVM(vm.id)}>Удалить ВМ</button>}
          </div>)}
          {row.proposed_flows.map(f=><div className="decisionItem" key={f.id}>
            <button onClick={()=>{openSchema();inspectFlow(f)}}>{f.name}</button><small>Новый поток</small>
            <small className="decisionFlowSummary">{choices.find(i=>i.id===f.source_id)?.name||'Компонент'} → {choices.find(i=>i.id===f.target_id)?.name||'Компонент'}{[f.protocol,f.port].some(Boolean)&&' · '+[f.protocol,f.port].filter(Boolean).join(' ')}</small>
          </div>)}
          {!row.proposed_vms.length&&!row.proposed_flows.length&&<p>В черновике пока нет изменений.</p>}
        </>}
        {!schema&&<button onClick={openSchema}>Открыть схему</button>}
        {editable&&!tool&&!vmFormDirty&&(row.proposed_vms.length+row.proposed_flows.length+row.existing_changes.length>0)&&<button className="primary" disabled={busy||routeChanged} title={routeChanged?'Сохраните изменённый маршрут согласования на вкладке «Согласование»':undefined} onClick={()=>void change('/submit',revision)}>На согласование</button>}
      </>:tab==='changes'?<section className="decisionChanges" aria-label="Изменения технического решения">
        <div className="decisionActions"><h4>Предлагаемые изменения</h4><button type="button" onClick={downloadDocument}>Скачать техническое решение (.md)</button></div>
        <p>Действующая архитектура остаётся без изменений. Новые объекты появятся в реестре только после отдельного подтверждённого внедрения.</p>
        <div className="decisionChangeCounts"><strong>+ {row.proposed_vms.length} ВМ</strong><strong>+ {row.proposed_flows.length} потоков</strong>
          <strong>~ {existingSummary(row.existing_changes).changed} изменено</strong>
          <strong>− {existingSummary(row.existing_changes).removed} к удалению</strong>
        </div>
        {row.proposed_vms.map(vm=><div className="decisionItem" key={vm.id}>
          <span>+ {vm.name}</span><small>{vm.kind} · {vm.environment||'Среда не указана'}</small>
        </div>)}
        {row.proposed_flows.map(flow=><div className="decisionItem" key={flow.id}>
          <span>+ {flow.name}</span><small className="decisionFlowSummary">
            {choices.find(x=>x.id===flow.source_id)?.name||'Неизвестный источник'} → {choices.find(x=>x.id===flow.target_id)?.name||'Неизвестный получатель'}
            {' · '}{flow.protocol||'Протокол не указан'}{flow.port?':'+flow.port:''}
          </small>
          <small>{flow.data_description||'Состав данных не описан'} · {flow.security||'Защита не указана'}</small>
        </div>)}
        {!row.proposed_vms.length&&!row.proposed_flows.length&&!row.existing_changes.length&&<small>Изменений пока нет.</small>}
        <DecisionExistingChanges systemId={row.system_id} items={items} flows={flows}
          changes={row.existing_changes} editable={editable} busy={busy}
          initialTarget={changeFocus} onDirtyChange={setExistingFormDirty}
          onSave={existing=>writeProposal(row.proposed_vms,row.proposed_flows,'edit',existing)}
          onFocus={(kind,id)=>{
            if(kind==='vm'){setTab('items');openSchema();inspectVM(id)}
            else {const f=baseFlows.find(item=>item.id===id);if(f){setTab('items');openSchema();inspectFlow(f)}}
          }}/>
        {row.base_changed&&<p role="alert">Исходная архитектура изменилась. Перед публикацией потребуется пересогласование новой версии.</p>}
        <small>План изменений и документ согласуются без внесения изменений в действующий реестр. Внедрение подтверждается отдельным процессом.</small>
      </section>:<>
        <section className="decisionApprovalRoute" aria-label="Маршрут согласования">
          <h4>Маршрут согласования</h4>
          <p>Каждая выбранная служба согласует решение отдельно. Отправка не создаёт реальные ВМ и потоки.</p>
          {editable&&<div className="decisionReviewServices" role="group" aria-label="Обязательные согласующие службы">
            {(Object.entries(services) as [Service,string][]).map(([service,label])=>
              <label key={service}><input type="checkbox" checked={route.includes(service)} onChange={event=>setRoute(current=>event.target.checked?[...current,service]:current.filter(key=>key!==service))}/>{label}</label>
            )}
          </div>}
          {editable&&routeChanged&&<div className="decisionActions">
            <button type="button" disabled={busy||!route.length} onClick={saveRoute}>Сохранить маршрут</button>
            <button type="button" disabled={busy} onClick={()=>setRoute(row.required_services)}>Отменить изменение</button>
          </div>}
          {editable&&!route.length&&<small role="alert">Выберите хотя бы одну согласующую службу.</small>}
          {row.required_services.length>0&&<p className="decisionReviewProgress" role="status">Согласовано: {approvedCount} из {row.required_services.length}</p>}
          <div className="decisionReviewStages">
            {row.required_services.map(service=>{
              const approval=row.approvals.find(a=>a.service===service)
              return <div className="decisionReviewStage" key={service}>
                <strong>{services[service]}</strong>
                <span>{approval?.verdict==='approved'?'Согласовано':approval?.verdict==='changes_requested'?'Возвращено на доработку':row.status==='in_review'?'На рассмотрении':'Не отправлено'}</span>
                {approval&&<small>{approval.actor_name||approval.actor} · {dateFormat.format(new Date(approval.created_at))}</small>}
                {approval?.note&&<p>{approval.note}</p>}
              </div>
            })}
          </div>
          {editable&&<div className="decisionActions">
            <button type="button" className="primary" disabled={busy||!canSubmit}
              onClick={()=>void change('/submit',revision)}>Отправить на согласование</button>
            {!row.proposed_vms.length&&!row.proposed_flows.length&&!row.existing_changes.length&&<small>Сначала добавьте в проект ВМ, поток или изменение существующего объекта.</small>}
            {routeChanged&&<small>Сначала сохраните изменённый маршрут.</small>}
          </div>}
        </section>
        {row.status==='in_review'&&!reviewer&&<p className="decisionReviewNotice" role="status">
          {profile?.auth_kind!=='named_user'
            ?profile?.auth_kind==='open_access'
              ?'В режиме «Доступ без пароля» подпись недоступна. Войдите для согласования под персональной учётной записью сотрудника.'
              :'Для согласования необходим персональный вход сотрудника с ролью службы. Служебный ключ не заменяет персональную подпись.'
            :author?'Автор не может согласовать собственное решение.'
            :'Решение ожидает согласования назначенных служб. Ваша роль не включена в маршрут.'}
        </p>}
        {reviewer&&<section className="decisionReviewerActions" aria-label="Моё согласование">
          <h4>Решение согласующего – {services[profile!.role as Service]}</h4>
          <label>Замечания или пояснение к решению
            <textarea value={comment} maxLength={2000} onChange={e=>setComment(e.target.value)}
              placeholder="При возврате на доработку обязательно опишите замечания."/>
          </label>
          <div className="decisionActions">
            <button type="button" disabled={busy||row.base_changed||comment.trim().length<3}
              onClick={()=>void change('/review',{...revision,verdict:'changes_requested',note:comment})}>На доработку</button>
            <button type="button" className="primary" disabled={busy||row.base_changed}
              onClick={()=>void change('/review',{...revision,verdict:'approved',note:comment})}>Согласовать</button>
          </div>
        </section>}
        {row.status==='approved'&&editor&&<div className="decisionActions">
          {profile?.auth_kind==='named_user'
            ?<button type="button" className="primary" disabled={busy||row.base_changed}
              onClick={()=>void change('/publish',revision)}>Опубликовать согласованное решение</button>
            :<small role="status">Для публикации войдите под персональной учётной записью автора или архитектора.</small>}
        </div>}
        <section className="decisionDiscussion" aria-label="Обсуждение решения">
          <h4>Комментарии и замечания</h4>
          {(row.comments||[]).length?<ol>{row.comments.map(message=><li key={message.id}>
            <strong>{message.actor_name||message.actor}</strong>
            <small>{dateFormat.format(new Date(message.created_at))}
              {message.anchor_kind==='vm'?' · ВМ: '+(row.proposed_vms.find(vm=>vm.id===message.anchor_id)?.name||row.existing_changes.find(c=>c.kind==='vm'&&c.id===message.anchor_id)?.before.name||'ВМ')
                :message.anchor_kind==='flow'?' · Поток: '+(row.proposed_flows.find(flow=>flow.id===message.anchor_id)?.name||row.existing_changes.find(c=>c.kind==='flow'&&c.id===message.anchor_id)?.before.name||'Поток'):''}
            </small><p>{message.body}</p>
          </li>)}</ol>:<p>Замечаний пока нет.</p>}
          {canComment&&<form onSubmit={event=>{event.preventDefault();sendComment()}}>
            <label>К чему относится комментарий
              <select aria-label="Объект комментария" value={commentTarget} onChange={e=>setCommentTarget(e.target.value)}>
                <option value="decision:">Решение целиком</option>
                {row.proposed_vms.map(vm=><option key={vm.id} value={'vm:'+vm.id}>ВМ · {vm.name}</option>)}
                {row.proposed_flows.map(flow=><option key={flow.id} value={'flow:'+flow.id}>Поток · {flow.name}</option>)}
                {row.existing_changes.map(change=><option key={change.kind+change.id} value={change.kind+':'+change.id}>
                  Изменение · {change.before.name}
                </option>)}
              </select>
            </label>
            <label>Комментарий<textarea value={discussion} maxLength={2000} onChange={e=>setDiscussion(e.target.value)}
              placeholder="Опишите замечание или вопрос по техническому решению."/></label>
            <button type="submit" disabled={busy||!discussion.trim()}>Добавить комментарий</button>
            {profile?.auth_kind!=='named_user'&&<small>Комментарий без персонального входа не является согласованием.</small>}
          </form>}
        </section>
        {(row.review_history||[]).length>0&&<details className="decisionVoteHistory">
          <summary>История согласований ({row.review_history.length})</summary>
          <ol>{row.review_history.map((vote,index)=><li key={index}>
            <strong>{services[vote.service]} · {vote.verdict==='approved'?'Согласовано':'На доработку'}</strong>
            <small>Версия {vote.revision} · {vote.actor_name||vote.actor} · {dateFormat.format(new Date(vote.created_at))}</small>
            {vote.note&&<p>{vote.note}</p>}
          </li>)}</ol>
        </details>}
      </>}
      {row.status==='in_review'&&(editor?<button disabled={busy} onClick={()=>{if(window.confirm('Вернуть решение в черновик? Изменённую версию потребуется согласовать заново.'))void change('/withdraw',revision)}}>Отозвать в черновик</button>:<small>Редактирование доступно после возврата в черновик.</small>)}
      {error&&<div role="alert" className="decisionError">{error} <button onClick={()=>{setTool(null);setViewFlowId('');retry(v=>v+1)}}>Обновить</button></div>}
    </aside>
  </>
}
