import React from 'react'
import {BaseEdge,EdgeLabelRenderer,type EdgeProps} from '@xyflow/react'

/** Reciprocal records remain separate; each gets its own curved lane and arrow. */
export function ReciprocalEdge({id,source,target,sourceX,sourceY,targetX,targetY,markerEnd,style,data}:EdgeProps){
  const dx=targetX-sourceX,dy=targetY-sourceY
  const distance=Math.max(1,Math.hypot(dx,dy))
  // Both directions must bend to opposite physical sides of the connection.
  const direction=source<target?1:-1
  const offset=52*direction
  const nx=-dy/distance,ny=dx/distance
  const midX=(sourceX+targetX)/2+nx*offset
  const midY=(sourceY+targetY)/2+ny*offset
  const path=`M ${sourceX} ${sourceY} Q ${midX} ${midY} ${targetX} ${targetY}`
  const labelX=(sourceX+2*midX+targetX)/4
  const labelY=(sourceY+2*midY+targetY)/4
  return <>
    <BaseEdge id={id} path={path} markerEnd={markerEnd} style={style} interactionWidth={22}/>
    {typeof data?.caption==='string'&&data.caption.trim()&&<EdgeLabelRenderer><div className="reciprocalEdgeLabel" style={{position:'absolute',transform:`translate(-50%,-50%) translate(${labelX}px,${labelY}px)`,pointerEvents:'none',opacity:style?.opacity??1}}>{data.caption}</div></EdgeLabelRenderer>}
  </>
}
