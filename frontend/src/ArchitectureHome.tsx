import React, {useEffect,useMemo,useRef,useState} from 'react'
import {architectureIcon,DiagramNodeLabel,diagramCardStyle} from './DiagramVisual'
import {OverviewFlowEdge, type OverviewFlow} from './OverviewFlowEdge'
import type {OverviewMode} from './workspaceRoutes'
import {FlowSequence} from './FlowSequence'
import {interSystemExchanges, overviewExchangeLabel} from './systemExchanges'
import {focusedSystemIds,focusedSystemPositions} from './overviewFocus'
import type {Connection, Edge} from '@xyflow/react'
import {logoFromAttributes} from './SystemLogo'
export {architectureIcon} from './DiagramVisual'
import {ReactFlow,Background,Controls,MarkerType,Position,NodeResizer,useReactFlow,type NodeProps,type NodeChange} from '@xyflow/react'
import {MousePointer2, Move, SquareDashed, Maximize2, Save, X, ClipboardList} from 'lucide-react'

type System={id:string;name:string;kind:string;attributes?:Record<string,unknown>}
type Component={id:string;system_id:string;name:string;kind:string;details:Record<string,unknown>}
type Flow=OverviewFlow & {source_id:string;target_id:string}
type Process={id:string;name:string;category_id?:string}
type Category={id:string;name:string}
type OverlayGroup={id:string;name:string;type:'business';members:Set<string>}
type LayerRegion={group_key:string;revision:number;x:number;y:number;width:number;height:number;color:string;opacity:number;members:string[]}
type LayerDraft=Omit<LayerRegion,'group_key'|'revision'>
type LayerRegionNodeData={name:string;count:number;editing:boolean;resize:(bounds:{x:number;y:number;width:number;height:number})=>void}
function LayerRegionNode({data,selected}:NodeProps){
 const region=data as unknown as LayerRegionNodeData
 return <div className="homeEditableRegion"><NodeResizer isVisible={region.editing&&selected} minWidth={140} minHeight={80} onResize={(_,bounds)=>region.resize(bounds)} onResizeEnd={(_,bounds)=>region.resize(bounds)}/><div className="homeLayerRegionLabel"><strong>{region.name}</strong><small>{region.count} ИС</small></div></div>
}
// Supply initial handle geometry as well as dimensions while React Flow measures cards.
const systemHandles = [
 {type:'source' as const, position:Position.Right, x:245, y:43, width:1, height:1},
 {type:'target' as const, position:Position.Left, x:0, y:43, width:1, height:1},
]
const homeEdgeTypes={overviewFlow:OverviewFlowEdge}
const homeNodeTypes={layerRegion:LayerRegionNode}
type RegionRect={x:number;y:number;width:number;height:number}
type LayerTool='select'|'move'|'draw'

/** Exactly the same React Flow coordinate space as the IS and VM nodes. */
function LayerRectangleDraw({enabled,onDraw}:{enabled:boolean;onDraw:(rect:RegionRect)=>void}){
 const {screenToFlowPosition}=useReactFlow()
 const start=useRef<{x:number;y:number}|null>(null)
 const [preview,setPreview]=useState<RegionRect|null>(null)
 useEffect(()=>{if(!enabled){start.current=null;setPreview(null)}},[enabled])
 if(!enabled)return null
 const screenRect=(left:number,top:number,right:number,bottom:number):RegionRect=>({
   x:Math.min(left,right),y:Math.min(top,bottom),
   width:Math.abs(right-left),height:Math.abs(bottom-top)
 })
 return <div className="homeLayerDrawSurface" role="region" aria-label="Поле рисования архитектурной области"
  onPointerDown={event=>{
   if(event.button!==0)return
   event.preventDefault()
   start.current={x:event.clientX,y:event.clientY}
   event.currentTarget.setPointerCapture(event.pointerId)
   setPreview({x:event.nativeEvent.offsetX,y:event.nativeEvent.offsetY,width:0,height:0})
  }}
  onPointerMove={event=>{
   if(!start.current)return
   const bounds=event.currentTarget.getBoundingClientRect()
   setPreview(screenRect(start.current.x-bounds.left,start.current.y-bounds.top,event.clientX-bounds.left,event.clientY-bounds.top))
  }}
  onPointerUp={event=>{
   const initial=start.current
   if(!initial)return
   start.current=null
   if(event.currentTarget.hasPointerCapture(event.pointerId))event.currentTarget.releasePointerCapture(event.pointerId)
   setPreview(null)
   const a=screenToFlowPosition(initial)
   const b=screenToFlowPosition({x:event.clientX,y:event.clientY})
   const small=Math.hypot(event.clientX-initial.x,event.clientY-initial.y)<8
   const x=small?a.x:Math.min(a.x,b.x),y=small?a.y:Math.min(a.y,b.y)
   const width=small?440:Math.max(140,Math.abs(b.x-a.x))
   const height=small?260:Math.max(80,Math.abs(b.y-a.y))
   onDraw({x:Math.round(x),y:Math.round(y),width:Math.round(width),height:Math.round(height)})
  }}
  onPointerCancel={()=>{start.current=null;setPreview(null)}}>
  {preview&&<div className="homeLayerDrawPreview" style={preview}/>}
 </div>
}

