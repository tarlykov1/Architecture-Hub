import React, {useEffect, useMemo, useRef, useState} from 'react'
import {AutoFit,Disclosure} from './WorkspaceUI'
import {DiagramNodeLabel,diagramCardStyle} from './DiagramVisual'
import {ReactFlow,Background,Controls,MarkerType,Position,useReactFlow,type Node,type Edge} from '@xyflow/react'

type Item={id:string;system_id:string;kind:string;name:string;description?:string;parent_id?:string|null;details:Record<string,unknown>}
type System={id:string;name:string}
type Segment={id:string;kind:string;name:string;description?:string;verification?:string}
type Nic={id:string;item_id:string;name:string;ip_address:string;vrf_id:string|null;vlan_id:string|null;zone_id:string|null}
type Flow={id:string;source_id:string;target_id:string;name:string;protocol:string;port:string;security:string;data_description:string;verification:string;schedule:string}
type Props={systems:System[];items:Item[];segments:Segment[];interfaces:Nic[];flows:Flow[];saveInterface:(value:Omit<Nic,"id">,id?:string)=>Promise<void>;saveFlow:(value:Omit<Flow,"id">,id?:string)=>Promise<void>;saveSegment:(value:Omit<Segment,"id">,id?:string)=>Promise<void>}
const unknown='Не определено'
const colors={verified:'#15805c',unverified:'#bc8323'}
/** Fit declared parent group rectangles instead of relying on nested node measurements.
 * Child node positions are relative to parentId and must not be fitted twice.
 */
