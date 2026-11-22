import React, {useEffect,useLayoutEffect,useMemo,useRef,useState} from 'react'
import {architectureIcon,DiagramNodeLabel,diagramCardStyle} from './DiagramVisual'
import {OverviewFlowEdge, type OverviewFlow} from './OverviewFlowEdge'
import type {OverviewMode} from './workspaceRoutes'
import {FlowSequence} from './FlowSequence'
import type {Connection, Edge} from '@xyflow/react'
import {logoFromAttributes} from './SystemLogo'
export {architectureIcon} from './DiagramVisual'
import {ReactFlow,Background,Controls,MarkerType,Position,type NodeChange} from '@xyflow/react'
import {Save, X} from 'lucide-react'

type System={id:string;name:string;kind:string;attributes?:Record<string,unknown>}
type Component={id:string;system_id:string;name:string;kind:string;details:Record<string,unknown>}
type Flow=OverviewFlow & {source_id:string;target_id:string}
type Process={id:string;name:string;category_id?:string}
type Category={id:string;name:string}
type OverlayGroup={id:string;name:string;type:'business';members:Set<string>}
type LayerRegion={group_key:string;revision:number;x:number;y:number;width:number;height:number;color:string;opacity:number;members:string[]}
type LayerDraft=Omit<LayerRegion,'group_key'|'revision'>
// Supply initial handle geometry as well as dimensions while React Flow measures cards.
const systemHandles = [
 {type:'source' as const, position:Position.Right, x:245, y:43, width:1, height:1},
 {type:'target' as const, position:Position.Left, x:0, y:43, width:1, height:1},
]
const homeEdgeTypes={overviewFlow:OverviewFlowEdge}
type Link={process_id:string;system_id:string}
type Network={id:string;name:string;kind:string}
type Interface={item_id:string;zone_id:string|null;vlan_id:string|null;vrf_id:string|null}

import {AutoFit,Disclosure} from './WorkspaceUI'
import {overviewGridColumns,overviewGridPositions,flowCountLabel} from './graphLayout'

