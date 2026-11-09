import React from 'react'
import {Handle,Position,type NodeProps} from '@xyflow/react'

/**
 * Eight bidirectional ports per VM: two on every side.
 * In loose connection mode a single source-type handle is usable for
 * both incoming and outgoing data flows.
 */
export const BOARD_PORTS=[
  {id:'top-a',position:Position.Top,offset:'30%',side:'верхняя',index:1},
  {id:'top-b',position:Position.Top,offset:'70%',side:'верхняя',index:2},
  {id:'right-a',position:Position.Right,offset:'30%',side:'правая',index:1},
  {id:'right-b',position:Position.Right,offset:'70%',side:'правая',index:2},
  {id:'bottom-a',position:Position.Bottom,offset:'30%',side:'нижняя',index:1},
  {id:'bottom-b',position:Position.Bottom,offset:'70%',side:'нижняя',index:2},
  {id:'left-a',position:Position.Left,offset:'30%',side:'левая',index:1},
  {id:'left-b',position:Position.Left,offset:'70%',side:'левая',index:2},
] as const

export function BoardComponentNode({data}:NodeProps){
  return <div className="boardComponentNode">
    {data.label as React.ReactNode}
    {BOARD_PORTS.map(port=><Handle key={port.id} id={port.id}
      type="source" position={port.position} className="boardComponentPort"
      aria-label={`Точка связи: ${port.side} сторона ${port.index}`}
      title={`Точка связи: ${port.side} сторона ${port.index}`}
      style={port.position===Position.Top||port.position===Position.Bottom?
        {left:port.offset}: {top:port.offset}}/>)}
  </div>
}

export const BOARD_NODE_TYPES={architectureComponent:BoardComponentNode}

/** Choose facing sides and distinct lanes when a pair has opposite flows. */
export function pairPorts(
  from:{id:string;position:{x:number;y:number};width?:number;measured?:{width?:number;height?:number}},
  to:{id:string;position:{x:number;y:number};width?:number;measured?:{width?:number;height?:number}},
  reciprocal:boolean
){
  const fc={x:from.position.x+(from.measured?.width||from.width||245)/2,
    y:from.position.y+(from.measured?.height||104)/2}
  const tc={x:to.position.x+(to.measured?.width||to.width||245)/2,
    y:to.position.y+(to.measured?.height||104)/2}
  const dx=tc.x-fc.x,dy=tc.y-fc.y
  // Lexical order gives two stable, distinct lanes for A->B and B->A.
  const lane=reciprocal?(from.id<to.id?'a':'b'):'a'
  if(Math.abs(dx)>Math.abs(dy)){
    return {sourceHandle:(dx>=0?'right-':'left-')+lane,
      targetHandle:(dx>=0?'left-':'right-')+lane}
  }
  return {sourceHandle:(dy>=0?'bottom-':'top-')+lane,
    targetHandle:(dy>=0?'top-':'bottom-')+lane}
}
