import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { ReactFlow, Background, Controls, applyNodeChanges, type Connection, type Edge, type Node, type NodeChange } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import './style.css'
import Topology from './Topology'
import Incidents from './Incidents'

type Obj = { id: string; kind: string; name: string; description: string; status: string; attributes: Record<string, unknown> }
type Rel = { id: string; source_id: string; target_id: string; kind: string; description: string }
type Infra = {id:string;system_id:string;parent_id:string|null;kind:string;name:string;description:string;details:Record<string,unknown>}
type Flow = {id:string;source_id:string;target_id:string;name:string;data_description:string;protocol:string;port:string;security:string;schedule:string;verification:string}
type Segment = {id:string;name:string;kind:string;description:string;verification:string}
type Nic = {id:string;item_id:string;name:string;ip_address:string;zone_id:string|null;vlan_id:string|null;vrf_id:string|null}
type Category = {id:string;name:string}
type BusinessProcess = {id:string;category_id:string;name:string;description:string}
type BusinessLink = {id:string;process_id:string;system_id:string;role:string}
type Diagram = { id: string; name: string; positions: Record<string, { x: number; y: number }> }

let accessToken = ""
async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, headers: { 'Content-Type': 'application/json', ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}), ...init?.headers } })
  if (!response.ok) {
    const detail = await response.text()
    throw new Error(detail || 'Ошибка обращения к API')
  }
  return response.status === 204 ? undefined as T : response.json()
}

