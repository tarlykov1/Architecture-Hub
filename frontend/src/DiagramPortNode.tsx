import {Handle, type Node, type NodeChange} from '@xyflow/react'
import {useRef, type ReactNode} from 'react'
import {FLOW_PORTS, sourcePort} from './flowPorts'

/** Loose connection mode allows the same visible port to receive or start a flow. */
function DiagramPortNode({data,isConnectable}:{data:{label?:ReactNode};isConnectable:boolean}) {
  return <>{data.label}{FLOW_PORTS.map(port=>
    <Handle key={sourcePort(port)} id={sourcePort(port)} type="source" position={port.position}
      isConnectable={isConnectable} style={port.style} className="diagramPort"/>
  )}</>
}

export const diagramPortNodes={diagramPort:DiagramPortNode}

// React Flow drops measured bounds when a controlled node is rebuilt without them.
// Keep the DOM measurements when unrelated inspector or form state changes.
export function useDiagramMeasurements(){
  const sizes=useRef(new Map<string,{width:number;height:number}>())
  function record(changes:NodeChange[]){
    for(const change of changes){
      if(change.type==='dimensions'&&change.dimensions)sizes.current.set(change.id,change.dimensions)
      if(change.type==='remove')sizes.current.delete(change.id)
    }
  }
  function apply<T extends Node>(nodes:T[]){
    return nodes.map(node=>({...node,measured:sizes.current.get(node.id)}))
  }
  return {record,apply}
}
