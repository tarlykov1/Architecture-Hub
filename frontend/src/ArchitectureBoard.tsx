import React, {useEffect, useMemo, useRef, useState} from 'react'
import './board.css'
import {DiagramNodeLabel,diagramCardStyle} from './DiagramVisual'
import {AutoFit} from './WorkspaceUI'
import {MousePointer2, Monitor, GitBranch, SquareDashed, Maximize2, Save, History, ClipboardCheck} from 'lucide-react'
import {ReactFlow, ReactFlowProvider, Background, Controls, useNodesState, useReactFlow, MarkerType, Position, ConnectionMode, type Node, type NodeChange, type Edge, type Connection} from '@xyflow/react'
import {compactComponentLayout,flowCountLabel} from './graphLayout'
import {ReciprocalEdge} from './ReciprocalEdge'
import {ObstacleAwareEdge} from './ObstacleAwareEdge'
import {BOARD_NODE_TYPES,BOARD_PORTS,pairPorts} from './BoardComponentNode'

type VM = {id:string;system_id:string;kind:string;name:string;description?:string;details:Record<string,unknown>}
type Network = {id:string;name:string;kind:string}
type NIC = {id:string;item_id:string;name:string;zone_id:string|null;vlan_id:string|null;vrf_id:string|null}
type Flow = {id:string;source_id:string;target_id:string;name:string;protocol:string;port:string;security?:string;data_description?:string;schedule?:string;verification?:string}
type FlowHandlePair={source_handle:string;target_handle:string}
type EdgePopup={flowIds:string[];pair:string;x:number;y:number}
type Change = {action:'create_vm'|'create_network'|'create_flow'|'update_flow'|'create_interface'|'move_interface'|'update_vm';id?:string;system_id?:string;name?:string;kind?:string;description?:string;source_id?:string;target_id?:string;protocol?:string;port?:string;security?:string;data_description?:string;interface_id?:string;item_id?:string;interface_name?:string;network_id?:string|null;previous_network_id?:string|null;previous_name?:string;previous_description?:string;details_patch?:Record<string,string>;previous_details?:Record<string,unknown>;previous_flow?:Record<string,string>;schedule?:string;verification?:string;network_field?:'zone_id'|'vlan_id'|'vrf_id'}
type Preview = {changes:Array<{action:string;id:string;before:unknown;after:unknown;field?:string}>;count:number}
type Props = {systemId:string;ownerName?:string;ownerBySystemId?:Record<string,string>;items:VM[];networks:Network[];interfaces:NIC[];flows:Flow[];savedPositions?:Record<string,{x:number;y:number}>;onPositionChange?:(node:Node)=>void;request:<T>(url:string,init?:RequestInit)=>Promise<T>;onCommitted:()=>Promise<void>;exitRequest?:number;onExit?:()=>void}
type Tool = 'move'|'vm'|'flow'|'network'
type PickerOption={value:string;label:string}
const CUSTOM_CHOICE='__new__'
const PROTOCOL_OPTIONS:PickerOption[]=[
  'TCP','UDP','HTTP','HTTPS','SSH','RDP','LDAP','LDAPS','DNS','SFTP','SMTP',
  'PostgreSQL','MySQL','MSSQL','AMQP','Kafka','gRPC'
].map(value=>({value,label:value}))
const PORT_OPTIONS:PickerOption[]=[
  '22','53','80','389','443','445','587','636','1433','1521','3306','3389',
  '5432','5672','6379','8080','8443','9092'
].map(value=>({value,label:value}))
const SECURITY_OPTIONS:PickerOption[]=[
  {value:'unknown',label:'Не указана / не проверена'},
  {value:'none',label:'Нет защиты (подтверждено)'},
  {value:'TLS',label:'TLS'},
  {value:'mTLS',label:'mTLS (взаимный TLS)'},
  {value:'VPN',label:'VPN'},
  {value:'IPsec',label:'IPsec'},
  {value:'Firewall',label:'Межсетевой экран'},
  {value:'ACL',label:'ACL'},
  {value:'TLS+Firewall',label:'TLS + межсетевой экран'},
]
const SUGGESTED_PORTS:Record<string,string>={
  HTTP:'80',HTTPS:'443',SSH:'22',SFTP:'22',RDP:'3389',LDAP:'389',
  LDAPS:'636',DNS:'53',SMTP:'587',PostgreSQL:'5432',MySQL:'3306',
  MSSQL:'1433',AMQP:'5672',Kafka:'9092'
}

/** An explicit "Новый…" option preserves non-standard ports/protocols/controls. */
function FlowChoice({label,value,onChange,options,placeholder}:{
  label:string;value:string;onChange:(value:string)=>void;
  options:PickerOption[];placeholder:string
}){
  const [custom,setCustom]=useState(false)
  const known=options.some(option=>option.value===value)
  const isCustom=custom||(Boolean(value)&&!known)
  return <label>{label}
    <select aria-label={label} value={isCustom?CUSTOM_CHOICE:value}
      onChange={event=>{
        const next=event.target.value
        if(next===CUSTOM_CHOICE){setCustom(true);onChange('')}
        else{setCustom(false);onChange(next)}
      }}>
      <option value="" disabled>Выберите</option>
      {options.map(option=><option key={option.value} value={option.value}>{option.label}</option>)}
      <option value={CUSTOM_CHOICE}>+ Новый…</option>
    </select>
    {isCustom&&<input aria-label={'Новый '+label.toLowerCase()} value={value}
      maxLength={80} placeholder={placeholder} autoFocus
      onChange={event=>onChange(event.target.value)}/>}
  </label>
}
type Rect = {id:string;name:string;kind:string;x:number;y:number;width:number;height:number}
const makeId=()=>crypto.randomUUID()
const rectContains=(r:Rect,p:{x:number;y:number})=>p.x>=r.x&&p.x<=r.x+r.width&&p.y>=r.y&&p.y<=r.y+r.height
const fieldForKind=(kind:string):'zone_id'|'vlan_id'|'vrf_id'=>kind==='vlan'?'vlan_id':kind==='vrf'?'vrf_id':'zone_id'

