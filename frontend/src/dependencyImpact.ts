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
