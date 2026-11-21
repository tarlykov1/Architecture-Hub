import {useMemo,useState} from 'react'
import type {Passport} from './BusinessProcessPassport'
import './businessProcessMatrix.css'

type Item={id:string;name:string}
type Process=Item&{category_id:string}
type ProcessLink={process_id:string;system_id:string}
type Props={
 processes:Process[];passports:Passport[];systems:Item[];flows:Item[]
 links:ProcessLink[];onOpen:(id:string)=>void
}
export default function BusinessProcessMatrix({processes,passports,systems,flows,links,onOpen}:Props){
 const [mode,setMode]=useState<'systems'|'flows'>('systems')
 const [search,setSearch]=useState('')
 const chosen=mode==='systems'?systems:flows
 const profiles=new Map(passports.map(p=>[p.process_id,p]))
 const members=useMemo(()=>{
  const result=new Map<string,Set<string>>()
  for(const process of processes){
   const ids=new Set<string>()
   const passport=profiles.get(process.id)
   for(const step of passport?.steps||[]){
    if(mode==='systems'&&step.system_id)ids.add(step.system_id)
    if(mode==='flows'&&step.flow_id)ids.add(step.flow_id)
   }
   if(mode==='systems')for(const link of links){
    if(link.process_id===process.id)ids.add(link.system_id)
   }
   result.set(process.id,ids)
  }
  return result
 },[processes,passports,links,mode])
 const rows=processes.filter(p=>
  !search.trim()||[p.name,profiles.get(p.id)?.owner||''].join(' ').toLocaleLowerCase('ru').includes(search.toLocaleLowerCase('ru')))
 const used=new Set([...members.values()].flatMap(set=>[...set]))
 const cols=chosen.filter(item=>used.has(item.id)).sort((a,b)=>a.name.localeCompare(b.name,'ru'))
 const marked=rows.reduce((count,p)=>count+(members.get(p.id)?.size||0),0)
 return <section className="businessMatrix" aria-label="Матрица бизнес-процессов">
  <div className="businessMatrixToolbar">
   <div role="group" aria-label="Тип матрицы БП">
    <button type="button" aria-pressed={mode==='systems'} onClick={()=>setMode('systems')}>БП × ИС</button>
    <button type="button" aria-pressed={mode==='flows'} onClick={()=>setMode('flows')}>БП × Потоки</button>
   </div>
   <input aria-label="Поиск процесса в матрице" placeholder="Поиск БП или владельца" value={search} onChange={e=>setSearch(e.target.value)}/>
   <span>{rows.length} БП · {cols.length} объектов · {marked} связей</span>
  </div>
  <div className="businessMatrixScroll" role="region" aria-label="Таблица зависимостей БП">
   <table>
    <thead><tr><th scope="col">Бизнес-процесс</th><th scope="col">Шаги</th><th scope="col">Владелец</th>{cols.map(item=><th scope="col" key={item.id} title={item.name}>{item.name}</th>)}</tr></thead>
    <tbody>{rows.map(process=>{
      const profile=profiles.get(process.id),related=members.get(process.id)||new Set<string>()
      return <tr key={process.id}>
       <th scope="row"><button type="button" onClick={()=>onOpen(process.id)}>{process.name}</button></th>
       <td>{profile?.steps.length||0}</td>
       <td>{profile?.owner||<span className="businessMatrixGap">Не указан</span>}</td>
       {cols.map(item=><td key={item.id} className={related.has(item.id)?'linked':''}>
        {related.has(item.id)?<button type="button" aria-label={'Открыть БП '+process.name+' для объекта '+item.name}
         title={'Связь: '+process.name+' ↔ '+item.name} onClick={()=>onOpen(process.id)}>●</button>:<span aria-label="Связь не указана">·</span>}
       </td>)}
      </tr>
    })}</tbody>
   </table>
   {rows.length===0&&<p role="status">Нет процессов по текущему фильтру.</p>}
  </div>
  <p className="businessMatrixNote">Матрица использует связи БП с ИС и ссылки шагов на существующие объекты. Отсутствие отметки не доказывает отсутствия фактического взаимодействия.</p>
 </section>
}
