import {Background, Controls, MarkerType, ReactFlow, type Node} from '@xyflow/react'
import {useEffect, useRef, useState} from 'react'
import {autoFlowPorts, ReadonlyFlowNode} from './flowPorts'
import {ObstacleAwareEdge} from './ObstacleAwareEdge'
import {flowCountLabel} from './graphLayout'
import {ListOrdered, AppWindow} from 'lucide-react'
import {architectureIcon} from './DiagramVisual'
import './systemComposition.css'

type Item={id:string;name:string;kind:string;parent_id?:string|null;description?:string}
const labels:Record<string,string>={vm:'ВМ',server:'Сервер',host:'Хост',database:'База данных',service:'Сервис',application:'Приложение',queue:'Очередь',api:'API',container:'Контейнер'}

type Flow = {id:string; source_id:string; target_id:string; name:string; protocol:string; port:string}

const nodeTypes={component:ReadonlyFlowNode}
const edgeTypes={placement:ObstacleAwareEdge}
export function SystemComposition({items,flows,onOpen}:{items:Item[];flows:Flow[];onOpen:(id:string)=>void}){
  const container=useRef<HTMLElement>(null)
  const [width,setWidth]=useState(0)
  const [selection,setSelection]=useState('')
  useEffect(()=>{
    const element=container.current
    if(!element)return
    const observer=new ResizeObserver(([entry])=>setWidth(entry.contentRect.width))
    observer.observe(element)
    return ()=>observer.disconnect()
  },[])
  const narrow=width<600
  const byId=new Map(items.map(item=>[item.id,item]))
  const isHost=(item:Item)=>['vm','server','host'].includes(item.kind)
  const hosts=items.filter(isHost)
  const groups=new Map<string,Item[]>()
  for(const item of items){
    if(isHost(item))continue
    const seen=new Set([item.id])
    let parent=byId.get(item.parent_id||'')
    while(parent&&!isHost(parent)&&!seen.has(parent.id)){
      seen.add(parent.id)
      parent=byId.get(parent.parent_id||'')
    }
    const host=parent&&isHost(parent)?parent.id:''
    const group=groups.get(host)||[]
    group.push(item)
    groups.set(host,group)
  }
  const nodes:Node[]=[]
  const sections=[...hosts.map(host=>({host, members:groups.get(host.id)??[]}))]
  if(groups.has(''))sections.push({host:{id:'',name:'Без привязки к ВМ',kind:''},members:groups.get('')!})
  let top=0
  let left=0
  let rowHeight=0
  sections.forEach(({host,members},index)=>{
    const columns=Math.min(narrow?1:2,Math.max(1,members.length))
    const width=columns*224+24
    const rowSpacing=narrow?128:108
    const height=Math.max(110,80+Math.ceil(members.length/columns)*rowSpacing)
    if(narrow||index%2===0){top+=rowHeight;left=0;rowHeight=0}
    const frameId='placement-frame:'+host.id
    if(members.length)nodes.push({id:frameId,type:'group',position:{x:left,y:top},style:{width,height},
      className:'placementFrame',selectable:false,focusable:false,data:{placementFrame:true}})
    const frameLeft=left
    left+=width+96
    rowHeight=Math.max(rowHeight,(members.length?height:54)+80)

    function addNode(item:Item,x:number,y:number,heading=false){
      const icon=item.kind==='queue'?<ListOrdered/>:item.kind==='application'?<AppWindow/>:architectureIcon(item.kind)
      const subtitle=heading?item.description?.trim():labels[item.kind]??item.kind
      const label=item.id?<button type="button" title={[item.name,subtitle].filter(Boolean).join(' · ')} onClick={()=>onOpen(item.id)}>
        {icon}<span>{item.name}{subtitle&&<small>{subtitle}</small>}</span>
      </button>:<strong>{item.name}</strong>
      nodes.push({id:item.id||'placement-unassigned',type:'component',position:{x:frameLeft+x,y:top+y},style:{width:192},zIndex:2,
        className:heading?'placementHeading':'placementItem',selectable:false,focusable:false,data:{label}})
    }
    addNode(host,16,8,true)
    members.forEach((item,i)=>addNode(item,18+(i%columns)*224,76+Math.floor(i/columns)*rowSpacing))
  })
  const positions=new Map(nodes.map(node=>[node.id,node.position]))
  const directions=new Map<string,Flow[]>()
  for(const flow of flows){
    if(!byId.has(flow.source_id)||!byId.has(flow.target_id))continue
    const pair=JSON.stringify([flow.source_id,flow.target_id])
    const group=directions.get(pair)
    if(group)group.push(flow)
    else directions.set(pair,[flow])
  }
  const edges=Array.from(directions,([id,group])=>{
    const first=group[0]
    const source=first.source_id,target=first.target_id
    const ports=autoFlowPorts(positions.get(source)!,positions.get(target)!)
    const secondLane=source>target&&directions.has(JSON.stringify([target,source]))
    const caption=group.length>1?flowCountLabel(group.length):[first.protocol,first.port].filter(Boolean).join(' ')||'1 поток'
    const fullCaption=byId.get(source)!.name+' → '+byId.get(target)!.name+' · '+caption
    return {id,source,target,type:'placement',zIndex:1,
      sourceHandle:secondLane?ports.source_handle.replace('-1','-2'):ports.source_handle,
      targetHandle:secondLane?ports.target_handle.replace('-1','-2'):ports.target_handle,
      markerEnd:{type:MarkerType.ArrowClosed},ariaLabel:fullCaption,
      data:{caption,fullCaption,labelOffsetY:0,onSelect:()=>setSelection(id)}}
  })
  const selected=directions.get(selection)
  return <section ref={container} aria-label="Размещение компонентов по ВМ">
    {!items.length?<p>Компоненты ещё не добавлены.</p>:width>0&&<div className="systemComposition">
      <ReactFlow key={JSON.stringify([narrow,sections.map(section=>[section.host.id,section.members.length])])}
        nodeTypes={nodeTypes} edgeTypes={edgeTypes} nodes={nodes} edges={edges}
        onEdgeClick={(_,edge)=>setSelection(edge.id)} onPaneClick={()=>setSelection('')}
        nodesDraggable={false} nodesConnectable={false} deleteKeyCode={null}
        fitView={!narrow} defaultViewport={{x:18,y:22,zoom:1}} fitViewOptions={{padding:0.12,maxZoom:1}} minZoom={0.08}>
        <Background gap={20}/><Controls showInteractive={false}/>
      </ReactFlow>
    </div>}
    {selected&&<aside className="placementFlows" aria-label="Потоки направления">
      <header><strong>{byId.get(selected[0].source_id)?.name} → {byId.get(selected[0].target_id)?.name}</strong>
        <button type="button" onClick={()=>setSelection('')}>Закрыть</button></header>
      <ul>{selected.map(flow=><li key={flow.id}>{flow.name} <small>{[flow.protocol,flow.port].filter(Boolean).join(' ')}</small></li>)}</ul>
    </aside>}
  </section>
}
