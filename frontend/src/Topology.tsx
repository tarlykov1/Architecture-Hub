import React, {useMemo, useState} from 'react'
import {ReactFlow,Background,Controls,MarkerType,Position,type Node,type Edge} from '@xyflow/react'

type Item={id:string;system_id:string;kind:string;name:string;details:Record<string,unknown>}
type System={id:string;name:string}
type Segment={id:string;kind:string;name:string;description?:string;verification?:string}
type Nic={id:string;item_id:string;name:string;ip_address:string;vrf_id:string|null;vlan_id:string|null;zone_id:string|null}
type Flow={id:string;source_id:string;target_id:string;name:string;protocol:string;port:string;security:string;data_description:string;verification:string;schedule:string}
type Props={systems:System[];items:Item[];segments:Segment[];interfaces:Nic[];flows:Flow[]}
const unknown='Не определено'
const colors={verified:'#15805c',unverified:'#bc8323'}
export default function Topology({systems,items,segments,interfaces,flows}:Props){
 const [system,setSystem]=useState(''),[vrf,setVrf]=useState(''),[vlan,setVlan]=useState(''),[environment,setEnvironment]=useState(''),[search,setSearch]=useState(''),[mode,setMode]=useState<'all'|'internal'|'external'>('all'),[selected,setSelected]=useState(''),[flowId,setFlowId]=useState('')
 const segmentById=useMemo(()=>new Map(segments.map(s=>[s.id,s])),[segments])
 const itemById=useMemo(()=>new Map(items.map(i=>[i.id,i])),[items])
 const systemById=useMemo(()=>new Map(systems.map(s=>[s.id,s])),[systems])
 const nicsByItem=useMemo(()=>{const m=new Map<string,Nic[]>();interfaces.forEach(n=>m.set(n.item_id,[...(m.get(n.item_id)||[]),n]));return m},[interfaces])
 const name=(id:string|null|undefined)=>id?segmentById.get(id)?.name||'Неизвестный объект':unknown
 const environments=Array.from(new Set(items.map(i=>String(i.details.environment||'')).filter(Boolean))).sort()
 const matching=items.filter(i=>(!system||i.system_id===system)&&(!environment||String(i.details.environment||'')===environment)&&(!search||[i.name,systemById.get(i.system_id)?.name||'',i.kind].join(' ').toLocaleLowerCase().includes(search.toLocaleLowerCase()))&&(!vrf||(nicsByItem.get(i.id)||[]).some(n=>n.vrf_id===vrf))&&(!vlan||(nicsByItem.get(i.id)||[]).some(n=>n.vlan_id===vlan)))
 const matchingIds=new Set(matching.map(i=>i.id))
 // A filtered endpoint keeps its external peer visible when requested.
 const visibleFlows=flows.filter(f=>{
   const a=matchingIds.has(f.source_id),b=matchingIds.has(f.target_id)
   if(mode==='internal')return a&&b
   if(mode==='external')return a!==b&&(itemById.has(f.source_id)&&itemById.has(f.target_id))
   return (a||b)&&itemById.has(f.source_id)&&itemById.has(f.target_id)
 })
 const peerIds=new Set<string>()
 visibleFlows.forEach(f=>{if(!matchingIds.has(f.source_id))peerIds.add(f.source_id);if(!matchingIds.has(f.target_id))peerIds.add(f.target_id)})
 const displayed=[...matching,...Array.from(peerIds).map(id=>itemById.get(id)).filter((i):i is Item=>Boolean(i))]
 const groups=new Map<string,{vrf:string|null;vlan:string|null;items:Item[]}>()
 // Multiple interfaces are not silently reduced to the first one:
 // a component is represented once in each VLAN/VRF where it has an interface.
 const memberships=new Map<string,string[]>()
 for(const item of displayed){
   const isPeer=!matchingIds.has(item.id)
   const nics=nicsByItem.get(item.id)||[]
   const keys=isPeer?['external']:(nics.length?nics.map(n=>(n.vrf_id||'none')+'|'+(n.vlan_id||'none')):['none|none'])
   memberships.set(item.id,Array.from(new Set(keys)))
   for(const key of new Set(keys)){
     const [v,r]=key.split('|')
     const group=groups.get(key)||{vrf:key==='external'?null:v==='none'?null:v,vlan:key==='external'?null:r==='none'?null:r,items:[]}
     group.items.push(item);groups.set(key,group)
   }
 }
 const nodes:Node[]=[],edges:Edge[]=[]
 let offsetY=0
 // Variable-height rows avoid overlapping network groups with many hosts.
 const entries=Array.from(groups.entries())
 for(let groupIndex=0;groupIndex<entries.length;groupIndex++){
   const [key,group]=entries[groupIndex]
   const height=95+Math.ceil(group.items.length/3)*132
   const groupId='group:'+key
   const isExternal=key==='external'
   nodes.push({id:groupId,position:{x:0,y:offsetY},data:{label:<div style={{textAlign:'left'}}><strong>{isExternal?'Внешние зависимости':'VRF: '+name(group.vrf)+' · VLAN: '+name(group.vlan)}</strong><div style={{fontSize:12,marginTop:5,color:'#60728b'}}>{group.items.length} компонентов{isExternal?' · вне выбранного фильтра':''}</div></div>},style:{width:900,height,background:isExternal?'#fff4df':'#eaf1fb',border:'1px solid '+(isExternal?'#d6b67b':'#a8bdd6'),borderRadius:14},draggable:false,selectable:false})
   group.items.forEach((item,j)=>{
     const duplicate=(memberships.get(item.id)||[]).indexOf(key)
     nodes.push({id:'host:'+item.id+':'+key,parentId:groupId,extent:'parent',position:{x:16+(j%3)*294,y:74+Math.floor(j/3)*132},sourcePosition:Position.Right,targetPosition:Position.Left,data:{label:<div style={{textAlign:'left',display:'grid',gap:4}}><strong>{item.name}</strong><small>{systemById.get(item.system_id)?.name||'Система неизвестна'}</small><small>{item.kind} · {String(item.details.environment||'Контур не указан')}{isExternal?' · внешняя':''}</small>{(memberships.get(item.id)||[]).length>1&&<small>Сетей: {memberships.get(item.id)?.length}</small>}</div>},style:{width:272,minHeight:100,background:isExternal?'#fffcf5':'white',border:'1px solid '+(duplicate>0?'#669acb':'#adbed3'),borderRadius:9,cursor:'pointer'},draggable:false})
   })
   offsetY+=height+50
 }
 // Resolve arrows to the correct visual copy of multi-homed components.
 const hostNode=(id:string)=>'host:'+id+':'+(memberships.get(id)||[])[0]
 for(const flow of visibleFlows){
   if(!memberships.has(flow.source_id)||!memberships.has(flow.target_id))continue
   const known=flow.verification==='verified'
   edges.push({id:flow.id,source:hostNode(flow.source_id),target:hostNode(flow.target_id),type:'smoothstep',label:[flow.protocol,flow.port].filter(Boolean).join(' : ')||flow.name,markerEnd:{type:MarkerType.ArrowClosed,color:known?colors.verified:colors.unverified},animated:false,style:{stroke:known?colors.verified:colors.unverified,strokeWidth:2},labelStyle:{fontSize:11,fill:'#35465b'},labelBgPadding:[6,3],labelBgBorderRadius:4,labelBgStyle:{fill:'#ffffff',fillOpacity:0.94}})
 }
 const item=itemById.get(selected),flow=flows.find(f=>f.id===flowId)
 return <section style={{padding:14,height:'calc(100vh - 150px)',display:'flex',flexDirection:'column',gap:10,minHeight:510,position:'relative'}}>
  <div><h2 style={{margin:'0 0 4px'}}>Топология сетей и потоков · 0.6</h2><p style={{margin:0,fontSize:13,color:'#546a82'}}>VRF → VLAN → сетевые интерфейсы и ВМ → направленные потоки данных. Неподтверждённые сведения отмечены отдельно.</p></div>
  <div style={{display:'flex',gap:8,flexWrap:'wrap',alignItems:'center'}}>
   <select value={system} onChange={e=>setSystem(e.target.value)} aria-label="Система"><option value="">Все системы</option>{systems.map(x=><option key={x.id} value={x.id}>{x.name}</option>)}</select>
   <select value={vrf} onChange={e=>setVrf(e.target.value)} aria-label="VRF"><option value="">Все VRF</option>{segments.filter(s=>s.kind==='vrf').map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select>
   <select value={vlan} onChange={e=>setVlan(e.target.value)} aria-label="VLAN"><option value="">Все VLAN</option>{segments.filter(s=>s.kind==='vlan').map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select>
   <select value={environment} onChange={e=>setEnvironment(e.target.value)} aria-label="Контур"><option value="">Все контуры</option>{environments.map(x=><option key={x} value={x}>{x}</option>)}</select>
   <select value={mode} onChange={e=>setMode(e.target.value as 'all'|'internal'|'external')} aria-label="Тип связей"><option value="all">Все связи</option><option value="internal">Только внутренние</option><option value="external">Только внешние</option></select>
   <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Поиск ВМ или системы" aria-label="Поиск компонента" style={{minWidth:180}}/>
   <button onClick={()=>{setSystem('');setVrf('');setVlan('');setEnvironment('');setMode('all');setSearch('');setSelected('');setFlowId('')}}>Сбросить</button>
  </div>
  <small>Найдено компонентов: {matching.length} · Показано объектов: {displayed.length} · VRF/VLAN-групп: {groups.size} · Потоков: {visibleFlows.length} · Без сетевых интерфейсов: {matching.filter(i=>!(nicsByItem.get(i.id)||[]).length).length}</small>
  <div style={{flex:1,minHeight:300,position:'relative',border:'1px solid #d5e0ef',borderRadius:12,overflow:'hidden'}}>
   {displayed.length?<ReactFlow nodes={nodes} edges={edges} nodesDraggable={false} nodesConnectable={false} fitView fitViewOptions={{padding:0.15}} onNodeClick={(_,n)=>{if(n.id.startsWith('host:')){const id=String((n.data as {item_id?:string}).item_id||'');const found=id||displayed.find(i=>n.id.startsWith('host:'+i.id+':'))?.id||'';setSelected(found);setFlowId('')}}} onEdgeClick={(_,e)=>{setFlowId(e.id);setSelected('')}}><Background/><Controls/></ReactFlow>:<p style={{padding:20}}>Нет компонентов для выбранных фильтров. Проверьте систему, контур и сетевые привязки.</p>}
  </div>
  <small>Зелёная стрелка – подтверждённый поток; оранжевая – не проверен. Отсутствие стрелки не означает отсутствия сетевого доступа. Схема отображает описанные логические связи, не трассировку физического маршрута.</small>
  {(item||flow)&&<aside style={{position:'absolute',right:20,top:145,zIndex:5,background:'#fff',border:'1px solid #c3d1e5',boxShadow:'0 8px 26px #0002',padding:16,borderRadius:12,width:340,maxHeight:'65vh',overflow:'auto'}}>
   <button style={{float:'right'}} onClick={()=>{setSelected('');setFlowId('')}} aria-label="Закрыть">×</button>
   {item&&<><h3>{item.name}</h3><p>Система: {systemById.get(item.system_id)?.name||unknown}</p><p>Контур: {String(item.details.environment||unknown)}</p><h4>Сетевые интерфейсы</h4>{(nicsByItem.get(item.id)||[]).map(n=><p key={n.id}><b>{n.name}</b> · IP: {n.ip_address||unknown}<br/>VRF: {name(n.vrf_id)} · VLAN: {name(n.vlan_id)} · Зона: {name(n.zone_id)}</p>)}{!(nicsByItem.get(item.id)||[]).length&&<p>Сетевые интерфейсы не описаны.</p>}<h4>Потоки</h4>{flows.filter(f=>f.source_id===item.id||f.target_id===item.id).map(f=><button key={f.id} onClick={()=>{setFlowId(f.id);setSelected('')}} style={{display:'block',marginBottom:6,textAlign:'left'}}>{f.source_id===item.id?'→':'←'} {f.name||f.protocol||'Поток'}</button>)}{!flows.some(f=>f.source_id===item.id||f.target_id===item.id)&&<p>Потоки не описаны.</p>}</>}
   {flow&&<><h3>{flow.name||'Поток данных'}</h3><p>{itemById.get(flow.source_id)?.name||unknown} → {itemById.get(flow.target_id)?.name||unknown}</p><p>Данные: {flow.data_description||unknown}</p><p>Протокол: {flow.protocol||unknown}; порт: {flow.port||unknown}</p><p>Защита: {flow.security||unknown}</p><p>Проверка: {flow.verification||unknown}</p><p>Расписание: {flow.schedule||unknown}</p></>}
  </aside>}
 </section>
}
