import React, {useMemo, useState} from 'react'
import './board.css'
import {ReactFlow, ReactFlowProvider, Background, Controls, useNodesState, useReactFlow, type Node, type NodeChange} from '@xyflow/react'

type VM = {id:string;system_id:string;kind:string;name:string;details:Record<string,unknown>}
type Network = {id:string;name:string;kind:string}
type NIC = {id:string;item_id:string;name:string;zone_id:string|null;vlan_id:string|null;vrf_id:string|null}
type Flow = {id:string;source_id:string;target_id:string;name:string;protocol:string;port:string}
type Change = {action:'create_vm'|'create_network'|'create_flow'|'move_interface';id?:string;system_id?:string;name?:string;kind?:string;description?:string;source_id?:string;target_id?:string;protocol?:string;port?:string;security?:string;data_description?:string;interface_id?:string;network_id?:string|null;previous_network_id?:string|null;network_field?:'zone_id'|'vlan_id'|'vrf_id'}
type Preview = {changes:Array<{action:string;id:string;before:unknown;after:unknown;field?:string}>;count:number}
type Props = {systemId:string;items:VM[];networks:Network[];interfaces:NIC[];flows:Flow[];request:<T>(url:string,init?:RequestInit)=>Promise<T>;onCommitted:()=>Promise<void>}
type Tool = 'move'|'vm'|'flow'|'network'
type Rect = {id:string;name:string;kind:string;x:number;y:number;width:number;height:number}
const makeId=()=>crypto.randomUUID()
const rectContains=(r:Rect,p:{x:number;y:number})=>p.x>=r.x&&p.x<=r.x+r.width&&p.y>=r.y&&p.y<=r.y+r.height
const fieldForKind=(kind:string):'zone_id'|'vlan_id'|'vrf_id'=>kind==='vlan'?'vlan_id':kind==='vrf'?'vrf_id':'zone_id'

