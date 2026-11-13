import React, {useEffect,useMemo,useRef,useState} from 'react'
import {architectureIcon,DiagramNodeLabel,diagramCardStyle} from './DiagramVisual'
export {architectureIcon} from './DiagramVisual'
import {ReactFlow,Background,Controls,MarkerType,NodeResizer,useReactFlow,type NodeProps,type NodeChange} from '@xyflow/react'
import {MousePointer2, Move, SquareDashed, Maximize2, Save, X, ClipboardList} from 'lucide-react'

type System={id:string;name:string;kind:string}
type Component={id:string;system_id:string;name:string;kind:string;details:Record<string,unknown>}
type Flow={id:string;source_id:string;target_id:string}
type Process={id:string;name:string;category_id?:string}
type Category={id:string;name:string}
type OverlayGroup={id:string;name:string;type:'business'|'network';members:Set<string>}
type LayerRegion={group_key:string;x:number;y:number;width:number;height:number;color:string;members:string[]}
type LayerDraft=Omit<LayerRegion,'group_key'>
type LayerRegionNodeData={name:string;count:number;editing:boolean;resize:(bounds:{x:number;y:number;width:number;height:number})=>void}
function LayerRegionNode({data,selected}:NodeProps){
 const region=data as unknown as LayerRegionNodeData
 return <div className="homeEditableRegion"><NodeResizer isVisible={region.editing&&selected} minWidth={140} minHeight={80} onResize={(_,bounds)=>region.resize(bounds)} onResizeEnd={(_,bounds)=>region.resize(bounds)}/><div className="homeLayerRegionLabel"><strong>{region.name}</strong><small>{region.count} ИС</small></div></div>
}
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
import {overviewGridPositions} from './graphLayout'