function Editor({systemId,ownerName='',ownerBySystemId={},items,networks,interfaces,flows,savedPositions={},onPositionChange,request,onCommitted,exitRequest=0,onExit}:Props){
 const [tool,setTool]=useState<Tool>('move')
 const [inspectedId,setInspectedId]=useState<string|null>(null)
 const [focusDependencies,setFocusDependencies]=useState(false)
 const [editingPassport,setEditingPassport]=useState(false)
 const [passportDraft,setPassportDraft]=useState({name:'',description:'',purpose:'',environment:''})
 const [changes,setChanges]=useState<Change[]>([])
 const [layoutDirty,setLayoutDirty]=useState(false)
 const [layoutBusy,setLayoutBusy]=useState(false)
 const [layoutMessage,setLayoutMessage]=useState('')
 const [reason,setReason]=useState('')
 const [preview,setPreview]=useState<Preview|null>(null)
 const [error,setError]=useState('')
 const [busy,setBusy]=useState(false)
 const [history,setHistory]=useState<Array<{id:string;timestamp:string;reason:string;changes:Preview['changes']}>>([])
 const [showHistory,setShowHistory]=useState(false)
 const [name,setName]=useState('')
 const [kind,setKind]=useState<'zone'|'vlan'|'vrf'>('zone')
 const [from,setFrom]=useState('')
 const [to,setTo]=useState('')
 const [direction,setDirection]=useState<'forward'|'reverse'|'both'>('forward')
 const [protocol,setProtocol]=useState('TCP')
 const [port,setPort]=useState('')
 const [security,setSecurity]=useState('unknown')
 const [interfaceId,setInterfaceId]=useState('')
 const [snapToGrid,setSnapToGrid]=useState(false)
 const [drawing,setDrawing]=useState<{x:number;y:number}|null>(null)
 const networkStart=useRef<{x:number;y:number}|null>(null)
 const networkStartPixel=useRef<{x:number;y:number}|null>(null)
 const [networkPreview,setNetworkPreview]=useState<{x:number;y:number;width:number;height:number}|null>(null)
 const [reviewOpen,setReviewOpen]=useState(false)
 const [exitPrompt,setExitPrompt]=useState(false)
 const [exitAfterSave,setExitAfterSave]=useState(false)
 const [flowHandles,setFlowHandles]=useState<Record<string,FlowHandlePair>>({})
 const [edgePopup,setEdgePopup]=useState<EdgePopup|null>(null)
 const [flowCardId,setFlowCardId]=useState<string|null>(null)
 const [flowCardDraft,setFlowCardDraft]=useState<Flow|null>(null)
 const [expandedPair,setExpandedPair]=useState<string|null>(null)
 const stageRef=useRef<HTMLDivElement|null>(null)
 const [rectangles,setRectangles]=useState<Rect[]>(()=>{
   const relevant = networks.filter(n=>interfaces.some(nic=>nic[fieldForKind(n.kind)]===n.id&&items.some(item=>item.id===nic.item_id)))
   const heights=relevant.map(n=>{
     const members=items.filter(item=>interfaces.some(nic=>nic.item_id===item.id&&nic[fieldForKind(n.kind)]===n.id)).length
     return Math.max(340,90+Math.ceil(members/2)*175)
   })
   return relevant.map((n,i)=>{
     const row=Math.floor(i/2)
     let y=60
     for(let previous=0;previous<row;previous++)y+=Math.max(heights[previous*2]||0,heights[previous*2+1]||0)+50
     return {id:n.id,name:n.name,kind:n.kind,x:60+(i%2)*600,y,width:540,height:heights[i]}
   })
 })
 const initialNodes=useMemo<Node[]>(()=>{
   const positions=compactComponentLayout(items.map(i=>i.id),flows.filter(f=>items.some(i=>i.id===f.source_id)&&items.some(i=>i.id===f.target_id)).map(f=>({source:f.source_id,target:f.target_id})),280,175)
   return items.map((item,i)=>{
     const membership=interfaces.find(n=>n.item_id===item.id)
     const group=rectangles.find(r=>membership?.[fieldForKind(r.kind)]===r.id)
     const members=group?items.filter(v=>interfaces.some(n=>n.item_id===v.id&&n[fieldForKind(group.kind)]===group.id)):[]
     const index=group?members.findIndex(v=>v.id===item.id):i
     const position=savedPositions[item.id]|| (group?{x:group.x+25+(index%2)*265,y:group.y+65+Math.floor(index/2)*175}:positions[item.id]||{x:70+(i%4)*280,y:80+Math.floor(i/4)*175})
     return {id:item.id,type:'architectureComponent',position,sourcePosition:Position.Bottom,targetPosition:Position.Top,data:{label:<DiagramNodeLabel name={item.name} kind={item.kind} subtitle={ownerBySystemId[item.system_id]||ownerName} detail={item.kind+' · '+String(item.details.environment||'Среда не задана')}><small className="componentNodePurpose">{item.description?.trim()||String(item.details.purpose||item.details.role||'Назначение не описано')}</small></DiagramNodeLabel>},style:diagramCardStyle({zIndex:2,padding:0})}
   })
 },[items,flows,interfaces,ownerName,ownerBySystemId]) // Keep dragged coordinates in React Flow during the editing session.
 const [nodes,setNodes,onNodesChange]=useNodesState(initialNodes)
 // Keep the editor in sync when the selected system or inventory changes,
 // without resetting coordinates that the user has already dragged.
 useEffect(()=>{
   const currentIds=new Set([...initialNodes.map(node=>node.id),...changes.filter(c=>c.action==='create_vm').map(c=>c.id!).filter(Boolean)])
   setNodes(previous=>{
     const retained=previous.filter(node=>currentIds.has(node.id))
     const retainedIds=new Set(retained.map(node=>node.id))
     const added=initialNodes.filter(node=>!retainedIds.has(node.id))
     if(!added.length&&retained.length===previous.length)return previous
     return [...retained,...added]
   })
 },[initialNodes,changes,setNodes])
 const {screenToFlowPosition,fitView}=useReactFlow()
 const allVMs=useMemo<VM[]>(()=>[...items,...changes.filter(c=>c.action==='create_vm').map(c=>({id:c.id!,name:c.name!,system_id:systemId,kind:'vm',description:'',details:{} as Record<string,unknown>}))],[items,changes,systemId])
 const allNetworks=[...networks,...changes.filter(c=>c.action==='create_network').map(c=>({id:c.id!,name:c.name!,kind:c.kind!}))]
 const visibleRects=rectangles.filter(r=>allNetworks.some(n=>n.id===r.id))
 const backgroundNodes:Node[]=visibleRects.map(r=>({id:'network:'+r.id,type:'default',position:{x:r.x,y:r.y},width:r.width,height:r.height,measured:{width:r.width,height:r.height},draggable:false,selectable:false,connectable:false,data:{label:r.name+' · '+r.kind.toUpperCase()},style:{width:r.width,height:r.height,background:'#dbeafe77',border:'2px dashed #2563eb',borderRadius:9,zIndex:0,pointerEvents:'none',textAlign:'left',padding:12,fontSize:13,color:'#1e40af'}}))
 const graphNodes=[...backgroundNodes,...nodes]
 // Project reviewed technical changes into the editor graph without touching the database.
 const pendingFlows:Flow[]=changes.filter(c=>c.action==='create_flow').map(c=>({
   id:c.id!,source_id:c.source_id!,target_id:c.target_id!,protocol:c.protocol||'',port:c.port||'',
   name:c.name||'',security:c.security||'unknown',data_description:c.data_description||'',
   schedule:c.schedule||'',verification:c.verification||'draft'
 }))
 const effectiveFlows:Flow[]=[...flows.map(flow=>{
   const update=changes.find(c=>c.action==='update_flow'&&c.id===flow.id)
   return update?{...flow,...{
     source_id:update.source_id!,target_id:update.target_id!,name:update.name!,
     protocol:update.protocol||'',port:update.port||'',security:update.security||'unknown',
     data_description:update.data_description||'',schedule:update.schedule||'',verification:'draft'
   }}:flow
 }),...pendingFlows]
 const flowGroups=new Map<string,Flow[]>()
 for(const flow of effectiveFlows){
   if(!allVMs.some(v=>v.id===flow.source_id)||!allVMs.some(v=>v.id===flow.target_id))continue
   const key=flow.source_id+'|'+flow.target_id
   flowGroups.set(key,[...(flowGroups.get(key)||[]),flow])
 }
 const visibleFlowGroups: Array<{pair:string;list:Flow[];lane:number;siblings:number}>=[]
 for(const [pair,list] of flowGroups.entries()){
   if(expandedPair===pair&&list.length>1){
     list.forEach((flow,lane)=>visibleFlowGroups.push({pair,list:[flow],lane,siblings:list.length}))
   }else visibleFlowGroups.push({pair,list,lane:0,siblings:list.length})
 }
 const relatedIds=new Set(inspectedId?[inspectedId,...effectiveFlows.filter(f=>f.source_id===inspectedId||f.target_id===inspectedId).flatMap(f=>[f.source_id,f.target_id])]:[])
 const displayedNodes=graphNodes.map(n=>({...n,style:{...n.style,
    border:((tool==='flow'&&(n.id===from||n.id===to))||(tool==='move'&&n.id===inspectedId))?'2px solid #2563eb':n.style?.border,
    background:((tool==='flow'&&(n.id===from||n.id===to))||(tool==='move'&&n.id===inspectedId))?'#eff6ff':n.style?.background,
    opacity:focusDependencies&&inspectedId&&!n.id.startsWith('network:')&&!relatedIds.has(n.id)?0.22:1
  }}))
 const inspectedVM=allVMs.find(v=>v.id===inspectedId)
 const openPassport=(id:string)=>{const vm=allVMs.find(v=>v.id===id);if(!vm)return;setInspectedId(id);setEditingPassport(false);setPassportDraft({name:vm.name,description:vm.description||'',purpose:String(vm.details?.purpose||''),environment:String(vm.details?.environment||'')})}
 const stagePassport=()=>{if(!inspectedVM||!passportDraft.name.trim())return;const details_patch:Record<string,string>={purpose:passportDraft.purpose,environment:passportDraft.environment};const previous_details:Record<string,unknown>={purpose:inspectedVM.details?.purpose??null,environment:inspectedVM.details?.environment??null};addChange({action:'update_vm',id:inspectedVM.id,system_id:systemId,name:passportDraft.name.trim(),description:passportDraft.description,previous_name:inspectedVM.name,previous_description:inspectedVM.description||'',details_patch,previous_details});setEditingPassport(false);setInspectedId(null);setFocusDependencies(false);setReviewOpen(true)}
 const inspectedFlows=effectiveFlows.filter(f=>f.source_id===inspectedId||f.target_id===inspectedId)
 const edges=visibleFlowGroups.map(({pair,list,lane,siblings})=>{
   const first=list[0]
   const protocolLabel=[first.protocol,first.port].filter(Boolean).join(':')
   const reciprocal=flowGroups.has(first.target_id+'|'+first.source_id)
   const sourceNode=nodes.find(node=>node.id===first.source_id)
   const targetNode=nodes.find(node=>node.id===first.target_id)
   const auto=sourceNode&&targetNode?pairPorts(sourceNode,targetNode,reciprocal):{}
   const ports=list.length===1&&flowHandles[first.id]?
     {sourceHandle:flowHandles[first.id].source_handle,targetHandle:flowHandles[first.id].target_handle}:auto
   const caption=list.length>1?flowCountLabel(list.length):protocolLabel||'Поток'
   return {
     id:'flow-pair:'+pair+(siblings>1&&list.length===1?'|'+first.id:''),
     source:first.source_id,target:first.target_id,...ports,
     type:reciprocal||siblings>1&&list.length===1?'reciprocal':'obstacle-aware',
     reconnectable:list.length===1,
     animated:false,
     style:{stroke:list.some(f=>pendingFlows.some(c=>c.id===f.id))?'#176bc1':'#369279',
       strokeWidth:edgePopup?.flowIds.includes(first.id)?3.1:inspectedId&&(first.source_id===inspectedId||first.target_id===inspectedId)?3:1.8,
       opacity:focusDependencies&&inspectedId&&first.source_id!==inspectedId&&first.target_id!==inspectedId?0.16:1},
     markerEnd:{type:MarkerType.ArrowClosed,width:13,height:13},
     label:reciprocal?'':caption,
     labelStyle:{fontSize:11,fontWeight:600},labelBgStyle:{fill:'#ffffff',fillOpacity:0.95},labelBgPadding:[7,4] as [number,number],
     data:{reciprocal,flowIds:list.map(f=>f.id),caption, laneOffset:siblings>1&&list.length===1?18+lane*17:undefined}
   }
 })
 const addChange=(c:Change)=>{setChanges(previous=>[...previous,c]);setPreview(null);setError('')}
 const moveNode=(node:Node)=>{
   onPositionChange?.(node)
   setLayoutDirty(true);setLayoutMessage('')
   const center={x:node.position.x+97,y:node.position.y+30}
   // A zone move affects exactly one chosen NIC; never replace all NIC memberships.
   const target=visibleRects.slice().reverse().find(r=>rectContains(r,center))
   if(!target)return
   const field=fieldForKind(target.kind)
   const attached=interfaces.filter(n=>n.item_id===node.id)
   const nic=attached.find(n=>n.id===interfaceId)|| (attached.length===1?attached[0]:undefined)
   if(!nic){
     if(attached.length>1){setError('У ВМ несколько сетевых интерфейсов. Выберите нужный интерфейс перед переносом.');return}
     // A new NIC is a reviewed infrastructure change, never a silent mutation.
     const staged=changes.find(c=>c.action==='create_interface'&&c.item_id===node.id)
     if(staged){
       setChanges(previous=>previous.map(c=>c===staged?{...c,network_id:target.id,network_field:field}:c))
     }else{
       setChanges(previous=>[...previous,{action:'create_interface',id:makeId(),item_id:node.id,interface_name:'eth0',network_id:target.id,network_field:field}])
     }
     setPreview(null);setError('Будет создан интерфейс eth0 без IP-адреса. Проверьте изменение перед сохранением.')
     return
   }
   const prior=changes.find(c=>c.action==='move_interface'&&c.interface_id===nic.id&&c.network_field===field)
   if((prior?prior.network_id:nic[field])===target.id)return
   const next:Change={action:'move_interface',interface_id:nic.id,network_id:target.id,previous_network_id:nic[field],network_field:field}
   setChanges(previous=>[...previous.filter(c=>!(c.action==='move_interface'&&c.interface_id===nic.id&&c.network_field===field)),next])
   setPreview(null);setError('')
 }
 const addVM=(point?:{x:number;y:number})=>{
   if(!name.trim())return setError('Введите имя новой ВМ.')
   const id=makeId()
   const node:Node={id,type:'architectureComponent',position:point||{x:90+(nodes.length%4)*280,y:100+Math.floor(nodes.length/4)*175},sourcePosition:Position.Bottom,targetPosition:Position.Top,data:{label:<DiagramNodeLabel name={name.trim()} kind="vm" subtitle={ownerName} detail="ВМ · Черновик"/>},style:diagramCardStyle({border:'1px dashed #2674bf',padding:0})}
   addChange({action:'create_vm',id,system_id:systemId,name:name.trim(),kind:'vm'})
   setNodes(previous=>[...previous,node])
   onPositionChange?.(node)
   setLayoutDirty(true);setLayoutMessage('')
   setName('');setTool('move');setReviewOpen(true)
 }
 const addFlow=()=>{
   if(!from||!to||from===to)return setError('Выберите разные исходный и целевой компоненты.')
   if(!port.trim())return setError('Укажите порт или диапазон портов.')
   const source=direction==='reverse'?to:from,target=direction==='reverse'?from:to
   addChange({action:'create_flow',id:makeId(),source_id:source,target_id:target,name:allVMs.find(v=>v.id===source)?.name+' → '+allVMs.find(v=>v.id===target)?.name,protocol,port,security})
   if(direction==='both')addChange({action:'create_flow',id:makeId(),source_id:target,target_id:source,name:allVMs.find(v=>v.id===target)?.name+' → '+allVMs.find(v=>v.id===source)?.name,protocol,port,security})
   setTool('move')
 }
 const addNetwork=(start:{x:number;y:number},end:{x:number;y:number})=>{
   if(!name.trim()){setError('Укажите название сети справа, затем нарисуйте контейнер.');return}
   const x=Math.min(start.x,end.x),y=Math.min(start.y,end.y)
   const width=Math.abs(end.x-start.x),height=Math.abs(end.y-start.y)
   if(width<140||height<90){setError('Контейнер слишком мал. Протяните прямоугольник не менее 140 × 90.');return}
   const id=makeId()
   const rect:Rect={id,name:name.trim(),kind,x,y,width,height}
   setRectangles(prev=>[...prev,rect])
   const networkField=fieldForKind(kind)
   const enclosed=nodes.filter(node=>rectContains(rect,{x:node.position.x+97,y:node.position.y+30}))
   const assignments:Change[]=[]
   let ambiguous=0
   for(const node of enclosed){
     const attached=interfaces.filter(n=>n.item_id===node.id)
     if(attached.length>1){ambiguous++;continue}
     if(attached.length===1){
       const nic=attached[0]
       if(nic[networkField]!==id)assignments.push({action:'move_interface',interface_id:nic.id,previous_network_id:nic[networkField],network_id:id,network_field:networkField})
     }else{
       assignments.push({action:'create_interface',id:makeId(),item_id:node.id,interface_name:'eth0',network_id:id,network_field:networkField})
     }
   }
   setChanges(previous=>[...previous,{action:'create_network',id,name:name.trim(),kind},...assignments])
   setPreview(null)
   setError(ambiguous?('Сеть нарисована. У '+ambiguous+' ВМ несколько интерфейсов – выберите интерфейс и переместите ВМ в зону вручную.'):'Новая сеть и '+assignments.length+' сетевых привязок подготовлены для подтверждения.')
   setDrawing(null);setName('');setTool('move');setReviewOpen(true)
 }
 const handlePaneClick=(event:React.MouseEvent)=>{
   if(tool==='vm'){
     addVM(screenToFlowPosition({x:event.clientX,y:event.clientY}))
     return
   }
 }
 const beginNetworkDrag=(event:React.PointerEvent<HTMLDivElement>)=>{
   if(event.button!==0)return
   if(!name.trim()){setError('Сначала укажите название сети справа.');return}
   const rect=event.currentTarget.getBoundingClientRect()
   networkStartPixel.current={x:event.clientX-rect.left,y:event.clientY-rect.top}
   networkStart.current=screenToFlowPosition({x:event.clientX,y:event.clientY})
   setDrawing(networkStart.current)
   setNetworkPreview({x:event.clientX-rect.left,y:event.clientY-rect.top,width:0,height:0})
   event.currentTarget.setPointerCapture(event.pointerId)
   setError('')
 }
 const moveNetworkDrag=(event:React.PointerEvent<HTMLDivElement>)=>{
   if(!networkStart.current||!networkPreview)return
   const rect=event.currentTarget.getBoundingClientRect()
   const x=event.clientX-rect.left,y=event.clientY-rect.top
   // Keep the first corner fixed while drawing, including when moving up and left.
   const origin=networkStartPixel.current
   if(origin)setNetworkPreview({x:Math.min(origin.x,x),y:Math.min(origin.y,y),width:Math.abs(x-origin.x),height:Math.abs(y-origin.y)})
 }
 const finishNetworkDrag=(event:React.PointerEvent<HTMLDivElement>)=>{
   const start=networkStart.current
   networkStart.current=null;networkStartPixel.current=null
   setNetworkPreview(null);setDrawing(null)
   if(!start)return
   addNetwork(start,screenToFlowPosition({x:event.clientX,y:event.clientY}))
 }
 const cancelNetworkDrag=()=>{networkStart.current=null;networkStartPixel.current=null;setNetworkPreview(null);setDrawing(null)}
 // The visual layout is saved independently from technical changes.
 useEffect(()=>{
   let active=true
   setLayoutDirty(false);setLayoutMessage('')
   void request<{positions:Record<string,{x:number;y:number}>;network_rectangles?:Record<string,{x:number;y:number;width:number;height:number}>}>('/api/board/layout/'+systemId)
     .then(result=>{
       if(!active)return
       setNodes(previous=>previous.map(node=>{
         const position=result.positions?.[node.id]||savedPositions[node.id]
         return position?{...node,position}:node
       }))
       const stored=result.network_rectangles||{}
       setRectangles(previous=>{
         const byId=new Map(previous.map(rect=>[rect.id,{...rect,...(stored[rect.id]||{})}]))
         for(const [id,geometry] of Object.entries(stored)){
           const network=networks.find(item=>item.id===id)
           if(network&&!byId.has(id))byId.set(id,{id,name:network.name,kind:network.kind,...geometry})
         }
         return [...byId.values()]
       })
     }).catch(()=>{/* Browser positions remain the fallback. */})
   return ()=>{active=false}
 },[systemId,request,setNodes])

 const saveLayout=async(includeCommittedDraft=false):Promise<boolean>=>{
   if(layoutBusy)return false
   setLayoutBusy(true);setLayoutMessage('');setError('')
   try{
     const pendingVMs=changes.filter(c=>c.action==='create_vm').map(c=>c.id!)
     const pendingNetworks=changes.filter(c=>c.action==='create_network').map(c=>c.id!)
     const validVMs=new Set([...items.map(item=>item.id),...(includeCommittedDraft?pendingVMs:[])])
     const validNetworks=new Set([...networks.map(n=>n.id),...(includeCommittedDraft?pendingNetworks:[])])
     const positions=Object.fromEntries(nodes.filter(node=>validVMs.has(node.id))
       .map(node=>[node.id,{x:node.position.x,y:node.position.y}]))
     const network_rectangles=Object.fromEntries(rectangles.filter(rect=>validNetworks.has(rect.id))
       .map(rect=>[rect.id,{x:rect.x,y:rect.y,width:rect.width,height:rect.height}]))
     await request('/api/board/layout/'+systemId,{
       method:'PUT',body:JSON.stringify({positions,network_rectangles})
     })
     const hasPending=changes.some(c=>c.action==='create_vm'||c.action==='create_network')
     setLayoutDirty(!includeCommittedDraft&&hasPending)
     setLayoutMessage(hasPending&&!includeCommittedDraft
       ?'Расположение существующих объектов сохранено. Новые объекты сохраните через черновик.'
       :'Расположение компонентов и контейнеров сохранено.')
     return true
   }catch(e){setLayoutDirty(true);setError('Не удалось сохранить схему: '+String(e));return false}
   finally{setLayoutBusy(false)}
 }
 useEffect(()=>{
   if(!exitRequest)return
   if(changes.length||layoutDirty)setExitPrompt(true)
   else onExit?.()
   // Exit requests are explicit UI events; the editor is never closed silently.
   // eslint-disable-next-line react-hooks/exhaustive-deps
 },[exitRequest])
 const saveBeforeExit=async()=>{
   setExitPrompt(false)
   if(changes.length){
     setExitAfterSave(true);setReviewOpen(true);setTool('move');setInspectedId(null)
   }else if(await saveLayout()){
     onExit?.()
   }
 }
 const discardDraft=()=>{
   const stagedVMs=new Set(changes.filter(c=>c.action==='create_vm').map(c=>c.id))
   const stagedNetworks=new Set(changes.filter(c=>c.action==='create_network').map(c=>c.id))
   setNodes(previous=>previous.filter(node=>!stagedVMs.has(node.id)))
   setRectangles(previous=>previous.filter(rect=>!stagedNetworks.has(rect.id)))
   setChanges([]);setPreview(null);setError('');setReviewOpen(false)
   setLayoutMessage('Черновик изменений отменён.')
 }
 const openHistory=async()=>{
   setError('')
   try{setHistory(await request<Array<{id:string;timestamp:string;reason:string;changes:Preview['changes']}>>('/api/board/audit?limit=30'));setShowHistory(true)}catch(e){setError(String(e))}
 }
 const submitPreview=async()=>{
   if(!changes.length||reason.trim().length<3){setError('Добавьте изменения и укажите причину (минимум 3 символа).');return}
   setBusy(true);setError('')
   try{setPreview(await request<Preview>('/api/board/preview',{method:'POST',body:JSON.stringify({changes,reason})}))}
   catch(e){setError(String(e))}
   finally{setBusy(false)}
 }
 const commit=async()=>{
   if(!preview)return
   setBusy(true);setError('')
   try{
     await request('/api/board/commit',{method:'POST',body:JSON.stringify({changes,reason})})
     const layoutSaved=await saveLayout(true)
     await onCommitted()
     if(showHistory)void openHistory()
     setChanges([]);setPreview(null);setReason('');setDrawing(null);setReviewOpen(false)
     if(layoutSaved){
       setError('')
       setLayoutMessage('Изменения и расположение схемы сохранены.')
       if(exitAfterSave)onExit?.()
     }
     setExitAfterSave(false)
   }catch(e){setPreview(null);setError('Сохранение отклонено: '+String(e)+'. Обновите предварительный просмотр.')}
   finally{setBusy(false)}
 }
 return <section className="boardWorkspace" aria-label="Редактор архитектурной схемы">
   <div className="boardEditorStage">
        <div className="boardCanvas" data-active-graph="infrastructure-editor"><ReactFlow nodes={displayedNodes} edges={edges} nodeTypes={BOARD_NODE_TYPES} connectionMode={ConnectionMode.Loose} edgeTypes={{reciprocal:ReciprocalEdge,'obstacle-aware':ObstacleAwareEdge}} onNodesChange={(updates:NodeChange[])=>onNodesChange(updates.filter(c=>!('id' in c)||!c.id.startsWith('network:')||c.type==='dimensions'||c.type==='select'))} nodesDraggable={tool==='move'} snapToGrid={snapToGrid} snapGrid={[20,20]} nodesConnectable={tool==='flow'} onConnect={connection=>{if(connection.source&&connection.target&&connection.source!==connection.target){setFrom(connection.source);setTo(connection.target);setInspectedId(null);setTool('flow');setError('Заполните параметры нового потока справа и добавьте его в черновик.')}}} onEdgeClick={(_,edge)=>{setInspectedId(null);setFocusDependencies(false);setFrom(edge.source);setTo(edge.target);setTool('flow')}} onNodeClick={(_,node)=>{
 if(node.id.startsWith('network:'))return
 if(tool==='flow'){
   setInspectedId(null);setFocusDependencies(false)
   if(!from||to||from===node.id){setFrom(node.id);setTo('')}
   else setTo(node.id)
 }else if(tool==='move'){openPassport(node.id);setFocusDependencies(false)}
}} onNodeDragStop={(_,node)=>moveNode(node)} onPaneClick={handlePaneClick} minZoom={0.08} fitView fitViewOptions={{padding:0.2,maxZoom:0.9}}><AutoFit layoutKey={systemId+':'+items.length+':'+flows.length} maxFitZoom={0.9}/><Background gap={20}/><Controls showInteractive={false}/></ReactFlow>
     {tool==='network'&&<div className="boardNetworkDrawLayer" role="region" aria-label="Поле рисования контейнера"
       onPointerDown={beginNetworkDrag} onPointerMove={moveNetworkDrag} onPointerUp={finishNetworkDrag}
       onPointerCancel={cancelNetworkDrag} onContextMenu={event=>event.preventDefault()}>
       {networkPreview&&<div className="boardNetworkPreview" style={{left:networkPreview.x,top:networkPreview.y,width:networkPreview.width,height:networkPreview.height}} aria-hidden="true"/>}
     </div>}
   </div>

        <div className="boardTools" role="toolbar" aria-label="Инструменты архитектуры">
     {([
       {key:'move',title:'Курсор / перемещение',caption:'Выбрать',icon:MousePointer2,help:'Перетаскивайте блоки и открывайте их паспорта'},
       {key:'vm',title:'+ ВМ',caption:'Добавить ВМ',icon:Monitor,help:'Укажите имя справа и нажмите на схему'},
       {key:'flow',title:'→ Поток',caption:'Поток',icon:GitBranch,help:'Выберите источник и получателя'},
       {key:'network',title:'▭ Сеть / контейнер',caption:'Контейнер',icon:SquareDashed,help:'Введите название справа и протяните прямоугольник'},
     ] as const).map(({key,title,caption,icon:Icon,help})=>
        <button type="button" key={key} title={caption+' – '+help} aria-label={title} data-tool={key} aria-pressed={tool===key}
          onClick={()=>{setTool(key);setInspectedId(null);setFocusDependencies(false);setDrawing(null);setError('');setLayoutMessage('');setReviewOpen(false);cancelNetworkDrag()}}>
          <Icon size={19} strokeWidth={1.8} aria-hidden="true"/><span className="boardToolCaption" aria-hidden="true">{caption}</span>
        </button>)}
     <span className="boardToolsSeparator" aria-hidden="true"/>
     <button type="button" title="Вписать всю схему в экран" aria-label="Показать всё" disabled={!nodes.length} onClick={()=>void fitView({padding:0.25,duration:250,maxZoom:0.9})}><Maximize2 size={19} aria-hidden="true"/><span className="boardToolCaption" aria-hidden="true">Вписать</span></button>
     <button type="button" title={changes.length?'Проверить и сохранить '+changes.length+' технических изменений':'Сохранить расположение'} aria-label={changes.length?'Сохранить изменения':'Сохранить расположение'} disabled={(!changes.length&&!layoutDirty)||layoutBusy||busy}
       onClick={()=>{if(changes.length){setReviewOpen(true);setTool('move');setInspectedId(null)}else void saveLayout()}}>
       <Save size={19} aria-hidden="true"/>
       <span className="boardToolCaption" aria-hidden="true">{changes.length?'Сохранить ('+changes.length+')':'Сохранить'}</span>
       {(layoutDirty||changes.length>0)&&<span className="boardUnsavedDot" aria-hidden="true"/>}
     </button>
     <button type="button" title="История изменений" aria-label="История изменений" onClick={()=>void openHistory()}><History size={19} aria-hidden="true"/><span className="boardToolCaption" aria-hidden="true">История</span></button>
     <button type="button" className="boardChangeCount" title="Проверить и сохранить изменения в реестре" aria-label={'Черновик: '+changes.length+' изменений'} disabled={!changes.length} onClick={()=>{setReviewOpen(true);setTool('move');setInspectedId(null)}}>
       <ClipboardCheck size={18} aria-hidden="true"/><span className="boardToolCaption" aria-hidden="true">Черновик ({changes.length})</span><span className="boardCountLabel"> изменений</span>
     </button>
   </div>
     {(tool!=='move'||inspectedVM||reviewOpen)&&<aside className="boardDock" role="complementary" aria-label="Свойства и изменения схемы">
       {tool!=='move'&&<div className="boardPropertiesHeader"><div><small>ИНСТРУМЕНТ</small><h3>{tool==='vm'?'Виртуальная машина':tool==='flow'?'Поток данных':'Сеть / контейнер'}</h3></div><button type="button" aria-label="Закрыть настройки инструмента" onClick={()=>{setTool('move');setDrawing(null);setError('');setLayoutMessage('');setReviewOpen(false);cancelNetworkDrag()}}>✕</button></div>}
          {tool==='vm'&&<div className="boardToolFields"><p>Введите название и нажмите на холст для размещения ВМ.</p><label>Имя ВМ <input value={name} onChange={e=>setName(e.target.value)} placeholder="Новая ВМ"/></label><button onClick={()=>addVM()}>Разместить на схеме</button></div>}
   {tool==='network'&&<div className="boardToolFields"><label>Название сети <input value={name} onChange={e=>setName(e.target.value)}/></label><label>Тип <select value={kind} onChange={e=>setKind(e.target.value as typeof kind)}><option value="zone">Зона</option><option value="vlan">VLAN</option><option value="vrf">VRF</option></select></label><p role="status">{drawing?'Продолжайте тянуть – контур контейнера виден на схеме':'Нажмите мышью на свободном месте схемы и протяните прямоугольник нужного размера. Отпустите кнопку – контейнер появится в черновике.'}</p></div>}
   {tool==='flow'&&<div className="boardToolFields"><p>Протяните связь между ВМ или выберите по очереди источник и получателя на холсте.</p><label>Откуда <select aria-label="Откуда" value={from} onChange={e=>setFrom(e.target.value)}><option value="">Выберите</option>{allVMs.map(v=><option key={v.id} value={v.id}>{v.name}</option>)}</select></label><label>Куда <select aria-label="Куда" value={to} onChange={e=>setTo(e.target.value)}><option value="">Выберите</option>{allVMs.map(v=><option key={v.id} value={v.id}>{v.name}</option>)}</select></label><label>Направление <select value={direction} onChange={e=>setDirection(e.target.value as typeof direction)}><option value="forward">→</option><option value="reverse">←</option><option value="both">↔ (два потока)</option></select></label><FlowChoice label="Протокол" value={protocol} options={PROTOCOL_OPTIONS}
      placeholder="Например, WebSocket" onChange={value=>{
        const previousPort=SUGGESTED_PORTS[protocol]
        if((!port||Boolean(previousPort&&port===previousPort))&&SUGGESTED_PORTS[value])
          setPort(SUGGESTED_PORTS[value])
        setProtocol(value)
      }}/>
    <FlowChoice label="Порт" value={port} options={PORT_OPTIONS}
      placeholder="Например, 9443 или 5000-5010" onChange={setPort}/>
    <FlowChoice label="Защита" value={security} options={SECURITY_OPTIONS}
      placeholder="Например, TLS 1.3 + VPN" onChange={setSecurity}/><button onClick={()=>{addFlow();setReviewOpen(true)}}>Добавить поток</button></div>}
   {(tool==='network'||(tool==='move'&&inspectedVM))&&<div className="boardToolFields"><label>Интерфейс для перемещения в сеть <select value={interfaceId} onChange={e=>setInterfaceId(e.target.value)}><option value="">Автоматически, если один</option>{interfaces.filter(n=>items.some(i=>i.id===n.item_id)).map(n=><option key={n.id} value={n.id}>{items.find(i=>i.id===n.item_id)?.name} · {n.name}</option>)}</select></label><span>Перетащите ВМ в прямоугольник сети – привязка попадёт в черновик. Перемещение на поле сохраняется только как расположение схемы.</span></div>}

       {tool==='move'&&inspectedVM&&<aside className="boardInspector" role="dialog" aria-modal="false" aria-label={'Паспорт компонента '+inspectedVM.name}>
     <div className="boardInspectorHeader"><div><small>Паспорт компонента</small><h3>{inspectedVM.name}</h3></div><button type="button" aria-label="Закрыть паспорт" onClick={()=>{setInspectedId(null);setFocusDependencies(false)}}>✕</button></div>
     <div className="boardInspectorBody">
       {editingPassport&&<div className="boardPassportEdit"><label>Название<input aria-label="Название компонента" value={passportDraft.name} onChange={e=>setPassportDraft(p=>({...p,name:e.target.value}))}/></label><label>Описание<textarea aria-label="Описание компонента" value={passportDraft.description} onChange={e=>setPassportDraft(p=>({...p,description:e.target.value}))}/></label><label>Назначение<input aria-label="Назначение компонента" value={passportDraft.purpose} onChange={e=>setPassportDraft(p=>({...p,purpose:e.target.value}))}/></label><label>Среда<input aria-label="Среда компонента" value={passportDraft.environment} onChange={e=>setPassportDraft(p=>({...p,environment:e.target.value}))}/></label><div><button type="button" disabled={!passportDraft.name.trim()} onClick={stagePassport}>Добавить в черновик</button><button type="button" onClick={()=>setEditingPassport(false)}>Отмена</button></div></div>}
        {!editingPassport&&<dl><dt>Тип</dt><dd>{inspectedVM.kind}</dd><dt>Система</dt><dd>{ownerName||inspectedVM.system_id}</dd><dt>Назначение</dt><dd>{inspectedVM.description||String(inspectedVM.details?.purpose||inspectedVM.details?.role||'Не указано')}</dd><dt>Среда</dt><dd>{String(inspectedVM.details?.environment||'Не указана')}</dd></dl>}
       <h4>Сетевые интерфейсы</h4>
       {interfaces.filter(n=>n.item_id===inspectedVM.id).map(n=><div className="boardInspectorItem" key={n.id}><strong>{n.name}</strong><small>{[n.zone_id&&'Зона: '+(networks.find(x=>x.id===n.zone_id)?.name||n.zone_id),n.vlan_id&&'VLAN: '+(networks.find(x=>x.id===n.vlan_id)?.name||n.vlan_id),n.vrf_id&&'VRF: '+(networks.find(x=>x.id===n.vrf_id)?.name||n.vrf_id)].filter(Boolean).join(' · ')||'Без сетевой привязки'}</small></div>)}
       {!interfaces.some(n=>n.item_id===inspectedVM.id)&&<p>Интерфейсы не указаны.</p>}
       <h4>Связанные потоки ({inspectedFlows.length})</h4>
       {inspectedFlows.map(f=><div className="boardInspectorItem" key={f.id}><strong>{f.name||'Поток'}</strong><span>{allVMs.find(v=>v.id===f.source_id)?.name||f.source_id} → {allVMs.find(v=>v.id===f.target_id)?.name||f.target_id}</span><small>{f.protocol||'Протокол не указан'}{f.port?':'+f.port:''}</small></div>)}
       {!inspectedFlows.length&&<p>Связанных потоков нет.</p>}
     </div>
     <div className="boardInspectorActions"><button type="button" onClick={()=>setEditingPassport(v=>!v)}>{editingPassport?"Скрыть редактирование":"Редактировать паспорт"}</button><label><input type="checkbox" checked={focusDependencies} onChange={e=>setFocusDependencies(e.target.checked)}/> Выделить зависимости</label><button type="button" onClick={()=>{setFrom(inspectedVM.id);setTo('');setTool('flow');setInspectedId(null);setFocusDependencies(false)}}>Добавить поток</button><button type="button" onClick={()=>{setInspectedId(null);setFocusDependencies(false)}}>Закрыть</button></div>
   </aside>}
       {reviewOpen&&changes.length>0&&<div className="boardReview"><div className="boardReviewHeader"><strong>Черновик: {changes.length} изменений</strong><button type="button" onClick={()=>setReviewOpen(false)} aria-label="Закрыть черновик">✕</button></div><label>Причина изменений <input value={reason} onChange={e=>{setReason(e.target.value);setPreview(null)}} placeholder="Например: актуализация схемы ИС после изменения сети"/></label><button disabled={!changes.length||busy} onClick={submitPreview}>Проверить изменения ({changes.length})</button><button disabled={!changes.length||busy} onClick={discardDraft}>Отменить черновик</button></div>}
     </aside>}
     {(Boolean(error)||Boolean(layoutMessage))&&<div className="boardCanvasToast" role="status">{error||layoutMessage}<button type="button" aria-label="Закрыть сообщение" onClick={()=>{setError('');setLayoutMessage('')}}>✕</button></div>}
   </div>
   {exitPrompt&&<div className="boardConfirm" role="dialog" aria-modal="true" aria-label="Несохранённые изменения схемы">
     <div className="boardConfirmInner">
       <h3>Есть несохранённые изменения</h3>
       <p>Черновик: {changes.length} операций. {layoutDirty?'Расположение объектов также изменено.':''} При выходе без сохранения изменения будут потеряны.</p>
       <div>
         <button type="button" onClick={()=>setExitPrompt(false)}>Продолжить редактирование</button>
         <button type="button" onClick={()=>{setExitPrompt(false);discardDraft();onExit?.()}}>Выйти без сохранения</button>
         <button type="button" className="primary" disabled={busy||layoutBusy} onClick={()=>void saveBeforeExit()}>Сохранить и выйти</button>
       </div>
     </div>
   </div>}
   {showHistory&&<div className="boardConfirm" role="dialog" aria-modal="true" aria-label="Журнал изменений архитектуры"><div className="boardConfirmInner"><h3>Журнал изменений схемы</h3><p>Последние подтверждённые пакеты операций.</p><ol>{history.map(entry=><li key={entry.id}><strong>{entry.timestamp}</strong> – {entry.reason} · {entry.changes.length} операций<details><summary>Посмотреть состав</summary><pre>{JSON.stringify(entry.changes,null,2)}</pre></details></li>)}</ol>{!history.length&&<p>Записей пока нет.</p>}<button type="button" onClick={()=>setShowHistory(false)}>Закрыть</button></div></div>}
   {preview&&<div className="boardConfirm" role="dialog" aria-modal="true" aria-label="Подтверждение изменений архитектуры"><div className="boardConfirmInner"><h3>Подтверждение изменений</h3><p>Причина: {reason}. Будет сохранено {preview.count} операций. Для существующих интерфейсов сверяется прежняя сеть.</p><ol>{preview.changes.map((c,i)=><li key={i}><strong>{c.action}</strong> · {c.id}<pre>{JSON.stringify({before:c.before,after:c.after},null,2)}</pre></li>)}</ol><div><button disabled={busy} onClick={()=>setPreview(null)}>Вернуться к схеме</button><button disabled={busy} className="primary" onClick={commit}>Подтвердить и записать в журнал</button></div></div></div>}
 </section>
}

export default function ArchitectureBoard(props:Props){return <ReactFlowProvider><Editor {...props}/></ReactFlowProvider>}
