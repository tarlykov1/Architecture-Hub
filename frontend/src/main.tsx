import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { ReactFlow, Background, Controls, MiniMap, applyNodeChanges, type Connection, type Edge, type Node, type NodeChange } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import './style.css'

type Obj = { id: string; kind: string; name: string; description: string; status: string; attributes: Record<string, unknown> }
type Rel = { id: string; source_id: string; target_id: string; kind: string; description: string }
type Infra = {id:string;system_id:string;parent_id:string|null;kind:string;name:string;description:string;details:Record<string,unknown>}
type Flow = {id:string;source_id:string;target_id:string;name:string;data_description:string;protocol:string;port:string;security:string;schedule:string;verification:string}
type Diagram = { id: string; name: string; positions: Record<string, { x: number; y: number }> }

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, headers: { 'Content-Type': 'application/json', ...init?.headers } })
  if (!response.ok) {
    const detail = await response.text()
    throw new Error(detail || 'Ошибка обращения к API')
  }
  return response.status === 204 ? undefined as T : response.json()
}

function App() {
  const [objects, setObjects] = useState<Obj[]>([])
  const [infra, setInfra] = useState<Infra[]>([])
  const [flows, setFlows] = useState<Flow[]>([])
  const [layer, setLayer] = useState<'systems'|'infrastructure'|'flows'>('systems')
  const [infraName,setInfraName] = useState('')
  const [infraKind,setInfraKind] = useState('vm')
  const [infraParent,setInfraParent] = useState('')
  const [infraDetails,setInfraDetails] = useState('')
  const [flowSource,setFlowSource] = useState('')
  const [flowTarget,setFlowTarget] = useState('')
  const [flowName,setFlowName] = useState('')
  const [flowData,setFlowData] = useState('')
  const [flowProtocol,setFlowProtocol] = useState('HTTPS')
  const [flowPort,setFlowPort] = useState('443')
  const [flowSecurity,setFlowSecurity] = useState('TLS')
  const [flowVerification,setFlowVerification] = useState('draft')
  const [relations, setRelations] = useState<Rel[]>([])
  const [diagrams, setDiagrams] = useState<Diagram[]>([])
  const [diagramId, setDiagramId] = useState('')
  const [positions, setPositions] = useState<Record<string, { x: number; y: number }>>({})
  const [selected, setSelected] = useState('')
  const [name, setName] = useState('')
  const [kind, setKind] = useState('system')
  const [description, setDescription] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [dirty, setDirty] = useState(false)

  const refresh = useCallback(async () => {
    const [o, r, d] = await Promise.all([
      request<Obj[]>('/api/objects'),
      request<Rel[]>('/api/relations'),
      request<Diagram[]>('/api/diagrams'),
    ])
    setObjects(o); setRelations(r); setDiagrams(d)
    const [i,f] = await Promise.all([request<Infra[]>('/api/infra'),request<Flow[]>('/api/flows')]); setInfra(i);setFlows(f)
    if (d.length && !diagramId) {
      setDiagramId(d[0].id)
      setPositions(d[0].positions || {})
    }
  }, [diagramId])

  useEffect(() => { refresh().catch(e => setError(e.message)) }, []) // initial load

  const nodes = useMemo<Node[]>(() => objects.map((o, i) => ({
    id: o.id,
    position: positions[o.id] || { x: (i % 3) * 245 + 30, y: Math.floor(i / 3) * 140 + 40 },
    data: { label: <div><strong>{o.name}</strong><small>{o.kind}</small></div> },
    style: {
      width: 192, padding: 12, borderRadius: 12, textAlign: 'left',
      background: selected === o.id ? '#dbeafe' : '#fff',
      border: selected === o.id ? '2px solid #2563eb' : '1px solid #cbd5e1',
      boxShadow: '0 5px 16px #152b4320',
    },
  })), [objects, positions, selected])

  const edges = useMemo<Edge[]>(() => relations.map(r => ({
    id: r.id, source: r.source_id, target: r.target_id, label: r.kind,
    animated: false, style: { stroke: '#64748b', strokeWidth: 2 },
    labelStyle: { fill: '#475569', fontSize: 11 },
  })), [relations])

  const onNodesChange = useCallback((changes: NodeChange[]) => {
    const result = applyNodeChanges(changes, nodes)
    if (changes.some(c => c.type === 'position' && 'position' in c && c.position)) {
      setPositions(old => ({ ...old, ...Object.fromEntries(result.map(n => [n.id, n.position])) }))
      setDirty(true)
    }
  }, [nodes])

  const onConnect = useCallback(async (connection: Connection) => {
    if (!connection.source || !connection.target) return
    try {
      await request('/api/relations', { method: 'POST', body: JSON.stringify({
        source_id: connection.source, target_id: connection.target, kind: 'data_flow',
      }) })
      setRelations(await request<Rel[]>('/api/relations'))
    } catch (e) { setError(String(e)) }
  }, [])

  async function addObject(event: React.FormEvent) {
    event.preventDefault()
    if (!name.trim()) return
    setBusy(true); setError('')
    try {
      await request('/api/objects', { method: 'POST', body: JSON.stringify({ name: name.trim(), kind, description }) })
      setObjects(await request<Obj[]>('/api/objects'))
      setName(''); setDescription('')
    } catch (e) { setError(String(e)) }
    finally { setBusy(false) }
  }

  async function saveDiagram() {
    setError('')
    try {
      const title = diagrams.find(d => d.id === diagramId)?.name || 'Основная карта'
      if (diagramId) {
        await request('/api/diagrams/' + diagramId, { method: 'PUT', body: JSON.stringify({ name: title, positions }) })
      } else {
        const d = await request<Diagram>('/api/diagrams', { method: 'POST', body: JSON.stringify({ name: title, positions }) })
        setDiagramId(d.id)
      }
      setDirty(false)
      setDiagrams(await request<Diagram[]>('/api/diagrams'))
    } catch (e) { setError(String(e)) }
  }

  async function loadDemo() {
    if (dirty && !confirm('На текущей схеме есть несохранённые перемещения. Продолжить загрузку демо?')) return
    setBusy(true); setError('')
    try {
      const result = await request<{diagram_id:string; created_objects:number; created_relations:number}>('/api/demo/load', { method: 'POST' })
      const [o,r,d] = await Promise.all([
        request<Obj[]>('/api/objects'), request<Rel[]>('/api/relations'), request<Diagram[]>('/api/diagrams')
      ])
      setObjects(o); setRelations(r); setDiagrams(d)
      const demo = d.find(x => x.id === result.diagram_id)
      if (demo) { setDiagramId(demo.id); setPositions(demo.positions || {}) }
      setSelected(''); setDirty(false)
      alert('Демонстрация загружена. Новых систем: ' + result.created_objects + ', новых связей: ' + result.created_relations + '. Данные требуют проверки.')
    } catch(e) { setError(String(e)) }
    finally { setBusy(false) }
  }

  async function addInfrastructure(event: React.FormEvent) {
    event.preventDefault()
    if (!selected) {setError('Сначала выберите систему');return}
    setError('')
    try {
      let details:Record<string,unknown> = {}
      // Free-text network notes avoid inventing actual VLANs or IP addresses.
      if (infraDetails.trim()) details = {network_notes:infraDetails.trim()}
      await request('/api/infra',{method:'POST',body:JSON.stringify({
        system_id:selected,parent_id:infraParent||null,kind:infraKind,name:infraName,
        description:'',details
      })})
      setInfra(await request<Infra[]>('/api/infra'));setInfraName('');setInfraDetails('');setInfraParent('')
    } catch(e){setError(String(e))}
  }
  async function addFlow(event: React.FormEvent) {
    event.preventDefault();setError('')
    try {
      await request('/api/flows',{method:'POST',body:JSON.stringify({
        source_id:flowSource,target_id:flowTarget,name:flowName,data_description:flowData,
        protocol:flowProtocol,port:flowPort,security:flowSecurity,verification:flowVerification
      })})
      setFlows(await request<Flow[]>('/api/flows'));setFlowName('');setFlowData('')
    } catch(e){setError(String(e))}
  }
  async function loadInfrastructureDemo(){
    const find = (n:string)=>objects.find(o=>o.name.toLowerCase()===n.toLowerCase())
    const zup=find('1С ЗУП'),datareon=find('DATAREON'),naumen=find('Naumen'),phone=find('Телефонный справочник')
    if(!zup||!datareon||!naumen||!phone){setError('Сначала нажмите «Загрузить демо» для создания систем');return}
    try {
      const desired=[{s:zup,name:'HR Export API',kind:'service'},
        {s:datareon,name:'Integration Adapter',kind:'service'},
        {s:naumen,name:'Directory API',kind:'service'},
        {s:phone,name:'Directory DB',kind:'database'},
        {s:phone,name:'VM-DIR-DEMO-01',kind:'vm'}]
      const existing=await request<Infra[]>('/api/infra')
      const lookup:Record<string,string>={}
      for(const x of desired){
        let row=existing.find(i=>i.system_id===x.s.id&&i.name===x.name)
        if(!row)row=await request<Infra>('/api/infra',{method:'POST',body:JSON.stringify({
          system_id:x.s.id,name:x.name,kind:x.kind,details:{network_notes:'ДЕМО: VLAN, VRF и зона пока не подтверждены'}
        })})
        lookup[x.name]=row.id
      }
      const actual=await request<Flow[]>('/api/flows')
      const legs=[['HR Export API','Integration Adapter','Кадровые данные'],
        ['Integration Adapter','Directory API','Данные сотрудников'],
        ['Integration Adapter','Directory DB','Данные справочника']]
      for(const [source,target,description] of legs) {
        if(!actual.some(f=>f.source_id===lookup[source]&&f.target_id===lookup[target])){
          await request('/api/flows',{method:'POST',body:JSON.stringify({
            source_id:lookup[source],target_id:lookup[target],name:description,
            data_description:'ДЕМО – состав полей уточнить',protocol:'HTTPS',port:'443',
            security:'TLS',verification:'draft'
          })})
        }
      }
      setInfra(await request<Infra[]>('/api/infra'));setFlows(await request<Flow[]>('/api/flows'))
      setLayer('infrastructure');alert('Демо инфраструктуры добавлено. Сетевые и транспортные параметры условные.')
    }catch(e){setError(String(e))}
  }
  async function addDiagram() {
    const title = prompt('Название новой схемы:')
    if (!title?.trim()) return
    try {
      const d = await request<Diagram>('/api/diagrams', { method: 'POST', body: JSON.stringify({ name: title.trim(), positions: {} }) })
      setDiagrams(ds => [...ds, d]); setDiagramId(d.id); setPositions({}); setDirty(false)
    } catch (e) { setError(String(e)) }
  }

  function selectDiagram(id: string) {
    if (dirty && !confirm('Несохранённые изменения схемы будут потеряны. Продолжить?')) return
    const d = diagrams.find(x => x.id === id)
    if (d) { setDiagramId(id); setPositions(d.positions || {}); setDirty(false) }
  }

  const detail = objects.find(o => o.id === selected)
  return <div className="shell">
    <aside className="sidebar">
      <div className="logo"><span className="logoIcon">◆</span><span>Architecture <b>Hub</b></span></div>
      <div className="sideLabel">РЕЕСТР ОБЪЕКТОВ <span>{objects.length}</span></div>
      <div className="catalog">{objects.map(o => <button key={o.id} className={'catalogItem ' + (selected === o.id ? 'active' : '')} onClick={() => setSelected(o.id)}>
        <span className="objectIcon">▦</span><span><strong>{o.name}</strong><small>{o.kind}</small></span>
      </button>)}</div>
      <form className="createForm" onSubmit={addObject}>
        <h3>Новый объект</h3>
        <input aria-label="Название" placeholder="Название системы" value={name} onChange={e => setName(e.target.value)} required />
        <select aria-label="Тип" value={kind} onChange={e => setKind(e.target.value)}>
          <option value="system">ИТ-система</option><option value="process">Бизнес-процесс</option>
          <option value="database">База данных</option><option value="integration">Интеграция</option>
          <option value="service">Сервис</option><option value="other">Другое</option>
        </select>
        <textarea aria-label="Описание" placeholder="Описание (необязательно)" value={description} onChange={e => setDescription(e.target.value)} rows={3} />
        <button className="primary" disabled={busy}>+ Добавить</button>
      </form>
    </aside>
    <main className="main">
      <header className="topbar"><div><h1>Карта архитектуры</h1><p>Единый реестр систем и взаимосвязей</p></div><div className="topActions">
        <select aria-label="Схема" value={diagramId} onChange={e => selectDiagram(e.target.value)}>
          {!diagrams.length && <option value="">Основная карта</option>}
          {diagrams.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
        <button onClick={loadDemo} disabled={busy} title="Добавить 7 демонстрационных систем и 3 связи, не удаляя ваши данные">Загрузить демо</button><button onClick={addDiagram}>+ Схема</button>
        <button className="primary" onClick={saveDiagram}>Сохранить{dirty ? ' *' : ''}</button>
      </div></header>
      {error && <div className="error" role="alert">{error}<button onClick={() => setError('')}>×</button></div>}
      <div className="layerTabs">
        <button className={layer==='systems'?'current':''} onClick={()=>setLayer('systems')}>Системы</button>
        <button className={layer==='infrastructure'?'current':''} onClick={()=>setLayer('infrastructure')}>Сервисы и ВМ</button>
        <button className={layer==='flows'?'current':''} onClick={()=>setLayer('flows')}>Потоки данных</button>
        <button onClick={loadInfrastructureDemo} title="Создать условные компоненты и потоки для телефонного справочника">+ Демо инфраструктуры</button>
      </div>
      {layer==='systems' ? <section className="canvas">
        <ReactFlow nodes={nodes} edges={edges} onNodesChange={onNodesChange} onConnect={onConnect}
          onNodeClick={(_event: React.MouseEvent, node: Node) => setSelected(node.id)} onPaneClick={() => setSelected('')} fitView>
          <Background color="#d1dae5" gap={20} size={1}/><Controls/><MiniMap zoomable pannable/>
        </ReactFlow>
        {!objects.length && <div className="emptyHint">Создайте первый объект в панели слева, затем добавьте второй и соедините их точками на схеме.</div>}
      </section> : <section className="infraPanel">
        {layer==='infrastructure' ? <>
          <h2>Компоненты и размещение</h2>
          <p className="hint">Выберите систему слева или на общей карте. Каждая ВМ, сервис, API и база создаётся как отдельный объект. Сетевую принадлежность указываем для компонентов, а не для системы целиком.</p>
          <div className="infraGrid">{infra.filter(i=>!selected||i.system_id===selected).map(i=><article className="infraCard" key={i.id}>
            <span className="tag">{i.kind}</span><h3>{i.name}</h3>
            <p>{objects.find(o=>o.id===i.system_id)?.name}</p>
            {i.parent_id&&<small>Входит в: {infra.find(x=>x.id===i.parent_id)?.name||'Неизвестно'}</small>}
            <p>{String(i.details.network_notes||'Сеть не указана')}</p>
          </article>)}</div>
        </> : <>
          <h2>Направленные потоки данных</h2>
          <p className="hint">Каждый поток – отдельная запись от конкретного компонента-источника до компонента-получателя. Обратный независимый поток создаётся отдельно.</p>
          <div className="infraGrid">{flows.map(f=><article className="infraCard" key={f.id}>
            <span className="tag">{f.verification}</span><h3>{f.name}</h3>
            <strong>{infra.find(i=>i.id===f.source_id)?.name} → {infra.find(i=>i.id===f.target_id)?.name}</strong>
            <p>{f.data_description}</p><small>{f.protocol} · порт {f.port||'?'} · {f.security}</small>
          </article>)}</div>
        </>}
      </section>}
    </main>
    <aside className="details">
      <div className="sideLabel">СВОЙСТВА</div>
      {detail ? <><h2>{detail.name}</h2><span className="tag">{detail.kind}</span>
        <h3>Описание</h3><p>{detail.description || 'Описание пока не заполнено.'}</p>
        <h3>Статус</h3><p>{detail.status === "demo" ? "Демо · требуется проверка" : detail.status}</p>{detail.attributes.subtype && <><h3>Категория</h3><p>{String(detail.attributes.subtype)}</p></>}
        <h3>Связи</h3>{relations.filter(r => r.source_id === detail.id || r.target_id === detail.id).length ? relations.filter(r => r.source_id === detail.id || r.target_id === detail.id).map(r => <p key={r.id}><strong>{r.source_id === detail.id ? "→ " : "← "}{objects.find(o => o.id === (r.source_id === detail.id ? r.target_id : r.source_id))?.name}</strong><br/>{r.description || r.kind}</p>) : <p>Связей пока нет</p>}
        <p className="hint">Чтобы создать логическую интеграцию, потяните связь между системами.</p>
        <h3>Компоненты системы</h3>
        {infra.filter(i=>i.system_id===detail.id).map(i=><p key={i.id}><strong>{i.name}</strong> · {i.kind}</p>)}
        <form className="detailForm" onSubmit={addInfrastructure}>
          <input required placeholder="Имя ВМ / сервиса / API" value={infraName} onChange={e=>setInfraName(e.target.value)}/>
          <select value={infraKind} onChange={e=>setInfraKind(e.target.value)}>
            {['vm','service','api','database','adapter','container','network_interface','subsystem','other'].map(x=><option key={x} value={x}>{x}</option>)}
          </select>
          <select value={infraParent} onChange={e=>setInfraParent(e.target.value)}>
            <option value="">Без родителя</option>
            {infra.filter(i=>i.system_id===detail.id).map(i=><option key={i.id} value={i.id}>{i.name}</option>)}
          </select>
          <textarea rows={2} placeholder="Заметки о сети: VLAN / VRF / DMZ (если известны)" value={infraDetails} onChange={e=>setInfraDetails(e.target.value)}/>
          <button className="primary">Добавить компонент</button>
        </form>
        <h3>Новый поток данных</h3>
        <form className="detailForm" onSubmit={addFlow}>
          <select required value={flowSource} onChange={e=>setFlowSource(e.target.value)}>
            <option value="">Источник</option>{infra.map(i=><option key={i.id} value={i.id}>{i.name}</option>)}
          </select>
          <select required value={flowTarget} onChange={e=>setFlowTarget(e.target.value)}>
            <option value="">Получатель</option>{infra.map(i=><option key={i.id} value={i.id}>{i.name}</option>)}
          </select>
          <input required placeholder="Название потока" value={flowName} onChange={e=>setFlowName(e.target.value)}/>
          <textarea rows={2} placeholder="Какие именно данные передаются?" value={flowData} onChange={e=>setFlowData(e.target.value)}/>
          <input placeholder="Протокол" value={flowProtocol} onChange={e=>setFlowProtocol(e.target.value)}/>
          <input placeholder="Порт" value={flowPort} onChange={e=>setFlowPort(e.target.value)}/>
          <select value={flowSecurity} onChange={e=>setFlowSecurity(e.target.value)}>{['unknown','TLS','mTLS','VPN','private_connector','none'].map(x=><option key={x} value={x}>{x}</option>)}</select>
          <select value={flowVerification} onChange={e=>setFlowVerification(e.target.value)}><option value="draft">Черновик</option><option value="assumed">Предположение</option><option value="verified">Подтверждено</option></select>
          <button className="primary">Добавить поток</button>
        </form>
      </> : <div className="hint">Выберите объект на схеме или в каталоге.</div>}
      <div className="disclaimer">Локальная версия 0.2 · Без авторизации · Только тестовые данные</div>
    </aside>
  </div>
}

createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>)
