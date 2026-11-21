/** Display hierarchy only; process identity and category remain in the API.
 * Orphaned/legacy parent IDs and cycles cannot crash the registry.
 */
export type ListedProcess={id:string;name:string;category_id:string}
export type ListedPassport={process_id:string;parent_id:string|null}

export function orderedBusinessProcesses<T extends ListedProcess>(
 processes:readonly T[], passports:readonly ListedPassport[]
):Array<{process:T;depth:number}>{
 const byId=new Map(processes.map(p=>[p.id,p]))
 const parents=new Map(passports.map(p=>[p.process_id,p.parent_id]))
 const children=new Map<string,T[]>()
 const roots:T[]=[]
 for(const process of processes){
   const id=parents.get(process.id)
   const parent=id?byId.get(id):null
   if(parent&&parent.id!==process.id&&parent.category_id===process.category_id){
     const group=children.get(parent.id)||[]
     group.push(process)
     children.set(parent.id,group)
   }else roots.push(process)
 }
 const sorted=(a:T,b:T)=>a.name.localeCompare(b.name,'ru')||a.id.localeCompare(b.id)
 const visited=new Set<string>()
 const result:Array<{process:T;depth:number}>=[]
 function traverse(process:T,depth:number){
   if(visited.has(process.id))return
   visited.add(process.id)
   result.push({process,depth})
   for(const child of (children.get(process.id)||[]).sort(sorted))traverse(child,Math.min(depth+1,20))
 }
 for(const root of roots.sort(sorted))traverse(root,0)
 // Defensive fallback for inherited malformed data: still show every BP once.
 for(const row of [...processes].sort(sorted))if(!visited.has(row.id))traverse(row,0)
 return result
}
