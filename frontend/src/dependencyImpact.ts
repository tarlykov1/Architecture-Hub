/** Downstream reachability along registered directed data flows. This is an impact hypothesis, not an outage prediction. */
export type DependencyLink={source_id:string;target_id:string}
export function downstreamImpact(start:string,links:DependencyLink[],allowed:ReadonlySet<string>){
  if(!start||!allowed.has(start))return new Set<string>()
  const outgoing=new Map<string,Set<string>>()
  for(const link of links){
    if(!allowed.has(link.source_id)||!allowed.has(link.target_id))continue
    if(!outgoing.has(link.source_id))outgoing.set(link.source_id,new Set())
    outgoing.get(link.source_id)!.add(link.target_id)
  }
  const seen=new Set([start]),queue=[start]
  for(let i=0;i<queue.length;i++)for(const next of outgoing.get(queue[i])||[]){
    if(!seen.has(next)){seen.add(next);queue.push(next)}
  }
  seen.delete(start)
  return seen
}

export type VerifiedDependencyLink=DependencyLink&{verification?:string;name?:string}
export type ImpactRoute={target:string;nodes:string[];verification:string;steps:number}
/** Shortest registered route, with a conservative confidence classification. */
export function impactRoutes(start:string,links:VerifiedDependencyLink[],allowed:ReadonlySet<string>):ImpactRoute[]{
 if(!allowed.has(start))return []
 const bySource=new Map<string,VerifiedDependencyLink[]>()
 for(const link of links)if(allowed.has(link.source_id)&&allowed.has(link.target_id)){
   const existing=bySource.get(link.source_id)||[]
   existing.push(link);bySource.set(link.source_id,existing)
 }
 const routes=new Map<string,ImpactRoute>()
 const queue=[{node:start,nodes:[start],confirmed:true}]
 const seen=new Set([start])
 for(let idx=0;idx<queue.length;idx++){
   const item=queue[idx]
   for(const link of [...(bySource.get(item.node)||[])].sort((a,b)=>a.target_id.localeCompare(b.target_id))){
     if(seen.has(link.target_id))continue
     seen.add(link.target_id)
     const nodes=[...item.nodes,link.target_id]
     const confirmed=item.confirmed&&link.verification==='verified'
     routes.set(link.target_id,{target:link.target_id,nodes,verification:confirmed?'Подтверждённые записи':'Есть неподтверждённые записи',steps:nodes.length-1})
     queue.push({node:link.target_id,nodes,confirmed})
   }
 }
 return [...routes.values()].sort((a,b)=>a.steps-b.steps||a.target.localeCompare(b.target))
}
