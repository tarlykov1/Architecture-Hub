export type OverviewRelation={source:string;target:string}

/** A focused system is the anchor of a one-hop neighborhood.
 * Directions are preserved in the exchanges; only the set of visible IS changes.
 */
export function focusedSystemIds(id:string,relations:OverviewRelation[]):Set<string>{
 const result=new Set([id])
 for(const edge of relations){
   if(edge.source===id)result.add(edge.target)
   if(edge.target===id)result.add(edge.source)
 }
 return result
}

/** One central IS and its neighbors. Computed for presentation only.
 * Persisted coordinates must not be overwritten by a filtered view.
 */
export function focusedSystemPositions(id:string,relations:OverviewRelation[],names:string[]){
 const neighbors=names.filter(item=>item!==id)
 const incoming:string[]=[],outgoing:string[]=[]
 for(const item of neighbors){
   if(relations.some(rel=>rel.source===id&&rel.target===item))outgoing.push(item)
   else incoming.push(item)
 }
 const total=Math.max(incoming.length,outgoing.length,1)
 const height=Math.max(200,(total-1)*170)
 const points:Record<string,{x:number;y:number}>={[id]:{x:460,y:height/2}}
 for(const [items,x] of [[incoming,0],[outgoing,920]] as const){
   items.forEach((item,index)=>{points[item]={x,y:height/2-(items.length-1)*85+index*170}})
 }
 return points
}
