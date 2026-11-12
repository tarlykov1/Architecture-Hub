import React from 'react'
import {Handle, Position} from '@xyflow/react'
import './flowPorts.css'

export type FlowPortPair={source_handle:string;target_handle:string}
export type FlowEnd='source'|'target'
export type FlowPortSide='top'|'right'|'bottom'|'left'

type Port={side:FlowPortSide;index:1|2;position:Position;style:React.CSSProperties}
export const FLOW_PORTS:Port[]=[
 {side:'top',index:1,position:Position.Top,style:{top:0,left:'33.333%'}},
 {side:'top',index:2,position:Position.Top,style:{top:0,left:'66.667%'}},
 {side:'right',index:1,position:Position.Right,style:{right:0,top:'33.333%'}},
 {side:'right',index:2,position:Position.Right,style:{right:0,top:'66.667%'}},
 {side:'bottom',index:1,position:Position.Bottom,style:{bottom:0,left:'33.333%'}},
 {side:'bottom',index:2,position:Position.Bottom,style:{bottom:0,left:'66.667%'}},
 {side:'left',index:1,position:Position.Left,style:{left:0,top:'33.333%'}},
 {side:'left',index:2,position:Position.Left,style:{left:0,top:'66.667%'}}
]
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
