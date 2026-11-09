export type FlowDetailPreference='auto'|'systems'|'components'
export type FlowEndpoint={source_id:string;target_id:string}
export function shouldShowSystemsOverview(
  flows:FlowEndpoint[], systemCount:number, hasSystemFilter:boolean, hasComponentFocus:boolean,
  preference:FlowDetailPreference, legacyOverview=false,
):boolean{
  if(preference==='systems')return true
  if(preference==='components')return false
  if(legacyOverview)return true
  if(hasSystemFilter||hasComponentFocus||systemCount<2)return false
  // Even a graph with relatively few VMs becomes unreadable when dozens
  // of parallel data flows must be shown at once. Aggregate by system before
  // shrinking every card to a microscopic zoom level.
  return flows.length>=24 || new Set(flows.flatMap(flow=>[flow.source_id,flow.target_id])).size>20
}
