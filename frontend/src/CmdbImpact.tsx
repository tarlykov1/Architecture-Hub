import {useEffect,useState} from 'react'

type ConfigurationItem = {
  id:string
  name:string
  ci_class:string
  lifecycle:string
  owner:string|null
  criticality:string|null
  verified_at:string|null
  source:string
}
type ImpactRow = {
  node:ConfigurationItem
  depth:number
  path:string[]
  relations:string[]
  confidence:'known_relation'|'requires_verification'
}
type ImpactResponse = {
  root:ConfigurationItem
  depth:number
  affected:ImpactRow[]
  count:number
  disclaimer:string
}
type Props={
  ciId:string
  request:<T>(url:string,init?:RequestInit)=>Promise<T>
  onOpenComponent?:(id:string)=>void
}

const TYPE_LABEL:Record<string,string>={
  application:'Информационная система',
  vm:'Виртуальная машина',
  database:'База данных',
  service:'Сервис',
  business_process:'Бизнес-процесс',
}

export default function CmdbImpact({ciId,request,onOpenComponent}:Props){
  const [depth,setDepth]=useState(2)
  const [result,setResult]=useState<ImpactResponse|null>(null)
  const [loading,setLoading]=useState(true)
  const [error,setError]=useState('')

  useEffect(()=>{
    let active=true
    setLoading(true);setError('');setResult(null)
    void request<ImpactResponse>('/api/cmdb/impact?ci_id='+encodeURIComponent(ciId)+'&depth='+depth)
      .then(value=>{if(active)setResult(value)})
      .catch(err=>{if(active)setError('Не удалось получить зависимости CMDB: '+String(err))})
      .finally(()=>{if(active)setLoading(false)})
    return ()=>{active=false}
  },[ciId,depth,request])

  return <section className="cmdbImpact" role="region" aria-label="Анализ влияния CMDB">
    <header className="cmdbImpactHead">
      <div>
        <h3>Зависимости и влияние</h3>
        <p>CMDB показывает возможные последствия изменений по зарегистрированным связям.</p>
      </div>
      <label>Глубина
        <select value={depth} onChange={event=>setDepth(Number(event.target.value))} aria-label="Глубина CMDB">
          <option value={1}>1 шаг</option><option value={2}>2 шага</option>
          <option value={3}>3 шага</option><option value={4}>4 шага</option>
          <option value={5}>5 шагов</option>
        </select>
      </label>
    </header>
    {loading&&<p role="status">Проверяем зарегистрированные зависимости…</p>}
    {error&&<p role="alert">{error}</p>}
    {result&&<>
      <div className="cmdbImpactSummary">
        <strong>{result.count}</strong>
        <span>потенциально связанных КЕ и процессов</span>
      </div>
      {!result.count&&<p>Зависимости не зарегистрированы. Это не доказывает их отсутствие.</p>}
      <ol className="cmdbImpactList">
        {result.affected.map(row=><li key={row.node.id}>
          <div className="cmdbImpactItem">
            <div>
              <strong>{row.node.name}</strong>
              <small>{TYPE_LABEL[row.node.ci_class]||row.node.ci_class} · {row.depth} шаг(а)</small>
              <small>{row.confidence==='requires_verification'?'Связь требует проверки':'Связь зарегистрирована как подтверждённая'}</small>
              <small>Путь: {row.relations.join(' → ')}</small>
            </div>
            {row.node.id.startsWith('component:')&&onOpenComponent&&
              <button type="button" onClick={()=>onOpenComponent(row.node.id.slice('component:'.length))}>Открыть КЕ</button>}
          </div>
        </li>)}
      </ol>
      <p className="cmdbImpactDisclaimer">{result.disclaimer}</p>
    </>}
  </section>
}