function LayerFitController({trigger,systemIds}:{trigger:number;systemIds:string[]}){
 const {fitView}=useReactFlow()
 useEffect(()=>{
   if(!trigger||!systemIds.length)return
   void fitView({nodes:systemIds.map(id=>({id})),padding:0.2,maxZoom:1,duration:220})
 // eslint-disable-next-line react-hooks/exhaustive-deps
 },[trigger])
 return null
}
type Link={process_id:string;system_id:string}
type Network={id:string;name:string;kind:string}
type Interface={item_id:string;zone_id:string|null;vlan_id:string|null;vrf_id:string|null}

import {AutoFit,Disclosure} from './WorkspaceUI'
import {overviewGridPositions,flowCountLabel} from './graphLayout'

type LogicalMap = {
 relations: {id:string; source_id:string; target_id:string; kind:string}[]
 positions: Record<string,{x:number;y:number}>
 controls: React.ReactNode
 editing: boolean
 toggleEdit: ()=>void
 move: (id:string, point:{x:number;y:number})=>void
 onConnect: (connection:Connection)=>void
}
export default function ArchitectureHome({mode,onModeChange,logical,systems,components,flows,processes,categories,links,onOpenSystem,onCloseSystem,inspectorOpen,onOpenComponents,onOpenComponent,onOpenFlows,focusSystemId='',request,canEditLayers=false}:{mode:OverviewMode;onModeChange:(mode:OverviewMode)=>void;logical:LogicalMap;systems:System[];components:Component[];flows:Flow[];processes:Process[];categories:Category[];links:Link[];networks:Network[];interfaces:Interface[];onOpenSystem:(id:string)=>void;onCloseSystem:()=>void;inspectorOpen:boolean;onOpenComponents:(id:string)=>void;onOpenComponent:(id:string)=>void;onOpenFlows:()=>void;onOpenNetworks:()=>void;focusSystemId?:string;request?:<T>(url:string,init?:RequestInit)=>Promise<T>;canEditLayers?:boolean}){
 const [layers,setLayers]=useState({systems:true,components:false,flows:false,business:false})
 const sequence=mode==='sequence'
 const mapMode=sequence?'flows':mode
 const flowPresentation=sequence?'sequence':'map'
 const logicalMode=mapMode==='logical'
 const editingSystems=logicalMode&&logical.editing&&canEditLayers
 const [activeOverlays,setActiveOverlays]=useState({business:false})
 const [selectedOverlayGroup,setSelectedOverlayGroup]=useState('')
 // The user can enable the layer before the async category/link collections arrive.
 // Queue one initial selection, but never override an explicit "clear selection".
 const pendingInitialOverlaySelection=useRef(false)
 const [savedRegions,setSavedRegions]=useState<Record<string,LayerRegion>>({})
 const [layerDrafts,setLayerDrafts]=useState<Record<string,LayerDraft>>({})
 const [editingLayers,setEditingLayers]=useState(false)
 const [layerTool,setLayerTool]=useState<LayerTool>('select')
 const [fitTrigger,setFitTrigger]=useState(0)
 useEffect(()=>{
   if(!editingLayers)return
   const onKey=(event:KeyboardEvent)=>{
     if(event.key==='Escape'&&layerTool!=='select'){setLayerTool('select');event.preventDefault()}
   }
   window.addEventListener('keydown',onKey)
   return()=>window.removeEventListener('keydown',onKey)
 },[editingLayers,layerTool])
 const [layerBusy,setLayerBusy]=useState(false)
 const [layerError,setLayerError]=useState('')
 const [layerConflict,setLayerConflict]=useState(false)
 const [layerApiReady,setLayerApiReady]=useState(false)
 useEffect(()=>{
  if(!request){setSavedRegions({});setLayerDrafts({});setEditingLayers(false);setLayerTool('select');setLayerApiReady(false);return}
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
 const cancelLayerChanges=()=>{setLayerDrafts({});setEditingLayers(false);setLayerTool('select');setLayerError('');setLayerConflict(false)}
 const reloadLayerRegions=async()=>{
  if(!request)return
  setLayerBusy(true)
  try{
   const rows=await request<LayerRegion[]>('/api/diagrams/layer-regions')
   setSavedRegions(Object.fromEntries(rows.map(row=>[row.group_key,row])))
   setLayerDrafts({})
   setEditingLayers(false);setLayerTool('select');setLayerError('');setLayerConflict(false)
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
    ...payload,group_key:key,expected_revision:savedRegions[key]?.revision??null
   }))
   const updated=await request<LayerRegion[]>('/api/diagrams/layer-regions',{
    method:'PUT',body:JSON.stringify({regions})
   })
   setSavedRegions(old=>({...old,...Object.fromEntries(updated.map(row=>[row.group_key,row]))}))
   setLayerDrafts({});setEditingLayers(false);setLayerTool('select')
  }catch(err){
   const message=(err as Error).message
   setLayerError(message)
   setLayerConflict(/409|изменен|изменёна|изменена|конкурентн/i.test(message))
  }finally{setLayerBusy(false)}
 }
 const overlayOpacity=22
 const [hiddenOverlayGroups,setHiddenOverlayGroups]=useState<string[]>([])
 const [overlayColors]=useState<Record<string,string>>(()=>{
  try{const value=JSON.parse(localStorage.getItem('architecture-hub-layer-colors-v1')||'{}');return value&&typeof value==='object'&&!Array.isArray(value)?value:{}}catch{return {}}
 })
 
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
 const baseFilteredSystems=systems.filter(s=>(!query||s.name.toLowerCase().includes(query.toLowerCase())||components.some(c=>c.system_id===s.id&&c.name.toLowerCase().includes(query.toLowerCase())))&&(environment==='all'||components.some(c=>c.system_id===s.id&&String(c.details.environment||'').toLowerCase()===environment)))
 const knownSystemIds=new Set(systems.map(s=>s.id))
 // A selected system anchors the one-hop view; other connected systems remain visible.
 const focusedSystemId=knownSystemIds.has(focus||selectedSystem)?focus||selectedSystem:''
 const baseIds=new Set(baseFilteredSystems.map(s=>s.id))
 const exchanges=interSystemExchanges(flows,components,knownSystemIds).map(row=>({
   ...row,flow:{...row.flow,name:overviewExchangeLabel(row.flow,components)}
 }))
 const processesById=new Map<string,Set<string>>()
 for(const link of links)if(knownSystemIds.has(link.system_id)){
   const members=processesById.get(link.process_id)||new Set<string>()
   members.add(link.system_id);processesById.set(link.process_id,members)
 }
 const allBusinessCounts=new Map<string,number>()
 for(const members of processesById.values()){
   const ids=[...members].sort()
   for(let i=0;i<ids.length;i++)for(let j=i+1;j<ids.length;j++){
     const key=ids[i]+'|'+ids[j]
     allBusinessCounts.set(key,(allBusinessCounts.get(key)||0)+1)
   }
 }
 const relations=mapMode==='flows'
   ?exchanges.map(row=>({source:row.source,target:row.target}))
   :mapMode==='business'
     ?[...allBusinessCounts.keys()].map(key=>{const [source,target]=key.split('|');return {source,target}})
     :logical.relations.map(row=>({source:row.source_id,target:row.target_id}))
 const focusedIds=focusedSystemId?focusedSystemIds(focusedSystemId,relations):new Set<string>()
 const visibleIds=focusedSystemId?focusedIds:baseIds
 const filteredSystems=focusedSystemId?systems.filter(s=>focusedIds.has(s.id)):baseFilteredSystems
 const crossFlows=exchanges.filter(row=>focusedSystemId
   ?row.source===focusedSystemId||row.target===focusedSystemId
   :baseIds.has(row.source)||baseIds.has(row.target))
 const neighborIds=new Set(crossFlows.flatMap(row=>[row.source,row.target]))
 const mapSystems=focusedSystemId?filteredSystems:mapMode==='flows'
   ?systems.filter(s=>visibleIds.has(s.id)||neighborIds.has(s.id)):filteredSystems
 const groupedFlows=new Map<string,Flow[]>()
 for(const {source,target,flow} of crossFlows){
   const key=source+'|'+target
   const group=groupedFlows.get(key)
   if(group)group.push(flow)
   else groupedFlows.set(key,[flow])
 }
 const flowCounts=new Map(Array.from(groupedFlows,([key,group])=>[key,group.length]))
 const businessCounts=new Map([...allBusinessCounts].filter(([key])=>{
   const [source,target]=key.split('|')
   return focusedSystemId?(source===focusedSystemId||target===focusedSystemId):
     visibleIds.has(source)&&visibleIds.has(target)
 }))
 // A three-column overview avoids microscopic nodes in long dependency chains.
 // The coordinate space is defined by the full architecture, never by
 // active overlays or search filters. Node coordinates cannot jump on layer changes.
 const componentRows=Math.max(1,...systems.map(sys=>Math.ceil(components.filter(c=>c.system_id===sys.id).length/2)))
 const systemRowGap=Math.max(330,120+componentRows*43)
 const basePositions=overviewGridPositions(systems.map(s=>s.id))
 const positions=Object.fromEntries(systems.map((sys,index)=>{
   const original=basePositions[sys.id]||{x:(index%3)*320,y:Math.floor(index/3)*190}
   return [sys.id,(logicalMode&&logical.positions[sys.id])||{x:original.x/310*410,y:original.y/170*systemRowGap}]
 }))
 const focusPositions=focusedSystemId?focusedSystemPositions(focusedSystemId,relations,mapSystems.map(s=>s.id)):{}
 const overlayGroups:OverlayGroup[]=[]
 for(const cat of categories){
   const ids=new Set(processes.filter(p=>p.category_id===cat.id).map(p=>p.id))
   const members=new Set(links.filter(l=>ids.has(l.process_id)&&visibleIds.has(l.system_id)).map(l=>l.system_id))
   overlayGroups.push({id:'business:'+cat.id,name:cat.name,type:'business',members})
 }
 // Processes without a known category retain their own visual group.
 for(const process of processes.filter(p=>!p.category_id||!categories.some(c=>c.id===p.category_id))){
   const members=new Set(links.filter(l=>l.process_id===process.id&&visibleIds.has(l.system_id)).map(l=>l.system_id))
   if(members.size||savedRegions['business:process:'+process.id])overlayGroups.push({id:'business:process:'+process.id,name:process.name,type:'business',members})
 }
 const palette=['#a78bfa','#f59e0b','#10b981','#60a5fa','#f472b6','#22d3ee','#f97316','#84cc16']
 const groupColor=(group:OverlayGroup)=>layerDrafts[group.id]?.color||savedRegions[group.id]?.color||overlayColors[group.id]||palette[Math.max(0,overlayGroups.findIndex(item=>item.id===group.id))%palette.length]
 const membersFor=(group:OverlayGroup)=>layerDrafts[group.id]?.members||savedRegions[group.id]?.members||[...group.members]
 const firstAvailableOverlayGroup=overlayGroups.find(group=>membersFor(group).length>0)?.id||''
 useEffect(()=>{
  if(!activeOverlays.business||!pendingInitialOverlaySelection.current||!firstAvailableOverlayGroup)return
  pendingInitialOverlaySelection.current=false
  setSelectedOverlayGroup(current=>current||firstAvailableOverlayGroup)
 },[activeOverlays.business,firstAvailableOverlayGroup])
 const defaultDraftFor=(group:OverlayGroup):LayerDraft=>{
  const memberIds=membersFor(group)
  const points=memberIds.map(id=>positions[id]).filter(Boolean)
  return {x:points.length?Math.min(...points.map(p=>p.x))-26:20,
    y:points.length?Math.min(...points.map(p=>p.y))-42:20,
    width:points.length?Math.max(...points.map(p=>p.x))-Math.min(...points.map(p=>p.x))+330:340,
    height:points.length?Math.max(...points.map(p=>p.y))-Math.min(...points.map(p=>p.y))+Math.max(110,100+componentRows*43)+42:190,
    color:groupColor(group),opacity:overlayOpacity/100,members:memberIds}
 }
 const areaNodes=overlayGroups.filter(group=>activeOverlays[group.type]&&(!selectedOverlayGroup||selectedOverlayGroup===group.id)&&!hiddenOverlayGroups.includes(group.id)&&(membersFor(group).length>0||Boolean(savedRegions[group.id]||layerDrafts[group.id]))).map(group=>{
   const initial=defaultDraftFor(group)
   const memberIds=initial.members
   const area=layerDrafts[group.id]||savedRegions[group.id]||initial
   const color=groupColor(group)
   return {id:'overlay:'+group.id,type:'layerRegion',position:{x:area.x,y:area.y},width:area.width,height:area.height,
     data:{name:group.name,count:memberIds.length,editing:editingLayers&&canEditLayers&&layerTool==='move',resize:(value:{x:number;y:number;width:number;height:number})=>updateDraft(group.id,value,initial)},
     draggable:editingLayers&&canEditLayers&&layerTool==='move',selectable:editingLayers&&canEditLayers&&layerTool!=='draw',selected:editingLayers&&selectedOverlayGroup===group.id,connectable:false,zIndex:editingLayers?0:-10,
     style:{width:area.width,height:area.height,backgroundColor:color+Math.round((area.opacity??overlayOpacity/100)*255).toString(16).padStart(2,'0'),border:'2px solid '+color,borderRadius:16,pointerEvents:editingLayers?'auto' as const:'none' as const,boxShadow:'none'}}
 })
 const drawRegion=(rect:RegionRect)=>{
   if(!editingLayers||!canEditLayers)return
   const group=overlayGroups.find(item=>item.id===selectedOverlayGroup)
   if(!group)return
   const base=layerDrafts[group.id]||savedRegions[group.id]||defaultDraftFor(group)
   updateDraft(group.id,rect,base)
   setActiveOverlays(current=>({...current,[group.type]:true}))
   setHiddenOverlayGroups(current=>current.filter(id=>id!==group.id))
   setLayerTool('move')
 }
 const selectedRegion=overlayGroups.find(group=>group.id===selectedOverlayGroup)
 const regionDraft=selectedRegion?(layerDrafts[selectedRegion.id]||savedRegions[selectedRegion.id]||defaultDraftFor(selectedRegion)):null
 const updateRegionField=(field:'x'|'y'|'width'|'height',raw:number)=>{
   if(!selectedRegion||!regionDraft||!Number.isFinite(raw))return
   const value=(field==='width'?Math.max(140,raw):field==='height'?Math.max(80,raw):raw)
   updateDraft(selectedRegion.id,{[field]:value},regionDraft)
 }

 const componentNodes=layers.components?components.filter(c=>visibleIds.has(c.system_id)).flatMap(c=>{
   const group=components.filter(item=>item.system_id===c.system_id)
   const index=group.findIndex(item=>item.id===c.id)
   const parent=positions[c.system_id]
   return parent?[{id:'component:'+c.id,position:{x:parent.x+(index%2)*144,y:parent.y+100+Math.floor(index/2)*43},
     data:{label:<span title={c.name}>{architectureIcon(c.kind)} {c.name}</span>},style:{width:136,fontSize:11,padding:'7px',borderRadius:6,border:'1px solid #cbd5e1',background:'#fff',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap' as const},selectable:true,draggable:false,zIndex:20}]:[]
 }):[]

 const nodes=mapSystems.map((s,i)=>({id:s.id,draggable:editingSystems,initialWidth:245,initialHeight:86,handles:systemHandles,sourcePosition:Position.Right,targetPosition:Position.Left,position:focusPositions[s.id]||positions[s.id]||{x:(i%4)*320,y:Math.floor(i/4)*190},data:{label:<DiagramNodeLabel name={s.name} kind={s.kind} logo={logoFromAttributes(s.attributes)} subtitle={mapMode==='flows'?undefined:components.filter(c=>c.system_id===s.id).length+' компонентов · '+links.filter(l=>l.system_id===s.id).length+' бизнес-связей'}/>},style:diagramCardStyle()}))
 const selectedSystemInfo=mapSystems.find(s=>s.id===focusedSystemId)
 const selectedNeighbors=new Set<string>([focusedSystemId])
 for(const f of crossFlows)if(f.source===focusedSystemId||f.target===focusedSystemId){selectedNeighbors.add(f.source);selectedNeighbors.add(f.target)}
 const selectedComponents=components.filter(c=>c.system_id===focusedSystemId)
 const selectedFlowCount=crossFlows.filter(f=>f.source===focusedSystemId||f.target===focusedSystemId).length
 const focusedLayer=overlayGroups.find(group=>group.id===selectedOverlayGroup)
 const highlightedNodes=nodes.map(n=>({...n,zIndex:10,style:{...n.style,border:focusedSystemId===n.id?'2px solid var(--hub-accent)':n.style.border,opacity:!logicalMode&&focusedLayer&&!membersFor(focusedLayer).includes(n.id)?0.2:focusedSystemId&&!selectedNeighbors.has(n.id)?0.28:1}}))
 const canvasNodes=[...(logicalMode?[]:areaNodes),...highlightedNodes,...componentNodes]
 const connectionCounts=mapMode==='business'?businessCounts:flowCounts
 const edges:Edge[]=[...connectionCounts].map(([key,count])=>{
   const [source,target]=key.split('|')
   const related=(focusedSystemId&&(source===focusedSystemId||target===focusedSystemId))||(mapMode==='flows'&&openFlowPair===key)
   const color=mapMode==='business'?'#79738c':'#69707e'
   return {id:mapMode+':'+key,source,target,type:mapMode==='flows'?'overviewFlow':'smoothstep',label:mapMode==='business'?count+' БП':undefined,
     data:{flows:groupedFlows.get(key)||[],open:openFlowPair===key,toggle:()=>setOpenFlowPair(old=>old===key?'':key),close:()=>setOpenFlowPair('')},
     ...(mapMode==='flows'?{markerEnd:{type:MarkerType.ArrowClosed,width:13,height:13,color}}:{}),
     style:{stroke:related?'var(--hub-accent)':color,strokeWidth:related?2.5:1.4,strokeDasharray:mapMode==='business'?'5 5':undefined,opacity:focusedSystemId&&!related?0.18:1}}
 })
 const logicalEdges:Edge[]=logicalMode?logical.relations.filter(r=>focusedSystemId?(r.source_id===focusedSystemId||r.target_id===focusedSystemId):visibleIds.has(r.source_id)&&visibleIds.has(r.target_id)).map(r=>({
   id:r.id,source:r.source_id,target:r.target_id,type:'smoothstep',
   label:({data_flow:'Заявленный обмен (устар.)',integrates_with:'Интеграция',depends_on:'Зависит от'} as Record<string,string>)[r.kind]||r.kind,
   style:{stroke:'#69707e',strokeWidth:1.4}
 })):[]
 const environments=[...new Set(components.map(c=>String(c.details.environment||'').toLowerCase()).filter(Boolean))].sort()
 return <section className="homeMap" aria-label="Главная карта архитектуры">
  <div className="overviewToolbar">
 <div className="homeMapTools"><input aria-label="Поиск на карте" value={query} onChange={e=>setQuery(e.target.value)} placeholder="Найти систему или ВМ…"/><Disclosure label="Фильтры и слои"><select aria-label="Контур карты" value={environment} onChange={e=>setEnvironment(e.target.value)}><option value="all">Все контуры</option>{environments.map(e=><option key={e} value={e}>{e}</option>)}</select><select aria-label="Фокус на ИС" value={focus} onChange={e=>{setFocus(e.target.value);if(!e.target.value){setSelectedSystem('');onCloseSystem()}}}><option value="">Все системы</option>{systems.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select>
  {!sequence&&<details className="homeMapLayersDisclosure"><summary>Слои карты <span aria-hidden="true">▾</span></summary><div className="homeMapLayers" aria-label="Слои карты">{([['systems','Информационные системы'],['business','Бизнес-процессы']] as const).map(([key,label])=><label key={key}><input type="checkbox" checked={layers[key]} onChange={e=>setLayers(old=>({...old,[key]:e.target.checked}))}/>{label}</label>)}</div></details>}</Disclosure></div>
  <div className="homeMapMode" role="group" aria-label="Тип связей на архитектурной карте">
    {([['business','Бизнес-связи'],['flows','Потоки данных'],['logical','Логические связи']] as const).map(([id,label])=><button key={id} type="button" aria-pressed={mapMode===id} className={mapMode===id?'current':''} disabled={editingLayers||editingSystems} onClick={()=>onModeChange(id)}>{label}</button>)}
   </div>
  {mapMode==='flows'&&<div className="homeMapMode" role="group" aria-label="Представление потоков данных">
    {([['map','Карта'],['sequence','Последовательность']] as const).map(([id,label])=><button key={id} type="button" disabled={editingLayers} aria-pressed={flowPresentation===id} className={flowPresentation===id?'current':''} onClick={()=>onModeChange(id==='map'?'flows':'sequence')}>{label}</button>)}
  </div>}
  </div>
  {logicalMode&&<div className="overviewToolbar" role="group" aria-label="Раскладка логических связей">{logical.controls}
    {canEditLayers&&<button type="button" aria-pressed={editingSystems} onClick={logical.toggleEdit}>{editingSystems?'Завершить редактирование':'Редактировать схему'}</button>}
  </div>}
  {!logicalMode&&!sequence&&<div className="homeLayerToolbar" role="group" aria-label="Бизнес-области">
 <label><input type="checkbox" checked={activeOverlays.business} onChange={e=>{
   const checked=e.target.checked
   const target=checked?(selectedOverlayGroup||firstAvailableOverlayGroup):''
   pendingInitialOverlaySelection.current=checked&&!target
   setActiveOverlays({business:checked})
   setSelectedOverlayGroup(target)
 }}/> Показать бизнес-области</label>
 {activeOverlays.business&&canEditLayers&&layerApiReady&&!editingLayers&&<button type="button" onClick={()=>{setEditingLayers(true);setLayerTool('select');setLayerError('');setSelectedOverlayGroup(old=>old||overlayGroups[0]?.id||'')}}>Редактировать бизнес-области</button>}
 {layerError&&<p role="alert">{layerError}</p>}
 <div className="overviewAreaChips">{overlayGroups.map(group=>
   <button key={group.id} type="button" aria-pressed={activeOverlays.business&&selectedOverlayGroup===group.id} onClick={()=>{
     pendingInitialOverlaySelection.current=false
     setHiddenOverlayGroups(old=>old.filter(id=>id!==group.id))
     setSelectedOverlayGroup(group.id);setActiveOverlays({business:true})
   }}>{group.name}</button>)}</div>
 <details className="homeLayerCatalog"><summary>Видимость областей</summary><div className="homeLayerColorList">{overlayGroups.map(group=><label key={group.id}>
   <input type="checkbox" aria-label={'Показать область '+group.name} checked={!hiddenOverlayGroups.includes(group.id)} onChange={e=>setHiddenOverlayGroups(old=>e.target.checked?old.filter(id=>id!==group.id):[...old,group.id])}/>{group.name}
 </label>)}</div></details>
 <button type="button" className="overviewReset" onClick={()=>{
   pendingInitialOverlaySelection.current=false
   setQuery('');setEnvironment('all');setFocus('');setSelectedSystem('');onCloseSystem()
   setOpenFlowPair('');setActiveOverlays({business:false});setSelectedOverlayGroup('');setHiddenOverlayGroups([])
   setLayers({systems:true,components:false,flows:false,business:false})
 }}>Сбросить фильтры</button>
 </div>}
 {!logicalMode&&!sequence&&activeOverlays.business&&selectedOverlayGroup&&<span className="homeLayerHint" role="status">Показана бизнес-область: {overlayGroups.find(group=>group.id===selectedOverlayGroup)?.name}.</span>}
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
  {sequence&&<FlowSequence exchanges={exchanges} systems={systems} visible={visibleIds}/>}
  {!sequence&&layers.systems&&<div className={editingLayers?'homeLayerEditorStage editing':'homeLayerEditorStage'}>

   {editingLayers&&<div className="homeLayerTools" role="toolbar" aria-label="Инструменты слоёв">
     <button type="button" aria-label="Выбрать область" title="Выбор области и её свойств" data-tool="select" aria-pressed={layerTool==='select'} onClick={()=>setLayerTool('select')}><MousePointer2 size={19} strokeWidth={1.8}/><span>Выбрать</span></button>
     <button type="button" aria-label="Переместить область" title="Перемещение и изменение размера выбранной области" data-tool="move" aria-pressed={layerTool==='move'} onClick={()=>setLayerTool('move')}><Move size={19} strokeWidth={1.8}/><span>Переместить</span></button>
     <button type="button" aria-label="Нарисовать область" title="Выберите категорию справа, затем нарисуйте рамку на схеме" data-tool="draw" aria-pressed={layerTool==='draw'} disabled={!overlayGroups.length} onClick={()=>{
       if(!selectedOverlayGroup&&overlayGroups.length)setSelectedOverlayGroup(overlayGroups[0].id)
       setLayerTool('draw')
     }}><SquareDashed size={19} strokeWidth={1.8}/><span>Область</span></button>
     <div className="homeLayerToolsSeparator"/>
     <button type="button" aria-label="Вписать системы в экран" title="Вписать все системы, не меняя их положение" onClick={()=>setFitTrigger(value=>value+1)}><Maximize2 size={19} strokeWidth={1.8}/><span>Вписать</span></button>
     <button type="button" aria-label="Сохранить области" title="Сохранить изменённые области в базе" disabled={layerBusy||!Object.keys(layerDrafts).length} onClick={()=>void saveLayerChanges()}><Save size={19} strokeWidth={1.8}/><span>Сохранить</span></button>
     <button type="button" aria-label="Отменить изменения областей" title="Отменить черновик и выйти из редактора" disabled={layerBusy} onClick={cancelLayerChanges}><X size={19} strokeWidth={1.8}/><span>Отменить</span></button>
     <div className="homeLayerToolsDraft" aria-live="polite"><ClipboardList size={17}/><span>Черновик: {Object.keys(layerDrafts).length}</span></div>
   </div>}

  <div className="homeMapGraph"><ReactFlow minZoom={0.08} nodes={canvasNodes} edges={logicalMode?logicalEdges:edges} nodeTypes={homeNodeTypes} edgeTypes={homeEdgeTypes} nodesDraggable={editingSystems||(editingLayers&&canEditLayers&&layerTool==='move')}
   onNodesChange={(changes:NodeChange[])=>{
    if(editingSystems){for(const change of changes)if(change.type==='position'&&change.position&&visibleIds.has(change.id))logical.move(change.id,change.position);return}
    if(!editingLayers||!canEditLayers||layerTool!=='move')return
    for(const change of changes){
     if(change.type!=='position'||!change.position||!change.id.startsWith('overlay:'))continue
     const key=change.id.slice(8)
     const node=areaNodes.find(item=>item.id===change.id)
     const group=overlayGroups.find(item=>item.id===key)
     if(node&&group)updateDraft(key,change.position,{x:node.position.x,y:node.position.y,width:node.width,height:node.height,color:groupColor(group),opacity:(layerDrafts[key]||savedRegions[key])?.opacity??overlayOpacity/100,members:membersFor(group)})
    }
   }} onNodeDragStop={(_,node)=>{if(layerTool!=='move'||!node.id.startsWith('overlay:'))return;const key=node.id.slice(8);const region=areaNodes.find(item=>item.id===node.id);const group=overlayGroups.find(item=>item.id===key);if(region&&group)updateDraft(key,node.position,{x:region.position.x,y:region.position.y,width:region.width,height:region.height,color:groupColor(group),opacity:(layerDrafts[key]||savedRegions[key])?.opacity??overlayOpacity/100,members:membersFor(group)})}} fitView fitViewOptions={{padding:0.15,minZoom:0.3,maxZoom:1}} nodesConnectable={editingSystems} onConnect={logical.onConnect} deleteKeyCode={null} onNodeClick={(_,node)=>{if(node.id.startsWith('component:')){onOpenComponent(node.id.slice('component:'.length));return}if(node.id.startsWith('overlay:')){setSelectedOverlayGroup(node.id.slice(8));return}setSelectedSystem(node.id);onOpenSystem(node.id)}} onPaneClick={()=>{setSelectedSystem('');onCloseSystem()}}><AutoFit layoutKey={inspectorOpen?'inspector-open':'inspector-closed'} ignoreNodePrefixes="overlay:,component:" focusIds={selectedSystemInfo?[selectedSystemInfo.id]:mapSystems.map(s=>s.id)} suspended={editingLayers||editingSystems}/><Background gap={20}/><Controls showInteractive={false}/><LayerFitController trigger={fitTrigger} systemIds={filteredSystems.map(s=>s.id)}/>
   <LayerRectangleDraw enabled={editingLayers&&layerTool==='draw'&&Boolean(selectedOverlayGroup)} onDraw={drawRegion}/>
   </ReactFlow></div>

   {editingLayers&&<aside className="homeLayerDock" role="complementary" aria-label="Свойства архитектурной области">
     <header><strong>Свойства области</strong><span>{layerTool==='draw'?'Рисование':layerTool==='move'?'Перемещение':'Выбор'}</span></header>
     <p className="homeLayerToolInstructions">{layerTool==='draw'?'Выберите бизнес-категорию, затем протяните прямоугольник на холсте. Одно нажатие создаст рамку стандартного размера.':layerTool==='move'?'Перетаскивайте область. Чтобы изменить размер, выделите её и потяните за маркеры.':'Выберите область на схеме или в списке.'}</p>
     {layerError&&<p role="alert" className="homeLayerError">{layerError}</p>}
     {layerConflict&&<button type="button" className="homeLayerRefresh" disabled={layerBusy} onClick={()=>void reloadLayerRegions()}>Обновить области и отбросить мой черновик</button>}
     <label className="homeLayerGroupSelect">Область
       <select aria-label="Выбрать архитектурную область" value={selectedOverlayGroup} onChange={event=>{
         const id=event.target.value;setSelectedOverlayGroup(id)
         const item=overlayGroups.find(group=>group.id===id)
         if(item)setActiveOverlays(old=>({...old,[item.type]:true}))
       }}>
         <option value="">Выберите область</option>
         <optgroup label="Бизнес-категории">{overlayGroups.filter(group=>group.type==='business').map(group=><option key={group.id} value={group.id}>{group.name}</option>)}</optgroup>
       </select>
     </label>
     {selectedRegion&&regionDraft&&<div className="homeLayerProperties">
       <label>Цвет области<input aria-label="Цвет выбранной области" type="color" value={groupColor(selectedRegion)} onChange={event=>updateDraft(selectedRegion.id,{color:event.target.value},regionDraft)}/></label>
       <label>Прозрачность области
         <input aria-label="Прозрачность выбранной области" type="range" min="5" max="85" step="1" value={Math.round((regionDraft.opacity??0.22)*100)} onChange={event=>updateDraft(selectedRegion.id,{opacity:Number(event.target.value)/100},regionDraft)}/>
         <span>{Math.round((regionDraft.opacity??0.22)*100)}%</span>
       </label>
       <div className="homeLayerGeometry">
         {([['x','X'],['y','Y'],['width','Ширина'],['height','Высота']] as const).map(([key,label])=><label key={key}>{label}
           <input type="number" aria-label={label+' области'} value={Math.round(regionDraft[key])} step="10" min={key==='width'?140:key==='height'?80:-100000} max="100000" onChange={event=>updateRegionField(key,Number(event.target.value))}/>
         </label>)}
       </div>
       <p>Прямоугольник изменяет только визуальное представление; координаты систем и ВМ остаются неизменными.</p>
     </div>}
       {focusedLayer&&<section className="homeLayerMemberEditor" aria-label="Состав области">
   <h3>{focusedLayer.name} – состав области</h3>
   <p>Выбор влияет только на отображение области, а не на фактические бизнес-связи или сетевые интерфейсы.</p>
   <div className="homeLayerMemberGrid">{systems.map(system=><label key={system.id}><input type="checkbox" checked={membersFor(focusedLayer).includes(system.id)} onChange={e=>{
     const members=membersFor(focusedLayer).filter(id=>id!==system.id)
     if(e.target.checked)members.push(system.id)
     const region=areaNodes.find(node=>node.id==='overlay:'+focusedLayer.id)
     const base:LayerDraft=layerDrafts[focusedLayer.id]||savedRegions[focusedLayer.id]||{x:region?.position.x||20,y:region?.position.y||20,width:region?.width||340,height:region?.height||190,color:groupColor(focusedLayer),opacity:overlayOpacity/100,members:membersFor(focusedLayer)}
     updateDraft(focusedLayer.id,{members},base)
   }}/>{system.name}</label>)}</div>
  </section>}
   </aside>}

   </div>}
  {!sequence&&!layers.systems&&<div className="homeMapEmpty">Включите слой «Информационные системы», чтобы показать карту связей.</div>}
  {!sequence&&!logicalMode&&selectedOverlayGroup&&focusedLayer&&<div className="homeLayerMembers" role="status"><strong>{focusedLayer.name}</strong><span>В этой области: {membersFor(focusedLayer).map(id=>systems.find(sys=>sys.id===id)?.name||id).join(', ')}</span><button type="button" onClick={()=>setSelectedOverlayGroup('')}>Снять выделение</button></div>}

  {!sequence&&<details className="overviewLegend"><summary>О карте · {systems.length} ИС · {flowCountLabel(exchanges.length)} между системами</summary>
    <p>{logicalMode?'Связи, зарегистрированные между информационными системами.':mapMode==='business'?'Пунктир показывает участие систем в общих бизнес-процессах, а не направление передачи данных.':'Стрелка показывает направление передачи данных. Нажмите на число потоков, чтобы выбрать поток.'}</p>
  </details>}
  <div className="homeMapDetails">
   
   {(layers.business||mapMode==='business')&&<article><h3>Бизнес-процессы</h3><p>{processes.length} процессов · {links.length} связей с ИС</p><div>{processes.slice(0,12).map(p=><span className="homeMapChip" key={p.id}>{p.name}</span>)}</div></article>}
   {layers.components&&<article><h3>Компоненты</h3><div className="homeMapComponentList">{components.filter(c=>visibleIds.has(c.system_id)).slice(0,60).map(c=><button key={c.id} onClick={()=>onOpenComponent(c.id)}><span aria-hidden="true">{architectureIcon(c.kind)}</span> {c.name} <small>{c.kind}</small></button>)}</div></article>}
   
   {mapMode==='flows'&&selectedSystemInfo&&<button onClick={onOpenFlows}>Открыть реестр потоков</button>}
  </div>
 </section>
}
