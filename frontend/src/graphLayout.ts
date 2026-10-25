/** Deterministic, dependency-aware layout for read-only architecture graphs. */
export type LayoutEdge={source:string;target:string}
export type LayoutPoint={x:number;y:number}
export function dependencyLayout(ids:string[],edges:LayoutEdge[],xGap=270,yGap=150):Record<string,LayoutPoint>{
  const order=[...new Set(ids)].sort((a,b)=>a.localeCompare(b))
  const allowed=new Set(order)
  const outgoing=new Map(order.map(id=>[id,[] as string[]]))
  const incoming=new Map(order.map(id=>[id,0]))
  for(const edge of edges){
    if(!allowed.has(edge.source)||!allowed.has(edge.target)||edge.source===edge.target)continue
    const targets=outgoing.get(edge.source)!
    if(!targets.includes(edge.target)){targets.push(edge.target);incoming.set(edge.target,incoming.get(edge.target)!+1)}
  }
  const layers=new Map<string,number>()
  const ready=order.filter(id=>incoming.get(id)===0)
  let visited=0
  while(ready.length){
    ready.sort((a,b)=>a.localeCompare(b))
    const id=ready.shift()!
    visited++
    const depth=layers.get(id)||0
    for(const target of outgoing.get(id)!){
      layers.set(target,Math.max(layers.get(target)||0,depth+1))
      incoming.set(target,incoming.get(target)!-1)
      if(incoming.get(target)===0)ready.push(target)
    }
  }
  // Cyclic components cannot be topologically sorted: keep them in a stable fallback column.
  const fallback=Math.max(0,...layers.values())+1
  if(visited<order.length)for(const id of order)if(incoming.get(id)!>0)layers.set(id,fallback)
  const columns=new Map<number,string[]>()
  for(const id of order){const depth=layers.get(id)||0;const list=columns.get(depth)||[];list.push(id);columns.set(depth,list)}
  const result:Record<string,LayoutPoint>={}
  for(const [depth,list] of columns)list.forEach((id,index)=>{result[id]={x:depth*xGap,y:index*yGap}})
  return result
}
