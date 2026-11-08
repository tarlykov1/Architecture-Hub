import type {CSSProperties,ReactNode} from 'react'

/**
 * The overview is the visual reference for all Architecture Hub diagrams.
 * Keep node chrome in one place so component/flow/editor views cannot drift.
 */
export function architectureIcon(kind:string):string{
  const k=kind.toLowerCase()
  if(/database|postgres|mysql|db|бд/.test(k))return '▤'
  if(/vm|server|host|сервер/.test(k))return '▣'
  if(/network|vlan|vrf|zone|сеть/.test(k))return '◇'
  if(/gateway|proxy|firewall|security|шлюз/.test(k))return '⬡'
  if(/container|docker|kubernetes/.test(k))return '▥'
  if(/service|api|integration|сервис/.test(k))return '⟷'
  return '▦'
}

export const diagramCardStyle = (overrides:CSSProperties={}):CSSProperties=>({
  width:245,
  padding:12,
  background:'#fff',
  border:'1px solid #94a3b8',
  borderRadius:12,
  textAlign:'left',
  ...overrides,
})

export function DiagramNodeLabel({name,kind,subtitle,detail,children}:{
  name:string;kind:string;subtitle?:string;detail?:string;children?:ReactNode
}){
  return <div className="homeNode architectureGraphNode">
    <strong><span className="architectureGraphIcon" aria-hidden="true">{architectureIcon(kind)}</span> {name}</strong>
    {subtitle&&<small>{subtitle}</small>}
    {detail&&<small className="architectureGraphDetail">{detail}</small>}
    {children}
  </div>
}
