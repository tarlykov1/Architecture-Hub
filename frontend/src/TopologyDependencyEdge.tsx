import {BaseEdge, EdgeLabelRenderer, type Edge, type EdgeProps} from '@xyflow/react'
import {flowCountLabel} from './graphLayout'

type DependencyEdge = Edge<{count:number; peerAtSource:boolean; description:string; open:()=>void}>

/** Reserve a short horizontal segment by the peer. Its label stays in that peer's row. */
function TopologyDependencyEdge({id,sourceX,sourceY,targetX,targetY,style,markerEnd,data}:EdgeProps<DependencyEdge>){
  if(!data)return null
  const sign=Math.sign(targetX-sourceX)
  const stub=sign*Math.min(88,Math.abs(targetX-sourceX)*0.52)
  const a=sourceX+(data.peerAtSource?stub:0)
  const b=targetX-(data.peerAtSource?0:stub)
  const mid=(a+b)/2
  const path=`M ${sourceX} ${sourceY} H ${a} C ${mid} ${sourceY}, ${mid} ${targetY}, ${b} ${targetY} H ${targetX}`
  const x=data.peerAtSource?sourceX+stub/2:targetX-stub/2
  const y=data.peerAtSource?sourceY:targetY
  return <>
    <BaseEdge id={id} path={path} style={style} markerEnd={markerEnd} interactionWidth={18}/>
    <EdgeLabelRenderer><button className="topologyFlowCount nodrag nopan" aria-label={data.description} title={data.description}
      style={{transform:`translate(-50%, -50%) translate(${x}px, ${y}px)`}}
      onClick={event=>{event.stopPropagation();data.open()}}>{flowCountLabel(data.count)}</button></EdgeLabelRenderer>
  </>
}
export const topologyEdgeTypes={dependency:TopologyDependencyEdge}
