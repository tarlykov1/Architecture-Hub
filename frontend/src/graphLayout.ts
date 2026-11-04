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

/** Balanced default canvas for architecture components: compact for unlinked
 * machines, while preserving dependency columns when real flows exist.
 */
export function compactComponentLayout(ids:string[],edges:LayoutEdge[],xGap=280,yGap=170):Record<string,LayoutPoint>{
 const order=[...new Set(ids)].sort((a,b)=>a.localeCompare(b))
 if(!order.length)return {}
 const valid=new Set(order)
 const links=edges.filter(e=>valid.has(e.source)&&valid.has(e.target)&&e.source!==e.target)
 // With no technical flows, a long vertical dependency column is misleading.
 if(!links.length){
  const columns=Math.max(1,Math.ceil(Math.sqrt(order.length*1.5)))
  return Object.fromEntries(order.map((id,i)=>[id,{x:(i%columns)*xGap,y:Math.floor(i/columns)*yGap}]))
 }
 const initial=dependencyLayout(order,links,xGap,yGap)
 // For isolated nodes, pack them into a grid after the actual flow diagram.
 const linked=new Set(links.flatMap(e=>[e.source,e.target]))
 const connected=order.filter(id=>linked.has(id))
 const loose=order.filter(id=>!linked.has(id))
 const maxX=Math.max(0,...connected.map(id=>initial[id].x))
 const columns=Math.max(1,Math.ceil(Math.sqrt(loose.length*1.5)))
 const result:Record<string,LayoutPoint>={}
 for(const id of connected)result[id]=initial[id]
 loose.forEach((id,i)=>{result[id]={x:maxX+xGap+(i%columns)*xGap,y:Math.floor(i/columns)*yGap}})
 return result
}