function TopologyGroupFit({groups}:{groups:Node[]}){
 const anchor=useRef<HTMLSpanElement>(null)
 const {setViewport}=useReactFlow()
 const layoutKey=groups.map(n=>[n.id,n.position.x,n.position.y,n.style?.width,n.style?.height].join(':')).join('|')
 useEffect(()=>{
  const canvas=anchor.current?.closest<HTMLElement>('.react-flow')
  if(!canvas||!groups.length)return
  let frame=0
  const fit=()=>{
   cancelAnimationFrame(frame)
   frame=requestAnimationFrame(()=>{
    const width=canvas.clientWidth,height=canvas.clientHeight
    if(width<100||height<100)return
    const minX=Math.min(...groups.map(n=>n.position.x))
    const minY=Math.min(...groups.map(n=>n.position.y))
    const maxX=Math.max(...groups.map(n=>n.position.x+(Number(n.style?.width)||272)))
    const maxY=Math.max(...groups.map(n=>n.position.y+(Number(n.style?.height)||160)))
    const graphWidth=Math.max(1,maxX-minX),graphHeight=Math.max(1,maxY-minY)
    const margin=28
    // Fit the *whole* network map on initial load and after resize. Large
    // topologies can then be enlarged with the standard canvas zoom controls.
    // Never crop groups just to enforce an arbitrary minimum initial scale.
    const zoom=Math.max(0.02,Math.min(1,(width-margin*2)/graphWidth,(height-margin*2)/graphHeight))
    void setViewport({x:(width-graphWidth*zoom)/2-minX*zoom,y:(height-graphHeight*zoom)/2-minY*zoom,zoom},{duration:0})
   })
  }
  const observer=new ResizeObserver(fit)
  observer.observe(canvas)
  fit()
  return()=>{observer.disconnect();cancelAnimationFrame(frame)}
 },[setViewport,layoutKey])
 return <span ref={anchor} hidden/>
}

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
 async function submitFlow(event:React.FormEvent){event.preventDefault();if(!flowDraft)return;if(!flowDraft.source_id||!flowDraft.target_id||flowDraft.source_id===flowDraft.target_id){setFlowError('Выберите два разных компонента.');return}if(!flowDraft.name.trim()){setFlowError('Укажите название потока.');return}setFlowError('');setFlowSaving(true);try{await saveFlow({...flowDraft,name:flowDraft.name.trim()},flowEditingId);setFlowDraft(null);setFlowEditingId(undefined);setShowConnections(true)}catch(e){setFlowError(String(e))}finally{setFlowSaving(false)}}
 const [nicEditor,setNicEditor]=useState<Nic|null>(null)
 const [nicDraft,setNicDraft]=useState<Omit<Nic,"id">|null>(null)
 const [nicError,setNicError]=useState('')
 const [nicSaving,setNicSaving]=useState(false)
 const [nicConfirm,setNicConfirm]=useState(false)
 function editNic(item:Item,nic?:Nic){
   setNicEditor(nic||null)
   setNicDraft({item_id:item.id,name:nic?.name||'eth0',ip_address:nic?.ip_address||'',zone_id:nic?.zone_id||null,vrf_id:nic?.vrf_id||null,vlan_id:nic?.vlan_id||null})
   setNicError('')
   setNicConfirm(false)
 }
 async function submitNic(event:React.FormEvent){
   event.preventDefault()
   if(!nicDraft)return
   if(!nicDraft.name.trim()){setNicError('Укажите имя интерфейса.');return}
   const duplicates=interfaces.filter(n=>n.item_id===nicDraft.item_id&&n.id!==nicEditor?.id&&n.name.trim().toLocaleLowerCase()===nicDraft.name.trim().toLocaleLowerCase())
   if(duplicates.length){setNicError('У компонента уже есть интерфейс с таким именем.');return}
   if(nicDraft.ip_address.trim()&&!/^[0-9a-fA-F:.\/]+$/.test(nicDraft.ip_address.trim())){setNicError('IP-адрес должен быть IPv4 или IPv6, при необходимости с префиксом сети.');return}
   if(nicEditor&&!nicConfirm){setNicConfirm(true);return}
   setNicSaving(true);setNicError('')
   try{await saveInterface(nicDraft,nicEditor?.id);setNicDraft(null);setNicEditor(null)}
   catch(e){setNicError(String(e))}
   finally{setNicSaving(false)}
 }

 const [inspectorTab,setInspectorTab]=useState<'overview'|'network'|'connections'>('overview')
  const [system,setSystem]=useState(''),[vrf,setVrf]=useState(''),[vlan,setVlan]=useState(''),[environment,setEnvironment]=useState(''),[search,setSearch]=useState(''),[mode,setMode]=useState<'all'|'internal'|'external'>('all'),[selected,setSelected]=useState(''),[flowId,setFlowId]=useState('')
 const [inspectorTrail,setInspectorTrail]=useState<Array<{item:string;flow:string}>>([])
 const inspectorRef=useRef({item:'',flow:''})
 inspectorRef.current={item:selected,flow:flowId}
 function openInspector(itemId:string,flowIdNext=''){
   const current=inspectorRef.current
   if(current.item===itemId&&current.flow===flowIdNext)return
   if(current.item||current.flow)setInspectorTrail(trail=>[...trail,current])
   setSelected(itemId);setFlowId(flowIdNext);setInspectorTab('overview')
   if(itemId||flowIdNext)setFocusMode('dependencies')
   const url=new URL(window.location.href)
   if(itemId)url.searchParams.set('component',itemId);else url.searchParams.delete('component')
   if(flowIdNext)url.searchParams.set('flow',flowIdNext);else url.searchParams.delete('flow')
   window.history.pushState({topologyInspector:true},'',url)
 }
 function closeInspector(){
   if(inspectorTrail.length){window.history.back();return}
   setSelected('');setFlowId('');setFocusMode('overview')
   const url=new URL(window.location.href)
   url.searchParams.delete('component');url.searchParams.delete('flow')
   window.history.replaceState(null,'',url)
 }
 useEffect(()=>{
   const restore=()=>{const url=new URL(window.location.href);const item=url.searchParams.get('component')||'';const flow=url.searchParams.get('flow')||'';setSelected(item);setFlowId(flow);setInspectorTab('overview');setFocusMode(item||flow?'dependencies':'overview');setInspectorTrail(trail=>trail.slice(0,-1))}
   restore()
   window.addEventListener('popstate',restore)
   return()=>window.removeEventListener('popstate',restore)
 },[])
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
  const columnHeights=[0,0]
  // Match Overview/Editor cards; keep group canvases compact.
  const nodeWidth=245,cellWidth=268,rowHeight=190,groupGap=36,groupColumnWidth=596
 // Variable-height rows avoid overlapping network groups with many hosts.
 const entries=Array.from(groups.entries())
 for(let groupIndex=0;groupIndex<entries.length;groupIndex++){
   const [key,group]=entries[groupIndex]
    const insideColumns=Math.min(2,Math.max(1,group.items.length))
    const height=84+Math.ceil(group.items.length/insideColumns)*rowHeight
    const groupWidth=24+insideColumns*cellWidth
    const column=entries.length>1?(columnHeights[0]<=columnHeights[1]?0:1):0
   const groupId='group:'+key
   const groupNics=group.items.flatMap(i=>(nicsByItem.get(i.id)||[]).filter(n=>key==='external'||(n.vrf_id||'none')+'|'+(n.vlan_id||'none')===key))
   const zoneNames=Array.from(new Set(groupNics.map(n=>name(n.zone_id))))
   const ipCount=groupNics.filter(n=>n.ip_address).length
   const isExternal=key==='external'
    nodes.push({id:groupId,position:{x:column*groupColumnWidth,y:columnHeights[column]},
      data:{label:<div className="topologyGroupLabel"><strong>{isExternal?'Внешние зависимости':!group.vrf&&!group.vlan?'Сеть не указана · уточните VRF/VLAN':'VRF: '+name(group.vrf)+' · VLAN: '+name(group.vlan)}</strong>
        <small>{group.items.length} компонентов · {groupNics.length} интерфейсов · {ipCount} IP{zoneNames.length?' · Зоны: '+zoneNames.join(', '):''}</small></div>},
      style:{width:groupWidth,height,background:isExternal?'#fffaf1':!group.vrf&&!group.vlan?'#f8fafc':'#f0f6ff',border:'1px solid '+(isExternal?'#d6b67b':'#b4c8e4'),borderRadius:12,textAlign:'left',padding:12},
      draggable:false,selectable:false})
   group.items.forEach((item,j)=>{
     const duplicate=(memberships.get(item.id)||[]).indexOf(key)
     const visibleNics=(nicsByItem.get(item.id)||[]).filter(n=>key==='external'||(n.vrf_id||'none')+'|'+(n.vlan_id||'none')===key)
      nodes.push({id:'host:'+item.id+':'+key,parentId:groupId,extent:'parent',
        position:{x:16+(j%insideColumns)*cellWidth,y:74+Math.floor(j/insideColumns)*rowHeight},
        sourcePosition:Position.Right,targetPosition:Position.Left,
        data:{item_id:item.id,label:<DiagramNodeLabel name={item.name} kind={item.kind} subtitle={systemById.get(item.system_id)?.name||'Система неизвестна'} detail={item.kind+' · '+String(item.details.environment||'Контур не указан')}>
          <small className="topologyVmPurpose">{item.description?.trim()||String(item.details.purpose||item.details.role||'Назначение не описано')}</small>
          {visibleNics.length>0&&<small title={visibleNics.map(n=>n.name+': '+(n.ip_address||'IP не указан')).join('; ')}>{visibleNics.length} сетевых интерфейсов{visibleNics.some(n=>n.ip_address)?' · IP указан':' · IP не указан'}</small>}
          {(memberships.get(item.id)||[]).length>1&&<small style={{color:'#2563a6'}}>Также в {memberships.get(item.id)!.length-1} сетях</small>}
        </DiagramNodeLabel>},
        style:diagramCardStyle({width:nodeWidth,background:isExternal?'#fffcf5':'white',border:duplicate>0?'2px solid #669acb':'1px solid #94a3b8',cursor:'pointer'}),
        draggable:false})
   })
    columnHeights[column]+=height+groupGap
 }
 // Resolve arrows to the correct visual copy of multi-homed components.
 const hostNode=(id:string,peerId?:string)=>{const own=memberships.get(id)||[];const peer=memberships.get(peerId||'')||[];return 'host:'+id+':'+(own.find(k=>peer.includes(k))||own[0])}
 for(const flow of (showConnections&&focusMode==='overview'?visibleFlows:directedFlows.filter(f=>f.id===activeFlowId||f.source_id===selected||f.target_id===selected))){
   if(!memberships.has(flow.source_id)||!memberships.has(flow.target_id))continue
   const known=flow.verification==='verified'
   edges.push({id:flow.id,source:hostNode(flow.source_id,flow.target_id),target:hostNode(flow.target_id,flow.source_id),type:'smoothstep',label:[flow.protocol,flow.port].filter(Boolean).join(' : ')||flow.name,markerEnd:{type:MarkerType.ArrowClosed,color:known?colors.verified:colors.unverified},animated:false,style:{stroke:known?colors.verified:colors.unverified,strokeWidth:1.3},labelStyle:{fontSize:11,fill:'#35465b'},labelBgPadding:[6,3],labelBgBorderRadius:4,labelBgStyle:{fill:'#ffffff',fillOpacity:0.94}})
 }
 const focusFlows=activeFlow?[activeFlow]:selected?directedFlows.filter(f=>f.source_id===selected||f.target_id===selected):[]
 const focusGraph=focusMode==='dependencies'&&Boolean(selected||activeFlow)
 const focusIds=Array.from(new Set([...(selected?[selected]:[]),...focusFlows.flatMap(f=>[f.source_id,f.target_id])]))
 const incomingIds=focusIds.filter(id=>id!==selected&&focusFlows.some(f=>f.target_id===selected&&f.source_id===id))
 const outgoingIds=focusIds.filter(id=>id!==selected&&focusFlows.some(f=>f.source_id===selected&&f.target_id===id))
 const focusPositions=new Map<string,{x:number;y:number}>()
 if(activeFlow){focusPositions.set(activeFlow.source_id,{x:40,y:90});focusPositions.set(activeFlow.target_id,{x:490,y:90})}
 else if(selected){
  focusPositions.set(selected,{x:300,y:Math.max(80,Math.ceil(Math.max(incomingIds.length,outgoingIds.length,1)/2)*130)})
  incomingIds.forEach((id,i)=>focusPositions.set(id,{x:10,y:40+i*170}))
  outgoingIds.forEach((id,i)=>focusPositions.set(id,{x:610,y:40+i*170}))
 }
  const focusNodes:Node[]=focusIds.filter(id=>itemById.has(id)).map(id=>{
    const value=itemById.get(id)!
    const ips=(nicsByItem.get(id)||[]).map(n=>n.ip_address).filter(Boolean)
    return {id,position:focusPositions.get(id)||{x:300,y:100},sourcePosition:Position.Right,targetPosition:Position.Left,
      data:{label:<DiagramNodeLabel name={value.name} kind={value.kind} subtitle={systemById.get(value.system_id)?.name||'Система не указана'} detail={value.kind+' · '+String(value.details.environment||'Контур не указан')}>
        <small className="topologyVmPurpose">{value.description?.trim()||String(value.details.purpose||value.details.role||'Назначение не описано')}</small>
        <small>{ips.length?ips.join(', '):'IP не указан'}</small>
      </DiagramNodeLabel>},
      style:diagramCardStyle({background:id===selected?'#eff6ff':'#fff',border:id===selected?'2px solid #2563eb':'1px solid #94a3b8'})}
  })
 const focusEdges:Edge[]=focusFlows.map(f=>({id:f.id,source:f.source_id,target:f.target_id,type:'smoothstep',label:f.name,markerEnd:{type:MarkerType.ArrowClosed,color:f.verification==='verified'?colors.verified:colors.unverified},style:{stroke:f.verification==='verified'?colors.verified:colors.unverified,strokeWidth:activeFlow?.id===f.id?2:1.3},labelStyle:{fontSize:12,fontWeight:600},labelBgStyle:{fill:'#fff',fillOpacity:0.96},labelBgPadding:[6,4]}))
 const item=itemById.get(selected),flow=flows.find(f=>f.id===flowId)
 return <section className="topologyWorkspace">
  <div style={{display:'flex',gap:8,flexWrap:'wrap',alignItems:'center'}}><button type="button" className={editing?'primary':''} onClick={()=>{setEditing(!editing);setFlowDraft(null);setSegmentDraft(null);setNicDraft(null)}}>{editing?'Завершить редактирование':'Редактировать топологию'}</button>{editing&&<><button type="button" onClick={()=>editFlowDraft()}>+ Создать поток</button><button type="button" onClick={()=>editSegment()}>+ Создать сеть</button></>}
   <select value={system} onChange={e=>setSystem(e.target.value)} aria-label="Система"><option value="">Все системы</option>{systems.map(x=><option key={x.id} value={x.id}>{x.name}</option>)}</select>
   <Disclosure label="Фильтры топологии"><select value={vrf} onChange={e=>setVrf(e.target.value)} aria-label="VRF"><option value="">Все VRF</option>{segments.filter(s=>s.kind==='vrf').map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select>
   <select value={vlan} onChange={e=>setVlan(e.target.value)} aria-label="VLAN"><option value="">Все VLAN</option>{segments.filter(s=>s.kind==='vlan').map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select>
   <select value={environment} onChange={e=>setEnvironment(e.target.value)} aria-label="Контур"><option value="">Все контуры</option>{environments.map(x=><option key={x} value={x}>{x}</option>)}</select>
   <select value={mode} onChange={e=>setMode(e.target.value as 'all'|'internal'|'external')} aria-label="Тип связей"><option value="all">Все связи</option><option value="internal">Только внутренние</option><option value="external">Только внешние</option></select>
   </Disclosure><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Поиск ВМ или системы" aria-label="Поиск компонента" style={{minWidth:180}}/>
   <label className="topologyConnectionToggle"><input type="checkbox" checked={showConnections} onChange={e=>setShowConnections(e.target.checked)}/> Все потоки</label><button onClick={()=>{setSystem('');setVrf('');setVlan('');setEnvironment('');setMode('all');setSearch('');setSelected('');setFlowId('');setShowConnections(true);setShowAllComponents(true);setFocusMode('overview');setFlowDirection('both')}}>Сбросить</button>
  </div>
  {editing&&<div style={{display:'flex',alignItems:'center',gap:8}}><label htmlFor="topology-segment-editor" className="sr-only">Изменить сеть или зону</label><select id="topology-segment-editor" aria-label="Изменить сеть или зону" value="" onChange={e=>{const segment=segments.find(s=>s.id===e.target.value);if(segment)editSegment(segment)}} style={{maxWidth:260}}><option value="">Изменить сеть или зону…</option>{segments.map(s=><option key={s.id} value={s.id}>{s.kind.toUpperCase()} · {s.name}</option>)}</select></div>}
  <Disclosure label="Отображение и направления"><div className="topologyGuide" aria-label="Навигатор потоков"><label>Режим просмотра<select aria-label="Режим просмотра топологии" value={focusMode} onChange={e=>setFocusMode(e.target.value as 'overview'|'dependencies')}><option value="overview">Обзор всей сети</option><option value="dependencies">Только связанные с выбранным</option></select></label>
    <div><strong>Выберите компонент или поток данных</strong><p>По умолчанию показаны все компоненты. Выберите узел для просмотра его зависимостей или поток для просмотра направления и параметров.</p></div>
    <label>Направление<select aria-label="Направление потоков" value={flowDirection} onChange={e=>setFlowDirection(e.target.value as 'both'|'outgoing'|'incoming')}><option value="both">Входящие и исходящие</option><option value="outgoing">Только исходящие</option><option value="incoming">Только входящие</option></select></label>
    <label>Поток данных<select aria-label="Выбрать поток на схеме" value={activeFlowId} onChange={e=>{if(e.target.value)openInspector('',e.target.value);else closeInspector();setShowConnections(false)}}><option value="">Нет выбранного потока</option>{visibleFlows.map(f=><option key={f.id} value={f.id}>{itemById.get(f.source_id)?.name||'?'} → {itemById.get(f.target_id)?.name||'?'} · {f.name}</option>)}</select></label>
    <label className="topologyConnectionToggle"><input type="checkbox" checked={showAllComponents} onChange={e=>setShowAllComponents(e.target.checked)}/> Показать компоненты без потоков</label>
    <small>Без известных потоков: {matching.filter(i=>!visibleFlows.some(f=>f.source_id===i.id||f.target_id===i.id)).length}. Отсутствие потока в реестре не доказывает отсутствие зависимости.</small>
  </div>
  </Disclosure>{focusGraph&&<small role='status'>Слева – источники входящих потоков, справа – получатели исходящих. Нажмите на стрелку для просмотра параметров.</small>}
  <div className="topologyCanvas">
   {(focusGraph?focusNodes.length:displayed.length)?<ReactFlow minZoom={0.08} key={focusGraph?'focus:'+selected+':'+flowId+':'+flowDirection:'overview:'+system+':'+vrf+':'+vlan+':'+environment+':'+displayed.length} nodes={focusGraph?focusNodes:nodes} edges={focusGraph?focusEdges:edges} nodesDraggable={false} nodesConnectable={editing} onConnect={connection=>{if(!editing)return;const source=focusGraph?connection.source:connection.source?.split(':')[1],target=focusGraph?connection.target:connection.target?.split(':')[1];if(source&&target&&source!==target){editFlowDraft(undefined,source,target)}}} onNodeClick={(_,n)=>{if(focusGraph&&itemById.has(n.id)){openInspector(n.id)}else if(n.id.startsWith('host:')){const id=String((n.data as {item_id?:string}).item_id||'');const found=id||displayed.find(i=>n.id.startsWith('host:'+i.id+':'))?.id||'';if(found)openInspector(found)}}} onEdgeClick={(_,e)=>{openInspector('',e.id);setShowConnections(false)}}>{focusGraph?<AutoFit layoutKey={focusIds.join('|')+':'+flowDirection} maxFitZoom={0.9}/>:<TopologyGroupFit groups={nodes.filter(n=>!n.parentId)}/>}<Background/><Controls showInteractive={false}/></ReactFlow>:<p style={{padding:20}}>Нет компонентов для выбранных фильтров. Проверьте систему, контур и сетевые привязки.</p>}
  </div>
  {(item||flow)&&<div className="topologyInspectorShell"><aside className="topologyInspector architectureDrawer" role="complementary" aria-label="Выбранный объект топологии">
   <button style={{float:'right'}} onClick={closeInspector} aria-label="Закрыть">×</button>{inspectorTrail.length>0&&<button type="button" onClick={closeInspector} aria-label="Назад к предыдущему объекту">← Назад</button>}
   {item&&<><div className="topologyInspectorTitle"><h3>{item.name}</h3><small>{systemById.get(item.system_id)?.name||unknown}</small></div><nav className="topologyInspectorTabs" aria-label="Разделы компонента">{([['overview','Обзор'],['network','Сеть'],['connections','Связи']] as const).map(([tab,label])=><button type="button" key={tab} className={inspectorTab===tab?'active':''} aria-current={inspectorTab===tab?'page':undefined} onClick={()=>setInspectorTab(tab)}>{label}</button>)}</nav>
{inspectorTab==='overview'&&<dl className="topologyInspectorFacts"><dt>Назначение</dt><dd>{item.description?.trim()||String(item.details.purpose||item.details.role||'Не описано')}</dd><dt>Контур</dt><dd>{String(item.details.environment||unknown)}</dd><dt>Родительский компонент</dt><dd>{items.find(x=>x.id===item.parent_id)?.name||'Не указан'}</dd><dt>Тип</dt><dd>{item.kind}</dd></dl>}
{inspectorTab==='network'&&<section><div className="topologyInspectorSectionHeader"><h4>Сетевые интерфейсы</h4>{editing&&<button type="button" onClick={()=>editNic(item)}>+ Интерфейс</button>}</div>{(nicsByItem.get(item.id)||[]).map(n=><article className="topologyInspectorEntry" key={n.id}><div className="topologyInspectorSectionHeader"><strong>{n.name}</strong>{editing&&<button type="button" onClick={()=>editNic(item,n)}>Изменить</button>}</div><dl className="topologyInspectorFacts"><dt>IP</dt><dd>{n.ip_address||unknown}</dd><dt>VRF</dt><dd>{name(n.vrf_id)}</dd><dt>VLAN</dt><dd>{name(n.vlan_id)}</dd><dt>Зона</dt><dd>{name(n.zone_id)}</dd></dl></article>)}{!(nicsByItem.get(item.id)||[]).length&&<p className="hint">Интерфейсы не описаны.</p>}</section>}
{inspectorTab==='connections'&&<section><div className="topologyImpactStats"><span>Исходящие: <b>{flows.filter(f=>f.source_id===item.id).length}</b></span><span>Входящие: <b>{flows.filter(f=>f.target_id===item.id).length}</b></span></div><div className="topologyInspectorSectionHeader"><h4>Потоки и компоненты</h4>{editing&&<button type="button" onClick={()=>editFlowDraft(undefined,item.id,'')}>+ Поток</button>}</div>{flows.filter(f=>f.source_id===item.id||f.target_id===item.id).map(f=>{const outgoing=f.source_id===item.id;const peer=itemById.get(outgoing?f.target_id:f.source_id);return <article className="topologyInspectorEntry" key={f.id}><button type="button" className="topologyDependency" onClick={()=>openInspector(peer?.id||'')}><strong>{outgoing?'→':'←'} {peer?.name||'Неизвестный компонент'}</strong><small>{systemById.get(peer?.system_id||'')?.name||'Система не указана'}</small></button><button type="button" className="topologyInspectorFlowLink" onClick={()=>openInspector('',f.id)}>{f.name||f.protocol||'Поток'} · {f.protocol||'Протокол не задан'} {f.port||''}</button></article>})}{!flows.some(f=>f.source_id===item.id||f.target_id===item.id)&&<p className="hint">Связи не описаны.</p>}</section>}</>}
{flow&&<><h3>{flow.name||'Поток данных'}</h3><p>{itemById.get(flow.source_id)?.name||unknown} → {itemById.get(flow.target_id)?.name||unknown}</p><p>Данные: {flow.data_description||unknown}</p><p>Протокол: {flow.protocol||unknown}; порт: {flow.port||unknown}</p><p>Защита: {flow.security||unknown}</p><p>Проверка: {flow.verification||unknown}</p><p>Расписание: {flow.schedule||unknown}</p>{editing&&<button type="button" onClick={()=>editFlowDraft(flow)}>Редактировать поток</button>}</>}
  </aside></div>}
  {segmentDraft&&<div className="topologyNicBackdrop" onClick={()=>{if(window.confirm('Отменить несохранённые изменения сети?'))setSegmentDraft(null)}}><div className="topologyNicDialog architectureDrawer" role="dialog" aria-modal="true" aria-label="Редактор сети" onClick={e=>e.stopPropagation()}><div className="registryHeader"><h3>{segmentEditId?'Изменить сеть':'Создать сеть'}</h3><button type="button" onClick={()=>setSegmentDraft(null)}>Закрыть ×</button></div><form className="detailForm" onSubmit={submitSegment}><label>Тип<select value={segmentDraft.kind} onChange={e=>setSegmentDraft({...segmentDraft,kind:e.target.value})}>{['vrf','vlan','zone'].map(k=><option key={k} value={k}>{k.toUpperCase()}</option>)}</select></label><label>Название<input required value={segmentDraft.name} onChange={e=>setSegmentDraft({...segmentDraft,name:e.target.value})}/></label><label>Описание<input value={segmentDraft.description} onChange={e=>setSegmentDraft({...segmentDraft,description:e.target.value})}/></label><label>Статус<select value={segmentDraft.verification} onChange={e=>setSegmentDraft({...segmentDraft,verification:e.target.value})}><option value="draft">Черновик</option><option value="verified">Подтверждено</option></select></label>{segmentError&&<p role="alert">{segmentError}</p>}<button className="primary" disabled={segmentSaving}>{segmentSaving?'Сохранение…':'Сохранить сеть'}</button></form></div></div>}
  {flowDraft&&<div className="topologyNicBackdrop" onClick={()=>{if(window.confirm('Отменить несохранённые изменения потока?'))setFlowDraft(null)}}><div className="topologyNicDialog architectureDrawer" role="dialog" aria-modal="true" aria-label="Редактор потока данных" onClick={e=>e.stopPropagation()}><div className="registryHeader"><h3>{flowEditingId?'Редактировать поток':'Создать поток'}</h3><button type="button" onClick={()=>setFlowDraft(null)}>Закрыть ×</button></div><form className="detailForm" onSubmit={submitFlow}><label>Источник<select required value={flowDraft.source_id} onChange={e=>setFlowDraft({...flowDraft,source_id:e.target.value})}><option value="">Выберите источник</option>{items.map(i=><option key={i.id} value={i.id}>{i.name}</option>)}</select></label><label>Получатель<select required value={flowDraft.target_id} onChange={e=>setFlowDraft({...flowDraft,target_id:e.target.value})}><option value="">Выберите получателя</option>{items.map(i=><option key={i.id} value={i.id}>{i.name}</option>)}</select></label><div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}><span style={{fontSize:12,color:"#546a82"}}>Направление: источник → получатель</span><button type="button" onClick={()=>setFlowDraft({...flowDraft,source_id:flowDraft.target_id,target_id:flowDraft.source_id})} disabled={!flowDraft.source_id||!flowDraft.target_id}>Поменять направление ↔</button></div><label>Название<input required maxLength={250} value={flowDraft.name} onChange={e=>setFlowDraft({...flowDraft,name:e.target.value})}/></label><label>Описание данных<input value={flowDraft.data_description} onChange={e=>setFlowDraft({...flowDraft,data_description:e.target.value})}/></label><label>Протокол<input value={flowDraft.protocol} onChange={e=>setFlowDraft({...flowDraft,protocol:e.target.value})}/></label><label>Порт<input value={flowDraft.port} onChange={e=>setFlowDraft({...flowDraft,port:e.target.value})}/></label><label>Защита<select value={flowDraft.security} onChange={e=>setFlowDraft({...flowDraft,security:e.target.value})}>{['unknown','TLS','mTLS','VPN','private_connector','none'].map(x=><option key={x} value={x}>{x}</option>)}</select></label><label>Проверка<select value={flowDraft.verification} onChange={e=>setFlowDraft({...flowDraft,verification:e.target.value})}><option value="draft">Черновик</option><option value="verified">Подтверждено</option></select></label><label>Периодичность<input value={flowDraft.schedule} onChange={e=>setFlowDraft({...flowDraft,schedule:e.target.value})}/></label>{flowDraft.source_id&&flowDraft.source_id===flowDraft.target_id&&<p role="alert">Источник и получатель должны отличаться.</p>}{flowError&&<p role="alert">{flowError}</p>}<button className="primary" disabled={flowSaving||!flowDraft.source_id||flowDraft.source_id===flowDraft.target_id}>{flowSaving?'Сохранение…':'Сохранить поток'}</button></form></div></div>}
  {nicDraft&&<div className="topologyNicBackdrop" onClick={()=>{if(window.confirm('Отменить несохранённые изменения сетевого интерфейса?'))setNicDraft(null)}}>
   <div className="topologyNicDialog architectureDrawer" role="dialog" aria-modal="true" aria-label="Настройка сети компонента" onClick={e=>e.stopPropagation()}>
    <div className="registryHeader"><h3>{nicEditor?'Редактировать сетевой интерфейс':'Новый сетевой интерфейс'}</h3><button type="button" onClick={()=>setNicDraft(null)}>Закрыть ×</button></div>
    <p className="hint">Привязки зоны, VRF и VLAN выбираются из сетевого реестра. Сохранение изменяет сетевую принадлежность только этого интерфейса, а не всей системы.</p>{nicEditor&&<p className="hint">Текущая сеть: VRF {name(nicEditor.vrf_id)} · VLAN {name(nicEditor.vlan_id)} · зона {name(nicEditor.zone_id)}. После сохранения компонент появится в новой сетевой группе.</p>}
    <form onSubmit={submitNic} className="detailForm">
     <label>Имя интерфейса<input required maxLength={100} value={nicDraft.name} onChange={e=>{setNicDraft({...nicDraft,name:e.target.value});setNicConfirm(false)}}/></label>
     <label>IP-адрес<input value={nicDraft.ip_address} maxLength={120} placeholder="Не указан" onChange={e=>{setNicDraft({...nicDraft,ip_address:e.target.value});setNicConfirm(false)}}/></label>
     {(['zone','vrf','vlan'] as const).map(kind=>{
      const field=kind+'_id' as 'zone_id'|'vrf_id'|'vlan_id'
      return <label key={kind}>{kind.toUpperCase()}<select value={nicDraft[field]||''} onChange={e=>{setNicDraft({...nicDraft,[field]:e.target.value||null});setNicConfirm(false)}}>
       <option value="">Не определено</option>{segments.filter(s=>s.kind===kind).map(s=><option key={s.id} value={s.id}>{s.name}</option>)}
      </select></label>
     })}
     {nicEditor&&<div style={{border:'1px solid #c3d1e5',borderRadius:8,padding:12,display:'grid',gap:6}} aria-label="Предварительный просмотр изменений"><strong>До и после</strong><small>До: {nicEditor.name} · {nicEditor.ip_address||'IP не указан'} · VRF {name(nicEditor.vrf_id)} · VLAN {name(nicEditor.vlan_id)} · зона {name(nicEditor.zone_id)}</small><small>После: {nicDraft.name} · {nicDraft.ip_address||'IP не указан'} · VRF {name(nicDraft.vrf_id)} · VLAN {name(nicDraft.vlan_id)} · зона {name(nicDraft.zone_id)}</small><small>Изменяется только выбранный интерфейс, не другие интерфейсы или потоки.</small></div>}{nicConfirm&&<p role="status">Проверьте изменения и подтвердите сохранение.</p>}
     {nicError&&<p className="kisError" role="alert">{nicError}</p>}
     <button className="primary" disabled={nicSaving}>{nicSaving?'Сохранение…':nicConfirm?'Подтвердить и сохранить':nicEditor?'Проверить изменения':'Сохранить сеть компонента'}</button>
    </form>
   </div>
  </div>}
 </section>
}
