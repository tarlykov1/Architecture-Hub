import {Handle} from '@xyflow/react'
import type {ReactNode} from 'react'
import {FLOW_PORTS, sourcePort} from './flowPorts'

/** Loose connection mode allows the same visible port to receive or start a flow. */
function DiagramPortNode({data,isConnectable}:{data:{label?:ReactNode};isConnectable:boolean}) {
  return <>{data.label}{FLOW_PORTS.map(port=>
    <Handle key={sourcePort(port)} id={sourcePort(port)} type="source" position={port.position}
      isConnectable={isConnectable} style={port.style} className="diagramPort"/>
  )}</>
}

export const diagramPortNodes={diagramPort:DiagramPortNode}
