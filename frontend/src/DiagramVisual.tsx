import type {CSSProperties,ReactNode} from 'react'
import {SystemLogo} from './SystemLogo'

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

export function DiagramNodeLabel({name,kind,subtitle,detail,logo,children}:{
  name:string;kind:string;subtitle?:string;detail?:string;logo?:string;children?:ReactNode
}){
  return <div className="homeNode architectureGraphNode">
    <strong><span className="architectureGraphIcon" aria-hidden="true">{kind==='system'?<SystemLogo logo={logo} size="small"/>:architectureIcon(kind)}</span> {name}</strong>
    {subtitle&&<small>{subtitle}</small>}
    {detail&&<small className="architectureGraphDetail">{detail}</small>}
    {children}
  </div>
}


/** One component card contract for both the saved diagram and its editor.
 * Detailed descriptions and actions belong to the inspector, not the card
 * geometry: a mode switch must never push nodes outside network rectangles.
 */
export function ComponentDiagramLabel({name,kind,systemName,environment,purpose}:{
  name:string;kind:string;systemName?:string;environment?:string;purpose?:string
}){
  return <DiagramNodeLabel name={name} kind={kind} subtitle={systemName}
    detail={kind+' · '+(environment||'Среда не задана')}>
    <small className="componentNodePurpose">{purpose?.trim()||'Назначение не описано'}</small>
  </DiagramNodeLabel>
}
