import React from 'react'
import {Handle, Position} from '@xyflow/react'
import './flowPorts.css'

export type FlowPortPair={source_handle:string;target_handle:string}
export type FlowEnd='source'|'target'
export type FlowPortSide='top'|'right'|'bottom'|'left'

type Port={side:FlowPortSide;index:1|2|3|4;position:Position;style:React.CSSProperties}
// Existing indices 1 and 2 must keep their physical positions after an upgrade:
// manually saved attachment points must not jump when two new handles are added.
export const FLOW_PORTS:Port[]=(['top','right','bottom','left'] as const).flatMap(side=>
  ([1,2,3,4] as const).map(index=>{
    const percent=({1:'33.333%',2:'66.667%',3:'16.667%',4:'83.333%'} as const)[index]
    return {
      side,index,
      position:side==='top'?Position.Top:side==='right'?Position.Right:side==='bottom'?Position.Bottom:Position.Left,
      style:side==='top'?{top:0,left:percent}:side==='right'?{right:0,top:percent}:
        side==='bottom'?{bottom:0,left:percent}:{left:0,top:percent},
    }
  })
)
export const sourcePort=(port:Port)=>'out-'+port.side+'-'+port.index
export const targetPort=(port:Port)=>'in-'+port.side+'-'+port.index
export const validSourcePort=(value:string)=>FLOW_PORTS.some(p=>sourcePort(p)===value)
export const validTargetPort=(value:string)=>FLOW_PORTS.some(p=>targetPort(p)===value)
export const sideOfPort=(handle:string)=>handle.split('-')[1] as FlowPortSide

/** Choose the port most directly facing the other component when none is set. */
export function autoFlowPorts(a:{x:number;y:number},b:{x:number;y:number}):FlowPortPair{
 const dx=b.x-a.x,dy=b.y-a.y
 if(Math.abs(dx)>=Math.abs(dy))
  return dx>=0?{source_handle:'out-right-1',target_handle:'in-left-1'}:
                {source_handle:'out-left-1',target_handle:'in-right-1'}
 return dy>=0?{source_handle:'out-bottom-1',target_handle:'in-top-1'}:
              {source_handle:'out-top-1',target_handle:'in-bottom-1'}
}

/**
 * Resolve ALL visible flows together instead of routing every automatic flow
 * to the first handle of its preferred side. Incoming and outgoing flows share
 * the same physical perimeter point and therefore the same occupancy counter.
 *
 * Explicit saved anchors win unless two existing flows claim the same physical
 * point: the first keeps it, the others are placed on available handles.
 * This is only a rendering decision; editing a technical flow remains explicit.
 */
export function distributeFlowPorts(
 flows:readonly {id:string;source_id:string;target_id:string}[],
 positions:Record<string,{x:number;y:number}>,
 saved:Record<string,FlowPortPair>={}
):Record<string,FlowPortPair>{
 const occupied=new Map<string,number>()
 const result:Record<string,FlowPortPair>={}
 const sorted=[...flows].sort((a,b)=>a.id.localeCompare(b.id))
 const location=(vm:string,handle:string)=>vm+'|'+handle.replace(/^(in|out)-/,'')
 const count=(vm:string,handle:string)=>occupied.get(location(vm,handle))||0
 const reserve=(vm:string,handle:string)=>occupied.set(location(vm,handle),count(vm,handle)+1)
 // Keep every valid, collision-free saved point fixed before allocating
 // unassigned endpoints. Saved duplicates are repaired deterministically.
 for(const flow of sorted){
  const pair=saved[flow.id]
  if(!pair||!validSourcePort(pair.source_handle)||!validTargetPort(pair.target_handle))continue
  if(count(flow.source_id,pair.source_handle)||count(flow.target_id,pair.target_handle))continue
  result[flow.id]=pair
  reserve(flow.source_id,pair.source_handle)
  reserve(flow.target_id,pair.target_handle)
 }
 const preference=(a:string,b:string)=>{
  const from=positions[a]||{x:0,y:0},to=positions[b]||{x:0,y:0}
  return autoFlowPorts(from,to)
 }
 const choose=(vm:string,end:FlowEnd,preferred:string)=>{
  const prefix=end==='source'?'out-':'in-'
  const side=sideOfPort(preferred)
  const candidates=FLOW_PORTS.map((port,index)=>({
    id:prefix+port.side+'-'+port.index,
    score:count(vm,prefix+port.side+'-'+port.index)*1000+
      (port.side===side?0:100)+(port.index===1?0:port.index===2?5:port.index===3?12:17)+index/100
  })).sort((a,b)=>a.score-b.score)
  return candidates[0].id
 }
 for(const flow of sorted){
  if(result[flow.id])continue
  const preferred=preference(flow.source_id,flow.target_id)
  const source_handle=choose(flow.source_id,'source',preferred.source_handle)
  reserve(flow.source_id,source_handle)
  const target_handle=choose(flow.target_id,'target',preferred.target_handle)
  reserve(flow.target_id,target_handle)
  result[flow.id]={source_handle,target_handle}
 }
 return result
}

/** Geometry is measured from real React Flow handles, never guessed from the VM size. */
export function closestVisiblePort(
 node:HTMLElement,at:{x:number;y:number},end:FlowEnd,
 maxDistance=Infinity
):{id:string;distance:number}|null{
 const prefix=end==='source'?'out-':'in-'
 const candidates=[...node.querySelectorAll<HTMLElement>('.flowPortHandle')].filter(el=>el.dataset.anchor?.startsWith(prefix))
 const result=candidates.map(el=>{
  const rect=el.getBoundingClientRect()
  const distance=Math.hypot(at.x-rect.left-rect.width/2,at.y-rect.top-rect.height/2)
  return {id:el.dataset.anchor!,distance}
 }).sort((a,b)=>a.distance-b.distance)[0]
 return result&&result.distance<=maxDistance?result:null
}

export function FlowPortHandles({
 visible=false, sourcePointerDown,sourcePointerMove,sourcePointerUp,
}:{
 visible?:boolean
 sourcePointerDown?:(handle:string,event:React.PointerEvent<HTMLDivElement>)=>void
 sourcePointerMove?:(event:React.PointerEvent<HTMLDivElement>)=>void
 sourcePointerUp?:(event:React.PointerEvent<HTMLDivElement>)=>void
}){
 return <>
  {FLOW_PORTS.map(port=><React.Fragment key={port.side+port.index}>
   <Handle type="target" id={targetPort(port)} position={port.position} data-anchor={targetPort(port)}
     isConnectable={false} className="flowPortHandle boardConnectionHandle flowPortTarget" style={port.style}/>
   <Handle type="source" id={sourcePort(port)} position={port.position} data-anchor={sourcePort(port)}
     isConnectable={false} className={'flowPortHandle boardConnectionHandle flowPortSource'+(visible?' boardConnectionHandleActive':'')}
     style={port.style}
     onPointerDown={event=>{if(!visible)return;event.stopPropagation();event.preventDefault();sourcePointerDown?.(sourcePort(port),event)}}
     onPointerMove={event=>sourcePointerMove?.(event)}
     onPointerUp={event=>sourcePointerUp?.(event)}
     onPointerCancel={event=>sourcePointerUp?.(event)}
     onMouseDown={event=>{event.preventDefault();event.stopPropagation()}}
     onClick={event=>{event.preventDefault();event.stopPropagation()}}/>
  </React.Fragment>)}
 </>
}

/** Same anchor geometry without editing handles in read-only architecture mode. */
export function ReadonlyFlowNode({data}:{data:{label?:React.ReactNode}}){
 return <>{data.label}<FlowPortHandles/></>
}
