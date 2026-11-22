import {BaseEdge, EdgeLabelRenderer, getSmoothStepPath, type Edge, type EdgeProps} from '@xyflow/react'
import {useEffect, useRef} from 'react'
import {flowCountLabel} from './graphLayout'
import {workspaceRouteUrl} from './workspaceRoutes'

export type OverviewFlow = {id: string; name: string; data_description: string; schedule?: string}
type FlowEdge = Edge<{label?:string; processes?: {id:string;name:string}[]; hideControl?:boolean; selected?:boolean; openProcess?:(id:string)=>void; flows: OverviewFlow[]; open: boolean; toggle: () => void; close: () => void}>

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
      if (event.key === 'Escape') {
        event.preventDefault(); event.stopPropagation(); data.close()
        requestAnimationFrame(()=>trigger.current?.focus({preventScroll:true}))
      }
    }
    document.addEventListener('pointerdown', outside)
    document.addEventListener('keydown', escape, true)
    return () => {
      document.removeEventListener('pointerdown', outside)
      document.removeEventListener('keydown', escape, true)
    }
  }, [data])
  return <>
    <BaseEdge path={path} markerEnd={props.markerEnd} style={props.style}/>
    {data && !data.hideControl && <EdgeLabelRenderer>
      <div ref={menu} className="overviewEdgeControl nodrag nopan" style={{transform: `translate(-50%, -50%) translate(${x}px, ${y}px)`}}>
        <button ref={trigger} type="button" aria-label={data.label} aria-expanded={data.open} aria-pressed={data.processes?data.selected:undefined} onClick={event=>{event.stopPropagation();data.toggle()}}>{data.processes?data.processes.length+' БП':flowCountLabel(data.flows.length)}</button>
        {data.open && <div className="overviewFlowList nowheel" aria-label={data.processes?'Общие бизнес-процессы':'Потоки между системами'}>
          {data.processes?.map(process=><button key={process.id} type="button" onClick={()=>data.openProcess?.(process.id)}>{process.name}</button>)}
          {data.flows.map(flow => <a key={flow.id} href={workspaceRouteUrl('flows', '', '', false, flow.id)}>
            <span>{flow.name || flow.data_description || 'Поток '+flow.id.slice(0,8)}{flow.schedule&&<small className="overviewExchangeSchedule">{flow.schedule}</small>}</span><span aria-hidden="true">›</span>
          </a>)}
        </div>}
      </div>
    </EdgeLabelRenderer>}
  </>
}