type LogicalMap = {
 relations: {id:string; source_id:string; target_id:string; kind:string}[]
 positions: Record<string,{x:number;y:number}>
 controls: React.ReactNode
 editing: boolean
 toggleEdit: ()=>void
 move: (id:string, point:{x:number;y:number}, startingPositions?:LogicalMap['positions'])=>void
 onConnect: (connection:Connection)=>void
}
export default function ArchitectureHome({mode,onModeChange,logical,systems,components,flows,processes,categories,links,onOpenProcess,onOpenSystem,onCloseSystem,inspectorOpen,onOpenComponents,onOpenComponent,onOpenFlows,focusSystemId='',request,canEditLayers=false,canEditFlows=false}:{mode:OverviewMode;onModeChange:(mode:OverviewMode)=>void;logical:LogicalMap;systems:System[];components:Component[];flows:Flow[];processes:Process[];categories:Category[];links:Link[];networks:Network[];interfaces:Interface[];onOpenProcess?:(id:string)=>void;onOpenSystem:(id:string)=>void;onCloseSystem:()=>void;inspectorOpen:boolean;onOpenComponents:(id:string)=>void;onOpenComponent:(id:string)=>void;onOpenFlows:()=>void;onOpenNetworks:()=>void;focusSystemId?:string;request?:<T>(url:string,init?:RequestInit)=>Promise<T>;canEditLayers?:boolean;canEditFlows?:boolean}){
 const [layers,setLayers]=useState({systems:true,components:false,flows:false,business:false})
 const sequence=mode==='sequence'
 const mapMode=sequence?'flows':mode
 const flowPresentation=sequence?'sequence':'map'
 const logicalMode=mapMode==='logical'
 const [fitRequest,setFitRequest]=useState(0)
 const [manualLayout,setManualLayout]=useState(false)
 const editingSystems=logicalMode&&logical.editing&&canEditLayers
 const [selectedAreaIds,setSelectedAreaIds]=useState<string[]>([])
 const [membersOnly,setMembersOnly]=useState(false)
 const [editingAreaId,setEditingAreaId]=useState('')
 const [savedRegions,setSavedRegions]=useState<Record<string,LayerRegion>>({})
 const [layerDrafts,setLayerDrafts]=useState<Record<string,LayerDraft>>({})
 const [editingLayers,setEditingLayers]=useState(false)
 const [layerBusy,setLayerBusy]=useState(false)
 const [layerError,setLayerError]=useState('')
 const [layerConflict,setLayerConflict]=useState(false)
 const [layerApiReady,setLayerApiReady]=useState(false)
 useEffect(()=>{
  if(!request){setSavedRegions({});setLayerDrafts({});setEditingLayers(false);setLayerApiReady(false);return}
  setLayerApiReady(false)
  let cancelled=false
  void request<LayerRegion[]>('/api/diagrams/layer-regions').then(rows=>{
   if(!cancelled){setSavedRegions(Object.fromEntries(rows.map(row=>[row.group_key,row])));setLayerApiReady(true);setLayerError('')}
  }).catch(err=>{if(!cancelled)setLayerError((err as Error).message)})
  return()=>{cancelled=true}
 },[request])
 const updateDraft=(id:string,update:Partial<LayerDraft>,base:LayerDraft)=>{
  setLayerDrafts(old=>({...old,[id]:{...(old[id]||base),...update}}))
 }
 const cancelLayerChanges=()=>{setLayerDrafts({});setEditingLayers(false);setLayerError('');setLayerConflict(false)}
 const reloadLayerRegions=async()=>{
  if(!request)return
  setLayerBusy(true)
  try{
   const rows=await request<LayerRegion[]>('/api/diagrams/layer-regions')
   setSavedRegions(Object.fromEntries(rows.map(row=>[row.group_key,row])))
   setLayerDrafts({})
   setEditingLayers(false);setLayerError('');setLayerConflict(false)
  }catch(err){setLayerError((err as Error).message)}
  finally{setLayerBusy(false)}
 }
 const saveLayerChanges=async()=>{
  if(!request||!canEditLayers||!Object.keys(layerDrafts).length)return
  setLayerBusy(true);setLayerError('');setLayerConflict(false)
  try{
   // All-or-nothing: either every region is saved against its last observed
   // revision, or the editor keeps the complete local draft on HTTP 409.
   const regions=Object.entries(layerDrafts).map(([key,payload])=>({
    ...payload,members:payload.members.filter(id=>eligibleIds.has(id)),group_key:key,expected_revision:savedRegions[key]?.revision??null
   }))
   const updated=await request<LayerRegion[]>('/api/diagrams/layer-regions',{
    method:'PUT',body:JSON.stringify({regions})
   })
   setSavedRegions(old=>({...old,...Object.fromEntries(updated.map(row=>[row.group_key,row]))}))
   setSelectedAreaIds(ids=>[...new Set([...ids,...Object.keys(layerDrafts)])]);setLayerDrafts({});setEditingLayers(false)
  }catch(err){
   const message=(err as Error).message
   setLayerError(message)
   setLayerConflict(/409|изменен|изменёна|изменена|конкурентн/i.test(message))
  }finally{setLayerBusy(false)}
 }
 const [overlayColors]=useState<Record<string,string>>(()=>{
  try{const value=JSON.parse(localStorage.getItem('architecture-hub-layer-colors-v1')||'{}');return value&&typeof value==='object'&&!Array.isArray(value)?value:{}}catch{return {}}
 })
 
 const [businessPair,setBusinessPair]=useState('')
 const [processMenu,setProcessMenu]=useState('')
 const [openFlowPair,setOpenFlowPair]=useState('')
 const [query,setQuery]=useState('')
 const [focus,setFocus]=useState('')
 const [selectedSystem,setSelectedSystem]=useState('')
 const validFocusSystemId=systems.some(system=>system.id===focusSystemId)?focusSystemId:''
 useEffect(()=>{
  if(validFocusSystemId)setSelectedSystem(validFocusSystemId)
  else setSelectedSystem(previous=>previous&&systems.some(system=>system.id===previous)?previous:'')
 },[validFocusSystemId,systems])
 const previousInspectorOpen=useRef(inspectorOpen)
 useEffect(()=>{
   if(previousInspectorOpen.current&&!inspectorOpen)setSelectedSystem('')
   previousInspectorOpen.current=inspectorOpen
 },[inspectorOpen])
 const [environment,setEnvironment]=useState('all')
 const systemByComponent=useMemo(()=>new Map(components.map(c=>[c.id,c.system_id])),[components])
 const filteredSystems=systems.filter(s=>(!query||s.name.toLowerCase().includes(query.toLowerCase())||components.some(c=>c.system_id===s.id&&c.name.toLowerCase().includes(query.toLowerCase())))&&(!focus||focus===s.id)&& (environment==='all'||components.some(c=>c.system_id===s.id&&String(c.details.environment||'').toLowerCase()===environment)))
 const visibleIds=new Set(filteredSystems.map(s=>s.id))
 const knownSystemIds=new Set(systems.map(s=>s.id))
 const exchanges=flows.flatMap(flow=>{
   const source=systemByComponent.get(flow.source_id),target=systemByComponent.get(flow.target_id)
   return source&&target&&knownSystemIds.has(source)&&knownSystemIds.has(target)?[{source,target,flow}]:[]
 })
 const visibleExchanges=exchanges.filter(row=>visibleIds.has(row.source)||visibleIds.has(row.target))
 const crossFlows=visibleExchanges.filter(row=>row.source!==row.target)
 const neighborIds=new Set(crossFlows.flatMap(row=>[row.source,row.target]))
 const focusProcesses = new Set(links.filter(link=>link.system_id===focus).map(link=>link.process_id))
 const businessNeighbors = new Set(links.filter(link=>focusProcesses.has(link.process_id)).map(link=>link.system_id))
 const mapSystems = mapMode==='flows' ? systems.filter(s=>visibleIds.has(s.id)||neighborIds.has(s.id))
   : mapMode==='business' && visibleIds.has(focus) ? systems.filter(s=>businessNeighbors.has(s.id)||s.id===focus) : filteredSystems
 const mappedIds = new Set(mapSystems.map(s=>s.id))
 const groupedFlows=new Map<string,Flow[]>()
 for(const {source,target,flow} of crossFlows){
   const key=source+'|'+target
   const group=groupedFlows.get(key)
   if(group)group.push(flow)
   else groupedFlows.set(key,[flow])
 }
 const flowCounts=new Map(Array.from(groupedFlows,([key,group])=>[key,group.length]))
 // Systems participating in the same business process are associated, not
 // necessarily connected by a technical data flow. Keep those semantics separate.
 const processSystems=new Map<string,Set<string>>()
 for(const link of links)if(mappedIds.has(link.system_id)){
   const members=processSystems.get(link.process_id)||new Set<string>()
   members.add(link.system_id);processSystems.set(link.process_id,members)
 }
 const pairProcesses=new Map<string,Process[]>()
 for(const process of processes){
   const members=processSystems.get(process.id)
   if(!members)continue
   const ids=[...members].sort()
   for(let i=0;i<ids.length;i++)for(let j=i+1;j<ids.length;j++){
     const key=ids[i]+'|'+ids[j]
     const group=pairProcesses.get(key)
     if(group)group.push(process)
     else pairProcesses.set(key,[process])
   }
 }
 const overlayGroups:OverlayGroup[]=[]
 for(const cat of categories){
   const ids=new Set(processes.filter(p=>p.category_id===cat.id).map(p=>p.id))
   const members=new Set(links.filter(l=>ids.has(l.process_id)&&knownSystemIds.has(l.system_id)).map(l=>l.system_id))
   overlayGroups.push({id:'business:'+cat.id,name:cat.name,type:'business',members})
 }
 // Processes without a known category retain their own visual group.
 for(const process of processes.filter(p=>!p.category_id||!categories.some(c=>c.id===p.category_id))){
   const members=new Set(links.filter(l=>l.process_id===process.id&&knownSystemIds.has(l.system_id)).map(l=>l.system_id))
   if(members.size||savedRegions['business:process:'+process.id])overlayGroups.push({id:'business:process:'+process.id,name:process.name,type:'business',members})
 }
 const palette=['#a78bfa','#f59e0b','#10b981','#60a5fa','#f472b6','#22d3ee','#f97316','#84cc16']
 const groupColor=(group:OverlayGroup)=>layerDrafts[group.id]?.color||savedRegions[group.id]?.color||overlayColors[group.id]||palette[Math.max(0,overlayGroups.findIndex(item=>item.id===group.id))%palette.length]
 const eligibleSystems=systems.filter(system=>system.kind==='system')
 const eligibleIds=new Set(eligibleSystems.map(system=>system.id))
 const membersFor=(group:OverlayGroup)=>(layerDrafts[group.id]?.members||savedRegions[group.id]?.members||[...group.members]).filter(id=>eligibleIds.has(id))
 const selectedAreas=overlayGroups.filter(group=>selectedAreaIds.includes(group.id))
 const editingArea=overlayGroups.find(group=>group.id===editingAreaId)
 const displayAreas=logicalMode||sequence?[]:editingLayers&&editingArea?[editingArea]:selectedAreas
 const areaLabels=new Map<string,OverlayGroup[]>()
 for(const group of displayAreas){
   for(const systemId of membersFor(group)){
     const labels=areaLabels.get(systemId)||[]
     labels.push(group)
     areaLabels.set(systemId,labels)
   }
 }
 function toggleArea(id:string){
   setSelectedAreaIds(ids=>ids.includes(id)?ids.filter(key=>key!==id):[...ids,id])
 }
 function changeArea(group:OverlayGroup,changes:Partial<LayerDraft>){
   // Older installations also store rectangle geometry. Preserve it on membership edits.
   const base=layerDrafts[group.id]||savedRegions[group.id]||{
     x:0,y:0,width:340,height:190,color:groupColor(group),opacity:0.22,members:membersFor(group)
   }
   updateDraft(group.id,changes,base)
 }
 const compactAreas=membersOnly&&displayAreas.length>0&&!editingLayers
 const shownSystems=compactAreas?mapSystems.filter(system=>areaLabels.has(system.id)):mapSystems
 const shownIds=new Set(shownSystems.map(system=>system.id))
 const graphRef=useRef<HTMLDivElement>(null)
 const [pane,setPane]=useState({width:0,height:0})
 useLayoutEffect(()=>{
   const graph=graphRef.current
   if(!graph)return
   const measure=()=>{
     const width=graph.clientWidth
     // Keep the same grid when selecting areas adds a process toolbar.
     const context=graph.closest('.homeMap')?.querySelector('.overviewProcessContext')
     const height=graph.clientHeight+(context?.getBoundingClientRect().height??0)
     if(width&&height)setPane(previous=>previous.width===width&&previous.height===height?previous:{width,height})
   }
   measure()
   const observer=new ResizeObserver(measure)
   observer.observe(graph)
   return ()=>observer.disconnect()
 },[sequence,layers.systems])
 const columns=overviewGridColumns(shownIds.size,pane.width,pane.height)
 const gridPositions=overviewGridPositions([...shownIds],340,190,columns)
 const shownPositions=logicalMode&&manualLayout?{...gridPositions,...logical.positions}:gridPositions
 const componentNodes=layers.components?components.filter(c=>visibleIds.has(c.system_id)).flatMap(c=>{
   const group=components.filter(item=>item.system_id===c.system_id)
   const index=group.findIndex(item=>item.id===c.id)
   const parent=shownPositions[c.system_id]
   return parent?[{id:'component:'+c.id,position:{x:parent.x+(index%2)*144,y:parent.y+100+Math.floor(index/2)*43},
     data:{label:<span title={c.name}>{architectureIcon(c.kind)} {c.name}</span>},style:{width:136,fontSize:11,padding:'7px',borderRadius:6,border:'1px solid #cbd5e1',background:'#fff',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap' as const},selectable:true,draggable:false,zIndex:20}]:[]
 }):[]

 const nodes=shownSystems.map(s=>({id:s.id,draggable:editingSystems,initialWidth:245,initialHeight:86,handles:systemHandles,sourcePosition:Position.Right,targetPosition:Position.Left,position:shownPositions[s.id],data:{label:<DiagramNodeLabel name={s.name} kind={s.kind} logo={logoFromAttributes(s.attributes)} subtitle={components.filter(c=>c.system_id===s.id).length+' компонентов · '+links.filter(l=>l.system_id===s.id).length+' бизнес-связей'}>
   {areaLabels.has(s.id)&&<span className="systemAreaLabels">{areaLabels.get(s.id)!.map(group=><span key={group.id} className="systemAreaLabel" title={group.name} role="img" aria-label={group.name}><i aria-hidden="true" style={{backgroundColor:groupColor(group)}}/><span className="areaNameAccessible">{group.name}</span></span>)}</span>}
   </DiagramNodeLabel>},style:diagramCardStyle()}))
 const selectedSystemInfo=shownSystems.find(s=>s.id===selectedSystem)
 const selectedNeighbors=new Set<string>([selectedSystem])
 for(const f of crossFlows)if(f.source===selectedSystem||f.target===selectedSystem){selectedNeighbors.add(f.source);selectedNeighbors.add(f.target)}
 if(mapMode==='business'){
   selectedNeighbors.clear()
   selectedNeighbors.add(selectedSystem)
   for(const members of processSystems.values()) if(members.has(selectedSystem)) for(const id of members) selectedNeighbors.add(id)
 }
 const selectedComponents=components.filter(c=>c.system_id===selectedSystem)
 const selectedFlowCount=crossFlows.filter(f=>f.source===selectedSystem||f.target===selectedSystem).length
 const contextSystem = filteredSystems.find(s=>s.id===focus) || selectedSystemInfo
 const contextProcesses = processes.filter(process =>
   (!selectedAreas.length || selectedAreas.some(group=>group.id==='business:'+process.category_id || group.id==='business:process:'+process.id)) &&
   (!contextSystem || links.some(link=>link.process_id===process.id && link.system_id===contextSystem.id))
 )
 const highlightedNodes=nodes.map(n=>({...n,zIndex:10,style:{...n.style,border:selectedSystem===n.id?'2px solid var(--hub-accent)':n.style.border,opacity:displayAreas.length?(areaLabels.has(n.id)?1:0.52):selectedSystem&&!selectedNeighbors.has(n.id)?0.28:1}}))
 const canvasNodes=[...highlightedNodes,...componentNodes]
 function selectBusinessPair(key:string){
   const group=pairProcesses.get(key)
   if(!group?.length||!onOpenProcess)return
   setBusinessPair(key)
   if(group.length===1){setProcessMenu('');onOpenProcess(group[0].id)}
   else setProcessMenu(previous=>previous===key?'':key)
 }
 const businessCounts=new Map(Array.from(pairProcesses,([key,group])=>[key,group.length]))
 const systemNames=new Map(shownSystems.map(system=>[system.id,system.name]))
 const connectionCounts=mapMode==='business'?businessCounts:flowCounts
 const edges:Edge[]=[...connectionCounts].filter(([key])=>!compactAreas||key.split('|').every(id=>shownIds.has(id))).map(([key,count])=>{
   const [source,target]=key.split('|')
   const related=(selectedSystem&&(source===selectedSystem||target===selectedSystem))||(mapMode==='flows'?openFlowPair===key:businessPair===key)
   const outsideArea=displayAreas.length>0&&(!areaLabels.has(source)||!areaLabels.has(target))
   const muted=outsideArea||Boolean(selectedSystem&&!related)
   const color=mapMode==='business'?'#79738c':'#69707e'
   const clickableProcess=mapMode==='business'&&!!onOpenProcess
   return {id:mapMode+':'+key,source,target,type:mapMode==='flows'||clickableProcess?'overviewFlow':'smoothstep',label:mapMode==='business'&&!outsideArea&&!clickableProcess?count+' БП':undefined,
     data:clickableProcess?{flows:[],label:count+' БП · '+(systemNames.get(source)||source)+' ↔ '+(systemNames.get(target)||target),processes:pairProcesses.get(key),hideControl:outsideArea,selected:businessPair===key,open:processMenu===key,toggle:()=>selectBusinessPair(key),close:()=>setProcessMenu(''),openProcess:(id:string)=>{setProcessMenu('');onOpenProcess?.(id)}}:{flows:groupedFlows.get(key)||[],open:openFlowPair===key,toggle:()=>setOpenFlowPair(old=>old===key?'':key),close:()=>setOpenFlowPair('')},
     ...(mapMode==='flows'?{markerEnd:{type:MarkerType.ArrowClosed,width:13,height:13,color}}:{}),
     style:{stroke:related?'var(--hub-accent)':color,strokeWidth:related?2.5:1.4,strokeDasharray:mapMode==='business'?'5 5':undefined,opacity:muted?0.18:1}}
 })
 const logicalEdges:Edge[]=logicalMode?logical.relations.filter(r=>visibleIds.has(r.source_id)&&visibleIds.has(r.target_id)).map(r=>({
   id:r.id,source:r.source_id,target:r.target_id,type:'smoothstep',
   label:({data_flow:'Заявленный обмен (устар.)',integrates_with:'Интеграция',depends_on:'Зависит от'} as Record<string,string>)[r.kind]||r.kind,
   style:{stroke:'#69707e',strokeWidth:1.4}
 })):[]
 const environments=[...new Set(components.map(c=>String(c.details.environment||'').toLowerCase()).filter(Boolean))].sort()
 return <section className="homeMap" aria-label="Главная карта архитектуры">
  <div className="overviewToolbar">
 <div className="homeMapTools"><input aria-label="Поиск на карте" value={query} onChange={e=>setQuery(e.target.value)} placeholder="Найти систему или ВМ…"/><Disclosure label="Фильтры и слои"><select aria-label="Контур карты" value={environment} onChange={e=>setEnvironment(e.target.value)}><option value="all">Все контуры</option>{environments.map(e=><option key={e} value={e}>{e}</option>)}</select><select aria-label="Фокус на ИС" value={focus} onChange={e=>{setFocus(e.target.value);if(!e.target.value){setSelectedSystem('');onCloseSystem()}}}><option value="">Все системы</option>{systems.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select>
  {!sequence&&<details className="homeMapLayersDisclosure"><summary>Слои карты <span aria-hidden="true">▾</span></summary><div className="homeMapLayers" aria-label="Слои карты">{([['systems','Информационные системы']] as const).map(([key,label])=><label key={key}><input type="checkbox" checked={layers[key]} onChange={e=>setLayers(old=>({...old,[key]:e.target.checked}))}/>{label}</label>)}</div></details>}</Disclosure></div>
  <div className="homeMapMode" role="group" aria-label="Тип связей на архитектурной карте">
    {([['business','Бизнес-связи'],['flows','Потоки данных'],['logical','Логические связи']] as const).map(([id,label])=><button key={id} type="button" aria-pressed={mapMode===id} className={mapMode===id?'current':''} disabled={editingLayers||editingSystems} onClick={()=>onModeChange(id)}>{label}</button>)}
   </div>
  {mapMode==='flows'&&<div className="homeMapMode" role="group" aria-label="Представление потоков данных">
    {([['map','Карта'],['sequence','Последовательность']] as const).map(([id,label])=><button key={id} type="button" disabled={editingLayers} aria-pressed={flowPresentation===id} className={flowPresentation===id?'current':''} onClick={()=>onModeChange(id==='map'?'flows':'sequence')}>{label}</button>)}
  </div>}
  </div>
  {logicalMode&&<div className="overviewToolbar" role="group" aria-label="Раскладка логических связей">{logical.controls}
    {Object.keys(logical.positions).length>0&&<label><input type="checkbox" disabled={editingSystems} checked={manualLayout} onChange={event=>setManualLayout(event.target.checked)}/> Ручная раскладка</label>}
    {canEditLayers&&<button type="button" aria-pressed={editingSystems} onClick={logical.toggleEdit}>{editingSystems?'Завершить редактирование':'Редактировать схему'}</button>}
  </div>}
  {!logicalMode&&!sequence&&<div className="homeLayerToolbar" role="group" aria-label="Бизнес-области">
 <div className="overviewAreaChips">{overlayGroups.length>0&&<strong>Бизнес-области</strong>}{overlayGroups.map(group=>
   <button key={group.id} type="button" disabled={editingLayers} aria-pressed={selectedAreaIds.includes(group.id)} onClick={()=>toggleArea(group.id)}>
     <i className="areaColorKey" aria-hidden="true" style={{backgroundColor:groupColor(group)}}/>{group.name}
   </button>)}</div>
 {selectedAreas.length>0&&!editingLayers&&<label><input type="checkbox" checked={membersOnly} onChange={event=>setMembersOnly(event.target.checked)}/> Только участники</label>}
 {canEditLayers&&layerApiReady&&!editingLayers&&overlayGroups.length>0&&<button type="button" aria-label="Изменить состав бизнес-областей" onClick={()=>{
   setEditingAreaId(selectedAreas[0]?.id||overlayGroups[0].id);setEditingLayers(true);setLayerError('')
 }}>Изменить состав</button>}
 {layerError&&!editingLayers&&<p role="alert">{layerError}</p>}
 <button type="button" className="overviewReset" onClick={()=>{
   setQuery('');setEnvironment('all');setFocus('');setSelectedSystem('');onCloseSystem()
   setOpenFlowPair('');setSelectedAreaIds([]);setMembersOnly(false)
   setLayers({systems:true,components:false,flows:false,business:false})
 }}>Сбросить фильтры</button>
 </div>}
 {!logicalMode&&!sequence&&!editingLayers&&selectedAreas.length>0&&!mapSystems.some(system=>areaLabels.has(system.id))&&<p role="status">Среди показанных систем нет участников выбранных областей.</p>}
  {!sequence&&!logicalMode&&!editingLayers&&onOpenProcess&&(selectedAreas.length>0||contextSystem)&&
    <section className="overviewProcessContext" aria-label="Связанные бизнес-процессы">
      <strong>{selectedAreas.length?'Процессы выбранных областей':'Процессы ИС'}{contextSystem?' · '+contextSystem.name:''}</strong>
      {contextProcesses.map(p=><button type="button" key={p.id} onClick={()=>onOpenProcess(p.id)}>{p.name}</button>)}
      {!contextProcesses.length&&<span>{contextSystem?'Для этой ИС связи с процессами не указаны.':'В области пока нет процессов.'}</span>}
    </section>}
  {query.trim()&&<div className="homeMapSearchMatches" role="region" aria-label="Результаты поиска по архитектуре">
    <strong>Найденные ИС: {filteredSystems.length}</strong>
    {!filteredSystems.length&&<span>Системы не найдены.</span>}
    {filteredSystems.slice(0,12).map(system=><div key={system.id} className="homeMapSearchMatch">
      <span>{system.name}</span>
      <button type="button" onClick={()=>{setSelectedSystem(system.id);onOpenSystem(system.id)}} aria-label={`Выбрать ИС из поиска: ${system.name}`}>Выбрать</button>
      <button type="button" onClick={()=>{setSelectedSystem(system.id);onOpenSystem(system.id)}} aria-label={`Открыть паспорт ИС из поиска: ${system.name}`}>Паспорт</button>
      <button type="button" onClick={()=>onOpenComponents(system.id)} aria-label={`Открыть компоненты ИС из поиска: ${system.name}`}>Компоненты</button>
    </div>)}
    {filteredSystems.length>12&&<small>Показаны первые 12 систем. Уточните запрос.</small>}
  </div>}
  {sequence&&<FlowSequence exchanges={exchanges} systems={systems} visible={visibleIds} processes={processes} request={request} canEdit={canEditFlows}/>}
  {!sequence&&layers.systems&&<div className={editingLayers?'homeLayerEditorStage editing':'homeLayerEditorStage'}>

   {editingLayers&&<div className="homeLayerTools" role="toolbar" aria-label="Инструменты слоёв">
     <button type="button" aria-label="Сохранить области" title="Сохранить изменённые области в базе" disabled={layerBusy||!Object.keys(layerDrafts).length} onClick={()=>void saveLayerChanges()}><Save size={19} strokeWidth={1.8}/><span>Сохранить</span></button>
     <button type="button" aria-label="Отменить изменения областей" title="Отменить черновик и выйти из редактора" disabled={layerBusy} onClick={cancelLayerChanges}><X size={19} strokeWidth={1.8}/><span>Отменить</span></button>
     <div className="homeLayerToolsDraft" aria-live="polite"><span>Черновик: {Object.keys(layerDrafts).length}</span></div>
   </div>}

  <div className="homeMapGraph" ref={graphRef}><ReactFlow minZoom={0.08} nodes={canvasNodes} edges={logicalMode?logicalEdges:edges} edgeTypes={homeEdgeTypes} nodesDraggable={editingSystems}
   onNodesChange={(changes:NodeChange[])=>{
    if(!editingSystems)return
    let baseline=manualLayout?undefined:gridPositions
    for(const change of changes){
      if(change.type!=='position'||!change.position||!shownIds.has(change.id))continue
      logical.move(change.id,change.position,baseline)
      baseline=undefined
      setManualLayout(true)
    }
   }} fitView fitViewOptions={{padding:0.15,minZoom:0.3,maxZoom:1}} nodesConnectable={editingSystems} onConnect={logical.onConnect} deleteKeyCode={null} onEdgeClick={(_,edge)=>{if(mapMode==='business')selectBusinessPair(edge.source+'|'+edge.target)}} onNodeClick={(_,node)=>{if(node.id.startsWith('component:')){onOpenComponent(node.id.slice('component:'.length));return}setSelectedSystem(node.id);onOpenSystem(node.id)}} onPaneClick={()=>{setBusinessPair('');setProcessMenu('');setSelectedSystem('');onCloseSystem()}}><AutoFit trackNodeBounds layoutKey={fitRequest+mapMode+(manualLayout?'-manual':'-grid')+(inspectorOpen?'-open':'-closed')} ignoreNodePrefixes="overlay:,component:" focusIds={compactAreas?[...shownIds]:selectedSystemInfo?(mapMode==='business'?[...selectedNeighbors]:[selectedSystemInfo.id]):mapSystems.map(s=>s.id)} suspended={editingLayers||editingSystems}/><Background gap={20}/><Controls showInteractive={false} onFitView={()=>setFitRequest(n=>n+1)} fitViewOptions={{padding:0.2,maxZoom:1}}/>
   </ReactFlow></div>

   {editingLayers&&<aside className="homeLayerDock" role="complementary" aria-label="Свойства архитектурной области">
     <header><strong>Состав бизнес-области</strong></header>
     {layerError&&<p role="alert" className="homeLayerError">{layerError}</p>}
     {layerConflict&&<button type="button" className="homeLayerRefresh" disabled={layerBusy} onClick={()=>void reloadLayerRegions()}>Обновить области и отбросить мой черновик</button>}
     <label className="homeLayerGroupSelect">Область
       <select aria-label="Выбрать архитектурную область" disabled={layerBusy} value={editingAreaId} onChange={event=>setEditingAreaId(event.target.value)}>
         <optgroup label="Бизнес-категории">{overlayGroups.filter(group=>group.type==='business').map(group=><option key={group.id} value={group.id}>{group.name}</option>)}</optgroup>
       </select>
     </label>
     {editingArea&&<section className="homeLayerMemberEditor" aria-label="Состав области">
       <label>Цвет метки<input aria-label="Цвет выбранной области" type="color" disabled={layerBusy} value={groupColor(editingArea)} onChange={event=>changeArea(editingArea,{color:event.target.value})}/></label>
       <p>Отметьте системы, на карточках которых нужна метка этой области.</p>
       <div className="homeLayerMemberGrid">{eligibleSystems.map(system=><label key={system.id}>
         <input type="checkbox" disabled={layerBusy} checked={membersFor(editingArea).includes(system.id)} onChange={event=>{
           const members=membersFor(editingArea).filter(id=>id!==system.id)
           if(event.target.checked)members.push(system.id)
           changeArea(editingArea,{members})
         }}/>{system.name}</label>)}</div>
     </section>}
   </aside>}

   </div>}
  {!sequence&&!layers.systems&&<div className="homeMapEmpty">Включите слой «Информационные системы», чтобы показать карту связей.</div>}
  {!sequence&&<details className="overviewLegend"><summary>О карте · {systems.length} ИС · {flowCountLabel(flows.length)}</summary>
    <p>{logicalMode?'Связи, зарегистрированные между информационными системами.':mapMode==='business'?'Пунктир показывает участие систем в общих бизнес-процессах, а не направление передачи данных.':'Стрелка показывает направление передачи данных. Нажмите на число потоков, чтобы выбрать поток.'}</p>
  </details>}
  <div className="homeMapDetails">
   

   {layers.components&&<article><h3>Компоненты</h3><div className="homeMapComponentList">{components.filter(c=>visibleIds.has(c.system_id)).slice(0,60).map(c=><button key={c.id} onClick={()=>onOpenComponent(c.id)}><span aria-hidden="true">{architectureIcon(c.kind)}</span> {c.name} <small>{c.kind}</small></button>)}</div></article>}
   
   {mapMode==='flows'&&selectedSystemInfo&&<button onClick={onOpenFlows}>Открыть реестр потоков</button>}
  </div>
 </section>
}
