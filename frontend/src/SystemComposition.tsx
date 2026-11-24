import {Background, Controls, MarkerType, Position, ReactFlow, type Node} from '@xyflow/react'
import {ListOrdered, AppWindow} from 'lucide-react'
import {architectureIcon} from './DiagramVisual'
import './systemComposition.css'

type Item={id:string;name:string;kind:string;parent_id?:string|null}
const labels:Record<string,string>={vm:'ВМ',server:'Сервер',host:'Хост',database:'База данных',service:'Сервис',application:'Приложение',queue:'Очередь',api:'API',container:'Контейнер'}

type Flow = {id:string; source_id:string; target_id:string; name:string; protocol:string; port:string}

export function SystemComposition({items,flows,onOpen}:{items:Item[];flows:Flow[];onOpen:(id:string)=>void}){
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
    const columns=Math.min(2,Math.max(1,members.length))
    const width=columns*224+24
    const height=Math.max(110,68+Math.ceil(members.length/columns)*88)
    if(index%2===0){top+=rowHeight;left=0;rowHeight=0}
    const frameId='placement-frame:'+host.id
    nodes.push({id:frameId,type:'group',position:{x:left,y:top},style:{width,height},
      className:'placementFrame',selectable:false,focusable:false,data:{}})
    left+=width+96
    rowHeight=Math.max(rowHeight,height+80)

    function addNode(item:Item,x:number,y:number,heading=false){
      const icon=item.kind==='queue'?<ListOrdered/>:item.kind==='application'?<AppWindow/>:architectureIcon(item.kind)
      const label=item.id?<button type="button" title={item.name} onClick={()=>onOpen(item.id)}>
        {icon}<span>{item.name}{!heading&&<small>{labels[item.kind]??item.kind}</small>}</span>
      </button>:<strong>{item.name}</strong>
      nodes.push({id:item.id||'placement-unassigned',parentId:frameId,position:{x,y},style:{width:192},
        className:heading?'placementHeading':'placementItem',sourcePosition:Position.Right,
        targetPosition:Position.Left,selectable:false,focusable:false,data:{label}})
    }
    addNode(host,16,8,true)
    members.forEach((item,i)=>addNode(item,18+(i%columns)*224,60+Math.floor(i/columns)*88))
  })
  const edges=flows.filter(f=>byId.has(f.source_id)&&byId.has(f.target_id)).map(f=>({
    id:f.id,source:f.source_id,target:f.target_id,type:'smoothstep',zIndex:1,
    markerEnd:{type:MarkerType.ArrowClosed},label:[f.protocol,f.port].filter(Boolean).join(' ')||f.name,
    ariaLabel:f.name
  }))
  if(!items.length)return <p>Компоненты ещё не добавлены.</p>
  return <section className="systemComposition" aria-label="Размещение компонентов по ВМ">
    <ReactFlow key={sections.map(section=>section.host.id+':'+section.members.length).join('|')}
      nodes={nodes} edges={edges} nodesDraggable={false} nodesConnectable={false}
      deleteKeyCode={null} fitView fitViewOptions={{padding:0.12,maxZoom:1}} minZoom={0.08}>
      <Background gap={20}/><Controls showInteractive={false}/>
    </ReactFlow>
  </section>
}