function App() {
  const [categories,setCategories] = useState<Category[]>([])
  const [processes,setProcesses] = useState<BusinessProcess[]>([])
  const [businessLinks,setBusinessLinks] = useState<BusinessLink[]>([])
  const [segments,setSegments] = useState<Segment[]>([])
  const [nics,setNics] = useState<Nic[]>([])
  const [viewMode,setViewMode] = useState<'architecture'|'security'>('architecture')
  const [selectedFlow,setSelectedFlow] = useState('')
  const [nicName,setNicName] = useState('eth1')
  const [nicItem,setNicItem] = useState('')
  const [nicZone,setNicZone] = useState('')
  const [nicVrf,setNicVrf] = useState('')
  const [nicVlan,setNicVlan] = useState('')
  const [kisFile,setKisFile] = useState<File|null>(null)
  const [kisPreview,setKisPreview] = useState<any>(null)
  const [kisResult,setKisResult] = useState('')
  const [kisOpen,setKisOpen] = useState(false)
  const [kisBusy,setKisBusy] = useState(false)
  const [kisError,setKisError] = useState('')
  const [objects, setObjects] = useState<Obj[]>([])
  const [kbLinks,setKbLinks]=useState<{id:string;title:string;url:string;relation_type:string}[]>([])
  const [kbPages,setKbPages]=useState<{id:number;title:string;url:string;path:string;locale:string}[]>([])
  const [kbQuery,setKbQuery]=useState('')
  const [kbLoading,setKbLoading]=useState(false)
  const [kbMessage,setKbMessage]=useState('')
  const [panelTab,setPanelTab] = useState<'overview'|'components'|'flows'|'knowledge'|'incidents'|'edit'>('overview')
  const [inspectorExpanded,setInspectorExpanded] = useState(false)
  const [editorOpen,setEditorOpen] = useState(false)
  const [registryOpen,setRegistryOpen] = useState<'network'|'flow'|null>(null)
  const [networkFilter,setNetworkFilter] = useState('')
  const [networkTypeFilter,setNetworkTypeFilter] = useState('all')
  const [networkDetailId,setNetworkDetailId] = useState('')
  const [networkEditId,setNetworkEditId] = useState('')
  const [networkName,setNetworkName] = useState('')
  const [networkKind,setNetworkKind] = useState('zone')
  const [networkDescription,setNetworkDescription] = useState('')
  const [networkVerification,setNetworkVerification] = useState('draft')
  const [flowEditId,setFlowEditId] = useState('')
  const [flowSchedule,setFlowSchedule] = useState('')
  const [registryBusy,setRegistryBusy] = useState(false)
  const [registryError,setRegistryError] = useState('')
  const editNetwork = (n?: Segment) => {
    setNetworkEditId(n?.id || '');setNetworkName(n?.name || '');setNetworkKind(n?.kind || 'zone')
    setNetworkDescription(n?.description || '');setNetworkVerification(n?.verification || 'draft')
    setRegistryError('');setRegistryOpen('network')
  }
  const editFlow = (f?: Flow) => {
    setFlowEditId(f?.id || '');setFlowName(f?.name || '');setFlowSource(f?.source_id || '')
    setFlowTarget(f?.target_id || '');setFlowData(f?.data_description || '')
    setFlowProtocol(f?.protocol || 'HTTPS');setFlowPort(f?.port || '443')
    setFlowSecurity(f?.security || 'TLS');setFlowVerification(f?.verification || 'draft')
    setFlowSchedule(f?.schedule || '');setRegistryError('');setRegistryOpen('flow')
  }
  async function saveRegistry(event: React.FormEvent) {
    event.preventDefault();setRegistryBusy(true);setRegistryError('')
    try {
      if(registryOpen==='network'){
        const uri='/api/networks'+(networkEditId?'/'+networkEditId:'')
        await request(uri,{method:networkEditId?'PUT':'POST',body:JSON.stringify({
          name:networkName.trim(),kind:networkKind,description:networkDescription,verification:networkVerification
        })})
        setSegments(await request<Segment[]>('/api/networks'))
      } else if(registryOpen==='flow'){
        if(flowSource===flowTarget)throw new Error('Источник и получатель должны отличаться')
        const uri='/api/flows'+(flowEditId?'/'+flowEditId:'')
        await request(uri,{method:flowEditId?'PUT':'POST',body:JSON.stringify({
          source_id:flowSource,target_id:flowTarget,name:flowName.trim(),data_description:flowData,
          protocol:flowProtocol,port:flowPort,security:flowSecurity,verification:flowVerification,schedule:flowSchedule
        })})
        setFlows(await request<Flow[]>('/api/flows'))
      }
      setRegistryOpen(null);setNotice('Изменения сохранены')
    }catch(e){setRegistryError(String(e))}finally{setRegistryBusy(false)}
  }
  const [search,setSearch] = useState('')
  const [viewSystem,setViewSystem] = useState('')
  const [zoneMode,setZoneMode] = useState(false)
  const [infra, setInfra] = useState<Infra[]>([])
  const [flows, setFlows] = useState<Flow[]>([])
  const [layer, setLayer] = useState<'business'|'systems'|'infrastructure'|'flows'|'topology'|'networks'|'incidents'>('systems')
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
  const [notice,setNotice] = useState('')
  const [tokenReady, setTokenReady] = useState(false)
  const [busy, setBusy] = useState(false)
  const [dirty, setDirty] = useState(false)

  const refresh = useCallback(async () => {
    const [o, r, d] = await Promise.all([
      request<Obj[]>('/api/objects'),
      request<Rel[]>('/api/relations'),
      request<Diagram[]>('/api/diagrams'),
    ])
    setObjects(o); setRelations(r); setDiagrams(d)
    const [i,f] = await Promise.all([request<Infra[]>('/api/infra'),request<Flow[]>('/api/flows')]); setInfra(i);setFlows(f); const [net,interfaces]=await Promise.all([request<Segment[]>('/api/networks'),request<Nic[]>('/api/network-interfaces')]);setSegments(net);setNics(interfaces);const [cat,proc,links]=await Promise.all([request<Category[]>('/api/business/categories'),request<BusinessProcess[]>('/api/business/processes'),request<BusinessLink[]>('/api/business/system-links')]);setCategories(cat);setProcesses(proc);setBusinessLinks(links)
    if (d.length && !diagramId) {
      setDiagramId(d[0].id)
      setPositions(d[0].positions || {})
    }
  }, [diagramId])

  useEffect(() => { refresh().catch(e => setError(e.message)) }, []) // initial load
  useEffect(()=>{
    if(panelTab!=='knowledge'||!selected)return
    request<{id:string;title:string;url:string;relation_type:string}[]>('/api/knowledge/links?entity_type=system&entity_id='+encodeURIComponent(selected))
      .then(setKbLinks).catch(e=>setKbMessage(e.message))
  },[selected,panelTab])
  const searchWiki=async()=>{
    setKbLoading(true);setKbMessage('')
    try{setKbPages(await request<{id:number;title:string;url:string;path:string;locale:string}[]>('/api/knowledge/pages?query='+encodeURIComponent(kbQuery)))}
    catch(e){setKbMessage((e as Error).message)}finally{setKbLoading(false)}
  }
  const attachWiki=async(page:{id:number;title:string;url:string;path:string;locale:string})=>{
    try{
      await request('/api/knowledge/links',{method:'POST',body:JSON.stringify({entity_type:'system',entity_id:selected,wiki_page_id:page.id,wiki_path:page.locale+'/'+page.path,title:page.title,relation_type:'documentation'})})
      setKbLinks(await request('/api/knowledge/links?entity_type=system&entity_id='+encodeURIComponent(selected)))
      setKbMessage('Статья привязана')
    }catch(e){setKbMessage((e as Error).message)}
  }
  const unlinkWiki=async(id:string)=>{
    if(!window.confirm('Убрать связь со статьёй? Сама статья останется в Wiki.js.'))return
    try{await request('/api/knowledge/links/'+encodeURIComponent(id),{method:'DELETE'});setKbLinks(old=>old.filter(x=>x.id!==id))}catch(e){setKbMessage((e as Error).message)}
  }


  const visibleObjects = objects.filter(o=>o.name.toLowerCase().includes(search.toLowerCase()))
  const nodes = useMemo<Node[]>(() => visibleObjects.map((o, i) => ({
    id: o.id,
    position: positions[o.id] || { x: (i % 3) * 245 + 30, y: Math.floor(i / 3) * 140 + 40 },
    data: { label: <div className="systemNode"><strong>{o.name}</strong><small>{infra.filter(x=>x.system_id===o.id).length} компонентов · {o.kind}</small></div> },
    style: {
      width: 210, padding: 14, borderRadius: 12, textAlign: 'left',
      background: selected === o.id ? '#e9f0ff' : '#fff',
      border: selected === o.id ? '2px solid #2563eb' : '1px solid #cbd5e1',
      boxShadow: '0 5px 16px #152b4320',
    },
  })), [visibleObjects, positions, selected, infra])

  const edges = useMemo<Edge[]>(() => relations.filter(r=>visibleObjects.some(o=>o.id===r.source_id)&&visibleObjects.some(o=>o.id===r.target_id)).map(r => ({
    id: r.id, source: r.source_id, target: r.target_id, label: r.kind === 'data_flow' ? 'Поток данных' : r.kind,
    animated: false, style: { stroke: '#64748b', strokeWidth: 2 },
    labelStyle: { fill: '#475569', fontSize: 11 },
  })), [relations, visibleObjects])

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
  async function loadEnterpriseDemo(){
    setBusy(true);setError('');setNotice('Загружаю демо-системы…')
    try {
      const result=await request<{new_systems:number;new_components:number;new_flows:number}>('/api/demo/enterprise',{method:'POST'})
      const [o,r,i,f]=await Promise.all([
        request<Obj[]>('/api/objects'),request<Rel[]>('/api/relations'),
        request<Infra[]>('/api/infra'),request<Flow[]>('/api/flows')
      ])
      setObjects(o);setRelations(r);setInfra(i);setFlows(f);setLayer('infrastructure');setSelected('')
      setViewSystem('');setNotice('Демо-системы: добавлено '+result.new_systems+' систем, '+result.new_components+' компонентов, '+result.new_flows+' потоков. Если все значения 0 – данные уже загружены.')
    }catch(e){setError(String(e));setNotice('')}finally{setBusy(false)}
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
  async function kisPayload(file:File){
    if(file.size>12*1024*1024)throw new Error('Максимальный размер файла – 12 МБ')
    const content_base64=await new Promise<string>((resolve,reject)=>{
      const reader=new FileReader()
      reader.onload=()=>resolve(String(reader.result).split(',')[1]||'')
      reader.onerror=()=>reject(new Error('Ошибка чтения файла'))
      reader.readAsDataURL(file)
    })
    return {filename:file.name,content_base64}
  }
  async function previewKis(){
    if(!kisFile)return
    setKisBusy(true);setKisError('');setKisPreview(null)
    try{setKisPreview(await request<any>('/api/kis/preview',{method:'POST',body:JSON.stringify(await kisPayload(kisFile))}));setKisResult('')}
    catch(e){setKisError(String(e))}finally{setKisBusy(false)}
  }
  async function importKis(){
    if(!kisFile||!kisPreview)return
    if(!confirm('Импортировать паспорт, ВМ и СУБД? Существующие записи не будут перезаписаны.'))return
    setKisBusy(true);setKisError('')
    try{const result=await request<any>('/api/kis/import',{method:'POST',body:JSON.stringify(await kisPayload(kisFile))})
      setKisResult(result.message+' Создано систем: '+result.created_systems+', ВМ: '+result.created_vms+', БД: '+result.created_databases)
      const [o,i]=await Promise.all([request<Obj[]>('/api/objects'),request<Infra[]>('/api/infra')]);setObjects(o);setInfra(i)
    }catch(e){setKisError(String(e))}finally{setKisBusy(false)}
  }
  async function loadBusiness(){
    setError('');setNotice('Загружаю бизнес-процессы…')
    try {
      const result=await request<{created:number}>('/api/demo/business',{method:'POST'})
      const [a,b,c]=await Promise.all([request<Category[]>('/api/business/categories'),request<BusinessProcess[]>('/api/business/processes'),request<BusinessLink[]>('/api/business/system-links')])
      setCategories(a);setProcesses(b);setBusinessLinks(c);setLayer('business')
      setNotice('Бизнес-слой загружен, новых записей: '+result.created+'. Демонстрационные связи требуют проверки.')
    }catch(e){setError(String(e));setNotice('')}
  }
  async function loadNetworks(){
    setError('');setNotice('Загружаю демо-сети…')
    try {
      const result=await request<{added_segments:number;added_interfaces:number;message?:string}>('/api/demo/networks',{method:'POST'})
      const [a,b]=await Promise.all([request<Segment[]>('/api/networks'),request<Nic[]>('/api/network-interfaces')])
      setSegments(a);setNics(b);setViewMode('security');setLayer('infrastructure');setViewSystem('');
      setNotice(result.message || 'Демо-сети: добавлено '+result.added_segments+' сегментов, '+result.added_interfaces+' интерфейсов. Если значения 0 – сети уже загружены.')
    }catch(e){setError(String(e));setNotice('')}
  }
  async function addNIC(e:React.FormEvent){
    e.preventDefault()
    try {
      await request('/api/network-interfaces',{method:'POST',body:JSON.stringify({
        item_id:nicItem,name:nicName,zone_id:nicZone||null,vrf_id:nicVrf||null,vlan_id:nicVlan||null
      })})
      setNics(await request<Nic[]>('/api/network-interfaces'));setNicName('eth1')
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
  const drill = objects.find(o=>o.id===viewSystem)
  const detailItems = infra.filter(i=>i.system_id===selected)
  const scopedItems = infra.filter(i=>i.system_id===viewSystem)
  const scopedIds = new Set(scopedItems.map(i=>i.id))
  const scopedFlows = flows.filter(f=>scopedIds.has(f.source_id)||scopedIds.has(f.target_id))
  const segmentName=(id:string|null)=>segments.find(s=>s.id===id)?.name||'Не указано'
  const zones=Array.from(new Set(scopedItems.map(i=>nics.find(n=>n.item_id===i.id)?.zone_id||String(i.details.security_zone||'Зона неизвестна'))))
  const drillNodes:Node[] = scopedItems.map((i,n)=>({id:i.id,position:{x:(n%4)*260,y:Math.floor(n/4)*155},data:{label:<div className="systemNode"><strong>{i.name}</strong><small>{i.kind} · {String(i.details.environment||'Среда не задана')}</small><small>{nics.filter(n=>n.item_id===i.id).map(n=>[segments.find(s=>s.id===n.zone_id)?.name,segments.find(s=>s.id===n.vrf_id)?.name,segments.find(s=>s.id===n.vlan_id)?.name].filter(Boolean).join(' / ')).join('; ')||String(i.details.security_zone||'Сеть не указана')}</small></div>},style:{width:220,padding:12,background:i.details.environment==='TEST'?'#fff5e7':viewMode==='security'?'#eaf5f2':'#ffffff',border:'1px solid #bac8d8',borderRadius:12}}))
  const drillEdges:Edge[]=scopedFlows.filter(f=>scopedIds.has(f.source_id)&&scopedIds.has(f.target_id)).map(f=>({id:f.id,source:f.source_id,target:f.target_id,label:viewMode==='security'?`${f.protocol} : ${f.port} / ${f.security}`:f.name,style:{stroke:f.security==='unknown'?'#d58c40':'#369279'},labelStyle:{fontSize:10}}))
  return <div className="shell">
    <header className="globalHeader" aria-label="Главная панель Architecture Hub">
      <div className="globalBrand"><span className="globalBrandMark">◆</span><strong>Architecture Hub</strong><span className="globalBrandSeparator">/</span><span className="globalBrandSubtitle">Единая архитектура ИТ</span></div>
      <div className="globalHeaderActions"><span className="globalHeaderSection">РАБОЧЕЕ ПРОСТРАНСТВО</span><a href={import.meta.env.VITE_WIKI_URL || "http://127.0.0.1:3000"} target="_blank" rel="noopener noreferrer">Wiki.js <span aria-hidden="true">↗</span></a></div>
    </header>
    <aside className="sidebar">
      <div className="sidebarHeading"><span className="sidebarHeadingIcon">▦</span><div><strong>Каталог архитектуры</strong><small>Системы и связанные объекты</small></div></div>
      <div className="sideLabel">РЕЕСТР ОБЪЕКТОВ <span>{objects.length}</span></div><input className="catalogSearch" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Поиск системы..."/>
      <div className="catalog">{visibleObjects.map(o => <button key={o.id} className={'catalogItem ' + (selected === o.id ? 'active' : '')} onClick={() => {setSelected(o.id);setPanelTab("overview")}} onDoubleClick={()=>{setViewSystem(o.id);setLayer("infrastructure")}}>
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
      <header className="topbar"><div><h1>{drill?drill.name:"Карта архитектуры"}</h1><p>{drill?"Детализация компонентов и потоков · синтетическая модель":"Единый реестр систем и взаимосвязей"}</p></div><div className="topActions">
        <button title="Ключ хранится только в памяти вкладки. Используйте HTTPS при удалённом доступе." onClick={()=>{const value=window.prompt('Ключ доступа Architecture Hub (Bearer token)');if(value===null)return;accessToken=value.trim();setTokenReady(Boolean(accessToken));refresh().then(()=>setError('')).catch(e=>setError(e.message))}}>{tokenReady?'Доступ: ключ задан':'Ключ доступа'}</button>
        <select aria-label="Схема" value={diagramId} onChange={e => selectDiagram(e.target.value)}>
          {!diagrams.length && <option value="">Основная карта</option>}
          {diagrams.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
        <button onClick={addDiagram}>+ Схема</button>
        <button className="primary" onClick={saveDiagram}>Сохранить{dirty ? ' *' : ''}</button>
      </div></header>
      {notice && <div className="notice" role="status">{notice}<button onClick={()=>setNotice('')}>×</button></div>}
      {error && <div className="error" role="alert">{error}<button onClick={() => setError('')}>×</button></div>}
      <div className="layerTabs">
        <button className={layer==='business'?'current':''} onClick={()=>setLayer('business')}>Бизнес-процессы</button><button className={layer==='systems'?'current':''} onClick={()=>{setViewSystem("");setLayer("systems")}}>Системы</button>
        <button className={layer==='infrastructure'?'current':''} onClick={()=>setLayer('infrastructure')}>Сервисы и ВМ</button>
        <button className={layer==='flows'?'current':''} onClick={()=>setLayer('flows')}>Потоки данных</button>
        <button className={layer==='incidents'?'current':''} onClick={()=>setLayer('incidents')}>Инциденты</button><button className={layer==='networks'?'current':''} onClick={()=>setLayer('networks')}>Реестр сетей</button><button className={layer==='topology'?'current':''} onClick={()=>setLayer('topology')}>Топология сетей</button><button onClick={()=>setEditorOpen(true)}>+ Компонент</button><button onClick={()=>editNetwork()}>+ Сеть</button><button onClick={()=>editFlow()}>+ Поток</button><button onClick={()=>setKisOpen(true)}>Импорт КИС</button><button onClick={()=>window.open(import.meta.env.VITE_WIKI_URL || "http://127.0.0.1:3000", "_blank", "noopener,noreferrer")}>База знаний ↗</button>
      </div>
      {layer==='incidents' ? <Incidents request={request} systems={objects} components={infra} networks={segments} flows={flows}/> : layer==='networks' ? <section className="infraPanel networkRegistry">
 <div className="registryHeader"><div><h2>Реестр сетей</h2><p className="hint">Зоны безопасности, VLAN, VRF и их фактические привязки к интерфейсам</p></div><button className="primary" onClick={()=>editNetwork()}>+ Создать сеть</button></div>
 <div className="networkRegistryFilters"><input aria-label="Поиск сети" placeholder="Поиск по имени и описанию" value={networkFilter} onChange={e=>setNetworkFilter(e.target.value)}/><select aria-label="Тип сети" value={networkTypeFilter} onChange={e=>setNetworkTypeFilter(e.target.value)}><option value="all">Все типы</option><option value="zone">Зоны</option><option value="vrf">VRF</option><option value="vlan">VLAN</option></select><span>{segments.filter(n=>(networkTypeFilter==='all'||n.kind===networkTypeFilter)&&[n.name,n.description].join(' ').toLowerCase().includes(networkFilter.toLowerCase())).length} записей</span></div>
 <div className="networkTableWrap"><table className="networkTable"><thead><tr><th>Имя сети</th><th>Тип</th><th>Достоверность</th><th>Интерфейсы</th><th>Описание</th><th>Действия</th></tr></thead><tbody>{segments.filter(n=>(networkTypeFilter==='all'||n.kind===networkTypeFilter)&&[n.name,n.description].join(' ').toLowerCase().includes(networkFilter.toLowerCase())).sort((a,b)=>a.kind.localeCompare(b.kind)||a.name.localeCompare(b.name)).map(n=>{
 const used=nics.filter(x=>x.zone_id===n.id||x.vrf_id===n.id||x.vlan_id===n.id)
 const synthetic=/синтетическ|демонстрационн/i.test(n.description)
 return <React.Fragment key={n.id}><tr><td><strong>{n.name}</strong>{synthetic&&<small className="networkDemo">Демонстрационные данные</small>}</td><td><span className="tag">{n.kind.toUpperCase()}</span></td><td>{n.verification==='verified'?'Подтверждено':n.verification==='draft'?'Черновик':'Предположение'}</td><td>{used.length}</td><td>{n.description||'—'}</td><td><button onClick={()=>setNetworkDetailId(networkDetailId===n.id?'':n.id)}>{networkDetailId===n.id?'Скрыть':'Использование'}</button> <button onClick={()=>editNetwork(n)}>Изменить</button></td></tr>{networkDetailId===n.id&&<tr className="networkDetailRow"><td colSpan={6}><strong>Привязанные интерфейсы и системы</strong>{used.length?<div className="networkUsage">{used.map(nic=>{const component=infra.find(i=>i.id===nic.item_id);const system=objects.find(o=>o.id===component?.system_id);return <div key={nic.id}><b>{component?.name||'Компонент не найден'}</b> · {nic.name} · {system?.name||'Система не найдена'} {nic.ip_address&&'· '+nic.ip_address}</div>})}</div>:<p className="hint">Привязанных интерфейсов нет. Это не подтверждает отсутствие использования сети.</p>}</td></tr>}</React.Fragment>
 })}</tbody></table></div>
 </section> : layer==='topology' ? <Topology systems={objects} items={infra} segments={segments} interfaces={nics} flows={flows} saveInterface={async (value,id)=>{
      const uri=id?'/api/network-interfaces/'+id:'/api/network-interfaces'
      await request(uri,{method:id?'PUT':'POST',body:JSON.stringify(value)})
      setNics(await request<Nic[]>('/api/network-interfaces'))
    }}/> : layer==='business' ? <section className="infraPanel"><h2>Бизнес-архитектура</h2><p className="hint">Категория → процесс → поддерживающие системы. Достоверность связей проверяется отдельно.</p>
      <div className="businessGrid">{categories.map(cat=><article className="businessCategory" key={cat.id}><h3>{cat.name}</h3>{processes.filter(p=>p.category_id===cat.id).map(p=><div className="businessProcess" key={p.id}><strong>{p.name}</strong><p>{p.description}</p><div className="processSystems">{businessLinks.filter(l=>l.process_id===p.id).map(l=><button key={l.id} onClick={()=>{setSelected(l.system_id);setLayer('systems')}}>{objects.find(o=>o.id===l.system_id)?.name||'Система'}</button>)}</div></div>)}</article>)}</div>
      {!categories.length&&<p>Бизнес-процессы пока не добавлены.</p>}</section> : layer==='systems' ? <section className="canvas">
        <ReactFlow nodes={nodes} edges={edges} onNodesChange={onNodesChange} onConnect={onConnect}
          onNodeClick={(_event: React.MouseEvent, node: Node) => {setSelected(node.id);setPanelTab("overview")}} onNodeDoubleClick={(_event: React.MouseEvent, node: Node) => {setViewSystem(node.id);setSelected(node.id);setLayer("infrastructure")}} onPaneClick={() => setSelected('')} fitView>
          <Background color="#d1dae5" gap={20} size={1}/><Controls/>
        </ReactFlow>
        {!objects.length && <div className="emptyHint">Создайте первый объект в панели слева, затем добавьте второй и соедините их точками на схеме.</div>}
      </section> : <section className="infraPanel">
        {drill && <button onClick={()=>{setViewSystem("");setLayer("systems")}}>← К общей карте</button>}
        {layer==='infrastructure' ? <>
          <div className="viewHead"><h2>Компоненты, ВМ и сети</h2><select value={viewMode} onChange={e=>setViewMode(e.target.value as 'architecture'|'security')}><option value="architecture">Архитектура ВМ</option><option value="security">Сети и защита</option></select></div>
          <p className="hint">Выберите систему слева или на общей карте. Каждая ВМ, сервис, API и база создаётся как отдельный объект. Сетевую принадлежность указываем для компонентов, а не для системы целиком.</p>
          {drill && <div className="miniArchitecture" style={{height:520}}><ReactFlow key={drill.id+viewMode} nodes={drillNodes} edges={drillEdges} fitView nodesConnectable={false} nodesDraggable={false}><Background gap={20}/><Controls/></ReactFlow></div>}
          {viewMode==='security'&&<div className="networkZones">{zones.map(z=><article key={z} className="zoneCard"><h3>{segments.find(s=>s.id===z)?.name||z}</h3>{scopedItems.filter(i=>(nics.find(n=>n.item_id===i.id)?.zone_id||String(i.details.security_zone||'Зона неизвестна'))===z).map(i=><button key={i.id} onClick={()=>setSelected(i.system_id)}><strong>{i.name}</strong><small>{nics.filter(n=>n.item_id===i.id).map(n=>n.name+' · '+segmentName(n.vrf_id)+' · '+segmentName(n.vlan_id)).join('; ')||'Сетевой интерфейс не задан'}</small></button>)}</article>)}</div>}
          {viewMode==='security'&&<div className="networkLegend">Цвет стрелки: зелёный – указан тип защиты; оранжевый – неизвестно. Наличие TLS не подтверждает защиту всего маршрута. Неподтверждённые параметры требуют проверки.</div>}
          <div className="infraGrid">{infra.filter(i=>!viewSystem||i.system_id===viewSystem).map(i=><article className="infraCard" key={i.id}>
            <span className="tag">{i.kind}</span><h3>{i.name}</h3>
            <p>{objects.find(o=>o.id===i.system_id)?.name}</p>
            {i.parent_id&&<small>Входит в: {infra.find(x=>x.id===i.parent_id)?.name||'Неизвестно'}</small>}
            <p>{i.description}</p><p><strong>{String(i.details.environment||"")}</strong> · {String(i.details.security_zone||"Зона неизвестна")} · {String(i.details.vrf||"VRF неизвестен")}</p>
          </article>)}</div>
        </> : <>
          <div className="registryHeader"><h2>Направленные потоки данных</h2><button className="primary" onClick={()=>editFlow()}>+ Создать поток</button></div>
          <p className="hint">Каждый поток – отдельная запись от конкретного компонента-источника до компонента-получателя. Обратный независимый поток создаётся отдельно.</p>
          <div className="miniArchitecture"><ReactFlow
            nodes={infra.map((i,idx)=>({id:i.id,position:{x:(idx%5)*230,y:Math.floor(idx/5)*120},data:{label:<div><strong>{i.name}</strong><small>{i.kind} · {String(i.details.security_zone||'зона не задана')}</small></div>},style:{width:200,border:'1px solid #aab8cb',borderRadius:9,background:'#fff',padding:9}}))}
            edges={flows.map(f=>({id:f.id,source:f.source_id,target:f.target_id,label:f.name,style:{stroke:'#64748b'},labelStyle:{fontSize:10}}))}
            fitView nodesDraggable={false} nodesConnectable={false} elementsSelectable={true}>
            <Background gap={20}/><Controls/>
          </ReactFlow></div>
          <div className="infraGrid">{flows.filter(f=>!viewSystem||scopedIds.has(f.source_id)||scopedIds.has(f.target_id)).map(f=><article className="infraCard" key={f.id} onClick={()=>setSelectedFlow(selectedFlow===f.id?'':f.id)} style={{cursor:"pointer",borderColor:selectedFlow===f.id?"#2563eb":undefined}}>
            <span className="tag">{f.verification}</span><h3>{f.name}</h3>
            <strong>{infra.find(i=>i.id===f.source_id)?.name} → {infra.find(i=>i.id===f.target_id)?.name}</strong>
            <p>{f.data_description}</p><small>{f.protocol} · порт {f.port||'?'} · {f.security}</small>{selectedFlow===f.id&&<div className="flowDetails"><button type="button" onClick={e=>{e.stopPropagation();editFlow(f)}}>Редактировать поток</button><strong>Защита: {f.security}</strong><p>Достоверность: {f.verification}</p><p>Периодичность: {f.schedule||"Не указана"}</p><p>Зона источника: {segmentName(nics.find(n=>n.item_id===f.source_id)?.zone_id||null)}</p><p>Зона получателя: {segmentName(nics.find(n=>n.item_id===f.target_id)?.zone_id||null)}</p><p>Неизвестно, разрешён ли маршрут на межсетевом экране.</p></div>}
          </article>)}</div>
        </>}
      </section>}
    </main>
    <aside className={inspectorExpanded ? "details detailsExpanded" : "details"} aria-label="Карточка архитектурного объекта">
      <div className="inspectorToolbar"><div className="sideLabel">КАРТОЧКА ОБЪЕКТА</div><button type="button" onClick={()=>setInspectorExpanded(v=>!v)} aria-label={inspectorExpanded?"Свернуть карточку":"Развернуть карточку"}>{inspectorExpanded?"Свернуть ↘":"Развернуть ↗"}</button></div>
      {detail ? <>
        <h2>{detail.name}</h2><span className="tag">{detail.kind}</span>
        <div className="inspectorTabs">
          <button className={panelTab==='overview'?'current':''} onClick={()=>setPanelTab('overview')}>Обзор</button>
          <button className={panelTab==='components'?'current':''} onClick={()=>setPanelTab('components')}>Компоненты</button>
          <button className={panelTab==='flows'?'current':''} onClick={()=>setPanelTab('flows')}>Потоки</button>
          <button className={panelTab==='incidents'?'current':''} onClick={()=>setPanelTab('incidents')}>Инциденты</button><button className={panelTab==='knowledge'?'current':''} onClick={()=>{setKbMessage('');setPanelTab('knowledge')}}>База знаний</button>
        </div>
        {panelTab==='incidents'&&detail&&<Incidents request={request} systems={objects} components={infra} networks={segments} flows={flows} context={{entity_type:'system',entity_id:detail.id}}/>}
        {panelTab==='knowledge'&&<div className="knowledgePanel">
          <div className="knowledgeHeading"><h3>Документация</h3><span className="knowledgeCount">{kbLinks.length}</span></div><p className="knowledgeIntro">Статьи хранятся в Wiki.js. Изменения доступны в обеих системах.</p>
          {kbLinks.map(k=><div key={k.id} className="inspectorItem"><a className="knowledgeArticleLink" href={k.url} target="_blank" rel="noopener noreferrer">📄 {k.title} ↗</a><button className="knowledgeUnlink" onClick={()=>unlinkWiki(k.id)}>Убрать связь</button></div>)}
          {!kbLinks.length&&<p>Связанных статей пока нет.</p>}
          <div className="knowledgeHeading"><h3>Найти или создать статью</h3></div><a className="knowledgeCreate" href={import.meta.env.VITE_WIKI_URL || "http://127.0.0.1:3000"} target="_blank" rel="noopener noreferrer">+ Новая статья в Wiki.js ↗</a>
          <input value={kbQuery} onChange={e=>setKbQuery(e.target.value)} placeholder="Поиск по названию или пути" className="knowledgeSearch"/>
          <button disabled={kbLoading} onClick={searchWiki}>{kbLoading?'Поиск…':'Найти в Wiki.js'}</button>
          {kbPages.filter(p=>!kbLinks.some(k=>k.url===p.url)).map(p=><div className="inspectorItem knowledgeSearchResult" key={p.id}><div><strong>{p.title}</strong><small>{p.path}</small></div><button onClick={()=>attachWiki(p)}>+ Связать</button></div>)}
          {kbMessage&&<p role="status">{kbMessage}</p>}
        </div>}
        {panelTab==='overview'&&<><h3>Назначение</h3><p>{detail.description||'Описание не указано'}</p><h3>Статус</h3><p>{detail.status}</p>
          <div className="statPills"><span>{detailItems.length} компонентов</span><span>{flows.filter(f=>detailItems.some(i=>i.id===f.source_id||i.id===f.target_id)).length} потоков</span></div>
          <button className="primary" onClick={()=>{setViewSystem(detail.id);setLayer('infrastructure')}}>Открыть архитектуру →</button></>}
        {panelTab==='components'&&<>{detailItems.map(i=><article className="inspectorItem" key={i.id}><strong>{i.name}</strong><small>{i.kind} · {String(i.details.environment||'—')} · {String(i.details.security_zone||'Зона не указана')}</small></article>)}
          {!detailItems.length&&<p>Компонентов пока нет</p>}</>}
        {panelTab==='flows'&&<>{flows.filter(f=>detailItems.some(i=>i.id===f.source_id||i.id===f.target_id)).map(f=><article className="inspectorItem" key={f.id}><strong>{f.name}</strong><small>{infra.find(i=>i.id===f.source_id)?.name} → {infra.find(i=>i.id===f.target_id)?.name}</small><small>{f.protocol} / {f.security}</small></article>)}</>}
      </>:<p className="hint">Выберите систему на карте. Двойной клик откроет её внутреннюю архитектуру.</p>}
      <div className="disclaimer">Architecture Hub · Реестр архитектуры</div>
    </aside>
    {kisOpen&&<div className="editorBackdrop" onClick={()=>setKisOpen(false)}><div className="editorDialog" onClick={e=>e.stopPropagation()}>
      <div className="dialogHead"><h2>Импорт карточки ИС (.xlsx)</h2><button onClick={()=>setKisOpen(false)}>Закрыть ×</button></div>
      <p className="hint">Файл обрабатывается локальным API. В GitHub он не загружается. Сначала проверьте разбор, затем подтвердите создание записей.</p>
      <input type="file" accept=".xlsx" onChange={e=>{setKisFile(e.target.files?.[0]||null);setKisPreview(null);setKisResult('');setKisError('')}}/>
      <button className="primary" disabled={!kisFile||kisBusy} onClick={previewKis}>{kisBusy?'Обработка…':'Предварительный просмотр'}</button>
      {kisError&&<div className="kisError" role="alert"><strong>Не удалось обработать КИС</strong><p>{kisError}</p><p>Проверьте адрес API в настройках Vite и журнал FastAPI.</p></div>}
      {kisPreview&&<div className="kisPreview"><h3>{kisPreview.preview.system_name||'Название не найдено'}</h3>
        <p>Листов: {kisPreview.preview.sheet_names.length} · ВМ: {kisPreview.preview.vms.length} · СУБД: {kisPreview.preview.databases.length} · Сетевых записей: {kisPreview.preview.network_rules.length}</p>
        <h3>Паспорт</h3>{Object.entries(kisPreview.preview.fields).slice(0,30).map(([k,v])=><p key={k}><strong>{k}</strong>: {String(v)}</p>)}
        <h3>ВМ (первые 15)</h3>{kisPreview.preview.vms.slice(0,15).map((v:any,i:number)=><p key={i}>{v.E||'без DNS'} · {v.C||'—'} · {v.D||'без роли'}</p>)}
        <h3>СУБД</h3>{kisPreview.preview.databases.slice(0,15).map((d:any,i:number)=><p key={i}>{d.E||'—'} · {d.C||'—'}</p>)}
        <p className="hint">Сетевые правила и контакты не записываются автоматически. Импорт добавляет только новые системы и компоненты, не изменяя существующие записи.</p>
        <button className="primary" disabled={kisBusy||!kisPreview.preview.system_name} onClick={importKis}>Подтвердить импорт</button>
      </div>}
      {kisResult&&<p role="status">{kisResult}</p>}
    </div></div>}
    {registryOpen&&<div className="editorBackdrop" onClick={()=>setRegistryOpen(null)}>
      <div className="editorDialog registryDialog" role="dialog" aria-modal="true" aria-label={registryOpen==='network'?'Редактор сети':'Редактор потока'} onClick={e=>e.stopPropagation()}>
        <div className="dialogHead"><h2>{registryOpen==='network'?(networkEditId?'Редактировать сеть':'Создать сеть'):(flowEditId?'Редактировать поток':'Создать поток')}</h2><button onClick={()=>setRegistryOpen(null)}>Закрыть ×</button></div>
        <form className="detailForm" onSubmit={saveRegistry}>
          {registryOpen==='network'?<>
            <label>Название<input required maxLength={250} value={networkName} onChange={e=>setNetworkName(e.target.value)}/></label>
            <label>Тип сети<select value={networkKind} onChange={e=>setNetworkKind(e.target.value)}><option value="zone">Зона</option><option value="vlan">VLAN</option><option value="vrf">VRF</option></select></label>
            <label>Описание<textarea value={networkDescription} onChange={e=>setNetworkDescription(e.target.value)}/></label>
            <label>Достоверность<select value={networkVerification} onChange={e=>setNetworkVerification(e.target.value)}><option value="draft">Черновик</option><option value="assumed">Предположение</option><option value="verified">Подтверждено</option></select></label>
          </>:<>
            <label>Источник<select required value={flowSource} onChange={e=>setFlowSource(e.target.value)}><option value="">Выберите компонент</option>{infra.map(i=><option key={i.id} value={i.id}>{i.name}</option>)}</select></label>
            <label>Получатель<select required value={flowTarget} onChange={e=>setFlowTarget(e.target.value)}><option value="">Выберите компонент</option>{infra.map(i=><option key={i.id} value={i.id}>{i.name}</option>)}</select></label>
            <label>Название<input required value={flowName} onChange={e=>setFlowName(e.target.value)}/></label>
            <label>Состав данных<textarea value={flowData} onChange={e=>setFlowData(e.target.value)}/></label>
            <div className="formPair"><label>Протокол<input value={flowProtocol} onChange={e=>setFlowProtocol(e.target.value)}/></label><label>Порт<input value={flowPort} onChange={e=>setFlowPort(e.target.value)}/></label></div>
            <label>Защита<select value={flowSecurity} onChange={e=>setFlowSecurity(e.target.value)}>{['unknown','TLS','mTLS','VPN','private_connector','none'].map(v=><option key={v}>{v}</option>)}</select></label>
            <label>Периодичность<input value={flowSchedule} onChange={e=>setFlowSchedule(e.target.value)} placeholder="По событию, ежедневно…"/></label>
            <label>Достоверность<select value={flowVerification} onChange={e=>setFlowVerification(e.target.value)}><option value="draft">Черновик</option><option value="assumed">Предположение</option><option value="verified">Подтверждено</option></select></label>
          </>}
          {registryError&&<p role="alert" className="kisError">{registryError}</p>}
          <button className="primary" disabled={registryBusy}>{registryBusy?'Сохранение…':'Сохранить'}</button>
        </form>
      </div>
    </div>}
    {editorOpen&&<div className="editorBackdrop" onClick={()=>setEditorOpen(false)}>
      <div className="editorDialog" onClick={e=>e.stopPropagation()}>
        <div className="dialogHead"><h2>Добавление объектов и потоков</h2><button onClick={()=>setEditorOpen(false)}>Закрыть ×</button></div>
        <p className="hint">Выберите систему слева, затем добавьте компонент или создайте обмен между существующими компонентами.</p>
        <h3>Новый компонент</h3>
        <form className="detailForm" onSubmit={addInfrastructure}>
          <input required placeholder="Имя ВМ / сервиса / API" value={infraName} onChange={e=>setInfraName(e.target.value)}/>
          <select value={infraKind} onChange={e=>setInfraKind(e.target.value)}>{['vm','service','api','database','adapter','container','network_interface','subsystem','other'].map(x=><option key={x}>{x}</option>)}</select>
          <select value={infraParent} onChange={e=>setInfraParent(e.target.value)}><option value="">Без родителя</option>{infra.filter(i=>i.system_id===selected).map(i=><option key={i.id} value={i.id}>{i.name}</option>)}</select>
          <textarea placeholder="Сетевая зона / VLAN / VRF – примечание" value={infraDetails} onChange={e=>setInfraDetails(e.target.value)}/>
          <button className="primary">Добавить компонент</button>
        </form>
        <h3>Новый направленный поток</h3>
        <form className="detailForm" onSubmit={addFlow}>
          <select required value={flowSource} onChange={e=>setFlowSource(e.target.value)}><option value="">Источник</option>{infra.map(i=><option key={i.id} value={i.id}>{i.name}</option>)}</select>
          <select required value={flowTarget} onChange={e=>setFlowTarget(e.target.value)}><option value="">Получатель</option>{infra.map(i=><option key={i.id} value={i.id}>{i.name}</option>)}</select>
          <input required placeholder="Название потока" value={flowName} onChange={e=>setFlowName(e.target.value)}/>
          <textarea placeholder="Состав данных" value={flowData} onChange={e=>setFlowData(e.target.value)}/>
          <div className="formPair"><input placeholder="Протокол" value={flowProtocol} onChange={e=>setFlowProtocol(e.target.value)}/><input placeholder="Порт" value={flowPort} onChange={e=>setFlowPort(e.target.value)}/></div>
          <select value={flowSecurity} onChange={e=>setFlowSecurity(e.target.value)}>{['unknown','TLS','mTLS','VPN','private_connector','none'].map(x=><option key={x}>{x}</option>)}</select>
          <select value={flowVerification} onChange={e=>setFlowVerification(e.target.value)}><option value="draft">Черновик</option><option value="assumed">Предположение</option><option value="verified">Подтверждено</option></select>
          <button className="primary">Создать поток</button>
        </form><h3>Сетевой интерфейс компонента</h3><form className="detailForm" onSubmit={addNIC}><select required value={nicItem} onChange={e=>setNicItem(e.target.value)}><option value="">Выберите ВМ / сервис</option>{infra.map(i=><option key={i.id} value={i.id}>{i.name}</option>)}</select><input required value={nicName} onChange={e=>setNicName(e.target.value)} placeholder="eth0 / eth1"/>{([["zone",nicZone,setNicZone],["vrf",nicVrf,setNicVrf],["vlan",nicVlan,setNicVlan]] as const).map(([type,value,change])=><select key={type} value={value} onChange={e=>change(e.target.value)}><option value="">{type.toUpperCase()} – не задано</option>{segments.filter(s=>s.kind===type).map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select>)}<button className="primary">Добавить интерфейс</button></form>
      </div>
    </div>}
  </div>
}

createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>)
