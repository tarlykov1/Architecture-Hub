import type {CSSProperties,ReactNode} from 'react'
import {Boxes, Cable, Database, Layers, Network, Server, Shield, SquareTerminal} from 'lucide-react'
import {SystemLogo} from './SystemLogo'

/**
 * The overview is the visual reference for all Architecture Hub diagrams.
 * Keep node chrome in one place so component/flow/editor views cannot drift.
 */
const diagramIcons = [
  [/database|postgres|mysql|db|бд/, Database],
  [/vm|server|host|сервер/, Server],
  [/network|vlan|vrf|zone|сеть/, Network],
  [/gateway|proxy|firewall|security|шлюз/, Shield],
  [/container|docker|kubernetes/, Boxes],
  [/service|api|integration|сервис/, Cable],
] as const

export function architectureIcon(kind:string){
  const Icon=diagramIcons.find(([pattern])=>pattern.test(kind.toLowerCase()))?.[1]||SquareTerminal
  return <Icon size={16} strokeWidth={1.7} aria-hidden="true"/>
}

export const diagramCardStyle = (overrides:CSSProperties={}):CSSProperties=>({
  width:245,
  padding:12,
  background:'#fff',
  border:'1px solid var(--hub-line)',
  borderRadius:8,
  textAlign:'left',
  ...overrides,
})

export function DiagramNodeLabel({name,kind,subtitle,detail,logo,children}:{
  name:string;kind:string;subtitle?:string;detail?:string;logo?:string;children?:ReactNode
}){
  return <div className="homeNode architectureGraphNode">
    <strong><span className="architectureGraphIcon" aria-hidden="true">{kind==='system'?(logo?<SystemLogo logo={logo} size="small"/>:<Layers size={17} strokeWidth={1.7}/>):architectureIcon(kind)}</span> {name}</strong>
    {subtitle&&<small>{subtitle}</small>}
    {detail&&<small className="architectureGraphDetail">{detail}</small>}
    {children}
  </div>
}
