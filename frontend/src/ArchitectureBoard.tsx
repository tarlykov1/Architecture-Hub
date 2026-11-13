import React, {useEffect, useMemo, useRef, useState} from 'react'
import './board.css'
import {DiagramNodeLabel,diagramCardStyle} from './DiagramVisual'
import MonitoringPanel from './MonitoringPanel'
import ExistingFlowEditor, {type FlowValues} from './ExistingFlowEditor'
import FlowAttributeMap from './FlowAttributeMap'
import {AutoFit} from './WorkspaceUI'
import {MousePointer2, Monitor, GitBranch, SquareDashed, Maximize2, Save, History, ClipboardCheck} from 'lucide-react'
import {ReactFlow, ReactFlowProvider, Background, Controls, Handle, NodeResizer, useNodesState, useReactFlow, MarkerType, Position, type Node, type NodeChange, type NodeProps} from '@xyflow/react'
import {compactComponentLayout,flowCountLabel} from './graphLayout'
import {ReciprocalEdge} from './ReciprocalEdge'
import {ObstacleAwareEdge} from './ObstacleAwareEdge'
import {FlowPortHandles, autoFlowPorts, closestVisiblePort, type FlowPortPair, type FlowEnd} from './flowPorts'

type VM = {id:string;system_id:string;kind:string;name:string;description?:string;details:Record<string,unknown>}
type Network = {id:string;name:string;kind:string}
type NIC = {id:string;item_id:string;name:string;zone_id:string|null;vlan_id:string|null;vrf_id:string|null}
type Flow = {id:string;source_id:string;target_id:string;name:string;protocol:string;port:string;security:string;data_description:string;schedule:string;verification:string}
type Change = {action:'create_vm'|'create_network'|'create_flow'|'update_flow'|'create_interface'|'move_interface'|'update_vm';id?:string;system_id?:string;name?:string;kind?:string;description?:string;source_id?:string;target_id?:string;protocol?:string;port?:string;security?:string;data_description?:string;schedule?:string;verification?:string;interface_id?:string;item_id?:string;interface_name?:string;network_id?:string|null;previous_network_id?:string|null;previous_name?:string;previous_description?:string;previous_flow?:FlowValues;previous_source_id?:string;previous_target_id?:string;details_patch?:Record<string,string>;previous_details?:Record<string,unknown>;network_field?:'zone_id'|'vlan_id'|'vrf_id'}
type Preview = {changes:Array<{action:string;id:string;before:unknown;after:unknown;field?:string;endpoints?:{before:[string,string];after:[string,string]}}>;count:number}
type Props = {systemId:string;demoMode:boolean;ownerName?:string;ownerBySystemId?:Record<string,string>;items:VM[];networks:Network[];interfaces:NIC[];flows:Flow[];savedPositions?:Record<string,{x:number;y:number}>;onPositionChange?:(node:Node)=>void;request:<T>(url:string,init?:RequestInit)=>Promise<T>;onCommitted:()=>Promise<void>;onEditNetwork?:(id:string)=>void;onDraftStateChange?:(pending:boolean)=>void}
type Tool = 'move'|'vm'|'flow'|'network'
// Eight geometrically independent handles per VM, each usable for outgoing
// and incoming data flows. Target handles are invisible but stay measurable.
function BoardComponentNode({data}:NodeProps){
 const drawing=Boolean(data.flowMode)
 const props=data as {label:React.ReactNode;flowMode?:boolean;onDirectClick?:()=>void;
  onStartFlow?:(handle:string,event:React.PointerEvent<HTMLDivElement>)=>void;
  onMoveFlow?:(event:React.PointerEvent<HTMLDivElement>)=>void;
  onFinishFlow?:(event:React.PointerEvent<HTMLDivElement>)=>void}
 return <>
  <div className="boardComponentClickArea" onClick={event=>{if(drawing){event.stopPropagation();props.onDirectClick?.()}}}>{props.label}</div>
  <FlowPortHandles visible={drawing} sourcePointerDown={props.onStartFlow}
    sourcePointerMove={props.onMoveFlow} sourcePointerUp={props.onFinishFlow}/>
 </>
}
function BoardNetworkNode({data}:NodeProps){
 const options=data as {label:React.ReactNode;resizable?:boolean;onResize?:(size:{x:number;y:number;width:number;height:number})=>void;onPointerDown?:(event:React.PointerEvent<HTMLDivElement>)=>void;onPointerMove?:(event:React.PointerEvent<HTMLDivElement>)=>void;onPointerUp?:(event:React.PointerEvent<HTMLDivElement>)=>void;onPointerCancel?:(event:React.PointerEvent<HTMLDivElement>)=>void}
 return <>
  <div className="boardNetworkDragArea" onPointerDown={options.onPointerDown} onPointerMove={options.onPointerMove} onPointerUp={options.onPointerUp} onPointerCancel={options.onPointerCancel}>{options.label}</div>
  <NodeResizer isVisible={Boolean(options.resizable)} minWidth={140} minHeight={90}
   lineStyle={{borderColor:'#2563eb'}} handleStyle={{width:9,height:9,border:'1px solid #fff',borderRadius:2,background:'#2563eb'}}
   onResize={(_,params)=>options.onResize?.({x:params.x,y:params.y,width:params.width,height:params.height})}/>
 </>
}
const boardNodeTypes={boardComponent:BoardComponentNode,boardNetwork:BoardNetworkNode}
type Rect = {id:string;name:string;kind:string;x:number;y:number;width:number;height:number}
type Geometry = {x:number;y:number;width?:number;height?:number;parent_id?:string}
const makeId=()=>crypto.randomUUID()
const rectContains=(r:Rect,p:{x:number;y:number})=>p.x>=r.x&&p.x<=r.x+r.width&&p.y>=r.y&&p.y<=r.y+r.height
// Nested rectangles are presentation groups only; no NIC or L3 membership is implied.
const rectFullyInside=(outer:Rect,inner:Rect)=>inner.id!==outer.id&&inner.x>=outer.x&&inner.y>=outer.y&&inner.x+inner.width<=outer.x+outer.width&&inner.y+inner.height<=outer.y+outer.height
const permittedParent=(childKind:string,parentKind:string)=>childKind==='vrf'?parentKind==='zone':childKind==='vlan'?(parentKind==='vrf'||parentKind==='zone'):childKind==='zone'?parentKind==='zone':true
const descendants=(root:string,parents:Record<string,string>):Set<string>=>{
 const result=new Set<string>(),queue=[root]
 for(let i=0;i<queue.length;i++){
  for(const [child,parent] of Object.entries(parents)){
   if(parent===queue[i]&&!result.has(child)){result.add(child);queue.push(child)}
  }
 }
 return result
}
const fieldForKind=(kind:string):'zone_id'|'vlan_id'|'vrf_id'=>kind==='vlan'?'vlan_id':kind==='vrf'?'vrf_id':'zone_id'
// Save uncommitted UI work across navigating away from the editor in the same tab.
// This is a local draft only: the API registry is changed by /api/board/commit.
type StoredBoardDraft={changes:Change[];rectangles:Rect[];positions:Record<string,{x:number;y:number}>;parents?:Record<string,string>;flowAnchors?:Record<string,FlowPortPair>;reason:string}
const draftKey=(systemId:string)=>'architecture-hub:board-draft:v1:'+systemId
function readBoardDraft(systemId:string):StoredBoardDraft|null{
 try{
  const raw=sessionStorage.getItem(draftKey(systemId))
  if(!raw)return null
  const value=JSON.parse(raw) as Partial<StoredBoardDraft>
  if(!Array.isArray(value.changes)||!Array.isArray(value.rectangles)||!value.changes.length)return null
  return {changes:value.changes.filter(c=>c&&typeof c.action==='string'),rectangles:value.rectangles.filter(r=>r&&typeof r.id==='string'),positions:value.positions&&typeof value.positions==='object'?value.positions:{},parents:value.parents&&typeof value.parents==='object'?value.parents:{},flowAnchors:value.flowAnchors&&typeof value.flowAnchors==='object'?value.flowAnchors:{},reason:typeof value.reason==='string'?value.reason:''}
 }catch{return null}
}