export default function ArchitectureHome({systems,components,flows,processes,categories,links,networks,interfaces,onOpenSystem,onCloseSystem,inspectorOpen,onOpenComponents,onOpenComponent,onOpenFlows,onOpenNetworks,focusSystemId='',request,canEditLayers=false}:{systems:System[];components:Component[];flows:Flow[];processes:Process[];categories:Category[];links:Link[];networks:Network[];interfaces:Interface[];onOpenSystem:(id:string)=>void;onCloseSystem:()=>void;inspectorOpen:boolean;onOpenComponents:(id:string)=>void;onOpenComponent:(id:string)=>void;onOpenFlows:()=>void;onOpenNetworks:()=>void;focusSystemId?:string;request?:<T>(url:string,init?:RequestInit)=>Promise<T>;canEditLayers?:boolean}){
 const [layers,setLayers]=useState({systems:true,components:false,flows:false,business:false,networks:false})
 const [mapMode,setMapMode]=useState<'business'|'flows'|'networks'>('flows')
 const [activeOverlays,setActiveOverlays]=useState({business:true,network:false})
 const [selectedOverlayGroup,setSelectedOverlayGroup]=useState('')
 const [savedRegions,setSavedRegions]=useState<Record<string,LayerRegion>>({})
 const [layerDrafts,setLayerDrafts]=useState<Record<string,LayerDraft>>({})
 const [editingLayers,setEditingLayers]=useState(false)
 const [layerTool,setLayerTool]=useState<LayerTool>('select')
 const [fitTrigger,setFitTrigger]=useState(0)
 const [layerBusy,setLayerBusy]=useState(false)
 const [layerError,setLayerError]=useState('')
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
 const cancelLayerChanges=()=>{setLayerDrafts({});setEditingLayers(false);setLayerTool('select');setLayerError('')}
 const saveLayerChanges=async()=>{
  if(!request||!canEditLayers)return
  setLayerBusy(true);setLayerError('')
  try{
   const updated={...savedRegions}
   for(const [key,payload] of Object.entries(layerDrafts)){
    updated[key]=await request<LayerRegion>('/api/diagrams/layer-regions/'+encodeURIComponent(key),{method:'PUT',body:JSON.stringify(payload)})
   }
   setSavedRegions(updated);setLayerDrafts({});setEditingLayers(false);setLayerTool('select')
  }catch(err){setLayerError((err as Error).message)}
  finally{setLayerBusy(false)}
 }
 const [overlayOpacity,setOverlayOpacity]=useState(22)
 const [hiddenOverlayGroups,setHiddenOverlayGroups]=useState<string[]>([])
 const [overlayColors,setOverlayColors]=useState<Record<string,string>>(()=>{
  try{const value=JSON.parse(localStorage.getItem('architecture-hub-layer-colors-v1')||'{}');return value&&typeof value==='object'&&!Array.isArray(value)?value:{}}catch{return {}}
 })
 useEffect(()=>{try{localStorage.setItem('architecture-hub-layer-colors-v1',JSON.stringify(overlayColors))}catch{/* browser storage unavailable */}},[overlayColors])
 const [query,setQuery]=useState('')
 const [focus,setFocus]=useState('')
 const [selectedSystem,setSelectedSystem]=useState('')
 useEffect(()=>{if(focusSystemId)setSelectedSystem(focusSystemId)},[focusSystemId])
 useEffect(()=>{if(!inspectorOpen)setSelectedSystem('')},[inspectorOpen])
 const [environment,setEnvironment]=useState('all')
 const systemByComponent=useMemo(()=>new Map(components.map(c=>[c.id,c.system_id])),[components])
 const filteredSystems=systems.filter(s=>(!query||s.name.toLowerCase().includes(query.toLowerCase())||components.some(c=>c.system_id===s.id&&c.name.toLowerCase().includes(query.toLowerCase())))&&(!focus||focus===s.id)&& (environment==='all'||components.some(c=>c.system_id===s.id&&String(c.details.environment||'').toLowerCase()===environment)))
 const visibleIds=new Set(filteredSystems.map(s=>s.id))
 const crossFlows=flows.map(f=>({source:systemByComponent.get(f.source_id),target:systemByComponent.get(f.target_id)})).filter((f):f is {source:string;target:string}=>!!f.source&&!!f.target&&f.source!==f.target&&visibleIds.has(f.source)&&visibleIds.has(f.target))
 const flowCounts=new Map<string,number>()
 for(const f of crossFlows){const key=f.source+'|'+f.target;flowCounts.set(key,(flowCounts.get(key)||0)+1)}
 // Systems participating in the same business process are associated, not
 // necessarily connected by a technical data flow. Keep those semantics separate.
 const processSystems=new Map<string,Set<string>>()
 for(const link of links)if(visibleIds.has(link.system_id)){
   const members=processSystems.get(link.process_id)||new Set<string>()
   members.add(link.system_id);processSystems.set(link.process_id,members)
 }
 const businessCounts=new Map<string,number>()
 for(const members of processSystems.values()){
   const ids=[...members].sort()
   for(let i=0;i<ids.length;i++)for(let j=i+1;j<ids.length;j++){
     const key=ids[i]+'|'+ids[j];businessCounts.set(key,(businessCounts.get(key)||0)+1)
   }
 }
 // Shared networks are reported as memberships, never as inferred network paths.
 const networkSystems=new Map<string,Set<string>>()
 for(const nic of interfaces){
   const systemId=systemByComponent.get(nic.item_id)
   if(!systemId||!visibleIds.has(systemId))continue
   for(const id of [nic.zone_id,nic.vlan_id,nic.vrf_id]){
     if(!id)continue
     const members=networkSystems.get(id)||new Set<string>()
     members.add(systemId);networkSystems.set(id,members)
   }
 }
 // A three-column overview avoids microscopic nodes in long dependency chains.
 // The coordinate space is defined by the full architecture, never by
 // active overlays or search filters. Node coordinates cannot jump on layer changes.
 const componentRows=Math.max(1,...systems.map(sys=>Math.ceil(components.filter(c=>c.system_id===sys.id).length/2)))
 const systemRowGap=Math.max(330,120+componentRows*43)
 const basePositions=overviewGridPositions(systems.map(s=>s.id))
 const positions=Object.fromEntries(systems.map((sys,index)=>{
   const original=basePositions[sys.id]||{x:(index%3)*320,y:Math.floor(index/3)*190}
   return [sys.id,{x:original.x/310*410,y:original.y/170*systemRowGap}]
 }))
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
 for(const network of networks){
   const members=networkSystems.get(network.id)
   overlayGroups.push({id:'network:'+network.id,name:network.name,type:'network',members:members||new Set()})
 }
 const palette=['#a78bfa','#f59e0b','#10b981','#60a5fa','#f472b6','#22d3ee','#f97316','#84cc16']
 const groupColor=(group:OverlayGroup)=>layerDrafts[group.id]?.color||savedRegions[group.id]?.color||overlayColors[group.id]||palette[Math.max(0,overlayGroups.findIndex(item=>item.id===group.id))%palette.length]
 const membersFor=(group:OverlayGroup)=>layerDrafts[group.id]?.members||savedRegions[group.id]?.members||[...group.members]
 const defaultDraftFor=(group:OverlayGroup):LayerDraft=>{
  const memberIds=membersFor(group)
  const points=memberIds.map(id=>positions[id]).filter(Boolean)
  return {x:points.length?Math.min(...points.map(p=>p.x))-26:20,
    y:points.length?Math.min(...points.map(p=>p.y))-42:20,
    width:points.length?Math.max(...points.map(p=>p.x))-Math.min(...points.map(p=>p.x))+330:340,
    height:points.length?Math.max(...points.map(p=>p.y))-Math.min(...points.map(p=>p.y))+Math.max(110,100+componentRows*43)+42:190,
    color:groupColor(group),members:memberIds}
 }
 const areaNodes=overlayGroups.filter(group=>activeOverlays[group.type]&&!hiddenOverlayGroups.includes(group.id)&&(membersFor(group).length>0||Boolean(savedRegions[group.id]||layerDrafts[group.id]))).map(group=>{
   const initial=defaultDraftFor(group)
   const memberIds=initial.members
   const area=layerDrafts[group.id]||savedRegions[group.id]||initial
   const color=groupColor(group)
   return {id:'overlay:'+group.id,type:'layerRegion',position:{x:area.x,y:area.y},width:area.width,height:area.height,
     data:{name:group.name,count:memberIds.length,editing:editingLayers&&canEditLayers&&layerTool==='move',resize:(value:{x:number;y:number;width:number;height:number})=>updateDraft(group.id,value,initial)},
     draggable:editingLayers&&canEditLayers&&layerTool==='move',selectable:editingLayers&&canEditLayers&&layerTool!=='draw',connectable:false,zIndex:-10,
     style:{width:area.width,height:area.height,backgroundColor:color+Math.round(overlayOpacity/100*255).toString(16).padStart(2,'0'),border:'2px solid '+color,borderRadius:16,pointerEvents:editingLayers?'auto' as const:'none' as const,boxShadow:'none'}}
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

 const nodes=filteredSystems.map((s,i)=>({id:s.id,draggable:false,position:positions[s.id]||{x:(i%4)*320,y:Math.floor(i/4)*190},data:{label:<DiagramNodeLabel name={s.name} kind={s.kind} subtitle={components.filter(c=>c.system_id===s.id).length+' компонентов · '+links.filter(l=>l.system_id===s.id).length+' бизнес-связей'}/>},style:diagramCardStyle()}))
 const selectedSystemInfo=filteredSystems.find(s=>s.id===selectedSystem)
 const selectedNeighbors=new Set<string>([selectedSystem])
 for(const f of crossFlows)if(f.source===selectedSystem||f.target===selectedSystem){selectedNeighbors.add(f.source);selectedNeighbors.add(f.target)}
 const selectedComponents=components.filter(c=>c.system_id===selectedSystem)
 const selectedFlowCount=crossFlows.filter(f=>f.source===selectedSystem||f.target===selectedSystem).length
 const focusedLayer=overlayGroups.find(group=>group.id===selectedOverlayGroup)
 const highlightedNodes=nodes.map(n=>({...n,zIndex:10,style:{...n.style,border:selectedSystem===n.id?'2px solid #2563eb':n.style.border,opacity:focusedLayer&&!membersFor(focusedLayer).includes(n.id)?0.2:selectedSystem&&!selectedNeighbors.has(n.id)?0.28:1}}))
 const canvasNodes=[...areaNodes,...highlightedNodes,...componentNodes]
 const connectionCounts=mapMode==='business'?businessCounts:mapMode==='flows'?flowCounts:new Map<string,number>()
 const edges=[...connectionCounts].map(([key,count])=>{
   const [source,target]=key.split('|')
   const related=selectedSystem&&(source===selectedSystem||target===selectedSystem)
   const color=mapMode==='business'?'#8264a8':'#64748b'
   return {id:mapMode+':'+key,source,target,type:'smoothstep',label:mapMode==='flows'?count+' поток'+(count===1?'':count<5?'а':'ов'):count+' БП',
     ...(mapMode==='flows'?{markerEnd:{type:MarkerType.ArrowClosed,width:13,height:13,color}}:{}),
     style:{stroke:related?'#2563eb':color,strokeWidth:related?2.5:1.4,strokeDasharray:mapMode==='business'?'5 5':undefined,opacity:selectedSystem&&!related?0.18:1}}
 })
 const environments=[...new Set(components.map(c=>String(c.details.environment||'').toLowerCase()).filter(Boolean))].sort()
 return <section className="homeMap" aria-label="Главная карта архитектуры">
  <header className="homeMapHead"><div className="homeMapStats"><span>{systems.length} ИС</span><span>{components.length} компонентов</span><span>{flows.length} потоков</span></div></header>
  <div className="homeMapMode" role="group" aria-label="Тип связей на архитектурной карте">
    {([['business','Бизнес-связи'],['flows','Потоки данных'],['networks','Сети и зоны']] as const).map(([id,label])=><button key={id} type="button" aria-pressed={mapMode===id} className={mapMode===id?'current':''} onClick={()=>setMapMode(id)}>{label}</button>)}
   </div>
  <div className="homeLayerToolbar" role="group" aria-label="Накладываемые слои">
   <div className="homeLayerPresets" role="group" aria-label="Режим архитектурных областей">
    <button type="button" aria-pressed={activeOverlays.business&&!activeOverlays.network} onClick={()=>setActiveOverlays({business:true,network:false})}>Бизнес-слой</button>
    <button type="button" aria-pressed={!activeOverlays.business&&activeOverlays.network} onClick={()=>setActiveOverlays({business:false,network:true})}>Сетевой слой</button>
    <button type="button" aria-pressed={activeOverlays.business&&activeOverlays.network} onClick={()=>setActiveOverlays({business:true,network:true})}>Наложить оба</button>
    <button type="button" aria-pressed={!activeOverlays.business&&!activeOverlays.network} onClick={()=>setActiveOverlays({business:false,network:false})}>Без областей</button>
   </div>
   <strong>Области на схеме</strong>
   {canEditLayers&&layerApiReady&&<div className="homeLayerEditActions">
    {!editingLayers?<button type="button" onClick={()=>{setEditingLayers(true);setLayerError('')}}>Редактировать области</button>:<>
     <button type="button" className="primary" disabled={layerBusy||!Object.keys(layerDrafts).length} onClick={()=>void saveLayerChanges()}>{layerBusy?'Сохранение…':'Сохранить области'}</button>
     <button type="button" disabled={layerBusy} onClick={cancelLayerChanges}>Отменить</button>
    </>}
   </div>}
   {layerError&&<p role="alert">{layerError}</p>
   <label><input type="checkbox" checked={layers.components} onChange={e=>setLayers(old=>({...old,components:e.target.checked}))}/> Показать ВМ и компоненты</label>
   <span className="homeLayerHint">Объекты остаются на месте; переключаются только цветные области принадлежности.</span>
   <label className="homeLayerOpacity">Прозрачность заливки <input aria-label="Насыщенность слоёв" type="range" min="5" max="55" value={overlayOpacity} onChange={e=>setOverlayOpacity(Number(e.target.value))}/></label>
   <details open className="homeLayerCatalog"><summary>Категории и области</summary><div className="homeLayerColorList">{overlayGroups.map(group=><label key={group.id}>
    <input type="checkbox" aria-label={'Показать область '+group.name} checked={!hiddenOverlayGroups.includes(group.id)} onChange={e=>setHiddenOverlayGroups(old=>e.target.checked?old.filter(id=>id!==group.id):[...old,group.id])}/>
    <input aria-label={'Цвет слоя '+group.name} type="color" value={groupColor(group)} onChange={e=>editingLayers&&canEditLayers?updateDraft(group.id,{color:e.target.value},layerDrafts[group.id]||savedRegions[group.id]||defaultDraftFor(group)):setOverlayColors(old=>({...old,[group.id]:e.target.value}))}/><button type="button" aria-pressed={selectedOverlayGroup===group.id} onClick={()=>{setSelectedOverlayGroup(old=>old===group.id?'':group.id);setActiveOverlays(old=>({...old,[group.type]:true}))}}>{group.name}</button><small>{membersFor(group).length} ИС · {group.type==='business'?'Бизнес':'Сети'}</small>
   </label>)}</div></details>
  </div>
  <div className="homeMapTools"><input aria-label="Поиск на карте" value={query} onChange={e=>setQuery(e.target.value)} placeholder="Найти ИС или компонент…"/><Disclosure label="Фильтры и слои"><select aria-label="Контур карты" value={environment} onChange={e=>setEnvironment(e.target.value)}><option value="all">Все контуры</option>{environments.map(e=><option key={e} value={e}>{e}</option>)}</select><select aria-label="Фокус на ИС" value={focus} onChange={e=>setFocus(e.target.value)}><option value="">Все системы</option>{systems.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select>
  <details className="homeMapLayersDisclosure"><summary>Слои карты <span aria-hidden="true">▾</span></summary><div className="homeMapLayers" aria-label="Слои карты">{([['systems','Информационные системы'],['business','Бизнес-процессы'],['networks','Сетевые объекты']] as const).map(([key,label])=><label key={key}><input type="checkbox" checked={layers[key]} onChange={e=>setLayers(old=>({...old,[key]:e.target.checked}))}/>{label}</label>)}</div></details></Disclosure></div>
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
  {layers.systems&&<div className="homeMapGraph"><ReactFlow minZoom={0.08} nodes={canvasNodes} edges={edges} nodeTypes={homeNodeTypes} nodesDraggable={editingLayers&&canEditLayers}
   onNodesChange={(changes:NodeChange[])=>{
    if(!editingLayers||!canEditLayers)return
    for(const change of changes){
     if(change.type!=='position'||!change.position||!change.id.startsWith('overlay:'))continue
     const key=change.id.slice(8)
     const node=areaNodes.find(item=>item.id===change.id)
     const group=overlayGroups.find(item=>item.id===key)
     if(node&&group)updateDraft(key,change.position,{x:node.position.x,y:node.position.y,width:node.width,height:node.height,color:groupColor(group),members:membersFor(group)})
    }
   } onNodeDragStop={(_,node)=>{if(!node.id.startsWith('overlay:'))return;const key=node.id.slice(8);const region=areaNodes.find(item=>item.id===node.id);const group=overlayGroups.find(item=>item.id===key);if(region&&group)updateDraft(key,node.position,{x:region.position.x,y:region.position.y,width:region.width,height:region.height,color:groupColor(group),members:membersFor(group)})}} fitView fitViewOptions={{padding:0.15,minZoom:0.3,maxZoom:1}} nodesConnectable={false} onNodeClick={(_,node)=>{if(node.id.startsWith('component:')){onOpenComponent(node.id.slice('component:'.length));return}if(node.id.startsWith('overlay:')){setSelectedOverlayGroup(node.id.slice(8));return}setSelectedSystem(node.id);onOpenSystem(node.id)}} onPaneClick={()=>{setSelectedSystem('');onCloseSystem()}}><AutoFit layoutKey={inspectorOpen?'inspector-open':'inspector-closed'} ignoreNodePrefixes="overlay:,component:" focusIds={filteredSystems.map(s=>s.id)} suspended={editingLayers}/><Background gap={20}/><Controls showInteractive={false}/></ReactFlow></div>}
  {!layers.systems&&<div className="homeMapEmpty">Включите слой «Информационные системы», чтобы показать карту связей.</div>}
  {selectedOverlayGroup&&focusedLayer&&<div className="homeLayerMembers" role="status"><strong>{focusedLayer.name}</strong><span>В этой области: {membersFor(focusedLayer).map(id=>systems.find(sys=>sys.id===id)?.name||id).join(', ')}</span><button type="button" onClick={()=>setSelectedOverlayGroup('')}>Снять выделение</button></div>}
  {editingLayers&&focusedLayer&&<section className="homeLayerMemberEditor" aria-label="Состав области">
   <h3>{focusedLayer.name} – состав области</h3>
   <p>Выбор влияет только на отображение области, а не на фактические бизнес-связи или сетевые интерфейсы.</p>
   <div className="homeLayerMemberGrid">{systems.map(system=><label key={system.id}><input type="checkbox" checked={membersFor(focusedLayer).includes(system.id)} onChange={e=>{
     const members=membersFor(focusedLayer).filter(id=>id!==system.id)
     if(e.target.checked)members.push(system.id)
     const region=areaNodes.find(node=>node.id==='overlay:'+focusedLayer.id)
     const base:LayerDraft=layerDrafts[focusedLayer.id]||savedRegions[focusedLayer.id]||{x:region?.position.x||20,y:region?.position.y||20,width:region?.width||340,height:region?.height||190,color:groupColor(focusedLayer),members:membersFor(focusedLayer)}
     updateDraft(focusedLayer.id,{members},base)
   }}/>{system.name}</label>)}</div>
  </section>}
  <p className="homeMapModeHint">Полупрозрачные области показывают принадлежность ИС к категориям, а не технические маршруты. Пересекающиеся рамки означают одновременное участие; для точного состава смотрите подписи и реестры.</p>
  <p className="homeMapModeHint">{mapMode==='business'?'Пунктир показывает участие систем в общих бизнес-процессах, а не направление передачи данных.':mapMode==='flows'?'Стрелки показывают реальные зарегистрированные потоки между компонентами разных ИС. Количество указано на связи.':'Сетевой слой показывает привязки систем к зонам, VLAN и VRF. Совпадение сети не означает наличие разрешённого маршрута.'}</p>
  <div className="homeMapDetails">
   {mapMode==='networks'&&<article><h3>Использование сетей</h3>{[...networkSystems].filter(([,members])=>members.size).map(([id,members])=><p key={id}><strong>{networks.find(n=>n.id===id)?.name||id}</strong> · {[...members].map(systemId=>systems.find(sys=>sys.id===systemId)?.name||systemId).join(', ')}</p>)}{!networkSystems.size&&<p>У выбранных систем нет зарегистрированных сетевых привязок.</p>}</article>}
   {(layers.business||mapMode==='business')&&<article><h3>Бизнес-процессы</h3><p>{processes.length} процессов · {links.length} связей с ИС</p><div>{processes.slice(0,12).map(p=><span className="homeMapChip" key={p.id}>{p.name}</span>)}</div></article>}
   {layers.components&&<article><h3>Компоненты</h3><div className="homeMapComponentList">{components.filter(c=>visibleIds.has(c.system_id)).slice(0,60).map(c=><button key={c.id} onClick={()=>onOpenComponent(c.id)}><span aria-hidden="true">{architectureIcon(c.kind)}</span> {c.name} <small>{c.kind}</small></button>)}</div></article>}
   {(layers.networks||mapMode==='networks')&&<article><h3>Сети и зоны</h3><p>{networks.length} сетевых объектов · {interfaces.length} интерфейсов</p><div>{networks.slice(0,15).map(n=><span className="homeMapChip" key={n.id}>{architectureIcon(n.kind)} {n.name}</span>)}</div><button onClick={onOpenNetworks}>Открыть реестр сетей</button></article>}
   {mapMode==='flows'&&selectedSystemInfo&&<button onClick={onOpenFlows}>Открыть реестр потоков</button>}
  </div>
 </section>
}
