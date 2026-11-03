export type DirectedFlow={id:string;source_id:string;target_id:string}
/** Follow the requested direction at every level, including cycles and parallel flows. */
export function scopedFlowIds(start:string,flows:DirectedFlow[],depth:number,direction:'both'|'incoming'|'outgoing'){
 const result=new Set<string>(),visited=new Set([start])
 let frontier=new Set([start])
 for(let level=0;level<depth;level++){
  const next=new Set<string>()
  for(const f of flows){
   if((direction!=='incoming'&&frontier.has(f.source_id))||(direction!=='outgoing'&&frontier.has(f.target_id))){
    result.add(f.id)
    for(const id of [f.source_id,f.target_id])if(!visited.has(id))next.add(id)
   }
  }
  for(const id of next)visited.add(id)
  frontier=next
 }
 return result
}
