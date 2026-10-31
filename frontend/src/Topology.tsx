import React, {useMemo, useState} from 'react'
import {ReactFlow,Background,Controls,MarkerType,Position,type Node,type Edge} from '@xyflow/react'

type Item={id:string;system_id:string;kind:string;name:string;details:Record<string,unknown>}
type System={id:string;name:string}
type Segment={id:string;kind:string;name:string;description?:string;verification?:string}
type Nic={id:string;item_id:string;name:string;ip_address:string;vrf_id:string|null;vlan_id:string|null;zone_id:string|null}
type Flow={id:string;source_id:string;target_id:string;name:string;protocol:string;port:string;security:string;data_description:string;verification:string;schedule:string}
type Props={systems:System[];items:Item[];segments:Segment[];interfaces:Nic[];flows:Flow[];saveInterface:(value:Omit<Nic,"id">,id?:string)=>Promise<void>;saveFlow:(value:Omit<Flow,"id">,id?:string)=>Promise<void>;saveSegment:(value:Omit<Segment,"id">,id?:string)=>Promise<void>}
const unknown='Не определено'
const colors={verified:'#15805c',unverified:'#bc8323'}
export default function Topology({systems,items,segments,interfaces,flows,saveInterface,saveFlow,saveSegment}:Props){
 const [showConnections,setShowConnections]=useState(true)
 const [showAllComponents,setShowAllComponents]=useState(true)
 const [focusMode,setFocusMode]=useState<'overview'|'dependencies'>('overview')
 const [flowDirection,setFlowDirection]=useState<'both'|'outgoing'|'incoming'>('both')
 const [editing,setEditing]=useState(false)
 const [segmentDraft,setSegmentDraft]=useState<Omit<Segment,'id'>|null>(null)
 const [segmentEditId,setSegmentEditId]=useState<string|undefined>()
 const [segmentError,setSegmentError]=useState('')
 const [segmentSaving,setSegmentSaving]=useState(false)
 function editSegment(segment?:Segment){setSegmentEditId(segment?.id);setSegmentError('');setSegmentDraft({kind:segment?.kind||'vlan',name:segment?.name||'',description:segment?.description||'',verification:segment?.verification||'draft'})}
 async function submitSegment(e:React.FormEvent){e.preventDefault();if(!segmentDraft)return;setSegmentSaving(true);setSegmentError('');try{await saveSegment({...segmentDraft,name:segmentDraft.name.trim()},segmentEditId);setSegmentDraft(null)}catch(err){setSegmentError(String(err))}finally{setSegmentSaving(false)}}

 const [flowDraft,setFlowDraft]=useState<Omit<Flow,'id'>|null>(null)
 const [flowEditingId,setFlowEditingId]=useState<string|undefined>()
 const [flowError,setFlowError]=useState('')
 const [flowSaving,setFlowSaving]=useState(false)
 function editFlowDraft(f?:Flow,sourceId?:string,targetId?:string){setFlowEditingId(f?.id);setFlowError('');setFlowDraft({source_id:f?.source_id||sourceId||'',target_id:f?.target_id||targetId||'',name:f?.name||(sourceId&&targetId?'Новый поток':''),protocol:f?.protocol||'',port:f?.port||'',security:f?.security||'unknown',data_description:f?.data_description||'',verification:f?.verification||'draft',schedule:f?.schedule||''})}
 async function submitFlow(event:React.FormEvent){event.preventDefault();if(!flowDraft)return;setFlowError('');setFlowSaving(true);try{await saveFlow(flowDraft,flowEditingId);setFlowDraft(null);setFlowEditingId(undefined);setShowConnections(true)}catch(e){setFlowError(String(e))}finally{setFlowSaving(false)}}
 const [nicEditor,setNicEditor]=useState<Nic|null>(null)
 const [nicDraft,setNicDraft]=useState<Omit<Nic,"id">|null>(null)
 const [nicError,setNicError]=useState('')
 const [nicSaving,setNicSaving]=useState(false)
 function editNic(item:Item,nic?:Nic){
   setNicEditor(nic||null)
   setNicDraft({item_id:item.id,name:nic?.name||'eth0',ip_address:nic?.ip_address||'',zone_id:nic?.zone_id||null,vrf_id:nic?.vrf_id||null,vlan_id:nic?.vlan_id||null})
   setNicError('')
 }
 async function submitNic(event:React.FormEvent){
   event.preventDefault()
   if(!nicDraft)return
   if(!nicDraft.name.trim()){setNicError('Укажите имя интерфейса.');return}
   const duplicates=interfaces.filter(n=>n.item_id===nicDraft.item_id&&n.id!==nicEditor?.id&&n.name.trim().toLocaleLowerCase()===nicDraft.name.trim().toLocaleLowerCase())
   if(duplicates.length){setNicError('У компонента уже есть интерфейс с таким именем.');return}
   if(nicDraft.ip_address.trim()&&!/^[0-9a-fA-F:.\/]+$/.test(nicDraft.ip_address.trim())){setNicError('IP-адрес должен быть IPv4 или IPv6, при необходимости с префиксом сети.');return}
   setNicSaving(true);setNicError('')
   try{await saveInterface(nicDraft,nicEditor?.id);setNicDraft(null);setNicEditor(null)}
   catch(e){setNicError(String(e))}
   finally{setNicSaving(false)}
 }

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
 const directedFlows=selected?visibleFlows.filter(f=>flowDirection==='both'||(flowDirection==='outgoing'?f.source_id===selected:f.target_id===selected)):visibleFlows
 const activeFlowId=flowId
 const activeFlow=visibleFlows.find(f=>f.id===activeFlowId)
 const focusedIds=new Set<string>()
 if(!showConnections||focusMode==='dependencies'){
   if(activeFlow){focusedIds.add(activeFlow.source_id);focusedIds.add(activeFlow.target_id)}
   else if(selected){focusedIds.add(selected);for(const f of directedFlows)if(f.source_id===selected||f.target_id===selected){focusedIds.add(f.source_id);focusedIds.add(f.target_id)}}
 }
 const peerIds=new Set<string>()
 visibleFlows.forEach(f=>{if(!matchingIds.has(f.source_id))peerIds.add(f.source_id);if(!matchingIds.has(f.target_id))peerIds.add(f.target_id)})
 const candidateItems=[...matching,...Array.from(peerIds).map(id=>itemById.get(id)).filter((i):i is Item=>Boolean(i))]
 const displayed=candidateItems.filter(i=>(showAllComponents||visibleFlows.some(f=>f.source_id===i.id||f.target_id===i.id))&&(!focusedIds.size||focusedIds.has(i.id)))
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
   const groupWidth=Math.min(900,24+Math.min(3,group.items.length)*294)
   const groupId='group:'+key
   const groupNics=group.items.flatMap(i=>(nicsByItem.get(i.id)||[]).filter(n=>key==='external'||(n.vrf_id||'none')+'|'+(n.vlan_id||'none')===key))
   const zoneNames=Array.from(new Set(groupNics.map(n=>name(n.zone_id))))
   const ipCount=groupNics.filter(n=>n.ip_address).length
   const isExternal=key==='external'
   nodes.push({id:groupId,position:{x:0,y:offsetY},data:{label:<div style={{textAlign:'left'}}><strong>{isExternal?'Внешние зависимости':!group.vrf&&!group.vlan?'Сеть не указана – требуется уточнить VRF/VLAN':'VRF: '+name(group.vrf)+' · VLAN: '+name(group.vlan)}</strong><div style={{fontSize:12,marginTop:5,color:'#60728b'}}>{group.items.length} компонентов · {groupNics.length} интерфейсов · {ipCount} IP{isExternal?' · вне выбранного фильтра':''}{zoneNames.length?' · Зоны: '+zoneNames.join(', '):''}</div></div>},style:{width:groupWidth,height,background:isExternal?'#fff4df':!group.vrf&&!group.vlan?'#f4f6f9':'#eaf1fb',border:'1px solid '+(isExternal?'#d6b67b':'#a8bdd6'),borderRadius:14},draggable:false,selectable:false})
   group.items.forEach((item,j)=>{
     const duplicate=(memberships.get(item.id)||[]).indexOf(key)
     nodes.push({id:'host:'+item.id+':'+key,parentId:groupId,extent:'parent',position:{x:16+(j%3)*294,y:74+Math.floor(j/3)*132},sourcePosition:Position.Right,targetPosition:Position.Left,data:{label:<div style={{textAlign:'left',display:'grid',gap:4}}><strong>{item.name}</strong><small>{systemById.get(item.system_id)?.name||'Система неизвестна'}</small><small>{item.kind} · {String(item.details.environment||'Контур не указан')}{isExternal?' · внешняя':''}</small>{(nicsByItem.get(item.id)||[]).filter(n=>(n.vrf_id||'none')+'|'+(n.vlan_id||'none')===key).map(n=><small key={n.id}>{n.name}: {n.ip_address||'IP не указан'} · {name(n.zone_id)}</small>)}{(memberships.get(item.id)||[]).length>1&&<small>Сетей: {memberships.get(item.id)?.length}</small>}</div>},style:{width:272,minHeight:100,background:isExternal?'#fffcf5':'white',border:'1px solid '+(duplicate>0?'#669acb':'#adbed3'),borderRadius:9,cursor:'pointer'},draggable:false})
   })
   offsetY+=height+50
 }
 // Resolve arrows to the correct visual copy of multi-homed components.
 const hostNode=(id:string)=>'host:'+id+':'+(memberships.get(id)||[])[0]
 for(const flow of (showConnections&&focusMode==='overview'?visibleFlows:directedFlows.filter(f=>f.id===activeFlowId||f.source_id===selected||f.target_id===selected))){
   if(!memberships.has(flow.source_id)||!memberships.has(flow.target_id))continue
   const known=flow.verification==='verified'
   edges.push({id:flow.id,source:hostNode(flow.source_id),target:hostNode(flow.target_id),type:'smoothstep',label:[flow.protocol,flow.port].filter(Boolean).join(' : ')||flow.name,markerEnd:{type:MarkerType.ArrowClosed,color:known?colors.verified:colors.unverified},animated:false,style:{stroke:known?colors.verified:colors.unverified,strokeWidth:2},labelStyle:{fontSize:11,fill:'#35465b'},labelBgPadding:[6,3],labelBgBorderRadius:4,labelBgStyle:{fill:'#ffffff',fillOpacity:0.94}})
 }
 const item=itemById.get(selected),flow=flows.find(f=>f.id===flowId)
 return <section style={{padding:14,height:'calc(100vh - 150px)',display:'flex',flexDirection:'column',gap:10,minHeight:510,position:'relative'}}>
  <div><h2 style={{margin:'0 0 4px'}}>Топология сетей и потоков · 0.6</h2><p style={{margin:0,fontSize:13,color:'#546a82'}}>Сетевые группы показывают VRF, VLAN, зоны, интерфейсы и IP. Стрелка означает направление потока; зелёная связь подтверждена, жёлтая требует проверки.</p></div>
  <div style={{display:'flex',gap:8,flexWrap:'wrap',alignItems:'center'}}><button type="button" className={editing?'primary':''} onClick={()=>setEditing(!editing)}>{editing?'Завершить редактирование':'Редактировать топологию'}</button>{editing&&<><button type="button" onClick={()=>editFlowDraft()}>+ Создать поток</button><button type="button" onClick={()=>editSegment()}>+ Создать сеть</button><span style={{fontSize:12,color:'#546a82'}}>Соедините узлы стрелкой или создайте поток через форму. Выберите линию для изменения параметров.</span></>}
   <select value={system} onChange={e=>setSystem(e.target.value)} aria-label="Система"><option value="">Все системы</option>{systems.map(x=><option key={x.id} value={x.id}>{x.name}</option>)}</select>
   <select value={vrf} onChange={e=>setVrf(e.target.value)} aria-label="VRF"><option value="">Все VRF</option>{segments.filter(s=>s.kind==='vrf').map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select>
   <select value={vlan} onChange={e=>setVlan(e.target.value)} aria-label="VLAN"><option value="">Все VLAN</option>{segments.filter(s=>s.kind==='vlan').map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select>
   <select value={environment} onChange={e=>setEnvironment(e.target.value)} aria-label="Контур"><option value="">Все контуры</option>{environments.map(x=><option key={x} value={x}>{x}</option>)}</select>
   <select value={mode} onChange={e=>setMode(e.target.value as 'all'|'internal'|'external')} aria-label="Тип связей"><option value="all">Все связи</option><option value="internal">Только внутренние</option><option value="external">Только внешние</option></select>
   <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Поиск ВМ или системы" aria-label="Поиск компонента" style={{minWidth:180}}/>
   <label className="topologyConnectionToggle"><input type="checkbox" checked={showConnections} onChange={e=>setShowConnections(e.target.checked)}/> Все потоки</label><button onClick={()=>{setSystem('');setVrf('');setVlan('');setEnvironment('');setMode('all');setSearch('');setSelected('');setFlowId('');setShowConnections(true);setShowAllComponents(true);setFocusMode('overview');setFlowDirection('both')}}>Сбросить</button>
  </div>
  {editing&&<div style={{display:"flex",gap:8,flexWrap:"wrap"}}>{segments.map(s=><button key={s.id} type="button" onClick={()=>editSegment(s)}>Изменить {s.kind.toUpperCase()}: {s.name}</button>)}</div>}
  <div className="topologyGuide" aria-label="Навигатор потоков"><label>Режим просмотра<select aria-label="Режим просмотра топологии" value={focusMode} onChange={e=>setFocusMode(e.target.value as 'overview'|'dependencies')}><option value="overview">Обзор всей сети</option><option value="dependencies">Только связанные с выбранным</option></select></label>
    <div><strong>Выберите компонент или поток данных</strong><p>По умолчанию показаны все компоненты. Выберите узел для просмотра его зависимостей или поток для просмотра направления и параметров.</p></div>
    <label>Направление<select aria-label="Направление потоков" value={flowDirection} onChange={e=>setFlowDirection(e.target.value as 'both'|'outgoing'|'incoming')}><option value="both">Входящие и исходящие</option><option value="outgoing">Только исходящие</option><option value="incoming">Только входящие</option></select></label>
    <label>Поток данных<select aria-label="Выбрать поток на схеме" value={activeFlowId} onChange={e=>{setFlowId(e.target.value);setSelected('');setShowConnections(false);setFocusMode('dependencies')}}><option value="">Нет выбранного потока</option>{visibleFlows.map(f=><option key={f.id} value={f.id}>{itemById.get(f.source_id)?.name||'?'} → {itemById.get(f.target_id)?.name||'?'} · {f.name}</option>)}</select></label>
    <label className="topologyConnectionToggle"><input type="checkbox" checked={showAllComponents} onChange={e=>setShowAllComponents(e.target.checked)}/> Показать компоненты без потоков</label>
    <small>Без известных потоков: {matching.filter(i=>!visibleFlows.some(f=>f.source_id===i.id||f.target_id===i.id)).length}. Отсутствие потока в реестре не доказывает отсутствие зависимости.</small>
  </div>
  <small>Найдено компонентов: {matching.length} · Показано объектов: {displayed.length} · VRF/VLAN-групп: {groups.size} · Потоков: {visibleFlows.length} · На схеме: {showConnections?'все потоки':selected||flowId?'выбранные связи':'обзор компонентов'} · Без сетевых интерфейсов: {matching.filter(i=>!(nicsByItem.get(i.id)||[]).length).length}</small>
  <div style={{flex:1,minHeight:300,position:'relative',border:'1px solid #d5e0ef',borderRadius:12,overflow:'hidden'}}>
   {displayed.length?<ReactFlow nodes={nodes} edges={edges} nodesDraggable={false} nodesConnectable={editing} onConnect={connection=>{if(!editing)return;const source=connection.source?.split(':')[1],target=connection.target?.split(':')[1];if(source&&target&&source!==target)editFlowDraft(undefined,source,target)}} fitView fitViewOptions={{padding:0.15}} onNodeClick={(_,n)=>{if(n.id.startsWith('host:')){const id=String((n.data as {item_id?:string}).item_id||'');const found=id||displayed.find(i=>n.id.startsWith('host:'+i.id+':'))?.id||'';setSelected(found);setFlowId('');setFocusMode('dependencies')}}} onEdgeClick={(_,e)=>{setFlowId(e.id);setSelected('');setShowConnections(false);setFocusMode('dependencies')}}><Background/><Controls/></ReactFlow>:<p style={{padding:20}}>Нет компонентов для выбранных фильтров. Проверьте систему, контур и сетевые привязки.</p>}
  </div>
  <small>Нажмите на компонент, чтобы увидеть его потоки. Переключатель «Все потоки» показывает общую картину. Зелёная стрелка – подтверждённый поток; оранжевая – не проверен. Отсутствие стрелки не означает отсутствия сетевого доступа. Схема отображает описанные логические связи, не трассировку физического маршрута.</small>
  {(item||flow)&&<aside style={{position:'absolute',right:20,top:145,zIndex:5,background:'#fff',border:'1px solid #c3d1e5',boxShadow:'0 8px 26px #0002',padding:16,borderRadius:12,width:340,maxHeight:'65vh',overflow:'auto'}}>
   <button style={{float:'right'}} onClick={()=>{setSelected('');setFlowId('')}} aria-label="Закрыть">×</button>
   {item&&<><h3>{item.name}</h3><p>Система: {systemById.get(item.system_id)?.name||unknown}</p><p>Контур: {String(item.details.environment||unknown)}</p><h4>Сетевые интерфейсы</h4>{editing?<button type="button" onClick={()=>editNic(item)}>+ Добавить интерфейс</button>:<p style={{fontSize:12,color:'#65758a'}}>Для изменения сетевых привязок включите режим «Редактировать топологию».</p>}{(nicsByItem.get(item.id)||[]).map(n=><p key={n.id}>{editing&&<button type="button" onClick={()=>editNic(item,n)} aria-label={"Редактировать "+n.name}>Изменить сеть</button>} <b>{n.name}</b> · IP: {n.ip_address||unknown}<br/>VRF: {name(n.vrf_id)} · VLAN: {name(n.vlan_id)} · Зона: {name(n.zone_id)}</p>)}{!(nicsByItem.get(item.id)||[]).length&&<p>Сетевые интерфейсы не описаны.</p>}<h4>Связи и влияние</h4>
   <p style={{fontSize:12,color:'#65758a'}}>Потоки описывают известные логические зависимости; фактическое влияние отказа требует подтверждения.</p>
   <div className="topologyImpactStats">
    <span>Исходящие: <b>{flows.filter(f=>f.source_id===item.id).length}</b></span>
    <span>Входящие: <b>{flows.filter(f=>f.target_id===item.id).length}</b></span>
    <span>Интерфейсы: <b>{(nicsByItem.get(item.id)||[]).length}</b></span>
   </div>
   <h4>Связанные компоненты</h4>
   {flows.filter(f=>f.source_id===item.id||f.target_id===item.id).map(f=>{
     const outgoing=f.source_id===item.id
     const peer=itemById.get(outgoing?f.target_id:f.source_id)
     return <button key={f.id} className="topologyDependency" onClick={()=>{setSelected(peer?.id||'');setFlowId('')}} title={f.name}>
      <span>{outgoing?'→':'←'} {peer?.name||'Неизвестный компонент'}</span>
      <small>{systemById.get(peer?.system_id||'')?.name||'Система не указана'} · {f.protocol||'Протокол не задан'} {f.port||''}</small>
     </button>
   })}
   <h4>Потоки</h4>{editing&&<button type="button" onClick={()=>editFlowDraft(undefined,item.id,'')}>+ Исходящий поток</button>}{flows.filter(f=>f.source_id===item.id||f.target_id===item.id).map(f=><button key={f.id} onClick={()=>{setFlowId(f.id);setSelected('');setFocusMode('dependencies')}} style={{display:'block',marginBottom:6,textAlign:'left'}}>{f.source_id===item.id?'→':'←'} {f.name||f.protocol||'Поток'}</button>)}{!flows.some(f=>f.source_id===item.id||f.target_id===item.id)&&<p>Потоки не описаны.</p>}</>}
   {flow&&<><h3>{flow.name||'Поток данных'}</h3><p>{itemById.get(flow.source_id)?.name||unknown} → {itemById.get(flow.target_id)?.name||unknown}</p><p>Данные: {flow.data_description||unknown}</p><p>Протокол: {flow.protocol||unknown}; порт: {flow.port||unknown}</p><p>Защита: {flow.security||unknown}</p><p>Проверка: {flow.verification||unknown}</p><p>Расписание: {flow.schedule||unknown}</p>{editing&&<button type="button" onClick={()=>editFlowDraft(flow)}>Редактировать поток</button>}</>}
  </aside>}
  {segmentDraft&&<div className="topologyNicBackdrop" onClick={()=>setSegmentDraft(null)}><div className="topologyNicDialog" role="dialog" aria-modal="true" aria-label="Редактор сети" onClick={e=>e.stopPropagation()}><div className="registryHeader"><h3>{segmentEditId?'Изменить сеть':'Создать сеть'}</h3><button type="button" onClick={()=>setSegmentDraft(null)}>Закрыть ×</button></div><form className="detailForm" onSubmit={submitSegment}><label>Тип<select value={segmentDraft.kind} onChange={e=>setSegmentDraft({...segmentDraft,kind:e.target.value})}>{['vrf','vlan','zone'].map(k=><option key={k} value={k}>{k.toUpperCase()}</option>)}</select></label><label>Название<input required value={segmentDraft.name} onChange={e=>setSegmentDraft({...segmentDraft,name:e.target.value})}/></label><label>Описание<input value={segmentDraft.description} onChange={e=>setSegmentDraft({...segmentDraft,description:e.target.value})}/></label><label>Статус<select value={segmentDraft.verification} onChange={e=>setSegmentDraft({...segmentDraft,verification:e.target.value})}><option value="draft">Черновик</option><option value="verified">Подтверждено</option></select></label>{segmentError&&<p role="alert">{segmentError}</p>}<button className="primary" disabled={segmentSaving}>{segmentSaving?'Сохранение…':'Сохранить сеть'}</button></form></div></div>}
  {flowDraft&&<div className="topologyNicBackdrop" onClick={()=>setFlowDraft(null)}><div className="topologyNicDialog" role="dialog" aria-modal="true" aria-label="Редактор потока данных" onClick={e=>e.stopPropagation()}><div className="registryHeader"><h3>{flowEditingId?'Редактировать поток':'Создать поток'}</h3><button type="button" onClick={()=>setFlowDraft(null)}>Закрыть ×</button></div><form className="detailForm" onSubmit={submitFlow}><label>Источник<select required value={flowDraft.source_id} onChange={e=>setFlowDraft({...flowDraft,source_id:e.target.value})}><option value="">Выберите источник</option>{items.map(i=><option key={i.id} value={i.id}>{i.name}</option>)}</select></label><label>Получатель<select required value={flowDraft.target_id} onChange={e=>setFlowDraft({...flowDraft,target_id:e.target.value})}><option value="">Выберите получателя</option>{items.map(i=><option key={i.id} value={i.id}>{i.name}</option>)}</select></label><label>Название<input required maxLength={250} value={flowDraft.name} onChange={e=>setFlowDraft({...flowDraft,name:e.target.value})}/></label><label>Описание данных<input value={flowDraft.data_description} onChange={e=>setFlowDraft({...flowDraft,data_description:e.target.value})}/></label><label>Протокол<input value={flowDraft.protocol} onChange={e=>setFlowDraft({...flowDraft,protocol:e.target.value})}/></label><label>Порт<input value={flowDraft.port} onChange={e=>setFlowDraft({...flowDraft,port:e.target.value})}/></label><label>Защита<select value={flowDraft.security} onChange={e=>setFlowDraft({...flowDraft,security:e.target.value})}>{['unknown','TLS','mTLS','VPN','private_connector','none'].map(x=><option key={x} value={x}>{x}</option>)}</select></label><label>Проверка<select value={flowDraft.verification} onChange={e=>setFlowDraft({...flowDraft,verification:e.target.value})}><option value="draft">Черновик</option><option value="verified">Подтверждено</option></select></label><label>Периодичность<input value={flowDraft.schedule} onChange={e=>setFlowDraft({...flowDraft,schedule:e.target.value})}/></label>{flowDraft.source_id&&flowDraft.source_id===flowDraft.target_id&&<p role="alert">Источник и получатель должны отличаться.</p>}{flowError&&<p role="alert">{flowError}</p>}<button className="primary" disabled={flowSaving||!flowDraft.source_id||flowDraft.source_id===flowDraft.target_id}>{flowSaving?'Сохранение…':'Сохранить поток'}</button></form></div></div>}
  {nicDraft&&<div className="topologyNicBackdrop" onClick={()=>setNicDraft(null)}>
   <div className="topologyNicDialog" role="dialog" aria-modal="true" aria-label="Настройка сети компонента" onClick={e=>e.stopPropagation()}>
    <div className="registryHeader"><h3>{nicEditor?'Редактировать сетевой интерфейс':'Новый сетевой интерфейс'}</h3><button type="button" onClick={()=>setNicDraft(null)}>Закрыть ×</button></div>
    <p className="hint">Привязки зоны, VRF и VLAN выбираются из сетевого реестра. Сохранение изменяет сетевую принадлежность только этого интерфейса, а не всей системы.</p>{nicEditor&&<p className="hint">Текущая сеть: VRF {name(nicEditor.vrf_id)} · VLAN {name(nicEditor.vlan_id)} · зона {name(nicEditor.zone_id)}. После сохранения компонент появится в новой сетевой группе.</p>}
    <form onSubmit={submitNic} className="detailForm">
     <label>Имя интерфейса<input required maxLength={100} value={nicDraft.name} onChange={e=>setNicDraft({...nicDraft,name:e.target.value})}/></label>
     <label>IP-адрес<input value={nicDraft.ip_address} maxLength={120} placeholder="Не указан" onChange={e=>setNicDraft({...nicDraft,ip_address:e.target.value})}/></label>
     {(['zone','vrf','vlan'] as const).map(kind=>{
      const field=kind+'_id' as 'zone_id'|'vrf_id'|'vlan_id'
      return <label key={kind}>{kind.toUpperCase()}<select value={nicDraft[field]||''} onChange={e=>setNicDraft({...nicDraft,[field]:e.target.value||null})}>
       <option value="">Не определено</option>{segments.filter(s=>s.kind===kind).map(s=><option key={s.id} value={s.id}>{s.name}</option>)}
      </select></label>
     })}
     {nicError&&<p className="kisError" role="alert">{nicError}</p>}
     <button className="primary" disabled={nicSaving}>{nicSaving?'Сохранение…':'Сохранить сеть компонента'}</button>
    </form>
   </div>
  </div>}
 </section>
}
