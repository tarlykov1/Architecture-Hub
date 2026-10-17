import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { ReactFlow, Background, Controls, MiniMap, applyNodeChanges, type Connection, type Edge, type Node, type NodeChange } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import './style.css'

type Obj = { id: string; kind: string; name: string; description: string; status: string; attributes: Record<string, unknown> }
type Rel = { id: string; source_id: string; target_id: string; kind: string; description: string }
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
      <section className="canvas">
        <ReactFlow nodes={nodes} edges={edges} onNodesChange={onNodesChange} onConnect={onConnect}
          onNodeClick={(_event: React.MouseEvent, node: Node) => setSelected(node.id)} onPaneClick={() => setSelected('')} fitView>
          <Background color="#d1dae5" gap={20} size={1}/><Controls/><MiniMap zoomable pannable/>
        </ReactFlow>
        {!objects.length && <div className="emptyHint">Создайте первый объект в панели слева, затем добавьте второй и соедините их точками на схеме.</div>}
      </section>
    </main>
    <aside className="details">
      <div className="sideLabel">СВОЙСТВА</div>
      {detail ? <><h2>{detail.name}</h2><span className="tag">{detail.kind}</span>
        <h3>Описание</h3><p>{detail.description || 'Описание пока не заполнено.'}</p>
        <h3>Статус</h3><p>{detail.status === "demo" ? "Демо · требуется проверка" : detail.status}</p>{detail.attributes.subtype && <><h3>Категория</h3><p>{String(detail.attributes.subtype)}</p></>}
        <h3>Связи</h3>{relations.filter(r => r.source_id === detail.id || r.target_id === detail.id).length ? relations.filter(r => r.source_id === detail.id || r.target_id === detail.id).map(r => <p key={r.id}><strong>{r.source_id === detail.id ? "→ " : "← "}{objects.find(o => o.id === (r.source_id === detail.id ? r.target_id : r.source_id))?.name}</strong><br/>{r.description || r.kind}</p>) : <p>Связей пока нет</p>}
        <p className="hint">Чтобы создать интеграцию, потяните связь от точки одного объекта к точке другого.</p>
      </> : <div className="hint">Выберите объект на схеме или в каталоге.</div>}
      <div className="disclaimer">Локальная версия 0.1 · Без авторизации · Только тестовые данные</div>
    </aside>
  </div>
}

createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>)
