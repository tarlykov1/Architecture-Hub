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
  return new Set(flows.flatMap(flow=>[flow.source_id,flow.target_id])).size>20
}
