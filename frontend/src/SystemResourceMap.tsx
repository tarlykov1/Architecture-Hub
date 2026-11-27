import {useEffect,useState} from 'react'
import {Background,Controls,MarkerType,Position,ReactFlow,type Edge,type Node} from '@xyflow/react'
import {architectureIcon} from './DiagramVisual'
import {assetKinds,placeName,type Asset,type Place,type Request} from './equipment'
import './resourceMap.css'

type Component={id:string;parent_id:string|null;name:string;kind:string;description:string}
type Props={system:{id:string;name:string};items:Component[];request:Request;onOpen:(id:string)=>void;readAssets:boolean}
type Card={id:string;name:string;kind:string;detail?:string;open?:()=>void}
const lanes=['Информационная система','Приложения и сервисы','Виртуальные машины','Серверы','Хранение данных','Сетевое оборудование']
function componentLane(kind:string){
  if(kind==='vm')return 2
  if(['server','host'].includes(kind))return 3
  if(kind==='storage')return 4
  if(['switch','router','access_point','firewall','gateway','load_balancer','vpn'].includes(kind))return 5
  return 1
}

export default function SystemResourceMap({system,items,request,onOpen,readAssets}:Props){
  const [assets,setAssets]=useState<Asset[]>([])
  const [places,setPlaces]=useState<Place[]>([])
  const [error,setError]=useState('')
  useEffect(()=>{
    let current=true
    if(readAssets)Promise.all([request<Asset[]>('/api/network-assets'),request<Place[]>('/api/network-assets/locations')])
      .then(([a,p])=>{if(current){setAssets(a);setPlaces(p);setError('')}})
      .catch(()=>{if(current)setError('Не удалось загрузить оборудование')})
    return ()=>{current=false}
  },[request,readAssets])
  const bands:Card[][]=lanes.map(()=>[])
  const ids=new Set(items.map(i=>i.id))
  const root='system:'+system.id
  bands[0].push({id:root,name:system.name,kind:'system'})
  const edges:Edge[]=[]
  function connect(source:string,target:string){
    edges.push({id:source+'/'+target,source,target,zIndex:1,type:'smoothstep',markerEnd:{type:MarkerType.ArrowClosed}})
  }
  const withChildren=new Set(items.map(i=>i.parent_id))
  for(const item of items){
    bands[componentLane(item.kind)].push({...item,detail:item.kind==='vm'?[item.description,items.filter(child=>child.parent_id===item.id).map(child=>child.name).join(', ')].filter(Boolean).join(' · '):item.description,open:()=>onOpen(item.id)})
    if(!withChildren.has(item.id))connect(root,item.id)
    if(item.parent_id&&ids.has(item.parent_id))connect(item.id,item.parent_id)
  }
  for(const asset of readAssets?assets:[]){
    const links=asset.equipment?.component_ids.filter(id=>ids.has(id))||[]
    if(!links.length)continue
    const id='asset:'+asset.id
    const place=places.find(p=>p.id===asset.equipment?.location_id)
    bands[asset.kind==='server'?3:asset.kind==='storage'?4:5].push({
      id,name:asset.name,kind:asset.kind,detail:[assetKinds[asset.kind],asset.equipment?.model,place&&placeName(place)].filter(Boolean).join(' · ')
    })
    links.forEach(component=>connect(component,id))
  }
  const nodes:Node[]=[]
  const columns=Math.min(4,Math.max(...bands.map(b=>b.length)))
  let y=0
  bands.forEach((band,index)=>{
    if(!band.length)return
    const height=42+Math.ceil(band.length/columns)*116
    nodes.push({id:'band:'+index,type:'group',width:columns*250+20,height,position:{x:0,y},style:{width:columns*250+20,height},data:{},className:'resourceBand band'+index,selectable:false})
    nodes.push({id:'caption:'+index,type:'default',initialWidth:235,initialHeight:27,position:{x:10,y:y+5},style:{width:235},className:'resourceCaption',data:{label:lanes[index]},selectable:false})
    band.forEach((card,i)=>{
      const body=<>{architectureIcon(card.kind)}<span><strong>{card.name}</strong>{card.detail&&<small>{card.detail}</small>}</span></>
      nodes.push({id:card.id,initialWidth:214,initialHeight:58,position:{x:20+(columns-Math.min(columns,band.length-Math.floor(i/columns)*columns))*125+(i%columns)*250,y:y+40+Math.floor(i/columns)*116},
        style:{width:214},zIndex:2,className:'resourceNode resourceLevel'+index,sourcePosition:Position.Bottom,targetPosition:Position.Top,
        data:{label:card.open?<button type="button" onClick={card.open}>{body}</button>:<div title={card.detail}>{body}</div>}})
    })
    y+=height+22
  })
  return <section aria-label="Ресурсная карта ИС">{error&&<p role="alert">{error}</p>}<div className="resourceMap">
    <ReactFlow key={system.id+':'+nodes.length} nodes={nodes} edges={edges} nodesDraggable={false} nodesConnectable={false}
      deleteKeyCode={null} fitView fitViewOptions={{padding:0.1,maxZoom:1}} minZoom={0.05}>
      <Background gap={24}/><Controls showInteractive={false}/>
    </ReactFlow></div></section>
}