function Editor({systemId,demoMode,ownerName='',ownerBySystemId={},items,networks,interfaces,flows,savedPositions={},onPositionChange,request,onCommitted,onEditNetwork,onDraftStateChange}:Props){
 const [restoredDraft]=useState<StoredBoardDraft|null>(()=>readBoardDraft(systemId))
 const [tool,setTool]=useState<Tool>('move')
 const [drawingConnection,setDrawingConnection]=useState(false)
 const [draggingNode,setDraggingNode]=useState(false)
 const [canvasInteracted,setCanvasInteracted]=useState(false)
 const boardCanvasRef=useRef<HTMLDivElement>(null)
 const flowGesture=useRef<{sourceId:string;sourceHandle:string;start:{x:number;y:number}}|null>(null)
 const retargetGesture=useRef<{flowId:string;end:FlowEnd}|null>(null)
 const [preferredSourceHandle,setPreferredSourceHandle]=useState('')
 const [flowGhost,setFlowGhost]=useState<{start:{x:number;y:number};end:{x:number;y:number}}|null>(null)
 const [inspectedId,setInspectedId]=useState<string|null>(null)
 const [inspectedNetworkId,setInspectedNetworkId]=useState<string|null>(null)
 const [focusDependencies,setFocusDependencies]=useState(false)
 const [editingPassport,setEditingPassport]=useState(false)
 const [passportDraft,setPassportDraft]=useState({name:'',description:'',purpose:'',environment:''})
 const [changes,setChanges]=useState<Change[]>(()=>restoredDraft?.changes||[])
 const [layoutDirty,setLayoutDirty]=useState(false)
 const [layoutBusy,setLayoutBusy]=useState(false)
 const [layoutMessage,setLayoutMessage]=useState('')
 const [reason,setReason]=useState(restoredDraft?.reason||'')
 const [preview,setPreview]=useState<Preview|null>(null)
 const [error,setError]=useState('')
 const [busy,setBusy]=useState(false)
 const [history,setHistory]=useState<Array<{id:string;timestamp:string;reason:string;changes:Preview['changes']}>>([])
 const [showHistory,setShowHistory]=useState(false)
 const [name,setName]=useState('')
 const [kind,setKind]=useState<'zone'|'vlan'|'vrf'>('zone')
 const [from,setFrom]=useState('')
 const [selectedDraftFlowId,setSelectedDraftFlowId]=useState('')
 const [selectedExistingFlowId,setSelectedExistingFlowId]=useState('')
 const [selectedEdgeFlowIds,setSelectedEdgeFlowIds]=useState<string[]>([])
 const [to,setTo]=useState('')
 const [direction,setDirection]=useState<'forward'|'reverse'|'both'>('forward')
 const [protocol,setProtocol]=useState('') // Unknown until an architect confirms the transport.
 const [port,setPort]=useState('')
 const [security,setSecurity]=useState('unknown')

 const [snapToGrid,setSnapToGrid]=useState(false)
 const [drawing,setDrawing]=useState<{x:number;y:number}|null>(null)
 const networkStart=useRef<{x:number;y:number}|null>(null)
 const networkNameInput=useRef<HTMLInputElement>(null)
 const networkStartPixel=useRef<{x:number;y:number}|null>(null)
 const [networkPreview,setNetworkPreview]=useState<{x:number;y:number;width:number;height:number}|null>(null)
 const [reviewOpen,setReviewOpen]=useState(Boolean(restoredDraft?.changes.length))
 const [parents,setParents]=useState<Record<string,string>>(restoredDraft?.parents||{})
 const [flowAnchors,setFlowAnchors]=useState<Record<string,FlowPortPair>>(restoredDraft?.flowAnchors||{})
 const persistedFlowAnchors=useRef<Record<string,FlowPortPair>>({})
 const persistedParents=useRef<Record<string,string>>({})
 const [pendingGrouping,setPendingGrouping]=useState<null|{id:string;name:string;from:string|null;to:string|null;newlyCreated?:boolean;snapshot?:{rects:Rect[];nodes:Node[];dirty:boolean}}>(null)
 const [nicForGrouping,setNicForGrouping]=useState('')
 const [newNicName,setNewNicName]=useState('eth0')
 const dragSnapshot=useRef<null|{rects:Rect[];nodes:Node[];dirty:boolean}>(null)
 const [rectangles,setRectangles]=useState<Rect[]>(()=>{
   const relevant = networks.filter(n=>interfaces.some(nic=>nic[fieldForKind(n.kind)]===n.id&&items.some(item=>item.id===nic.item_id)))
   const heights=relevant.map(n=>{
     const members=items.filter(item=>interfaces.some(nic=>nic.item_id===item.id&&nic[fieldForKind(n.kind)]===n.id)).length
     return Math.max(340,90+Math.ceil(members/2)*175)
   })
   const defaults=relevant.map((n,i)=>{
     const row=Math.floor(i/2)
     let y=60
     for(let previous=0;previous<row;previous++)y+=Math.max(heights[previous*2]||0,heights[previous*2+1]||0)+50
     return {id:n.id,name:n.name,kind:n.kind,x:60+(i%2)*600,y,width:540,height:heights[i]}
   })
   const validIds=new Set([...networks.map(n=>n.id),...(restoredDraft?.changes||[]).filter(c=>c.action==='create_network').map(c=>c.id)])
   const restored=(restoredDraft?.rectangles||[]).filter(r=>validIds.has(r.id))
   const restoredIds=new Set(restored.map(r=>r.id))
   return [...defaults.filter(r=>!restoredIds.has(r.id)),...restored]
 })
 const initialNodes=useMemo<Node[]>(()=>{
   const positions=compactComponentLayout(items.map(i=>i.id),flows.filter(f=>items.some(i=>i.id===f.source_id)&&items.some(i=>i.id===f.target_id)).map(f=>({source:f.source_id,target:f.target_id})),280,175)
   return items.map((item,i)=>{
     const membership=interfaces.find(n=>n.item_id===item.id)
     const group=rectangles.find(r=>membership?.[fieldForKind(r.kind)]===r.id)
     const members=group?items.filter(v=>interfaces.some(n=>n.item_id===v.id&&n[fieldForKind(group.kind)]===group.id)):[]
     const index=group?members.findIndex(v=>v.id===item.id):i
     const position=savedPositions[item.id]|| (group?{x:group.x+25+(index%2)*265,y:group.y+65+Math.floor(index/2)*175}:positions[item.id]||{x:70+(i%4)*280,y:80+Math.floor(i/4)*175})
     return {id:item.id,type:'boardComponent',position,sourcePosition:Position.Bottom,targetPosition:Position.Top,data:{label:<DiagramNodeLabel name={item.name} kind={item.kind} subtitle={ownerBySystemId[item.system_id]||ownerName} detail={item.kind+' · '+String(item.details.environment||'Среда не задана')}><small className="componentNodePurpose">{item.description?.trim()||String(item.details.purpose||item.details.role||'Назначение не описано')}</small></DiagramNodeLabel>,flowMode:tool==='flow'},style:diagramCardStyle({zIndex:2})}
   })
 },[items,flows,interfaces,ownerName,ownerBySystemId,tool]) // Keep dragged coordinates in React Flow during the editing session.
 const restoredNodes:Node[]=[...initialNodes,...(restoredDraft?.changes||[]).filter(c=>c.action==='create_vm'&&c.id&&c.name).filter(c=>!initialNodes.some(n=>n.id===c.id)).map((c,i)=>({
   id:c.id!,type:'boardComponent',position:restoredDraft?.positions[c.id!]||{x:90+(i%4)*280,y:100+Math.floor(i/4)*175},
   sourcePosition:Position.Bottom,targetPosition:Position.Top,
   data:{label:<DiagramNodeLabel name={c.name||"ВМ без имени"} kind="vm" subtitle={ownerName} detail="ВМ · Черновик"/>,flowMode:tool==='flow'},
   style:diagramCardStyle({border:'1px dashed #d97706'})
  }))]
 const [nodes,setNodes,onNodesChange]=useNodesState<Node>(restoredNodes)
 const visualGroupDrag=useRef<{id:string;origin:{x:number;y:number};rects:Rect[];members:Node[]}|null>(null)
 const manualNetworkDrag=useRef<{id:string;startPointer:{x:number;y:number};startPosition:{x:number;y:number};lastPosition:{x:number;y:number};moved:boolean}|null>(null)
 const startVisualGroupDrag=(node:Node)=>{
   dragSnapshot.current={rects:rectangles.map(r=>({...r})),nodes:nodes.map(n=>({...n,position:{...n.position}})),dirty:layoutDirty}
   if(!node.id.startsWith('network:')){visualGroupDrag.current=null;return}
   const parent=rectangles.find(r=>r.id===node.id.slice('network:'.length))
   if(!parent){visualGroupDrag.current=null;return}
   const childIds=descendants(node.id,parents)
   visualGroupDrag.current={id:node.id,origin:{x:parent.x,y:parent.y},
     rects:rectangles.filter(rect=>childIds.has('network:'+rect.id)),
     members:nodes.filter(n=>childIds.has(n.id))}
 }
 const updateVisualGroupDrag=(node:Node,finished=false)=>{
   const group=visualGroupDrag.current
   if(!group||group.id!==node.id)return
   const dx=node.position.x-group.origin.x,dy=node.position.y-group.origin.y
   if(!dx&&!dy){if(finished)visualGroupDrag.current=null;return}
   const childPositions=new Map(group.rects.map(r=>[r.id,{x:r.x+dx,y:r.y+dy}]))
   setRectangles(previous=>previous.map(rect=>childPositions.has(rect.id)?{...rect,...childPositions.get(rect.id)!}:rect))
   const vmPositions=new Map(group.members.map(member=>[member.id,{x:member.position.x+dx,y:member.position.y+dy}]))
   setNodes(previous=>previous.map(member=>vmPositions.has(member.id)?{...member,position:vmPositions.get(member.id)!}:member))
   if(finished){
     for(const member of group.members)onPositionChange?.({...member,position:vmPositions.get(member.id)!})
     setLayoutDirty(true)
     setLayoutMessage('Группа с вложенными объектами перемещена. Сохраните расположение.')
     visualGroupDrag.current=null
   }
 }
 const candidateGroup=(node:Node):string|null=>{
   const child=node.id.startsWith('network:')?rectangles.find(r=>r.id===node.id.slice(8)):undefined
   const point=child?{x:node.position.x+child.width/2,y:node.position.y+child.height/2}:{x:node.position.x+100,y:node.position.y+45}
   const excluded=descendants(node.id,parents)
   const candidates=rectangles.filter(r=>!excluded.has('network:'+r.id)&&'network:'+r.id!==node.id&&
     (!child||permittedParent(child.kind,r.kind))&&rectContains(r,point)&&
     (!child||rectFullyInside(r,{...child,x:node.position.x,y:node.position.y})))
   candidates.sort((a,b)=>a.width*a.height-b.width*b.height)
   return candidates.length?'network:'+candidates[0].id:null
 }
 const finishVisualDrop=(node:Node)=>{
   updateVisualGroupDrag(node,true)
   const target=candidateGroup(node),previous=parents[node.id]||null
   if(target!==previous){
     const label=node.id.startsWith('network:')?rectangles.find(r=>r.id===node.id.slice(8))?.name:items.find(v=>v.id===node.id)?.name
     setPendingGrouping({id:node.id,name:label||node.id,from:previous,to:target,snapshot:dragSnapshot.current||undefined})
     setNicForGrouping('');setNewNicName('eth0')
     setInspectedId(null);setInspectedNetworkId(null)
   }
   dragSnapshot.current=null
 }
 // Network containers are manipulated through a dedicated pointer-captured
 // title bar. React Flow's controlled node updates can otherwise lose a drag
 // when network geometry is represented by rectangles instead of useNodesState.
 const beginManualNetworkDrag=(id:string,event:React.PointerEvent<HTMLDivElement>)=>{
   if(tool!=='move'||event.button!==0)return
   const rect=rectangles.find(r=>r.id===id)
   if(!rect)return
   event.stopPropagation();event.preventDefault()
   setCanvasInteracted(true)
   const origin=screenToFlowPosition({x:event.clientX,y:event.clientY})
   manualNetworkDrag.current={id,startPointer:origin,startPosition:{x:rect.x,y:rect.y},lastPosition:{x:rect.x,y:rect.y},moved:false}
   startVisualGroupDrag({id:'network:'+id,position:{x:rect.x,y:rect.y}} as Node)
   event.currentTarget.setPointerCapture(event.pointerId)
 }
 const moveManualNetworkDrag=(id:string,event:React.PointerEvent<HTMLDivElement>)=>{
   const drag=manualNetworkDrag.current
   if(!drag||drag.id!==id)return
   event.stopPropagation()
   const pointer=screenToFlowPosition({x:event.clientX,y:event.clientY})
   const position={x:drag.startPosition.x+pointer.x-drag.startPointer.x,y:drag.startPosition.y+pointer.y-drag.startPointer.y}
   drag.lastPosition=position
   if(Math.hypot(position.x-drag.startPosition.x,position.y-drag.startPosition.y)<3&&!drag.moved)return
   drag.moved=true
   setDraggingNode(true)
   setRectangles(previous=>previous.map(rect=>rect.id===id?{...rect,...position}:rect))
   updateVisualGroupDrag({id:'network:'+id,position} as Node)
 }
 const finishManualNetworkDrag=(id:string,event:React.PointerEvent<HTMLDivElement>)=>{
   const drag=manualNetworkDrag.current
   if(!drag||drag.id!==id)return
   event.stopPropagation()
   if(event.currentTarget.hasPointerCapture(event.pointerId))event.currentTarget.releasePointerCapture(event.pointerId)
   manualNetworkDrag.current=null
   setDraggingNode(false)
   if(drag.moved){
     const node={id:'network:'+id,position:drag.lastPosition} as Node
     finishVisualDrop(node);moveNode(node)
   }else{
     visualGroupDrag.current=null;dragSnapshot.current=null
     setInspectedNetworkId(id);setInspectedId(null);setFocusDependencies(false)
   }
 }
 const cancelManualNetworkDrag=(id:string,event:React.PointerEvent<HTMLDivElement>)=>{
   const drag=manualNetworkDrag.current
   if(!drag||drag.id!==id)return
   event.stopPropagation()
   if(event.currentTarget.hasPointerCapture(event.pointerId))event.currentTarget.releasePointerCapture(event.pointerId)
   manualNetworkDrag.current=null;visualGroupDrag.current=null
   if(drag.moved)cancelGrouping()
   setDraggingNode(false)
 }
 const updateNetworkSize=(id:string,size:{x:number;y:number;width:number;height:number})=>{
   const current=rectangles.find(r=>r.id===id)
   if(!current)return
   const childIds=descendants('network:'+id,parents),next={...current,...size}
   const overflowingRect=rectangles.some(r=>childIds.has('network:'+r.id)&&!rectFullyInside(next,r))
   const overflowingVM=nodes.some(n=>childIds.has(n.id)&&
     (!rectContains(next,{x:n.position.x,y:n.position.y})||
      !rectContains(next,{x:n.position.x+195,y:n.position.y+95})))
   if(overflowingRect||overflowingVM){
     setLayoutMessage('Граница не может исключать связанные объекты. Сначала переместите их или увеличьте контейнер.')
     return
   }
   setRectangles(prev=>prev.map(r=>r.id===id?next:r))
   setLayoutDirty(true)
 }

 useEffect(()=>{
  onDraftStateChange?.(changes.length>0)
 },[changes.length,onDraftStateChange])
 useEffect(()=>{
  try{
   if(!changes.length){sessionStorage.removeItem(draftKey(systemId));return}
   sessionStorage.setItem(draftKey(systemId),JSON.stringify({
    changes,rectangles,parents,flowAnchors,reason,
    positions:Object.fromEntries(nodes.map(n=>[n.id,{x:n.position.x,y:n.position.y}]))
   } satisfies StoredBoardDraft))
  }catch{/* Storage might be unavailable: the visible draft remains in memory. */}
 },[changes,rectangles,parents,flowAnchors,reason,nodes,systemId])
 useEffect(()=>{
  if(!changes.length)return
  const preventClose=(event:BeforeUnloadEvent)=>{event.preventDefault();event.returnValue=''}
  window.addEventListener('beforeunload',preventClose)
  return ()=>window.removeEventListener('beforeunload',preventClose)
 },[changes.length])

 // Keep the editor in sync when the selected system or inventory changes,
 // without resetting coordinates that the user has already dragged.
 useEffect(()=>{
   const currentIds=new Set([...initialNodes.map(node=>node.id),...changes.filter(c=>c.action==='create_vm').map(c=>c.id!).filter(Boolean)])
   setNodes(previous=>{
     const retained=previous.filter(node=>currentIds.has(node.id))
     const retainedIds=new Set(retained.map(node=>node.id))
     const added=initialNodes.filter(node=>!retainedIds.has(node.id))
     const synced=retained.map(node=>node.id.startsWith('network:')?node:{...node,data:{...node.data,flowMode:tool==='flow'}})
     if(!added.length&&retained.length===previous.length&&synced.every((node,i)=>node.data.flowMode===previous[i]?.data.flowMode))return previous
     return [...synced,...added]
   })
 },[initialNodes,changes,setNodes,tool])
 const {screenToFlowPosition,fitView}=useReactFlow()
 const allVMs=useMemo<VM[]>(()=>[...items,...changes.filter(c=>c.action==='create_vm').map(c=>({id:c.id!,name:c.name!,system_id:systemId,kind:'vm',description:'',details:{} as Record<string,unknown>}))],[items,changes,systemId])
 const flowEndpointLabel=(ids:[string,string])=>ids.map(id=>allVMs.find(vm=>vm.id===id)?.name||id).join(' → ')
 const allNetworks=[...networks,...changes.filter(c=>c.action==='create_network').map(c=>({id:c.id!,name:c.name!,kind:c.kind!}))]
 const visibleRects=rectangles.filter(r=>allNetworks.some(n=>n.id===r.id))
 const draftNetworks=new Set(changes.filter(c=>c.action==='create_network').map(c=>c.id))
 const backgroundNodes:Node[]=visibleRects.map(r=>({id:'network:'+r.id,type:'boardNetwork',position:{x:r.x,y:r.y},width:r.width,height:r.height,measured:{width:r.width,height:r.height},draggable:false,selectable:true,connectable:false,data:{onPointerDown:(event:React.PointerEvent<HTMLDivElement>)=>beginManualNetworkDrag(r.id,event),onPointerMove:(event:React.PointerEvent<HTMLDivElement>)=>moveManualNetworkDrag(r.id,event),onPointerUp:(event:React.PointerEvent<HTMLDivElement>)=>finishManualNetworkDrag(r.id,event),onPointerCancel:(event:React.PointerEvent<HTMLDivElement>)=>cancelManualNetworkDrag(r.id,event),resizable:tool==='move',onResize:(size:{x:number;y:number;width:number;height:number})=>updateNetworkSize(r.id,size),label:<div className="boardNetworkLabel"><strong>{r.name} · {r.kind.toUpperCase()}</strong><small>{draftNetworks.has(r.id)?'Черновик · ещё не сохранён':parents['network:'+r.id]?'В группе: '+(allNetworks.find(n=>'network:'+n.id===parents['network:'+r.id])?.name||'сеть'):'Свободная зона'} · {tool==='move'?'Тяните край для изменения размера':''}</small></div>},style:{width:r.width,height:r.height,background:draftNetworks.has(r.id)?'#fff7ed29':'#dbeafe15',border:draftNetworks.has(r.id)?'2px dashed #d97706':'2px dashed #2563eb',borderRadius:9,zIndex:10+(()=>{let depth=0,p=parents['network:'+r.id];while(p&&depth<10){depth++;p=parents[p]}return depth})(),pointerEvents:'none',textAlign:'left',padding:12,fontSize:13,color:'#1e40af'}}))
 const graphNodes=[...backgroundNodes,...nodes]
 // A pair of machines has one readable connection; its technical flows stay separate records.
 const pendingFlows=changes.filter(c=>c.action==='create_flow').map(c=>({id:c.id!,source_id:c.source_id!,target_id:c.target_id!,protocol:c.protocol||'',port:c.port||'',name:c.name||'',security:c.security||'unknown',data_description:c.data_description||'',schedule:'',verification:'draft'}))
 const effectiveSavedFlows=flows.map(flow=>{
   const edit=changes.find(c=>c.action==='update_flow'&&c.id===flow.id)
   return edit?{...flow,source_id:edit.source_id??flow.source_id,target_id:edit.target_id??flow.target_id,name:edit.name??flow.name,protocol:edit.protocol??flow.protocol,port:edit.port??flow.port,security:edit.security??flow.security,
     data_description:edit.data_description??flow.data_description,schedule:edit.schedule??flow.schedule,verification:edit.verification??flow.verification}:flow
 })
 const effectiveFlows=[...effectiveSavedFlows,...pendingFlows]
 const automaticPorts=(source:string,target:string):FlowPortPair=>{
   const a=nodes.find(n=>n.id===source),b=nodes.find(n=>n.id===target)
   return autoFlowPorts(
     {x:(a?.position.x||0)+110,y:(a?.position.y||0)+50},
     {x:(b?.position.x||0)+110,y:(b?.position.y||0)+50}
   )
 }
 const portsForFlow=(flow:Flow):FlowPortPair=>flowAnchors[flow.id]||automaticPorts(flow.source_id,flow.target_id)
 // Two flows share a painted arrow only if both actual endpoint handles match.
 const flowGroupKey=(flow:Flow)=>{
   const anchors=portsForFlow(flow)
   return [flow.source_id,flow.target_id,anchors.source_handle,anchors.target_handle].join('|')
 }
 const flowGroups=new Map<string,Flow[]>()
 for(const flow of effectiveFlows){
   if(!allVMs.some(v=>v.id===flow.source_id)||!allVMs.some(v=>v.id===flow.target_id))continue
   const key=flowGroupKey(flow)
   flowGroups.set(key,[...(flowGroups.get(key)||[]),flow])
 }
 const selectedFlowId=selectedExistingFlowId||selectedDraftFlowId
 // The selected record is authoritative; visual edge grouping is derived
 // separately. Do not require a second list to unlock endpoint editing.
 const selectedFlow=effectiveFlows.find(flow=>flow.id===selectedFlowId)
 const selectedFlowEndpoints=tool==='flow'&&selectedEdgeFlowIds.length&&from&&to?[from,to]:[]
 const activeEdgeFlowIds=selectedFlow
   ? (flowGroups.get(flowGroupKey(selectedFlow))||[]).map(flow=>flow.id)
   : selectedEdgeFlowIds
 const relatedIds=new Set(inspectedId?[inspectedId,...effectiveFlows.filter(f=>f.source_id===inspectedId||f.target_id===inspectedId).flatMap(f=>[f.source_id,f.target_id])]:[])
 const canvasPoint=(x:number,y:number)=>{
   const box=boardCanvasRef.current?.getBoundingClientRect()
   return {x:x-(box?.left||0),y:y-(box?.top||0)}
 }
 const vmElement=(id:string)=>[...(boardCanvasRef.current?.querySelectorAll<HTMLElement>('.react-flow__node-boardComponent')||[])]
   .find(node=>node.dataset.id===id)
 const findDropTarget=(at:{x:number;y:number},exclude:string, end:FlowEnd='target')=>{
   const candidates=[...(boardCanvasRef.current?.querySelectorAll<HTMLElement>('.react-flow__node-boardComponent')||[])]
     .filter(node=>node.dataset.id&&node.dataset.id!==exclude)
   const near=(rect:DOMRect,margin:number)=>at.x>=rect.left-margin&&at.x<=rect.right+margin&&at.y>=rect.top-margin&&at.y<=rect.bottom+margin
   const byHandle=candidates.map(node=>({node,nearest:closestVisiblePort(node,at,end,28)}))
     .filter(x=>x.nearest).sort((a,b)=>a.nearest!.distance-b.nearest!.distance)[0]
   const target=byHandle?.node||candidates.find(node=>near(node.getBoundingClientRect(),8))
   if(!target||!target.dataset.id)return null
   const nearest=closestVisiblePort(target,at,end)
   return nearest?{targetId:target.dataset.id,targetHandle:nearest.id}:null
 }
 const beginFlowPointer=(id:string,handle:string,event:React.PointerEvent<HTMLDivElement>)=>{
   if(tool!=='flow'||event.button!==0)return
   event.stopPropagation();event.preventDefault()
   setCanvasInteracted(true);setPreferredSourceHandle(handle)
   // Use the true port location, even if the pointer is intercepted by the
   // canvas hit-test layer (React Flow's pane can sit over narrow top handles).
   const port=vmElement(id)?.querySelector<HTMLElement>('[data-anchor="'+handle+'"]')
   const bounds=(port||event.currentTarget).getBoundingClientRect()
   const point=canvasPoint(bounds.x+bounds.width/2,bounds.y+bounds.height/2)
   flowGesture.current={sourceId:id,sourceHandle:handle,start:point}
   setFlowGhost({start:point,end:point})
   event.currentTarget.setPointerCapture(event.pointerId)
 }
 const moveFlowPointer=(event:React.PointerEvent<HTMLDivElement>)=>{
   const gesture=flowGesture.current
   if(!gesture)return
   event.stopPropagation()
   setFlowGhost({start:gesture.start,end:canvasPoint(event.clientX,event.clientY)})
 }
 const finishFlowAt=(at:{x:number;y:number})=>{
   const gesture=flowGesture.current
   if(!gesture)return
   const result=findDropTarget(at,gesture.sourceId)
   flowGesture.current=null;setFlowGhost(null)
   if(result){
     stageDirectedFlow(gesture.sourceId,result.targetId,{source_handle:gesture.sourceHandle,target_handle:result.targetHandle})
   }else{
     setFrom(gesture.sourceId);setTo('')
     setLayoutMessage('Точка выхода выбрана. Нажмите на другую ВМ или протяните стрелку к одной из её восьми точек.')
   }
 }
 const endFlowPointer=(event:React.PointerEvent<HTMLDivElement>)=>{
   if(!flowGesture.current)return
   event.stopPropagation()
   if(event.currentTarget.hasPointerCapture(event.pointerId))event.currentTarget.releasePointerCapture(event.pointerId)
   finishFlowAt({x:event.clientX,y:event.clientY})
 }
 const beginReattach=(flowId:string,end:FlowEnd,event:React.PointerEvent<HTMLElement>)=>{
   if(event.button!==0)return
   const flow=effectiveFlows.find(f=>f.id===flowId)
   if(!flow)return
   event.stopPropagation();event.preventDefault()
   retargetGesture.current={flowId,end}
   setCanvasInteracted(true)
   const grip=boardCanvasRef.current?.querySelector<HTMLElement>('.boardEndpointGrip[data-flow-end="'+end+'"]')
   const box=(grip||event.currentTarget).getBoundingClientRect()
   const point=canvasPoint(box.left+box.width/2,box.top+box.height/2)
   setFlowGhost({start:point,end:point})
   event.currentTarget.setPointerCapture(event.pointerId)
 }
 const moveReattach=(event:React.PointerEvent<HTMLElement>)=>{
   if(!retargetGesture.current)return
   event.stopPropagation()
   setFlowGhost(previous=>previous?{...previous,end:canvasPoint(event.clientX,event.clientY)}:null)
 }
 const finishReattachAt=(at:{x:number;y:number})=>{
   const gesture=retargetGesture.current
   if(!gesture)return
   retargetGesture.current=null;setFlowGhost(null)
   const flow=effectiveFlows.find(f=>f.id===gesture.flowId)
   if(!flow)return
   const drop=findDropTarget(at,'',gesture.end)
   if(!drop){setLayoutMessage('Перетащите маркер на точку подключения компонента.');return}
   const movingSource=gesture.end==='source'
   const sourceId=movingSource?drop.targetId:flow.source_id
   const targetId=movingSource?flow.target_id:drop.targetId
   if(sourceId===targetId){setLayoutMessage('У потока должны быть разные источник и получатель.');return}
   const current=portsForFlow(flow)
   const pair={...current,[movingSource?'source_handle':'target_handle']:drop.targetHandle}
   const endpointsChanged=sourceId!==flow.source_id||targetId!==flow.target_id
   if(endpointsChanged){
     const draft=changes.find(c=>c.action==='create_flow'&&c.id===flow.id)
     if(draft){
       setChanges(previous=>[...previous.filter(c=>c!==draft),{...draft,source_id:sourceId,target_id:targetId}])
       setPreview(null);setReviewOpen(true)
     }else{
       const original=flows.find(f=>f.id===flow.id)
       if(!original)return
       stageExistingFlowEdit(original,flowValues(flow),sourceId,targetId)
     }
     setFrom(sourceId);setTo(targetId)
   }else if(pair.source_handle===current.source_handle&&pair.target_handle===current.target_handle)return
   setFlowAnchors(previous=>({...previous,[gesture.flowId]:pair}))
   setLayoutDirty(true)
   setLayoutMessage(endpointsChanged
     ?'Подключение изменено на схеме. Проверьте и подтвердите черновик.'
     :'Точка подключения стрелки изменена. Нажмите «Сохранить», чтобы сохранить расположение концов в схеме.')
   setError('')
 }
 const endReattach=(event:React.PointerEvent<HTMLElement>)=>{
   if(!retargetGesture.current)return
   event.stopPropagation()
   if(event.currentTarget.hasPointerCapture(event.pointerId))event.currentTarget.releasePointerCapture(event.pointerId)
   finishReattachAt({x:event.clientX,y:event.clientY})
 }

 // React Flow's pane, the handle and the edge label can each take pointer
 // capture. A document-level listener guarantees mouseup is observed even
 // when it lands on another handle or outside the original React component.
 // Capture the start before React Flow receives pointerdown, too.
 const suppressFlowClickUntil=useRef(0)
 useEffect(()=>{
   if(tool!=='flow')return
   const canvas=boardCanvasRef.current
   if(!canvas)return
   const center=(element:HTMLElement)=>{
     const rect=element.getBoundingClientRect()
     return {x:rect.left+rect.width/2,y:rect.top+rect.height/2}
   }
   const nearest=(selector:string,point:{x:number;y:number})=>
     [...canvas.querySelectorAll<HTMLElement>(selector)]
       .map(el=>({el,distance:Math.hypot(center(el).x-point.x,center(el).y-point.y)}))
       .sort((a,b)=>a.distance-b.distance)[0]
   const active=()=>Boolean(flowGesture.current||retargetGesture.current)
   const onDown=(event:PointerEvent)=>{
     if(event.button!==0||active())return
     const bounds=canvas.getBoundingClientRect()
     const at={x:event.clientX,y:event.clientY}
     if(at.x<bounds.left||at.x>bounds.right||at.y<bounds.top||at.y>bounds.bottom)return
     const selected=selectedExistingFlowId||selectedDraftFlowId
     if(selected){
       const grip=nearest('.boardEndpointGrip',at)
       const end=grip?.el.dataset.flowEnd
       const flow=effectiveFlows.find(f=>f.id===selected)
       if(grip&&grip.distance<=21&&flow&&(end==='source'||end==='target')){
         event.preventDefault();event.stopPropagation()
         retargetGesture.current={flowId:selected,end}
         setCanvasInteracted(true)
         const point=center(grip.el)
         setFlowGhost({start:canvasPoint(point.x,point.y),end:canvasPoint(point.x,point.y)})
         return
       }
     }
     const source=nearest('.react-flow__node-boardComponent .flowPortSource.boardConnectionHandleActive',at)
     const node=source?.el.closest<HTMLElement>('.react-flow__node-boardComponent')
     const anchor=source?.el.dataset.anchor
     if(!source||source.distance>21||!node?.dataset.id||!anchor)return
     event.preventDefault();event.stopPropagation()
     const point=center(source.el)
     flowGesture.current={sourceId:node.dataset.id,sourceHandle:anchor,start:canvasPoint(point.x,point.y)}
     setPreferredSourceHandle(anchor);setCanvasInteracted(true)
     setFlowGhost({start:canvasPoint(point.x,point.y),end:canvasPoint(point.x,point.y)})
   }
   const onMove=(event:PointerEvent|MouseEvent)=>{
     if(!active())return
     event.preventDefault();event.stopPropagation()
     setFlowGhost(previous=>previous?{...previous,end:canvasPoint(event.clientX,event.clientY)}:null)
   }
   const onUp=(event:PointerEvent|MouseEvent)=>{
     if(!active())return
     event.preventDefault();event.stopPropagation()
     // Do not turn the synthetic click following a drag into a new source selection.
     suppressFlowClickUntil.current=Date.now()+300
     const at={x:event.clientX,y:event.clientY}
     if(retargetGesture.current)finishReattachAt(at)
     else finishFlowAt(at)
   }
   const onCancel=()=>{
     if(!active())return
     flowGesture.current=null;retargetGesture.current=null;setFlowGhost(null)
     setLayoutMessage('Жест подключения прерван. Повторите перетаскивание.')
   }
   const onClick=(event:MouseEvent)=>{
     if(Date.now()>suppressFlowClickUntil.current)return
     if(canvas.contains(event.target as HTMLElement)){event.preventDefault();event.stopPropagation()}
   }
   document.addEventListener('pointerdown',onDown,true)
   document.addEventListener('pointermove',onMove,true)
   document.addEventListener('pointerup',onUp,true)
   document.addEventListener('pointercancel',onCancel,true)
   document.addEventListener('mousemove',onMove,true)
   document.addEventListener('mouseup',onUp,true)
   document.addEventListener('click',onClick,true)
   return ()=>{
     document.removeEventListener('pointerdown',onDown,true)
     document.removeEventListener('pointermove',onMove,true)
     document.removeEventListener('pointerup',onUp,true)
     document.removeEventListener('pointercancel',onCancel,true)
     document.removeEventListener('mousemove',onMove,true)
     document.removeEventListener('mouseup',onUp,true)
     document.removeEventListener('click',onClick,true)
   }
 },[tool,systemId,selectedExistingFlowId,selectedDraftFlowId,flows,changes,flowAnchors])
 const selectFlowComponent=(id:string)=>{
   setInspectedId(null);setInspectedNetworkId(null);setFocusDependencies(false)
   if(!from||to||from===id){
     setFrom(id);setTo('');setSelectedDraftFlowId('')
     setLayoutMessage('Источник выбран. Нажмите целевую ВМ или протяните стрелку.')
   }else stageDirectedFlow(from,id,preferredSourceHandle?{...automaticPorts(from,id),source_handle:preferredSourceHandle}:undefined)
 }
 const displayedNodes=graphNodes.map(n=>({...n,
   data:n.id.startsWith('network:')?n.data:{...n.data,flowMode:tool==='flow',
     onDirectClick:()=>selectFlowComponent(n.id),
     onStartFlow:(handle:string,event:React.PointerEvent<HTMLDivElement>)=>beginFlowPointer(n.id,handle,event),
     onMoveFlow:moveFlowPointer,onFinishFlow:endFlowPointer},
   style:{...n.style,
    border:((tool==='flow'&&(n.id===from||n.id===to))||(tool==='move'&&n.id===inspectedId))?'2px solid #2563eb':n.style?.border,
    background:((tool==='flow'&&(n.id===from||n.id===to))||(tool==='move'&&n.id===inspectedId))?'#eff6ff':n.style?.background,
    opacity:focusDependencies&&inspectedId&&!n.id.startsWith('network:')&&!relatedIds.has(n.id)?0.22:1
   }}))
 const inspectedVM=allVMs.find(v=>v.id===inspectedId)
 const inspectedNetwork=allNetworks.find(n=>n.id===inspectedNetworkId)
 const openPassport=(id:string)=>{const vm=allVMs.find(v=>v.id===id);if(!vm)return;setInspectedId(id);setEditingPassport(false);setPassportDraft({name:vm.name,description:vm.description||'',purpose:String(vm.details?.purpose||''),environment:String(vm.details?.environment||'')})}
 const stagePassport=()=>{if(!inspectedVM||!passportDraft.name.trim())return;const details_patch:Record<string,string>={purpose:passportDraft.purpose,environment:passportDraft.environment};const previous_details:Record<string,unknown>={purpose:inspectedVM.details?.purpose??null,environment:inspectedVM.details?.environment??null};addChange({action:'update_vm',id:inspectedVM.id,system_id:systemId,name:passportDraft.name.trim(),description:passportDraft.description,previous_name:inspectedVM.name,previous_description:inspectedVM.description||'',details_patch,previous_details});setEditingPassport(false);setInspectedId(null);setFocusDependencies(false);setReviewOpen(true)}

 const inspectedFlows=effectiveFlows.filter(f=>f.source_id===inspectedId||f.target_id===inspectedId)
 const selectCanvasEdge=(source:string,target:string,ids:string[])=>{
   setInspectedId(null);setInspectedNetworkId(null);setFocusDependencies(false)
   setTool('flow');setFrom(source);setTo(target);setSelectedEdgeFlowIds(ids)
   if(ids.length===1)selectFlowInDock(ids[0]);else{setSelectedDraftFlowId('');setSelectedExistingFlowId('')}
 }
 const edges=Array.from(flowGroups.entries()).map(([pair,list])=>{
   const first=list[0]
   const protocolLabel=[first.protocol,first.port].filter(Boolean).join(':')
   const anchor=portsForFlow(first)
   const selectedForReattach=tool==='flow'&&selectedFlow&&list.some(flow=>flow.id===selectedFlow.id)
   return {id:'flow-pair:'+pair,source:first.source_id,target:first.target_id,
     sourceHandle:anchor.source_handle,targetHandle:anchor.target_handle,
     type:'obstacle-aware',animated:false,
     style:{stroke:list.some(f=>changes.some(c=>c.id===f.id&&(c.action==='create_flow'||c.action==='update_flow')))?'#176bc1':'#369279',strokeWidth:activeEdgeFlowIds.some(id=>list.some(f=>f.id===id))?3.2:inspectedId&&(first.source_id===inspectedId||first.target_id===inspectedId)?3:1.8,opacity:focusDependencies&&inspectedId&&first.source_id!==inspectedId&&first.target_id!==inspectedId?0.16:1},
     markerEnd:{type:MarkerType.ArrowClosed,width:13,height:13},
     label:list.length>1?flowCountLabel(list.length):protocolLabel||'Поток',
     labelStyle:{fontSize:11,fontWeight:600},labelBgStyle:{fill:'#ffffff',fillOpacity:0.95},labelBgPadding:[7,4] as [number,number],
     data:{reciprocal:effectiveFlows.some(f=>f.source_id===first.target_id&&f.target_id===first.source_id),
       flowIds:list.map(f=>f.id),caption:list.length>1?flowCountLabel(list.length):protocolLabel||'Поток',
       onSelect:()=>selectCanvasEdge(first.source_id,first.target_id,list.map(f=>f.id)),
       ...(selectedForReattach?{endpointEditor:{
         onBegin:(end:FlowEnd,event:React.PointerEvent<HTMLButtonElement>)=>beginReattach(selectedFlow.id,end,event),
         onMove:(event:React.PointerEvent<HTMLButtonElement>)=>moveReattach(event),
         onEnd:(event:React.PointerEvent<HTMLButtonElement>)=>endReattach(event)
       }}:{})}
   }
 })
 const addChange=(c:Change)=>{setChanges(previous=>[...previous,c]);setPreview(null);setError('')}
 const groupingTarget= pendingGrouping?.to?visibleRects.find(r=>'network:'+r.id===pendingGrouping.to):undefined
 const groupingVM=pendingGrouping&&!pendingGrouping.id.startsWith('network:')?allVMs.find(v=>v.id===pendingGrouping.id):undefined
 const confirmGrouping=()=>{
   if(!pendingGrouping)return
   const change=pendingGrouping
   if(change.to&&groupingTarget?.kind==='vlan'&&groupingVM&&nicForGrouping==='new'){
     const label=newNicName.trim()
     const existing=interfaces.filter(n=>n.item_id===groupingVM.id)
     const pending=changes.filter(c=>c.action==='create_interface'&&c.item_id===groupingVM.id)
     if(!label||existing.some(n=>n.name===label)||pending.some(n=>n.interface_name===label)){
       setError('Имя нового сетевого интерфейса должно быть непустым и уникальным для ВМ.')
       return
     }
     addChange({action:'create_interface',id:makeId(),item_id:groupingVM.id,
       interface_name:label,network_id:groupingTarget.id,network_field:'vlan_id'})
   }else if(change.to&&groupingTarget?.kind==='vlan'&&groupingVM&&nicForGrouping){
     const nic=interfaces.find(n=>n.id===nicForGrouping&&n.item_id===groupingVM.id)
     if(!nic){setError('Указанный сетевой интерфейс не найден.');return}
     setChanges(prev=>[...prev.filter(c=>!(c.action==='move_interface'&&c.interface_id===nic.id&&c.network_field==='vlan_id')),
       {action:'move_interface',interface_id:nic.id,network_id:groupingTarget.id,
        previous_network_id:nic.vlan_id,network_field:'vlan_id'}])
     setPreview(null)
   }
   setParents(prev=>{
     const next={...prev}
     if(change.to)next[change.id]=change.to
     else delete next[change.id]
     return next
   })
   setLayoutDirty(true)
   setPendingGrouping(null);setNicForGrouping('')
   setLayoutMessage(change.to
     ?'Архитектурная вложенность подтверждена. Сохраните схему. Технические связи изменяются только отдельной согласованной операцией.'
     :'Объект выведен из группы. Сохраните схему; реальные сетевые интерфейсы не изменены.')
 }
 const cancelGrouping=()=>{
   const snapshot=pendingGrouping?.snapshot
   if(snapshot){
     setRectangles(snapshot.rects)
     setNodes(snapshot.nodes)
     setLayoutDirty(snapshot.dirty)
     for(const node of snapshot.nodes)onPositionChange?.(node)
   }
   setPendingGrouping(null);setNicForGrouping('');setError('')
   setLayoutMessage('Перемещение и изменение вложенности отменены.')
 }
 const moveNode=(node:Node)=>{
   if(node.id.startsWith('network:')){
     const id=node.id.slice('network:'.length)
     setRectangles(previous=>previous.map(rect=>rect.id===id?{...rect,x:node.position.x,y:node.position.y}:rect))
   }else onPositionChange?.(node)
   setLayoutDirty(true)
   setLayoutMessage('Расположение изменено. Если объект перенесён через границу зоны, подтвердите архитектурную связь. Технические интерфейсы не меняются без отдельного согласия.')
   setError('')
 }
 const addVM=(point?:{x:number;y:number})=>{
   if(!name.trim())return setError('Введите имя новой ВМ.')
   const id=makeId()
   const node:Node={id,type:'boardComponent',position:point||{x:90+(nodes.length%4)*280,y:100+Math.floor(nodes.length/4)*175},sourcePosition:Position.Bottom,targetPosition:Position.Top,data:{label:<DiagramNodeLabel name={name.trim()} kind="vm" subtitle={ownerName} detail="ВМ · Черновик"/>,flowMode:tool==='flow'},style:diagramCardStyle({border:'1px dashed #2674bf'})}
   addChange({action:'create_vm',id,system_id:systemId,name:name.trim(),kind:'vm'})
   setNodes(previous=>[...previous,node])
   onPositionChange?.(node)
   setLayoutDirty(true);setLayoutMessage('')
   // New VM placed in an existing zone must be explicitly confirmed as a child.
   const center={x:node.position.x+100,y:node.position.y+45}
   const candidates=visibleRects.filter(r=>rectContains(r,center)).sort((a,b)=>a.width*a.height-b.width*b.height)
   if(candidates.length){
     setPendingGrouping({id,name:name.trim(),from:null,to:'network:'+candidates[0].id,newlyCreated:true})
     setNicForGrouping('');setNewNicName('eth0')
   }
   setName('');setTool('move');setReviewOpen(true)
 }
 const stageDirectedFlow=(source:string,target:string,anchors?:FlowPortPair)=>{
   setSelectedEdgeFlowIds([]);setSelectedExistingFlowId('')
   if(!source||!target||source===target){setError('Выберите два разных компонента для направления потока.');return}
   if(!allVMs.some(vm=>vm.id===source)||!allVMs.some(vm=>vm.id===target)){setError('Источник или получатель отсутствует на схеме.');return}
   const id=makeId()
   // Store a chosen entry and exit immediately in the local layout draft.
   setFlowAnchors(previous=>({...previous,[id]:anchors||automaticPorts(source,target)}))
   setPreferredSourceHandle('')
   const sourceName=allVMs.find(vm=>vm.id===source)?.name||'Источник'
   const targetName=allVMs.find(vm=>vm.id===target)?.name||'Получатель'
   addChange({action:'create_flow',id,source_id:source,target_id:target,
     name:sourceName+' → '+targetName,protocol:protocol.trim(),port:port.trim(),security})
   // A new draft must be selectable exactly like an existing registry flow.
   // Without this, selectedFlow stays undefined and no endpoint grips render.
   setSelectedEdgeFlowIds([id]);setSelectedDraftFlowId(id);setFrom(source);setTo(target);setReviewOpen(true);setLayoutMessage('Стрелка '+sourceName+' → '+targetName+' добавлена в черновик. При необходимости уточните протокол, порт и защиту справа.')
 }
 const addFlow=()=>{
   if(!from||!to||from===to)return setError('Выберите разные исходный и целевой компоненты.')
   const source=direction==='reverse'?to:from,target=direction==='reverse'?from:to
   stageDirectedFlow(source,target)
   if(direction==='both')stageDirectedFlow(target,source)
 }
 const flowValues=(flow:Flow):FlowValues=>({
   name:flow.name,protocol:flow.protocol,port:flow.port,security:flow.security,
   data_description:flow.data_description,schedule:flow.schedule,verification:flow.verification
 })
 const selectedExistingFlow=flows.find(f=>f.id===selectedExistingFlowId)
 const selectedEffectiveFlow=effectiveSavedFlows.find(f=>f.id===selectedExistingFlowId)
 const selectedExistingChange=changes.find(c=>c.action==='update_flow'&&c.id===selectedExistingFlowId)
 const selectFlowInDock=(id:string)=>{
   const draft=changes.find(c=>c.action==='create_flow'&&c.id===id)
   const stored=effectiveSavedFlows.find(f=>f.id===id)
   if(!draft&&!stored){setError('Поток больше не найден. Обновите схему.');return}
   setTool('flow');setError('');setInspectedId(null);setInspectedNetworkId(null);setFocusDependencies(false)
   // Always synchronize the selected record with the painted edge, including
   // selection from grouped-flow lists and the VM inspector.
   setSelectedEdgeFlowIds([id])
   if(draft){setSelectedDraftFlowId(id);setSelectedExistingFlowId('')}
   else{setSelectedExistingFlowId(id);setSelectedDraftFlowId('')}
   const flow=draft||stored!
   setFrom(flow.source_id||'');setTo(flow.target_id||'')
 }
 const stageExistingFlowEdit=(original:Flow,next:FlowValues,sourceId:string,targetId:string)=>{
   const before=flowValues(original)
   const endpointsChanged=sourceId!==original.source_id||targetId!==original.target_id
   const hasChanges=endpointsChanged||Object.keys(before).some(key=>before[key as keyof FlowValues]!==next[key as keyof FlowValues])
   const remaining=changes.filter(c=>!(c.action==='update_flow'&&c.id===original.id))
   setChanges(hasChanges?[...remaining,{
     action:'update_flow',id:original.id,source_id:sourceId,target_id:targetId,
     previous_source_id:original.source_id,previous_target_id:original.target_id,
     ...next,previous_flow:before
   }]:remaining)
   setPreview(null);setError('');setReviewOpen(hasChanges||remaining.length>0)
   setLayoutMessage(demoMode?'Изменение потока добавлено в локальный черновик.':'Проверьте изменения потока и подтвердите запись в журнал.')
 }
 const discardExistingFlowEdit=()=>{
   if(!selectedExistingFlow)return
   const id=selectedExistingFlow.id
   if(selectedEffectiveFlow&&(selectedExistingFlow.source_id!==selectedEffectiveFlow.source_id||selectedExistingFlow.target_id!==selectedEffectiveFlow.target_id)){
     setFlowAnchors(previous=>{
       const next={...previous}
       const saved=persistedFlowAnchors.current[id]
       if(saved)next[id]=saved
       else delete next[id]
       return next
     })
     setFrom(selectedExistingFlow.source_id);setTo(selectedExistingFlow.target_id)
   }
   const remaining=changes.filter(c=>!(c.action==='update_flow'&&c.id===id))
   setChanges(remaining);setPreview(null);setReviewOpen(remaining.length>0)
   setLayoutMessage('Правка потока удалена из черновика.')
 }
 const selectedDraftFlow=changes.find(c=>c.action==='create_flow'&&c.id===selectedDraftFlowId)
 const updateSelectedDraftFlow=(patch:Partial<Change>)=>{
   if(!selectedDraftFlowId)return
   setChanges(previous=>previous.map(c=>c.action==='create_flow'&&c.id===selectedDraftFlowId?{...c,...patch}:c))
   setPreview(null)
 }
 const addNetwork=(start:{x:number;y:number},end:{x:number;y:number})=>{
   if(!name.trim()){setError('Заполните обязательное поле «Название сети» справа, затем нарисуйте контейнер.');networkNameInput.current?.focus();return}
   const x=Math.min(start.x,end.x),y=Math.min(start.y,end.y)
   const width=Math.abs(end.x-start.x),height=Math.abs(end.y-start.y)
   if(width<140||height<90){setError('Контейнер слишком мал: растяните минимум 140 × 90 или просто нажмите на холст для стандартного размера.');return}
   if(kind==='vrf'&&visibleRects.some(r=>r.kind==='vrf'&&rectContains(r,{x:x+width/2,y:y+height/2}))){
     setError('VRF нельзя создавать внутри другой VRF. Разместите её отдельно; VLAN внутри VRF допускается.')
     return
   }
   const id=makeId()
   const rect:Rect={id,name:name.trim(),kind,x,y,width,height}
   setRectangles(prev=>[...prev,rect])
   // A visual rectangle is not evidence of an L2/L3 attachment. In particular,
   // drawing a VLAN inside a VRF (or over a not-yet-persisted VM) must not
   // automatically create duplicate eth0 NICs or silently change routing.
   // Membership is a separate reviewed operation when the user explicitly
   // moves a concrete VM/interface into a network or edits the NIC.
   setChanges(previous=>[...previous,{action:'create_network',id,name:name.trim(),kind}])
   const candidates=visibleRects.filter(r=>permittedParent(kind,r.kind)&&rectFullyInside(r,rect)).sort((a,b)=>a.width*a.height-b.width*b.height)
   if(candidates.length){
     setPendingGrouping({id:'network:'+id,name:name.trim(),from:null,to:'network:'+candidates[0].id,newlyCreated:true})
     setNicForGrouping('')
   }
   setLayoutDirty(true);setLayoutMessage('')
   setPreview(null)
   setError('Контейнер добавлен в черновик. Размещение ВМ или VLAN внутри него не меняет автоматически сетевые интерфейсы. Подтвердите сохранение сети.')
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
   if(!name.trim()){setError('Контейнер не создан: заполните обязательное поле «Название сети».');networkNameInput.current?.focus();return}
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
   if(!start){
     // Pointer-up finishes the browser's focus handling after pointer-down.
     // Restore focus to the required input after the failed draw gesture.
     if(!name.trim())requestAnimationFrame(()=>networkNameInput.current?.focus())
     return
   }
   const end=screenToFlowPosition({x:event.clientX,y:event.clientY})
   // Click adds a default rectangle; dragging uses the user-defined size.
   if(Math.hypot(end.x-start.x,end.y-start.y)<10){
     addNetwork(start,{x:start.x+540,y:start.y+340})
   }else{
     addNetwork(start,end)
   }
 }
 const cancelNetworkDrag=()=>{networkStart.current=null;networkStartPixel.current=null;setNetworkPreview(null);setDrawing(null)}
 // The visual layout is saved independently from technical changes.
 useEffect(()=>{
   let active=true
   setLayoutDirty(false);setLayoutMessage('')
   void request<{positions:Record<string,Geometry>;flow_anchors?:Record<string,FlowPortPair>}>('/api/board/layout/'+systemId)
     .then(result=>{
       if(!active||!result.positions)return
       setNodes(previous=>previous.map(node=>{
         const position=result.positions[node.id]||savedPositions[node.id]
         return position?{...node,position:{x:position.x,y:position.y}}:node
       }))
       const persisted=Object.entries(result.positions)
         .filter(([id,geometry])=>id.startsWith('network:')&&networks.some(network=>network.id===id.slice(8))&&
           Number.isFinite(geometry.x)&&Number.isFinite(geometry.y)&&Number.isFinite(geometry.width)&&Number.isFinite(geometry.height))
         .map(([id,geometry])=>({id:id.slice(8),name:networks.find(network=>network.id===id.slice(8))!.name,
           kind:networks.find(network=>network.id===id.slice(8))!.kind,x:geometry.x,y:geometry.y,
           width:geometry.width!,height:geometry.height!}))
       setRectangles(previous=>{
         const ids=new Set(persisted.map(rect=>rect.id))
         return [...previous.filter(rect=>!ids.has(rect.id)),...persisted]
       })
       const loaded=Object.fromEntries(Object.entries(result.positions).filter(([,geometry])=>geometry.parent_id).map(([id,geometry])=>[id,geometry.parent_id!]))
       persistedParents.current=loaded
       setParents({...loaded,...(restoredDraft?.parents||{})})
       persistedFlowAnchors.current=result.flow_anchors||{}
       setFlowAnchors({...persistedFlowAnchors.current,...(restoredDraft?.flowAnchors||{})})
     }).catch(()=>{/* Browser positions remain the fallback. */})
   return ()=>{active=false}
 },[systemId,request,setNodes,networks])

 const collectLayout=(extraVMIds:string[]=[],extraNetworkIds:string[]=[])=>{
   const vmIds=new Set([...items.map(item=>item.id),...extraVMIds])
   const networkIds=new Set([...networks.map(network=>network.id),...extraNetworkIds])
   return {
     ...Object.fromEntries(nodes.filter(node=>vmIds.has(node.id))
       .map(node=>[node.id,{x:node.position.x,y:node.position.y,...(parents[node.id]?{parent_id:parents[node.id]}:{})}])),
     ...Object.fromEntries(rectangles.filter(rect=>networkIds.has(rect.id))
       .map(rect=>['network:'+rect.id,{x:rect.x,y:rect.y,width:rect.width,height:rect.height,...(parents['network:'+rect.id]?{parent_id:parents['network:'+rect.id]}:{})}]))
   }
 }
 const collectFlowAnchors=(newFlowIds:string[]=[])=>{
   const known=new Set([...flows.map(f=>f.id),...newFlowIds])
   return Object.fromEntries(Object.entries(flowAnchors).filter(([id])=>known.has(id)))
 }
 const saveLayout=async()=>{
   if(layoutBusy)return
   if(changes.length){
     setReviewOpen(true);setTool('move')
     if(demoMode)return
     setError('Есть несохранённые ВМ, VRF/VLAN или связи. Введите причину изменений в черновике, проверьте их и подтвердите запись в журнал. Сохранение только расположения не создаёт объекты.')
     return
   }
   if(demoMode){setLayoutMessage('Для сохранения расположения войдите по паролю.');return}
   setLayoutBusy(true);setLayoutMessage('');setError('')
   try{
     await request('/api/board/layout/'+systemId,{method:'PUT',body:JSON.stringify({positions:collectLayout(),flow_anchors:collectFlowAnchors()})})
     persistedFlowAnchors.current=collectFlowAnchors()
     const hasStagedGeometry=changes.some(c=>c.action==='create_vm'||c.action==='create_network')
     setLayoutDirty(hasStagedGeometry)
     setLayoutMessage(hasStagedGeometry
       ?'Расположение существующих объектов сохранено в историю. Новые подтвердите в черновике.'
       :'Расположение схемы сохранено. Запись добавлена в историю.')
   }catch(e){setError('Не удалось сохранить расположение: '+String(e))}
   finally{setLayoutBusy(false)}
 }
 const discardDraft=()=>{
   const stagedVMs=new Set(changes.filter(c=>c.action==='create_vm').map(c=>c.id))
   const stagedNetworks=new Set(changes.filter(c=>c.action==='create_network').map(c=>c.id))
   setNodes(previous=>previous.filter(node=>!stagedVMs.has(node.id)))
   setRectangles(previous=>previous.filter(rect=>!stagedNetworks.has(rect.id)))
   setChanges([]);setSelectedDraftFlowId('');setSelectedExistingFlowId('');setSelectedEdgeFlowIds([]);setPreview(null);setError('');setReviewOpen(false)
   setParents(persistedParents.current)
   setFlowAnchors(persistedFlowAnchors.current)
   setPendingGrouping(null)
   setLayoutDirty(false)
   setLayoutMessage('Черновик изменений отменён. Несохранённые ВМ и сети удалены со схемы.')
 }
 const openHistory=async()=>{
   setError('')
   try{setHistory(await request<Array<{id:string;timestamp:string;reason:string;changes:Preview['changes']}>>('/api/board/audit?limit=30'));setShowHistory(true)}catch(e){setError(String(e))}
 }
 const submitPreview=async()=>{
   if(demoMode)return
   if(!changes.length||reason.trim().length<3){setError('Добавьте изменения и укажите причину (минимум 3 символа).');return}
   setBusy(true);setError('')
   try{setPreview(await request<Preview>('/api/board/preview',{method:'POST',body:JSON.stringify({changes,reason})}))}
   catch(e){setError(String(e))}
   finally{setBusy(false)}
 }
 const commit=async()=>{
   if(demoMode||!preview)return
   setBusy(true);setError('')
   try{
     await request('/api/board/commit',{method:'POST',body:JSON.stringify({changes,reason})})
     // Registry changes are committed. Handle geometry/refresh failures separately,
     // never as a failure of an already committed technical transaction.
     const newVMIds=changes.filter(c=>c.action==='create_vm').map(c=>c.id!).filter(Boolean)
     const newNetworkIds=changes.filter(c=>c.action==='create_network').map(c=>c.id!).filter(Boolean)
     const newFlowIds=changes.filter(c=>c.action==='create_flow').map(c=>c.id!).filter(Boolean)
     let warning=''
     try{
       await request('/api/board/layout/'+systemId,{method:'PUT',
         body:JSON.stringify({positions:collectLayout(newVMIds,newNetworkIds),flow_anchors:collectFlowAnchors(newFlowIds)})})
       persistedFlowAnchors.current=collectFlowAnchors(newFlowIds)
       setLayoutDirty(false);setLayoutMessage('Расположение ВМ, контейнеров и точки стрелок сохранены.')
     }catch(e){
       warning=' Расположение не удалось сохранить: '+String(e)
       setLayoutDirty(true)
     }
     try{await onCommitted()}catch(e){warning+=' Не удалось обновить данные: '+String(e)}
     setChanges([]);setSelectedDraftFlowId('');setSelectedExistingFlowId('');setSelectedEdgeFlowIds([]);setPreview(null);setReason('');setDrawing(null);setReviewOpen(false)
     setError('ВМ, сети и связи сохранены в реестре и журнале.'+warning)
     if(showHistory)void openHistory()
   }catch(e){setPreview(null);setError('Сохранение отклонено: '+String(e)+'. Обновите предварительный просмотр.')}
   finally{setBusy(false)}
 }
 return <section className="boardWorkspace" aria-label="Редактор архитектурной схемы">
   <div className="boardEditorStage">
        <div ref={boardCanvasRef} className="boardCanvas" data-active-graph="infrastructure-editor"
          onPointerDownCapture={event=>{
            setCanvasInteracted(true)
            if(tool!=='flow'||event.button!==0)return
            const selectedFlowId=selectedExistingFlowId||selectedDraftFlowId
            const at={x:event.clientX,y:event.clientY}
            // The renderer places the yellow grips over an SVG label layer;
            // hit-testing by their geometry prevents the pane from receiving
            // the gesture when the visible grip's hitbox is clipped or covered.
            if(selectedFlowId){
              const grips=[...(boardCanvasRef.current?.querySelectorAll<HTMLElement>('.boardEndpointGrip')||[])]
                .map(el=>{const b=el.getBoundingClientRect();return {el,distance:Math.hypot(at.x-b.left-b.width/2,at.y-b.top-b.height/2)}})
                .sort((a,b)=>a.distance-b.distance)
              const closestGrip=grips[0]
              const end=closestGrip?.el.dataset.flowEnd
              if(closestGrip&&closestGrip.distance<=20&&(end==='source'||end==='target')){
                beginReattach(selectedFlowId,end,event)
                return
              }
            }
            // The top/side handles are on the card boundary. Their visible
            // circles can be obscured by React Flow's panning layer even when
            // a click appears to land on the port. Hit-test them by coordinates
            // before the pane handles pointerdown and starts dragging canvas.
            const targets=[...(boardCanvasRef.current?.querySelectorAll<HTMLElement>('.react-flow__node-boardComponent .flowPortSource.boardConnectionHandleActive')||[])]
              .map(el=>{const b=el.getBoundingClientRect();return {el,distance:Math.hypot(at.x-b.left-b.width/2,at.y-b.top-b.height/2)}})
              .sort((a,b)=>a.distance-b.distance)
            const closest=targets[0]
            const node=closest?.el.closest<HTMLElement>('.react-flow__node-boardComponent')
            const anchor=closest?.el.dataset.anchor
            if(closest&&closest.distance<=18&&node?.dataset.id&&anchor){
              beginFlowPointer(node.dataset.id,anchor,event)
            }
          }}
          onMouseDownCapture={event=>{
            if(tool!=='flow'||event.button!==0)return
            if(flowGesture.current||retargetGesture.current){
              event.preventDefault();event.stopPropagation()
              return
            }
            // React Flow begins panning on mousedown rather than pointerdown.
            // Some browsers dispatch the compatibility mouse event on the
            // pane despite a hit on a visible port. Recover the gesture from
            // DOM anchor geometry and suppress the pane handler.
            const at={x:event.clientX,y:event.clientY}
            const sources=[...(boardCanvasRef.current?.querySelectorAll<HTMLElement>('.react-flow__node-boardComponent .flowPortSource.boardConnectionHandleActive')||[])]
              .map(el=>{const b=el.getBoundingClientRect();return {el,distance:Math.hypot(at.x-b.left-b.width/2,at.y-b.top-b.height/2)}})
              .sort((a,b)=>a.distance-b.distance)
            const selected=sources[0]
            const node=selected?.el.closest<HTMLElement>('.react-flow__node-boardComponent')
            const handle=selected?.el.dataset.anchor
            if(selected&&selected.distance<=24&&node?.dataset.id&&handle){
              event.preventDefault();event.stopPropagation()
              const box=selected.el.getBoundingClientRect()
              const point=canvasPoint(box.left+box.width/2,box.top+box.height/2)
              setPreferredSourceHandle(handle)
              flowGesture.current={sourceId:node.dataset.id,sourceHandle:handle,start:point}
              setFlowGhost({start:point,end:point})
            }
          }}
          onPointerMoveCapture={event=>{
            setCanvasInteracted(true)
            if(retargetGesture.current)moveReattach(event)
            else if(flowGesture.current)moveFlowPointer(event)
          }}
          onPointerUpCapture={event=>{
            if(retargetGesture.current)endReattach(event)
            else if(flowGesture.current)endFlowPointer(event)
          }}
          onPointerCancelCapture={event=>{
            if(retargetGesture.current)endReattach(event)
            else if(flowGesture.current)endFlowPointer(event)
          }}><ReactFlow nodes={displayedNodes} edges={edges} panOnDrag={tool==='move'} nodeTypes={boardNodeTypes} edgeTypes={{reciprocal:ReciprocalEdge,'obstacle-aware':ObstacleAwareEdge}} onNodesChange={(updates:NodeChange[])=>{
  // React Flow is controlled: update rectangle geometry during the drag,
  // not only on drop, otherwise VRF/VLAN boxes appear stuck in place.
  const moved=new Map<string,{x:number;y:number}>()
  for(const change of updates){
    if(change.type==='position'&&change.position&&change.id.startsWith('network:')){
      moved.set(change.id.slice(8),change.position)
    }
  }
  if(moved.size)setRectangles(previous=>previous.map(rect=>{
    const position=moved.get(rect.id)
    return position?{...rect,x:position.x,y:position.y}:rect
  }))
  onNodesChange(updates.filter(change=>!('id' in change)||!change.id.startsWith('network:')))
 }} nodesDraggable={tool==='move'} snapToGrid={snapToGrid} snapGrid={[20,20]} nodesConnectable={tool==='flow'} onConnectStart={()=>setDrawingConnection(true)} onConnectEnd={()=>setDrawingConnection(false)} onConnect={connection=>{if(tool==='flow'&&connection.source&&connection.target){stageDirectedFlow(connection.source,connection.target);setInspectedId(null)}}} onEdgeClick={(_,edge)=>selectCanvasEdge(edge.source,edge.target,(edge.data?.flowIds as string[]|undefined)||[])} onNodeClick={(event,node)=>{
 // Network rectangles occupy their whole area; a click on one is not a pane
 // click. The VM tool must still allow placing a VM inside that container.
 if(tool==='vm'&&node.id.startsWith('network:')){
   addVM(screenToFlowPosition({x:event.clientX,y:event.clientY}))
   return
 }
 if(node.id.startsWith('network:')){setInspectedNetworkId(node.id.slice(8));setInspectedId(null);setFocusDependencies(false);return}
 setInspectedNetworkId(null)
 if(tool==='flow'){
   setInspectedId(null);setFocusDependencies(false)
   if(!from||to||from===node.id){setFrom(node.id);setTo('');setSelectedDraftFlowId('');setLayoutMessage('Источник выбран. Нажмите на целевой компонент или протяните стрелку от порта.')}
   else stageDirectedFlow(from,node.id)
 }else if(tool==='move'){openPassport(node.id);setFocusDependencies(false)}
}} onNodeDragStart={(_,node)=>{setDraggingNode(true);startVisualGroupDrag(node)}} onNodeDrag={(_,node)=>updateVisualGroupDrag(node)} onNodeDragStop={(_,node)=>{finishVisualDrop(node);moveNode(node);setDraggingNode(false)} } onPaneClick={handlePaneClick} minZoom={0.08} fitViewOptions={{padding:0.2,maxZoom:0.9}}><AutoFit layoutKey={systemId+':'+items.length+':'+flows.length} maxFitZoom={0.9} focusIds={selectedFlowEndpoints} suspended={drawingConnection||draggingNode||(!selectedFlowEndpoints.length&&(tool!=='move'||canvasInteracted))} settleDelayMs={0}/><Background gap={20}/><Controls showInteractive={false}/></ReactFlow>
     {flowGhost&&<svg className="boardFlowGesturePreview" aria-hidden="true" width="100%" height="100%">
       <defs><marker id="board-flow-ghost-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0 0 L8 4 L0 8 Z" fill="#176bc1"/></marker></defs>
       <line x1={flowGhost.start.x} y1={flowGhost.start.y} x2={flowGhost.end.x} y2={flowGhost.end.y} stroke="#176bc1" strokeWidth="2.5" strokeDasharray="6 3" markerEnd="url(#board-flow-ghost-arrow)"/>
     </svg>}
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
       {key:'flow',title:'→ Поток',caption:'Поток',icon:GitBranch,help:'Потяните за порт на карточке до целевого компонента или нажмите на две карточки по очереди'},
       {key:'network',title:'▭ Сеть / контейнер',caption:'Контейнер',icon:SquareDashed,help:'Введите название справа, нажмите на холст или нарисуйте прямоугольник'},
     ] as const).map(({key,title,caption,icon:Icon,help})=>
        <button type="button" key={key} title={caption+' – '+help} aria-label={title} data-tool={key} aria-pressed={tool===key}
          onClick={()=>{setTool(key);setInspectedId(null);setInspectedNetworkId(null);setFocusDependencies(false);setDrawing(null);setError('');setLayoutMessage('');setReviewOpen(false);cancelNetworkDrag()}}>
          <Icon size={19} strokeWidth={1.8} aria-hidden="true"/><span className="boardToolCaption" aria-hidden="true">{caption}</span>
        </button>)}
     <span className="boardToolsSeparator" aria-hidden="true"/>
     <button type="button" title="Вписать всю схему в экран" aria-label="Показать всё" disabled={!nodes.length} onClick={()=>void fitView({padding:0.25,duration:250,maxZoom:0.9})}><Maximize2 size={19} aria-hidden="true"/><span className="boardToolCaption" aria-hidden="true">Вписать</span></button>
     <button type="button" title={changes.length?'Сохранить новые ВМ, VRF/VLAN и связи через проверку черновика':layoutDirty?'Сохранить расположение блоков':'Расположение сохранено'} aria-label={changes.length?'Сохранить изменения схемы':'Сохранить расположение'} disabled={(!layoutDirty&&!changes.length)||layoutBusy||busy} onClick={()=>void saveLayout()}><Save size={19} aria-hidden="true"/><span className="boardToolCaption" aria-hidden="true">{changes.length?'Сохранить всё':'Сохранить'}</span>{(layoutDirty||changes.length>0)&&<span className="boardUnsavedDot" aria-hidden="true"/>}</button>
     <button type="button" title="История изменений" aria-label="История изменений" onClick={()=>void openHistory()}><History size={19} aria-hidden="true"/><span className="boardToolCaption" aria-hidden="true">История</span></button>
     <button type="button" className="boardChangeCount" title="Проверить и сохранить изменения в реестре" aria-label={'Черновик: '+changes.length+' изменений'} disabled={!changes.length} onClick={()=>{setReviewOpen(true);setTool('move');setInspectedId(null)}}>
       <ClipboardCheck size={18} aria-hidden="true"/><span className="boardToolCaption" aria-hidden="true">Черновик ({changes.length})</span><span className="boardCountLabel"> изменений</span>
     </button>
   </div>
     {changes.length>0&&<div className="boardPendingBanner" role="status"><strong>Не сохранено: {changes.filter(c=>c.action==='create_vm').length} ВМ, {changes.filter(c=>c.action==='create_network').length} сетей и {changes.filter(c=>c.action!=='create_vm'&&c.action!=='create_network').length} других изменений.</strong><span>Новые объекты ещё не в реестре. При выходе из редактора черновик сохранится в этом браузере и восстановится при возвращении.</span><button type="button" onClick={()=>{setTool('move');setReviewOpen(true);setError('')}}>Проверить и сохранить в реестр</button></div>}
     {(tool!=='move'||inspectedVM||inspectedNetwork||reviewOpen)&&<aside className="boardDock" role="complementary" aria-label="Свойства и изменения схемы">
       {tool!=='move'&&<div className="boardPropertiesHeader"><div><small>ИНСТРУМЕНТ</small><h3>{tool==='vm'?'Виртуальная машина':tool==='flow'?'Поток данных':'Сеть / контейнер'}</h3></div><button type="button" aria-label="Закрыть настройки инструмента" onClick={()=>{setTool('move');setDrawing(null);setError('');setLayoutMessage('');setReviewOpen(false);cancelNetworkDrag()}}>✕</button></div>}
          {tool==='vm'&&<div className="boardToolFields"><p>Введите название и нажмите на холст для размещения ВМ.</p><label>Имя ВМ <input value={name} onChange={e=>setName(e.target.value)} placeholder="Новая ВМ"/></label><button onClick={()=>addVM()}>Разместить на схеме</button></div>}
   {tool==='network'&&<div className="boardToolFields"><label>Название сети * <input ref={networkNameInput} required aria-required="true" aria-invalid={!name.trim()} value={name} onChange={e=>{setName(e.target.value);if(e.target.value.trim())setError('')}} placeholder="Название VRF / VLAN / зоны"/></label>{!name.trim()&&<p className="boardRequiredHint" role="alert">Обязательное поле: сначала укажите название, затем нарисуйте контейнер.</p>}<label>Тип <select value={kind} onChange={e=>setKind(e.target.value as typeof kind)}><option value="zone">Зона</option><option value="vlan">VLAN</option><option value="vrf">VRF</option></select></label><p role="status">{drawing?'Продолжайте тянуть – контур контейнера виден на схеме':'Нажмите на холст – появится стандартный контейнер 540 × 340. Или протяните прямоугольник нужного размера. Затем подтвердите изменения в черновике.'}</p></div>}
   {tool==='flow'&&<div className="boardToolFields"><p><strong>8 точек подключения на каждой ВМ.</strong> Начните стрелку от любой точки по периметру и отпустите на нужной точке другой ВМ. Можно нажать на две карточки по очереди. Чтобы изменить подключение, выберите поток и перетащите жёлтый маркер на нужную точку текущей или другой ВМ.</p><div className="boardFlowHint">Сначала источник → затем получатель. Сохранение в реестр – через «Сохранить всё».</div><label>Откуда <select aria-label="Откуда" value={from} onChange={e=>setFrom(e.target.value)}><option value="">Выберите</option>{allVMs.map(v=><option key={v.id} value={v.id}>{v.name}</option>)}</select></label><label>Куда <select aria-label="Куда" value={to} onChange={e=>setTo(e.target.value)}><option value="">Выберите</option>{allVMs.map(v=><option key={v.id} value={v.id}>{v.name}</option>)}</select></label><label>Направление (при выборе вручную) <select value={direction} onChange={e=>setDirection(e.target.value as typeof direction)}><option value="forward">→</option><option value="reverse">←</option><option value="both">↔ (два потока)</option></select></label><label>Протокол <input value={protocol} onChange={e=>setProtocol(e.target.value)}/></label><label>Порт <input value={port} onChange={e=>setPort(e.target.value)}/></label><label>Защита <input value={security} onChange={e=>setSecurity(e.target.value)}/></label><button onClick={()=>{addFlow()}}>Добавить поток по выбранным компонентам</button>{selectedDraftFlow&&<section className="boardFlowDraftEditor" aria-label="Параметры нарисованного потока"><h4>Нарисованный поток · черновик</h4><p>{allVMs.find(v=>v.id===selectedDraftFlow.source_id)?.name||'Источник'} → {allVMs.find(v=>v.id===selectedDraftFlow.target_id)?.name||'Получатель'}</p><label>Название <input value={selectedDraftFlow.name||''} onChange={e=>updateSelectedDraftFlow({name:e.target.value})}/></label><label>Протокол <input value={selectedDraftFlow.protocol||''} onChange={e=>updateSelectedDraftFlow({protocol:e.target.value})}/></label><label>Порт <input value={selectedDraftFlow.port||''} onChange={e=>updateSelectedDraftFlow({port:e.target.value})} placeholder="Необязательно"/></label><label>Защита <input value={selectedDraftFlow.security||''} onChange={e=>updateSelectedDraftFlow({security:e.target.value})}/></label><button type="button" onClick={()=>{setChanges(p=>p.filter(c=>c.id!==selectedDraftFlowId));setFlowAnchors(p=>{const copy={...p};delete copy[selectedDraftFlowId];return copy});setSelectedDraftFlowId('');setPreview(null)}}>Удалить стрелку из черновика</button></section>}</div>}
   {tool==='flow'&&activeEdgeFlowIds.length>0&&<section className="boardFlowEdgeList" aria-label="Потоки выбранной стрелки">
     <h4>Связи на стрелке ({activeEdgeFlowIds.length})</h4>
     <p>{activeEdgeFlowIds.length>1&&!selectedFlow?'На одной стрелке находятся '+activeEdgeFlowIds.length+' отдельных потока. Сначала выберите нужную запись ниже – появятся оранжевые маркеры для переноса её начала или конца.': 'Чтобы изменить подключение выбранного потока, перетащите оранжевый маркер на другую точку этой или другой ВМ.'}</p>
     {activeEdgeFlowIds.map(id=>{
       const flow=effectiveFlows.find(f=>f.id===id)
       if(!flow)return null
       return <button type="button" className={selectedExistingFlowId===id||selectedDraftFlowId===id?'boardFlowSelected':''} key={id} onClick={()=>selectFlowInDock(id)}>
         <strong>{flow.name||'Поток без названия'}</strong><small>{[flow.protocol,flow.port].filter(Boolean).join(' / ')||'Протокол и порт не указаны'} · {flows.some(f=>f.id===id)?'Реестр':'Черновик'}</small>
       </button>
     })}
   </section>}
   {tool==='flow'&&selectedExistingFlow&&selectedEffectiveFlow&&<ExistingFlowEditor key={'flow-editor:'+selectedExistingFlow.id} original={flowValues(selectedExistingFlow)} current={flowValues(selectedEffectiveFlow)}
     sourceName={allVMs.find(v=>v.id===selectedEffectiveFlow.source_id)?.name||selectedEffectiveFlow.source_id}
     targetName={allVMs.find(v=>v.id===selectedEffectiveFlow.target_id)?.name||selectedEffectiveFlow.target_id}
     staged={Boolean(selectedExistingChange)}
     onStage={values=>stageExistingFlowEdit(selectedExistingFlow,values,selectedEffectiveFlow.source_id,selectedEffectiveFlow.target_id)} onUndo={discardExistingFlowEdit}
     onClose={()=>{setSelectedExistingFlowId('');setSelectedEdgeFlowIds([])}}/>}
   {tool==='flow'&&selectedExistingFlow&&
     <FlowAttributeMap key={'flow-data-map:'+selectedExistingFlow.id} flowId={selectedExistingFlow.id} request={request}/>}
   {(tool==='network'||(tool==='move'&&inspectedVM))&&<div className="boardToolFields"><p>Вложенность на схеме подтверждается после перетаскивания. При размещении ВМ в VLAN можно отдельно выбрать существующий интерфейс или создать новый. Перемещение VRF/VLAN само по себе не настраивает маршруты и шлюзы.</p></div>}

       {tool==='move'&&inspectedNetwork&&<section className="boardToolFields" aria-label="Свойства контейнера"><h3>{inspectedNetwork.name} · {inspectedNetwork.kind.toUpperCase()}</h3><p>Перемещение группы переносит все подтверждённые вложенные VLAN, зоны и ВМ. Размер границ меняется мышью за маркеры на рамке.</p><p>Связанных вложенных объектов: {descendants('network:'+inspectedNetwork.id,parents).size}. При переносе в другую зону или на свободное поле потребуется подтверждение новой архитектурной связи. Реальная маршрутизация автоматически не меняется.</p>{onEditNetwork&&networks.some(n=>n.id===inspectedNetwork.id)&&<button type="button" onClick={()=>onEditNetwork(inspectedNetwork.id)}>Редактировать параметры сети</button>}<button type="button" onClick={()=>setInspectedNetworkId(null)}>Вернуться к схеме</button></section>}
   {tool==='move'&&inspectedVM&&<aside className="boardInspector" role="dialog" aria-modal="false" aria-label={'Паспорт компонента '+inspectedVM.name}>
     <div className="boardInspectorHeader"><div><small>Паспорт компонента</small><h3>{inspectedVM.name}</h3></div><button type="button" aria-label="Закрыть паспорт" onClick={()=>{setInspectedId(null);setFocusDependencies(false)}}>✕</button></div>
     <div className="boardInspectorBody">
       {editingPassport&&<div className="boardPassportEdit"><label>Название<input aria-label="Название компонента" value={passportDraft.name} onChange={e=>setPassportDraft(p=>({...p,name:e.target.value}))}/></label><label>Описание<textarea aria-label="Описание компонента" value={passportDraft.description} onChange={e=>setPassportDraft(p=>({...p,description:e.target.value}))}/></label><label>Назначение<input aria-label="Назначение компонента" value={passportDraft.purpose} onChange={e=>setPassportDraft(p=>({...p,purpose:e.target.value}))}/></label><label>Среда<input aria-label="Среда компонента" value={passportDraft.environment} onChange={e=>setPassportDraft(p=>({...p,environment:e.target.value}))}/></label><div><button type="button" disabled={!passportDraft.name.trim()} onClick={stagePassport}>Добавить в черновик</button><button type="button" onClick={()=>setEditingPassport(false)}>Отмена</button></div></div>}
        {!editingPassport&&<dl><dt>Тип</dt><dd>{inspectedVM.kind}</dd><dt>Система</dt><dd>{ownerName||inspectedVM.system_id}</dd><dt>Назначение</dt><dd>{inspectedVM.description||String(inspectedVM.details?.purpose||inspectedVM.details?.role||'Не указано')}</dd><dt>Среда</dt><dd>{String(inspectedVM.details?.environment||'Не указана')}</dd></dl>}
       <h4>Сетевые интерфейсы</h4>
       {interfaces.filter(n=>n.item_id===inspectedVM.id).map(n=><div className="boardInspectorItem" key={n.id}><strong>{n.name}</strong><small>{[n.zone_id&&'Зона: '+(networks.find(x=>x.id===n.zone_id)?.name||n.zone_id),n.vlan_id&&'VLAN: '+(networks.find(x=>x.id===n.vlan_id)?.name||n.vlan_id),n.vrf_id&&'VRF: '+(networks.find(x=>x.id===n.vrf_id)?.name||n.vrf_id)].filter(Boolean).join(' · ')||'Без сетевой привязки'}</small></div>)}
       {!interfaces.some(n=>n.item_id===inspectedVM.id)&&<p>Интерфейсы не указаны.</p>}
       <h4>Связанные потоки ({inspectedFlows.length})</h4>
       {inspectedFlows.map(f=><div className="boardInspectorItem" key={f.id}><strong>{f.name||'Поток'}</strong><span>{allVMs.find(v=>v.id===f.source_id)?.name||f.source_id} → {allVMs.find(v=>v.id===f.target_id)?.name||f.target_id}</span><small>{f.protocol||'Протокол не указан'}{f.port?':'+f.port:''}</small><button type="button" onClick={()=>{setSelectedEdgeFlowIds([f.id]);selectFlowInDock(f.id)}}>Открыть параметры потока</button></div>)}
       {!inspectedFlows.length&&<p>Связанных потоков нет.</p>}
       {items.some(item=>item.id===inspectedVM.id)?<MonitoringPanel targetType="component" targetId={inspectedVM.id} request={request} systems={Object.entries(ownerBySystemId).map(([id,name])=>({id,name}))}/>:<p className="monitoringHint">Для настройки мониторинга сначала сохраните новую ВМ в реестр.</p>}
     </div>
     <div className="boardInspectorActions"><button type="button" onClick={()=>setEditingPassport(v=>!v)}>{editingPassport?"Скрыть редактирование":"Редактировать паспорт"}</button><label><input type="checkbox" checked={focusDependencies} onChange={e=>setFocusDependencies(e.target.checked)}/> Выделить зависимости</label><button type="button" onClick={()=>{setFrom(inspectedVM.id);setTo('');setTool('flow');setInspectedId(null);setFocusDependencies(false)}}>Добавить поток</button><button type="button" onClick={()=>{setInspectedId(null);setFocusDependencies(false)}}>Закрыть</button></div>
   </aside>}
       {reviewOpen&&changes.length>0&&<div className="boardReview"><div className="boardReviewHeader"><strong>Черновик: {changes.length} изменений</strong><button type="button" onClick={()=>setReviewOpen(false)} aria-label="Закрыть черновик">✕</button></div>{demoMode?<p role="status">Для проверки и сохранения изменений войдите по паролю.</p>:<>
         <label>Причина изменений <input value={reason} onChange={e=>{setReason(e.target.value);setPreview(null)}} placeholder="Например: актуализация схемы ИС после изменения сети"/></label>
         <button disabled={busy} onClick={submitPreview}>Проверить изменения ({changes.length})</button>
       </>}<button disabled={!changes.length||busy} onClick={discardDraft}>Отменить черновик</button></div>}
     </aside>}
     {(Boolean(error)||Boolean(layoutMessage))&&<div className="boardCanvasToast" role="status">{error||layoutMessage}<button type="button" aria-label="Закрыть сообщение" onClick={()=>{setError('');setLayoutMessage('')}}>✕</button></div>}
   </div>
   {pendingGrouping&&<div className="boardConfirm" role="dialog" aria-modal="true" aria-label="Подтверждение вложенности">
     <div className="boardConfirmInner boardGroupingConfirm">
       <h3>{pendingGrouping.to?'Добавить объект в группу?':'Вывести объект из группы?'}</h3>
       <p><strong>{pendingGrouping.name}</strong> {pendingGrouping.to?'→ '+(groupingTarget?.name||'контейнер'):'→ вне сетевых контейнеров'}.</p>
       <p>Подтверждение создаёт постоянную архитектурную связь «находится внутри». При перемещении VRF или VLAN все связанные вложенные объекты будут двигаться вместе с родителем.</p>
       {!!groupingTarget&&groupingTarget.kind==='vrf'&&<p className="boardGroupingNote">VLAN внутри VRF – логическая группировка. Маршрутизация VLAN через VRF требует отдельного L3-шлюза / SVI и не создаётся перемещением.</p>}
       {!!groupingVM&&groupingTarget?.kind==='vlan'&&<div className="boardGroupingNic">
         <label>Техническая привязка интерфейса к VLAN (необязательно)
           <select value={nicForGrouping} onChange={e=>setNicForGrouping(e.target.value)}>
             <option value="">Только архитектурная связь</option>
             {interfaces.filter(n=>n.item_id===groupingVM.id).map(n=><option key={n.id} value={n.id}>Привязать {n.name} к VLAN</option>)}
             <option value="new">Создать новый интерфейс</option>
           </select>
         </label>
         {nicForGrouping==='new'&&<label>Имя нового интерфейса
           <input value={newNicName} onChange={e=>setNewNicName(e.target.value)} placeholder="eth0"/>
         </label>}
         <small>Реальная привязка VLAN будет записана в технический реестр только после проверки черновика и подтверждения. IP-адрес не назначается.</small>
       </div>}
       <p className="boardGroupingNote">Перемещение на схеме не меняет конфигурацию VMware, коммутаторов или маршрутизаторов.</p>
       <div className="boardGroupingActions">
         <button type="button" onClick={cancelGrouping}>{pendingGrouping.newlyCreated?'Оставить без группы':'Отменить перенос'}</button>
         <button type="button" className="primary" onClick={confirmGrouping}>Подтвердить связь</button>
       </div>
     </div>
   </div>}
   {showHistory&&<div className="boardConfirm" role="dialog" aria-modal="true" aria-label="Журнал изменений архитектуры"><div className="boardConfirmInner"><h3>Журнал изменений схемы</h3><p>Последние подтверждённые пакеты операций.</p><ol>{history.map(entry=><li key={entry.id}><strong>{entry.timestamp}</strong> – {entry.reason} · {entry.changes.length} операций<details><summary>Посмотреть состав</summary><pre>{JSON.stringify(entry.changes,null,2)}</pre></details></li>)}</ol>{!history.length&&<p>Записей пока нет.</p>}<button type="button" onClick={()=>{setShowHistory(false);setTool('move');setReviewOpen(changes.length>0)}}>Вернуться к редактированию</button></div></div>}
   {preview&&<div className="boardConfirm" role="dialog" aria-modal="true" aria-label="Подтверждение изменений архитектуры"><div className="boardConfirmInner"><h3>Подтверждение изменений</h3><p>Причина: {reason}. Будет сохранено {preview.count} операций. Для существующих интерфейсов сверяется прежняя сеть.</p><ol>{preview.changes.map((c,i)=><li key={i}><strong>{c.endpoints?'Переподключение потока':c.action}</strong> · {c.id}
     {c.endpoints&&<div><div>Было: {flowEndpointLabel(c.endpoints.before)}</div>
       <div>Станет: {flowEndpointLabel(c.endpoints.after)}</div></div>}
     <pre>{JSON.stringify({before:c.before,after:c.after},null,2)}</pre></li>)}</ol><div><button disabled={busy} onClick={()=>{setPreview(null);setReviewOpen(true);setTool('move')}}>Вернуться к редактированию</button><button disabled={busy} className="primary" onClick={commit}>Подтвердить и записать в журнал</button></div></div></div>}
 </section>
}

export default function ArchitectureBoard(props:Props){return <ReactFlowProvider><Editor {...props}/></ReactFlowProvider>}