function Editor({systemId,items,networks,interfaces,flows,request,onCommitted}:Props){
 const [tool,setTool]=useState<Tool>('move')
 const [changes,setChanges]=useState<Change[]>([])
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
 const [drawing,setDrawing]=useState<{x:number;y:number}|null>(null)
 const [rectangles,setRectangles]=useState<Rect[]>(()=>{
   const relevant = networks.filter(n=>interfaces.some(nic=>nic[fieldForKind(n.kind)]===n.id&&items.some(item=>item.id===nic.item_id)))
   return relevant.map((n,i)=>({id:n.id,name:n.name,kind:n.kind,x:60+(i%2)*600,y:60+Math.floor(i/2)*430,width:500,height:340}))
 })
 const initialNodes=useMemo<Node[]>(()=>items.map((item,i)=>{
   const membership=interfaces.find(n=>n.item_id===item.id)
   const group=rectangles.find(r=>membership?.[fieldForKind(r.kind)]===r.id)
   const members=group?items.filter(v=>interfaces.some(n=>n.item_id===v.id&&n[fieldForKind(group.kind)]===group.id)):[]
   const index=group?members.findIndex(v=>v.id===item.id):i
   return {id:item.id,position:group?{x:group.x+25+(index%2)*220,y:group.y+65+Math.floor(index/2)*100}:{x:70+(i%4)*240,y:80+Math.floor(i/4)*120},data:{label:item.name},style:{width:194,padding:14,background:'#fff',border:'1px solid #9daec4',borderRadius:8,boxShadow:'0 2px 8px #24364b17'}}
 }),[items]) // Saved coordinates are local to the editing session.
 const [nodes,setNodes,onNodesChange]=useNodesState(initialNodes)
 const {screenToFlowPosition,fitView}=useReactFlow()
 const allVMs=useMemo(()=>[...items,...changes.filter(c=>c.action==='create_vm').map(c=>({id:c.id!,name:c.name!,system_id:systemId,kind:'vm',details:{}}))],[items,changes,systemId])
 const allNetworks=[...networks,...changes.filter(c=>c.action==='create_network').map(c=>({id:c.id!,name:c.name!,kind:c.kind!}))]
 const visibleRects=rectangles.filter(r=>allNetworks.some(n=>n.id===r.id))
 const backgroundNodes:Node[]=visibleRects.map(r=>({id:'network:'+r.id,type:'default',position:{x:r.x,y:r.y},draggable:false,selectable:false,connectable:false,data:{label:r.name+' · '+r.kind.toUpperCase()},style:{width:r.width,height:r.height,background:'#e7f0fc55',border:'2px solid #7aa6d5',borderRadius:9,zIndex:-1,pointerEvents:'none',textAlign:'left',padding:12,fontSize:13,color:'#285787'}}))
 const graphNodes=[...backgroundNodes,...nodes]
 const edges=flows.filter(f=>allVMs.some(v=>v.id===f.source_id)&&allVMs.some(v=>v.id===f.target_id)).map(f=>({id:f.id,source:f.source_id,target:f.target_id,animated:false,style:{stroke:'#64748b',strokeWidth:1.5},label:f.port?f.protocol+':'+f.port:f.name}))
 const addChange=(c:Change)=>{setChanges(previous=>[...previous,c]);setPreview(null);setError('')}
 const moveNode=(node:Node)=>{
   const center={x:node.position.x+97,y:node.position.y+30}
   // A zone move affects exactly one chosen NIC; never replace all NIC memberships.
   const target=visibleRects.slice().reverse().find(r=>rectContains(r,center))
   if(!target)return
   const field=fieldForKind(target.kind)
   const attached=interfaces.filter(n=>n.item_id===node.id)
   const nic=attached.find(n=>n.id===interfaceId)|| (attached.length===1?attached[0]:undefined)
   if(!nic){setError('Для перемещения в сеть выберите интерфейс ВМ (или сначала создайте его в реестре).');return}
   const prior=changes.find(c=>c.action==='move_interface'&&c.interface_id===nic.id&&c.network_field===field)
   if((prior?prior.network_id:nic[field])===target.id)return
   const next:Change={action:'move_interface',interface_id:nic.id,network_id:target.id,previous_network_id:nic[field],network_field:field}
   setChanges(previous=>[...previous.filter(c=>!(c.action==='move_interface'&&c.interface_id===nic.id&&c.network_field===field)),next])
   setPreview(null);setError('')
 }
 const addVM=()=>{
   if(!name.trim())return setError('Введите имя новой ВМ.')
   const id=makeId()
   addChange({action:'create_vm',id,system_id:systemId,name:name.trim(),kind:'vm'})
   setNodes(previous=>[...previous,{id,position:{x:90+(previous.length%4)*240,y:100+Math.floor(previous.length/4)*120},data:{label:name.trim()},style:{width:194,padding:14,background:'#fff',border:'1px dashed #2674bf',borderRadius:8}}])
   setName('');setTool('move')
 }
 const addFlow=()=>{
   if(!from||!to||from===to)return setError('Выберите разные исходный и целевой компоненты.')
   if(!port.trim())return setError('Укажите порт или диапазон портов.')
   const source=direction==='reverse'?to:from,target=direction==='reverse'?from:to
   addChange({action:'create_flow',id:makeId(),source_id:source,target_id:target,name:allVMs.find(v=>v.id===source)?.name+' → '+allVMs.find(v=>v.id===target)?.name,protocol,port,security})
   if(direction==='both')addChange({action:'create_flow',id:makeId(),source_id:target,target_id:source,name:allVMs.find(v=>v.id===target)?.name+' → '+allVMs.find(v=>v.id===source)?.name,protocol,port,security})
   setTool('move')
 }
 const addNetwork=(end:{x:number;y:number})=>{
   if(!drawing||!name.trim()){setError('Сначала задайте имя сети и две точки прямоугольника.');return}
   const x=Math.min(drawing.x,end.x),y=Math.min(drawing.y,end.y)
   const width=Math.abs(end.x-drawing.x),height=Math.abs(end.y-drawing.y)
   if(width<180||height<120){setError('Нарисуйте прямоугольник минимум 180 × 120.');setDrawing(null);return}
   const id=makeId()
   setRectangles(prev=>[...prev,{id,name:name.trim(),kind,x,y,width,height}])
   addChange({action:'create_network',id,name:name.trim(),kind})
   setDrawing(null);setName('');setTool('move')
 }
 const handlePaneClick=(event:React.MouseEvent)=>{
   if(tool!=='network')return
   const point=screenToFlowPosition({x:event.clientX,y:event.clientY})
   if(drawing)addNetwork(point)
   else {setDrawing(point);setError('')}
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
     await onCommitted()
     if(showHistory)void openHistory()
     setChanges([]);setPreview(null);setReason('');setDrawing(null);setError('Изменения сохранены. Запись добавлена в журнал действий.')
   }catch(e){setPreview(null);setError('Сохранение отклонено: '+String(e)+'. Обновите предварительный просмотр.')}
   finally{setBusy(false)}
 }
 return <section className="boardWorkspace" aria-label="Редактор архитектурной доски">
   <div className="boardTools" role="toolbar" aria-label="Инструменты архитектуры">
     {([['move','Перемещать'],['vm','+ ВМ'],['flow','→ Поток'],['network','▭ Сеть']] as const).map(([key,title])=><button key={key} aria-pressed={tool===key} onClick={()=>{setTool(key);setDrawing(null);setError('')}}>{title}</button>)}
     <button disabled={!nodes.length} onClick={()=>void fitView({padding:0.18,duration:250})}>Показать всё</button>
     <strong>{changes.length} изменений</strong>
     <button type="button" onClick={()=>void openHistory()}>История изменений</button>
   </div>
   {tool==='vm'&&<div className="boardToolFields"><label>Имя ВМ <input value={name} onChange={e=>setName(e.target.value)} placeholder="Новая ВМ"/></label><button onClick={addVM}>Разместить на схеме</button></div>}
   {tool==='network'&&<div className="boardToolFields"><label>Название сети <input value={name} onChange={e=>setName(e.target.value)}/></label><label>Тип <select value={kind} onChange={e=>setKind(e.target.value as typeof kind)}><option value="zone">Зона</option><option value="vlan">VLAN</option><option value="vrf">VRF</option></select></label><span>{drawing?'Нажмите на противоположный угол прямоугольника':'Щёлкните на схеме – первый угол, затем второй угол'}</span></div>}
   {tool==='flow'&&<div className="boardToolFields"><label>Откуда <select value={from} onChange={e=>setFrom(e.target.value)}><option value="">Выберите</option>{allVMs.map(v=><option key={v.id} value={v.id}>{v.name}</option>)}</select></label><label>Куда <select value={to} onChange={e=>setTo(e.target.value)}><option value="">Выберите</option>{allVMs.map(v=><option key={v.id} value={v.id}>{v.name}</option>)}</select></label><label>Направление <select value={direction} onChange={e=>setDirection(e.target.value as typeof direction)}><option value="forward">→</option><option value="reverse">←</option><option value="both">↔ (два потока)</option></select></label><label>Протокол <input value={protocol} onChange={e=>setProtocol(e.target.value)}/></label><label>Порт <input value={port} onChange={e=>setPort(e.target.value)}/></label><label>Защита <input value={security} onChange={e=>setSecurity(e.target.value)}/></label><button onClick={addFlow}>Добавить поток</button></div>}
   <div className="boardToolFields"><label>Интерфейс для перемещения в сеть <select value={interfaceId} onChange={e=>setInterfaceId(e.target.value)}><option value="">Автоматически, если один</option>{interfaces.filter(n=>items.some(i=>i.id===n.item_id)).map(n=><option key={n.id} value={n.id}>{items.find(i=>i.id===n.item_id)?.name} · {n.name}</option>)}</select></label><span>Перетащите ВМ в прямоугольник сети – изменение будет подготовлено, но не сохранено.</span></div>
   <div className="boardCanvas"><ReactFlow nodes={graphNodes} edges={edges} onNodesChange={(changes:NodeChange[])=>onNodesChange(changes.filter(c=>!('id' in c)||!c.id.startsWith('network:')))} nodesDraggable={tool==='move'} nodesConnectable={false} onNodeDragStop={(_,node)=>moveNode(node)} onPaneClick={handlePaneClick} minZoom={0.08} fitView fitViewOptions={{padding:0.2,maxZoom:1}}><Background gap={20}/><Controls showInteractive={false}/></ReactFlow></div>
   <div className="boardReview"><label>Причина изменений <input value={reason} onChange={e=>{setReason(e.target.value);setPreview(null)}} placeholder="Например: актуализация схемы ИС после изменения сети"/></label><button disabled={!changes.length||busy} onClick={submitPreview}>Проверить изменения ({changes.length})</button><button disabled={!changes.length||busy} onClick={()=>{setChanges([]);setPreview(null);setError('Черновик операций очищен. Новые нарисованные объекты исчезнут при повторном открытии редактора.')}}>Отменить черновик</button></div>
   {!!error&&<p role="status" className="boardStatus">{error}</p>}
   {showHistory&&<div className="boardConfirm" role="dialog" aria-modal="true" aria-label="Журнал изменений архитектуры"><div className="boardConfirmInner"><h3>Журнал изменений доски</h3><p>Последние подтверждённые пакеты операций.</p><ol>{history.map(entry=><li key={entry.id}><strong>{entry.timestamp}</strong> – {entry.reason} · {entry.changes.length} операций<details><summary>Посмотреть состав</summary><pre>{JSON.stringify(entry.changes,null,2)}</pre></details></li>)}</ol>{!history.length&&<p>Записей пока нет.</p>}<button type="button" onClick={()=>setShowHistory(false)}>Закрыть</button></div></div>}
   {preview&&<div className="boardConfirm" role="dialog" aria-modal="true" aria-label="Подтверждение изменений архитектуры"><div className="boardConfirmInner"><h3>Подтверждение изменений</h3><p>Причина: {reason}. Будет сохранено {preview.count} операций. Для существующих интерфейсов сверяется прежняя сеть.</p><ol>{preview.changes.map((c,i)=><li key={i}><strong>{c.action}</strong> · {c.id}<pre>{JSON.stringify({before:c.before,after:c.after},null,2)}</pre></li>)}</ol><div><button disabled={busy} onClick={()=>setPreview(null)}>Вернуться к схеме</button><button disabled={busy} className="primary" onClick={commit}>Подтвердить и записать в журнал</button></div></div></div>}
 </section>
}

export default function ArchitectureBoard(props:Props){return <ReactFlowProvider><Editor {...props}/></ReactFlowProvider>}
