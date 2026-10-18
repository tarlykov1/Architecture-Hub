import React,{useState} from 'react'
import {ReactFlow,Background,Controls,MarkerType,type Node,type Edge} from '@xyflow/react'
type Item={id:string;system_id:string;kind:string;name:string;details:Record<string,unknown>}
type System={id:string;name:string}
type Segment={id:string;kind:string;name:string}
type Nic={id:string;item_id:string;name:string;ip_address:string;vrf_id:string|null;vlan_id:string|null;zone_id:string|null}
type Flow={id:string;source_id:string;target_id:string;name:string;protocol:string;port:string;security:string;data_description:string;verification:string;schedule:string}
export default function Topology({systems,items,segments,interfaces,flows}:{systems:System[];items:Item[];segments:Segment[];interfaces:Nic[];flows:Flow[]}){
 const [system,setSystem]=useState(''),[vrf,setVrf]=useState(''),[vlan,setVlan]=useState(''),[selected,setSelected]=useState(''),[flowId,setFlowId]=useState('')
 const name=(id:string|null)=>segments.find(s=>s.id===id)?.name||'Не определено'
 const visible=items.filter(i=>(!system||i.system_id===system)&&(!vrf||interfaces.some(n=>n.item_id===i.id&&n.vrf_id===vrf))&&(!vlan||interfaces.some(n=>n.item_id===i.id&&n.vlan_id===vlan)))
 const groups=new Map<string,Item[]>()
 for(const i of visible){const n=interfaces.find(n=>n.item_id===i.id);const key=(n?.vrf_id||'none')+'|'+(n?.vlan_id||'none');groups.set(key,[...(groups.get(key)||[]),i])}
 const nodes:Node[]=[],edges:Edge[]=[]
 let index=0
 for(const [key,group] of groups){const parts=key.split('|'),id='group:'+key,col=index%3,row=Math.floor(index/3);index++
   nodes.push({id,position:{x:col*420,y:row*460},data:{label:<div><b>VRF: {name(parts[0])}</b><p>VLAN: {name(parts[1])} · ВМ/сервисы: {group.length}</p></div>},style:{width:390,height:100+Math.ceil(group.length/2)*125,background:'#eaf1fa',border:'1px solid #9caec5',borderRadius:12},draggable:false,selectable:false})
   group.forEach((i,j)=>nodes.push({id:i.id,parentId:id,extent:'parent',position:{x:12+j%2*190,y:75+Math.floor(j/2)*125},data:{label:<div style={{display:'grid',gap:4,textAlign:'left'}}><b>{i.name}</b><small>{systems.find(s=>s.id===i.system_id)?.name}</small><small>{i.kind} · {String(i.details.environment||'Контур неизвестен')}</small></div>},style:{width:180,background:'#fff',border:'1px solid #b2c2d3',borderRadius:8},draggable:false}))
 }
 const ids=new Set(visible.map(i=>i.id))
 for(const f of flows.filter(f=>ids.has(f.source_id)&&ids.has(f.target_id)))edges.push({id:f.id,source:f.source_id,target:f.target_id,type:'smoothstep',label:f.protocol+':'+f.port,markerEnd:{type:MarkerType.ArrowClosed},style:{stroke:f.verification==='verified'?'#21875b':'#c58a30',strokeWidth:2}})
 const item=items.find(i=>i.id===selected),flow=flows.find(f=>f.id===flowId)
 return <section style={{padding:14,height:'calc(100vh - 160px)',display:'flex',flexDirection:'column',gap:10,minHeight:440}}>
  <h2 style={{margin:0}}>Топология сетей и потоков</h2><p style={{margin:0,fontSize:13,color:'#546a82'}}>Группировка по первому сетевому интерфейсу. У ВМ может быть несколько интерфейсов, они перечислены в карточке. Неподтверждённые данные не считаются реальной топологией.</p>
  <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
   <select value={system} onChange={e=>setSystem(e.target.value)} aria-label="Система"><option value="">Все системы</option>{systems.map(x=><option key={x.id} value={x.id}>{x.name}</option>)}</select>
   <select value={vrf} onChange={e=>setVrf(e.target.value)} aria-label="VRF"><option value="">Все VRF</option>{segments.filter(s=>s.kind==='vrf').map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select>
   <select value={vlan} onChange={e=>setVlan(e.target.value)} aria-label="VLAN"><option value="">Все VLAN</option>{segments.filter(s=>s.kind==='vlan').map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select>
   <button onClick={()=>{setSystem('');setVrf('');setVlan('')}}>Сбросить</button>
  </div><small>Компонентов: {visible.length} · Групп VRF/VLAN: {groups.size} · Потоков: {edges.length}</small>
  <div style={{flex:1,minHeight:250,position:'relative',border:'1px solid #d5e0ef',borderRadius:12}}>
   {visible.length?<ReactFlow nodes={nodes} edges={edges} nodesDraggable={false} nodesConnectable={false} fitView onNodeClick={(_,n)=>{if(!n.id.startsWith('group:')){setSelected(n.id);setFlowId('')}}} onEdgeClick={(_,e)=>{setFlowId(e.id);setSelected('')}}><Background/><Controls/></ReactFlow>:<p style={{padding:20}}>Нет компонентов для выбранных фильтров.</p>}
  </div><small>Зелёные стрелки – подтверждённые потоки; оранжевые – непроверенные. Отсутствие стрелки не доказывает отсутствия сетевого доступа.</small>
  {(item||flow)&&<aside style={{position:'absolute',right:24,top:205,zIndex:5,background:'#fff',border:'1px solid #c3d1e5',boxShadow:'0 8px 26px #0002',padding:16,borderRadius:12,width:310,maxHeight:'60vh',overflow:'auto'}}>
  <button style={{float:'right'}} onClick={()=>{setSelected('');setFlowId('')}}>×</button>
  {item?<><h3>{item.name}</h3><p>{systems.find(s=>s.id===item.system_id)?.name}</p><p>Контур: {String(item.details.environment||'Не указан')}</p><h4>Интерфейсы</h4>{interfaces.filter(n=>n.item_id===item.id).map(n=><p key={n.id}><b>{n.name}</b> · IP: {n.ip_address||'Не указан'}<br/>VRF: {name(n.vrf_id)} · VLAN: {name(n.vlan_id)} · Зона: {name(n.zone_id)}</p>)}{!interfaces.some(n=>n.item_id===item.id)&&<p>Сетевые интерфейсы не описаны.</p>}</>:null}
  {flow?<><h3>{flow.name}</h3><p>{items.find(i=>i.id===flow.source_id)?.name} → {items.find(i=>i.id===flow.target_id)?.name}</p><p>Данные: {flow.data_description||'Не указаны'}</p><p>Протокол: {flow.protocol}, порт: {flow.port}</p><p>Защита: {flow.security}; проверка: {flow.verification}</p><p>Расписание: {flow.schedule||'Не задано'}</p></>:null}
  </aside>}
 </section>
}
