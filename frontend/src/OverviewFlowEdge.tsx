import {BaseEdge, EdgeLabelRenderer, getSmoothStepPath, type Edge, type EdgeProps} from '@xyflow/react'
import {useEffect, useRef} from 'react'
import {flowCountLabel} from './graphLayout'
import {workspaceRouteUrl} from './workspaceRoutes'

export type OverviewFlow = {id: string; name: string; data_description: string}
type FlowEdge = Edge<{flows: OverviewFlow[]; open: boolean; toggle: () => void; close: () => void}>

export function OverviewFlowEdge(props: EdgeProps<FlowEdge>) {
  const [path, x, y] = getSmoothStepPath(props)
  const menu = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const {data} = props
  useEffect(() => {
    if (!data?.open) return
    const outside = (event: PointerEvent) => {
      if (!menu.current?.contains(event.target as Node)) data.close()
    }
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { data.close(); trigger.current?.focus() }
    }
    document.addEventListener('pointerdown', outside)
    document.addEventListener('keydown', escape)
    return () => {
      document.removeEventListener('pointerdown', outside)
      document.removeEventListener('keydown', escape)
    }
  }, [data])
  return <>
    <BaseEdge path={path} markerEnd={props.markerEnd} style={props.style}/>
    {data && <EdgeLabelRenderer>
      <div ref={menu} className="overviewEdgeControl nodrag nopan" style={{transform: `translate(-50%, -50%) translate(${x}px, ${y}px)`}}>
        <button ref={trigger} type="button" aria-expanded={data.open} onClick={data.toggle}>{flowCountLabel(data.flows.length)}</button>
        {data.open && <div className="overviewFlowList nowheel" aria-label="Потоки между системами">
          {data.flows.map(flow => <a key={flow.id} href={workspaceRouteUrl('flows', '', '', false, flow.id)}>
            <span>{flow.name || flow.data_description || 'Поток '+flow.id.slice(0,8)}</span><span aria-hidden="true">›</span>
          </a>)}
        </div>}
      </div>
    </EdgeLabelRenderer>}
  </>
}
