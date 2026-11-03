export type ComponentGroupMode='environment'|'zone'
export type GroupableComponent={id:string;environment:string;zone:string}
export type ComponentLink={id:string;source_id:string;target_id:string}
export type GroupNode={id:string;label:string;memberIds:string[]}
export type GroupEdge={id:string;source:string;target:string;count:number;flowIds:string[]}

/** Presentation-only aggregation: all original components and directional flow records remain untouched. */
export function groupComponents(items:GroupableComponent[],flows:ComponentLink[],mode:ComponentGroupMode):{nodes:GroupNode[];edges:GroupEdge[]}{
 const groups=new Map<string,GroupNode>(),memberGroup=new Map<string,string>()
 for(const item of items){
  const label=(mode==='environment'?item.environment:item.zone).trim()||'Не указано'
  const id='group:'+label
  if(!groups.has(id))groups.set(id,{id,label,memberIds:[]})
  groups.get(id)!.memberIds.push(item.id)
  memberGroup.set(item.id,id)
 }
 const edges=new Map<string,GroupEdge>()
 for(const flow of flows){
  const source=memberGroup.get(flow.source_id),target=memberGroup.get(flow.target_id)
  if(!source||!target||source===target)continue
  const id=source+'→'+target
  if(!edges.has(id))edges.set(id,{id,source,target,count:0,flowIds:[]})
  const entry=edges.get(id)!
  entry.count++
  entry.flowIds.push(flow.id)
 }
 const nodes=[...groups.values()].sort((a,b)=>a.label.localeCompare(b.label,'ru'))
 for(const node of nodes)node.memberIds.sort()
 return {nodes,edges:[...edges.values()].sort((a,b)=>a.id.localeCompare(b.id))}
}
