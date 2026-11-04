import React, {useEffect,useMemo,useState} from 'react'
import {ReactFlow,Background,Controls,MarkerType,useNodesInitialized,useReactFlow} from '@xyflow/react'

type System={id:string;name:string;kind:string}
type Component={id:string;system_id:string;name:string;kind:string;details:Record<string,unknown>}
type Flow={id:string;source_id:string;target_id:string}
type Process={id:string;name:string}
type Link={process_id:string;system_id:string}
type Network={id:string;name:string;kind:string}
type Interface={item_id:string;zone_id:string|null;vlan_id:string|null;vrf_id:string|null}

import {AutoFit,Disclosure} from './WorkspaceUI'

export function architectureIcon(kind:string):string{
 const k=kind.toLowerCase()
 if(/database|postgres|mysql|db|бд/.test(k))return '▤'
 if(/vm|server|host|сервер/.test(k))return '▣'
 if(/network|vlan|vrf|zone|сеть/.test(k))return '◇'
 if(/gateway|proxy|firewall|security|шлюз/.test(k))return '⬡'
 if(/container|docker|kubernetes/.test(k))return '▥'
 if(/service|api|integration|сервис/.test(k))return '⟷'
 return '▦'
}

export default function ArchitectureHome({systems,components,flows,processes,links,networks,interfaces,onOpenSystem,onOpenComponents,onOpenComponent,onOpenFlows,onOpenNetworks}:{systems:System[];components:Component[];flows:Flow[];processes:Process[];links:Link[];networks:Network[];interfaces:Interface[];onOpenSystem:(id:string)=>void;onOpenComponents:(id:string)=>void;onOpenComponent:(id:string)=>void;onOpenFlows:()=>void;onOpenNetworks:()=>void}){
 const [layers,setLayers]=useState({systems:true,components:false,flows:true,business:false,networks:false})
 const [query,setQuery]=useState('')
 const [focus,setFocus]=useState('')
 const [selectedSystem,setSelectedSystem]=useState('')
 const [environment,setEnvironment]=useState('all')
 const systemByComponent=useMemo(()=>new Map(components.map(c=>[c.id,c.system_id])),[components])
 const filteredSystems=systems.filter(s=>(!query||s.name.toLowerCase().includes(query.toLowerCase())||components.some(c=>c.system_id===s.id&&c.name.toLowerCase().includes(query.toLowerCase())))&&(!focus||focus===s.id)&& (environment==='all'||components.some(c=>c.system_id===s.id&&String(c.details.environment||'').toLowerCase()===environment)))
 const visibleIds=new Set(filteredSystems.map(s=>s.id))
 const crossFlows=flows.map(f=>({source:systemByComponent.get(f.source_id),target:systemByComponent.get(f.target_id)})).filter((f):f is {source:string;target:string}=>!!f.source&&!!f.target&&f.source!==f.target&&visibleIds.has(f.source)&&visibleIds.has(f.target))
 const counts=new Map<string,number>()
 for(const f of crossFlows){const key=f.source+'|'+f.target;counts.set(key,(counts.get(key)||0)+1)}
 // A three-column overview avoids microscopic nodes in long dependency chains.
 const columns=filteredSystems.length<=4?2:3
 const positions:Record<string,{x:number;y:number}>={}
 filteredSystems.forEach((s,i)=>{positions[s.id]={x:(i%columns)*310,y:Math.floor(i/columns)*170}})
 const nodes=filteredSystems.map((s,i)=>({id:s.id,position:positions[s.id]||{x:(i%4)*320,y:Math.floor(i/4)*190},data:{label:<div className="homeNode"><strong><span aria-hidden="true">{architectureIcon(s.kind)}</span> {s.name}</strong><small>{components.filter(c=>c.system_id===s.id).length} компонентов · {links.filter(l=>l.system_id===s.id).length} бизнес-связей</small><button type="button" className="nodrag nopan homeNodePassport" aria-label={`Открыть паспорт ИС: ${s.name}`} onPointerDown={e=>e.stopPropagation()} onClick={e=>{e.preventDefault();e.stopPropagation();setSelectedSystem(s.id);onOpenSystem(s.id)}}>Паспорт ИС</button></div>},style:{width:245,border:'1px solid #94a3b8',borderRadius:12,background:'#fff',padding:12}}))
 const selectedSystemInfo=filteredSystems.find(s=>s.id===selectedSystem)
 const selectedNeighbors=new Set<string>([selectedSystem])
 for(const f of crossFlows)if(f.source===selectedSystem||f.target===selectedSystem){selectedNeighbors.add(f.source);selectedNeighbors.add(f.target)}
 const selectedComponents=components.filter(c=>c.system_id===selectedSystem)
 const selectedFlowCount=crossFlows.filter(f=>f.source===selectedSystem||f.target===selectedSystem).length
 const highlightedNodes=nodes.map(n=>({...n,style:{...n.style,border:selectedSystem===n.id?'2px solid #2563eb':n.style.border,opacity:selectedSystem&&!selectedNeighbors.has(n.id)?0.28:1}}))
 const edges=[...counts].map(([key,count])=>{const [source,target]=key.split('|');return {id:key,source,target,type:'smoothstep',label:String(count),markerEnd:{type:MarkerType.ArrowClosed,width:13,height:13,color:'#64748b'},style:{stroke:selectedSystem&&(source===selectedSystem||target===selectedSystem)?'#2563eb':'#64748b',strokeWidth:selectedSystem&&(source===selectedSystem||target===selectedSystem)?2.5:1.4,opacity:selectedSystem&&source!==selectedSystem&&target!==selectedSystem?0.18:1}}})
 const environments=[...new Set(components.map(c=>String(c.details.environment||'').toLowerCase()).filter(Boolean))].sort()
 return <section className="homeMap" aria-label="Главная карта архитектуры">
  <header className="homeMapHead"><div className="homeMapStats"><span>{systems.length} ИС</span><span>{components.length} компонентов</span><span>{flows.length} потоков</span></div></header>
  <div className="homeMapTools"><input aria-label="Поиск на карте" value={query} onChange={e=>setQuery(e.target.value)} placeholder="Найти ИС или компонент…"/><Disclosure label="Фильтры и слои"><select aria-label="Контур карты" value={environment} onChange={e=>setEnvironment(e.target.value)}><option value="all">Все контуры</option>{environments.map(e=><option key={e} value={e}>{e}</option>)}</select><select aria-label="Фокус на ИС" value={focus} onChange={e=>setFocus(e.target.value)}><option value="">Все системы</option>{systems.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select>
  <details className="homeMapLayersDisclosure"><summary>Слои карты <span aria-hidden="true">▾</span></summary><div className="homeMapLayers" aria-label="Слои карты">{([['systems','Информационные системы'],['components','Компоненты'],['flows','Потоки'],['business','Бизнес'],['networks','Сети']] as const).map(([key,label])=><label key={key}><input type="checkbox" checked={layers[key]} onChange={e=>setLayers(old=>({...old,[key]:e.target.checked}))}/>{label}</label>)}</div></details></Disclosure></div>
  {layers.systems&&<div className="homeMapGraph"><ReactFlow minZoom={0.08} nodes={highlightedNodes} edges={layers.flows?edges:[]} fitView fitViewOptions={{padding:0.15,minZoom:0.3,maxZoom:1}} nodesDraggable={false} nodesConnectable={false} onNodeClick={(_,node)=>setSelectedSystem(node.id)} onPaneClick={()=>setSelectedSystem('')}><AutoFit/><Background gap={20}/><Controls showInteractive={false}/></ReactFlow></div>}
  {!layers.systems&&<div className="homeMapEmpty">Включите слой «Информационные системы», чтобы показать карту связей.</div>}
  {selectedSystemInfo&&<aside className="homeMapSelection" aria-label="Выбранная информационная система" style={{padding:16,marginTop:12,border:'1px solid #cbd5e1',borderRadius:12,background:'#f8fafc'}}>
   <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:12,flexWrap:'wrap'}}><div><strong>{selectedSystemInfo.name}</strong><p style={{margin:'6px 0 0'}}>{selectedComponents.length} компонентов · {selectedFlowCount} межсистемных потоков · {Math.max(0,selectedNeighbors.size-1)} связанных ИС</p></div><div style={{display:'flex',gap:8}}><button type="button" onClick={()=>onOpenSystem(selectedSystemInfo.id)}>Открыть паспорт ИС</button><button type="button" onClick={()=>onOpenComponents(selectedSystemInfo.id)}>Компоненты</button><button type="button" onClick={()=>setSelectedSystem('')} aria-label="Снять выделение">Сбросить выбор</button></div></div>
   {selectedComponents.length>0&&<div style={{display:'flex',gap:8,flexWrap:'wrap',marginTop:12}}>{selectedComponents.slice(0,12).map(c=><button type="button" key={c.id} onClick={()=>onOpenComponent(c.id)}>{architectureIcon(c.kind)} {c.name}</button>)}</div>}
  </aside>}
  <div className="homeMapDetails">
   {layers.business&&<article><h3>Бизнес-процессы</h3><p>{processes.length} процессов · {links.length} связей с ИС</p><div>{processes.slice(0,12).map(p=><span className="homeMapChip" key={p.id}>{p.name}</span>)}</div></article>}
   {layers.components&&<article><h3>Компоненты</h3><div className="homeMapComponentList">{components.filter(c=>visibleIds.has(c.system_id)).slice(0,60).map(c=><button key={c.id} onClick={()=>onOpenComponent(c.id)}><span aria-hidden="true">{architectureIcon(c.kind)}</span> {c.name} <small>{c.kind}</small></button>)}</div></article>}
   {layers.networks&&<article><h3>Сети и зоны</h3><p>{networks.length} сетевых объектов · {interfaces.length} интерфейсов</p><div>{networks.slice(0,15).map(n=><span className="homeMapChip" key={n.id}>{architectureIcon(n.kind)} {n.name}</span>)}</div><button onClick={onOpenNetworks}>Открыть реестр сетей</button></article>}
   {layers.flows&&selectedSystemInfo&&<button onClick={onOpenFlows}>Открыть детальную схему потоков</button>}
  </div>
 </section>
}
