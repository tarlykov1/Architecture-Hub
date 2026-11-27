import {useState} from 'react'
import type {Request} from './equipment'

type Item={id:string;name:string;kind:string;parent_id:string|null}
export function PlacementEditor({items,systemId,request,onSaved}:{items:Item[];systemId:string;request:Request;onSaved:(updates:Map<string,string|null>)=>void}){
  const [changes,setChanges]=useState<Record<string,{previous:string|null;target:string|null}>|null>(null)
  const [busy,setBusy]=useState(false)
  const [error,setError]=useState('')
  const hosts=items.filter(i=>i.kind==='vm')
  const workloads=items.filter(i=>!['vm','server','host','storage','switch','router','firewall','gateway','access_point','vpn','load_balancer'].includes(i.kind))
  if(!changes)return <button type="button" onClick={()=>{setError('');setChanges({})}}>Редактировать состав</button>
  async function save(){
    if(!changes||busy)return
    setBusy(true);setError('')
    try{
      const moves=Object.entries(changes).map(([id,c])=>({id,previous:c.previous,target:c.target}))
      await request('/api/infra/placement/'+systemId,{method:'PUT',body:JSON.stringify(moves)})
      onSaved(new Map(moves.map(m=>[m.id,m.target])))
      setChanges(null)
    }catch(e){setError(String(e))}finally{setBusy(false)}
  }
  return <form className="placementEditor" aria-label="Размещение компонентов" onSubmit={e=>{e.preventDefault();void save()}}>
    <h3>Размещение компонентов</h3>
    {workloads.length===0&&<p>В составе ИС пока нет приложений и сервисов.</p>}
    {workloads.map(item=><label key={item.id}>{item.name}<select disabled={busy} value={item.id in changes?changes[item.id].target||'':item.parent_id||''} onChange={e=>{
      const next={...changes},target=e.target.value||null,previous=item.id in changes?changes[item.id].previous:item.parent_id
      if(target===previous)delete next[item.id]
      else next[item.id]={previous,target}
      setChanges(next)
    }}><option value="">Без размещения</option>{item.parent_id&&!hosts.some(h=>h.id===item.parent_id)&&<option value={item.parent_id}>{items.find(i=>i.id===item.parent_id)?.name||'Текущее размещение'}</option>}{hosts.map(h=><option key={h.id} value={h.id}>{h.name}</option>)}</select></label>)}
    {error&&<p role="alert">{error}</p>}
    <div className="drawerFormActions"><button type="button" disabled={busy} onClick={()=>setChanges(null)}>Отмена</button><button className="primary" disabled={busy||!Object.keys(changes).length}>Сохранить размещение</button></div>
  </form>
}
