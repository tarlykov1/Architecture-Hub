import React, {useEffect,useMemo,useState} from 'react'
import {architectureIcon,DiagramNodeLabel,diagramCardStyle} from './DiagramVisual'
export {architectureIcon} from './DiagramVisual'
import {ReactFlow,Background,Controls,MarkerType,useNodesInitialized,useReactFlow} from '@xyflow/react'

type System={id:string;name:string;kind:string}
type Component={id:string;system_id:string;name:string;kind:string;details:Record<string,unknown>}
type Flow={id:string;source_id:string;target_id:string}
type Process={id:string;name:string;category_id?:string}
type Category={id:string;name:string}
type OverlayGroup={id:string;name:string;type:'business'|'network';members:Set<string>}
type Link={process_id:string;system_id:string}
type Network={id:string;name:string;kind:string}
type Interface={item_id:string;zone_id:string|null;vlan_id:string|null;vrf_id:string|null}

import {AutoFit,Disclosure} from './WorkspaceUI'
import {overviewGridPositions} from './graphLayout'

export default function ArchitectureHome({systems,components,flows,processes,categories,links,networks,interfaces,onOpenSystem,onCloseSystem,inspectorOpen,onOpenComponents,onOpenComponent,onOpenFlows,onOpenNetworks,focusSystemId=''}:{systems:System[];components:Component[];flows:Flow[];processes:Process[];categories:Category[];links:Link[];networks:Network[];interfaces:Interface[];onOpenSystem:(id:string)=>void;onCloseSystem:()=>void;inspectorOpen:boolean;onOpenComponents:(id:string)=>void;onOpenComponent:(id:string)=>void;onOpenFlows:()=>void;onOpenNetworks:()=>void;focusSystemId?:string}){
 const [layers,setLayers]=useState({systems:true,components:false,flows:false,business:false,networks:false})
 const [mapMode,setMapMode]=useState<'business'|'flows'|'networks'>('flows')
 const [activeOverlays,setActiveOverlays]=useState({business:false,network:false})
 const [overlayOpacity,setOverlayOpacity]=useState(22)
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
   if(members.size)overlayGroups.push({id:'business:'+cat.id,name:cat.name,type:'business',members})
 }
 // Processes without a known category retain their own visual group.
 for(const process of processes.filter(p=>!p.category_id||!categories.some(c=>c.id===p.category_id))){
   const members=new Set(links.filter(l=>l.process_id===process.id&&visibleIds.has(l.system_id)).map(l=>l.system_id))
   if(members.size)overlayGroups.push({id:'business:process:'+process.id,name:process.name,type:'business',members})
 }
 for(const network of networks){
   const members=networkSystems.get(network.id)
   if(members?.size)overlayGroups.push({id:'network:'+network.id,name:network.name,type:'network',members})
 }
 const palette=['#a78bfa','#f59e0b','#10b981','#60a5fa','#f472b6','#22d3ee','#f97316','#84cc16']
 const groupColor=(group:OverlayGroup)=>overlayColors[group.id]||palette[Math.max(0,overlayGroups.findIndex(item=>item.id===group.id))%palette.length]
 const areaNodes=overlayGroups.filter(group=>activeOverlays[group.type]).map(group=>{
   const points=[...group.members].map(id=>positions[id]).filter(Boolean)
   const minX=Math.min(...points.map(p=>p.x))-26,minY=Math.min(...points.map(p=>p.y))-42
   const maxX=Math.max(...points.map(p=>p.x))+304,maxY=Math.max(...points.map(p=>p.y))+Math.max(110,100+componentRows*43)
   const color=groupColor(group)
   return {id:'overlay:'+group.id,position:{x:minX,y:minY},data:{label:<div className="homeLayerRegionLabel">{group.name}<small>{group.members.size} ИС</small></div>},selectable:false,draggable:false,connectable:false,zIndex:-10,
     style:{width:maxX-minX,height:maxY-minY,backgroundColor:color+Math.round(overlayOpacity/100*255).toString(16).padStart(2,'0'),border:'2px solid '+color,borderRadius:16,pointerEvents:'none' as const,boxShadow:'none'}}
 })
 const componentNodes=layers.components?components.filter(c=>visibleIds.has(c.system_id)).flatMap(c=>{
   const group=components.filter(item=>item.system_id===c.system_id)
   const index=group.findIndex(item=>item.id===c.id)
   const parent=positions[c.system_id]
   return parent?[{id:'component:'+c.id,position:{x:parent.x+(index%2)*144,y:parent.y+100+Math.floor(index/2)*43},
     data:{label:<span title={c.name}>{architectureIcon(c.kind)} {c.name}</span>},style:{width:136,fontSize:11,padding:'7px',borderRadius:6,border:'1px solid #cbd5e1',background:'#fff',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap' as const},selectable:true,zIndex:20}]:[]
 }):[]

 const nodes=filteredSystems.map((s,i)=>({id:s.id,position:positions[s.id]||{x:(i%4)*320,y:Math.floor(i/4)*190},data:{label:<DiagramNodeLabel name={s.name} kind={s.kind} subtitle={components.filter(c=>c.system_id===s.id).length+' компонентов · '+links.filter(l=>l.system_id===s.id).length+' бизнес-связей'}/>},style:diagramCardStyle()}))
 const selectedSystemInfo=filteredSystems.find(s=>s.id===selectedSystem)
 const selectedNeighbors=new Set<string>([selectedSystem])
 for(const f of crossFlows)if(f.source===selectedSystem||f.target===selectedSystem){selectedNeighbors.add(f.source);selectedNeighbors.add(f.target)}
 const selectedComponents=components.filter(c=>c.system_id===selectedSystem)
 const selectedFlowCount=crossFlows.filter(f=>f.source===selectedSystem||f.target===selectedSystem).length
 const highlightedNodes=nodes.map(n=>({...n,zIndex:10,style:{...n.style,border:selectedSystem===n.id?'2px solid #2563eb':n.style.border,opacity:selectedSystem&&!selectedNeighbors.has(n.id)?0.28:1}}))
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
   <strong>Области на схеме</strong>
   <label><input type="checkbox" checked={layers.components} onChange={e=>setLayers(old=>({...old,components:e.target.checked}))}/> Показать ВМ и компоненты</label>
   <label><input type="checkbox" checked={activeOverlays.business} onChange={e=>setActiveOverlays(old=>({...old,business:e.target.checked}))}/> Бизнес-категории</label>
   <label><input type="checkbox" checked={activeOverlays.network} onChange={e=>setActiveOverlays(old=>({...old,network:e.target.checked}))}/> Сети и зоны</label>
   <label className="homeLayerOpacity">Прозрачность заливки <input aria-label="Насыщенность слоёв" type="range" min="5" max="55" value={overlayOpacity} onChange={e=>setOverlayOpacity(Number(e.target.value))}/></label>
   <details><summary>Цвета областей</summary><div className="homeLayerColorList">{overlayGroups.map(group=><label key={group.id}><input aria-label={'Цвет слоя '+group.name} type="color" value={groupColor(group)} onChange={e=>setOverlayColors(old=>({...old,[group.id]:e.target.value}))}/><span>{group.name}</span><small>{group.type==='business'?'Бизнес':'Сети'}</small></label>)}</div></details>
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
  {layers.systems&&<div className="homeMapGraph"><ReactFlow minZoom={0.08} nodes={canvasNodes} edges={edges} fitView fitViewOptions={{padding:0.15,minZoom:0.3,maxZoom:1}} nodesDraggable={false} nodesConnectable={false} onNodeClick={(_,node)=>{if(node.id.startsWith('component:')){onOpenComponent(node.id.slice('component:'.length));return}if(node.id.startsWith('overlay:'))return;setSelectedSystem(node.id);onOpenSystem(node.id)}} onPaneClick={()=>{setSelectedSystem('');onCloseSystem()}}><AutoFit layoutKey={inspectorOpen?'inspector-open':'inspector-closed'} focusIds={filteredSystems.map(s=>s.id)}/><Background gap={20}/><Controls showInteractive={false}/></ReactFlow></div>}
  {!layers.systems&&<div className="homeMapEmpty">Включите слой «Информационные системы», чтобы показать карту связей.</div>}
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
