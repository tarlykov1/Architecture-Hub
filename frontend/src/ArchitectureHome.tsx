import React, {useMemo,useState} from 'react'
import {ReactFlow,Background,Controls,MarkerType} from '@xyflow/react'
import {dependencyLayout} from './graphLayout'

type System={id:string;name:string;kind:string}
type Component={id:string;system_id:string;name:string;kind:string;details:Record<string,unknown>}
type Flow={id:string;source_id:string;target_id:string}
type Process={id:string;name:string}
type Link={process_id:string;system_id:string}
type Network={id:string;name:string;kind:string}
type Interface={item_id:string;zone_id:string|null;vlan_id:string|null;vrf_id:string|null}

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

export default function ArchitectureHome({systems,components,flows,processes,links,networks,interfaces,onOpenSystem,onOpenComponent,onOpenFlows,onOpenNetworks}:{systems:System[];components:Component[];flows:Flow[];processes:Process[];links:Link[];networks:Network[];interfaces:Interface[];onOpenSystem:(id:string)=>void;onOpenComponent:(id:string)=>void;onOpenFlows:()=>void;onOpenNetworks:()=>void}){
 const [layers,setLayers]=useState({systems:true,components:false,flows:true,business:false,networks:false})
 const [query,setQuery]=useState('')
 const [environment,setEnvironment]=useState('all')
 const systemByComponent=useMemo(()=>new Map(components.map(c=>[c.id,c.system_id])),[components])
 const filteredSystems=systems.filter(s=>(!query||s.name.toLowerCase().includes(query.toLowerCase())||components.some(c=>c.system_id===s.id&&c.name.toLowerCase().includes(query.toLowerCase())))&& (environment==='all'||components.some(c=>c.system_id===s.id&&String(c.details.environment||'').toLowerCase()===environment)))
 const visibleIds=new Set(filteredSystems.map(s=>s.id))
 const crossFlows=flows.map(f=>({source:systemByComponent.get(f.source_id),target:systemByComponent.get(f.target_id)})).filter((f):f is {source:string;target:string}=>!!f.source&&!!f.target&&f.source!==f.target&&visibleIds.has(f.source)&&visibleIds.has(f.target))
 const counts=new Map<string,number>()
 for(const f of crossFlows){const key=f.source+'|'+f.target;counts.set(key,(counts.get(key)||0)+1)}
 const positions=dependencyLayout(filteredSystems.map(s=>s.id),crossFlows,320,190)
 const nodes=filteredSystems.map((s,i)=>({id:s.id,position:positions[s.id]||{x:(i%4)*320,y:Math.floor(i/4)*190},data:{label:<div className="homeNode"><strong><span aria-hidden="true">{architectureIcon(s.kind)}</span> {s.name}</strong><small>{components.filter(c=>c.system_id===s.id).length} компонентов · {links.filter(l=>l.system_id===s.id).length} бизнес-связей</small><button type="button" onClick={e=>{e.stopPropagation();onOpenSystem(s.id)}}>Открыть ИС</button></div>},style:{width:245,border:'1px solid #94a3b8',borderRadius:12,background:'#fff',padding:12}}))
 const edges=[...counts].map(([key,count])=>{const [source,target]=key.split('|');return {id:key,source,target,type:'smoothstep',label:String(count),markerEnd:{type:MarkerType.ArrowClosed,width:13,height:13,color:'#64748b'},style:{stroke:'#64748b',strokeWidth:1.4}}})
 const environments=[...new Set(components.map(c=>String(c.details.environment||'').toLowerCase()).filter(Boolean))].sort()
 return <section className="homeMap" aria-label="Главная карта архитектуры">
  <header className="homeMapHead"><div><h2>Общая карта</h2></div><div className="homeMapStats"><span>{systems.length} ИС</span><span>{components.length} компонентов</span><span>{flows.length} потоков</span></div></header>
  <div className="homeMapTools"><input aria-label="Поиск на карте" value={query} onChange={e=>setQuery(e.target.value)} placeholder="Найти ИС или компонент…"/><select aria-label="Контур карты" value={environment} onChange={e=>setEnvironment(e.target.value)}><option value="all">Все контуры</option>{environments.map(e=><option key={e} value={e}>{e}</option>)}</select></div>
  <div className="homeMapLayers" aria-label="Слои карты">{([['systems','Информационные системы'],['components','Компоненты'],['flows','Потоки'],['business','Бизнес'],['networks','Сети']] as const).map(([key,label])=><label key={key}><input type="checkbox" checked={layers[key]} onChange={e=>setLayers(old=>({...old,[key]:e.target.checked}))}/>{label}</label>)}</div>
  {layers.systems&&<div className="homeMapGraph"><ReactFlow nodes={nodes} edges={layers.flows?edges:[]} fitView nodesDraggable={false} nodesConnectable={false} onNodeClick={(_,node)=>onOpenSystem(node.id)}><Background gap={20}/><Controls/></ReactFlow></div>}
  {!layers.systems&&<div className="homeMapEmpty">Включите слой «Информационные системы», чтобы показать карту связей.</div>}
  <div className="homeMapDetails">
   {layers.business&&<article><h3>Бизнес-процессы</h3><p>{processes.length} процессов · {links.length} связей с ИС</p><div>{processes.slice(0,12).map(p=><span className="homeMapChip" key={p.id}>{p.name}</span>)}</div></article>}
   {layers.components&&<article><h3>Компоненты</h3><div className="homeMapComponentList">{components.filter(c=>visibleIds.has(c.system_id)).slice(0,60).map(c=><button key={c.id} onClick={()=>onOpenComponent(c.id)}><span aria-hidden="true">{architectureIcon(c.kind)}</span> {c.name} <small>{c.kind}</small></button>)}</div></article>}
   {layers.networks&&<article><h3>Сети и зоны</h3><p>{networks.length} сетевых объектов · {interfaces.length} интерфейсов</p><div>{networks.slice(0,15).map(n=><span className="homeMapChip" key={n.id}>{architectureIcon(n.kind)} {n.name}</span>)}</div><button onClick={onOpenNetworks}>Открыть реестр сетей</button></article>}
   {layers.flows&&<article><h3>Межсистемные потоки</h3><p>{crossFlows.length} связей между ИС. Число на стрелке – количество потоков.</p><button onClick={onOpenFlows}>Открыть детальную схему потоков</button></article>}
  </div>
 </section>
}
