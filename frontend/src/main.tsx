import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { ReactFlow, Background, Controls, applyNodeChanges, type Connection, type Edge, type Node, type NodeChange, MarkerType, Position } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import './style.css'
import Topology from './Topology'
import {dependencyLayout,compactComponentLayout} from './graphLayout'
import {downstreamImpact,impactRoutes} from './dependencyImpact'
import Incidents from './Incidents'
import ArchitectureHome from './ArchitectureHome'
import ArchitectureBoard from './ArchitectureBoard'
import FlowDataCatalog from './FlowDataCatalog'
import SystemDataMap from './SystemDataMap'
import {parseWorkspaceRoute,workspaceRouteUrl,type Section} from './workspaceRoutes'
import NetworkPathCatalog from './NetworkPathCatalog'
import {scopedFlowIds} from './flowScope'
import {shouldShowSystemsOverview} from './flowDetail'
import {groupComponents,type ComponentGroupMode} from './componentGroups'
import {ReciprocalEdge} from './ReciprocalEdge'

import {AutoFit, FocusNeighborhood, Disclosure, useWorkspaceKeyboard} from './WorkspaceUI'

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

type SavedWorkspaceView={id:string;name:string;layer:'business'|'systems'|'infrastructure'|'flows';query:string;kind:string;verification:string;flowLayoutOrientation?:'horizontal'|'vertical';flowLayoutDensity?:'compact'|'normal'|'spacious';flowSystemOverview?:boolean;flowDepth?:number;flowDirection?:'both'|'incoming'|'outgoing'}
const VIEWS_STORAGE_KEY='architecture-hub:views:v1'
function readSavedWorkspaceViews():SavedWorkspaceView[]{
 try{
  const parsed:unknown=JSON.parse(localStorage.getItem(VIEWS_STORAGE_KEY)||'[]')
  if(!Array.isArray(parsed))return []
  const layers=['business','systems','infrastructure','flows']
  return parsed.filter((v):v is SavedWorkspaceView=>Boolean(v)&&typeof v==='object'&&typeof v.id==='string'&&typeof v.name==='string'&&layers.includes(v.layer)&&typeof v.query==='string'&&typeof v.kind==='string'&&typeof v.verification==='string').slice(0,30)
 }catch{return []}
}

// Keep the API token across reloads in this tab, but not in persistent localStorage.
const ACCESS_TOKEN_STORAGE_KEY = 'architecture-hub:access-token:session'
function readAccessToken(): string {
  try { return sessionStorage.getItem(ACCESS_TOKEN_STORAGE_KEY) || '' }
  catch { return '' }
}
let accessToken = readAccessToken()
function saveAccessToken(value: string): void {
  accessToken = value.trim()
  try {
    if (accessToken) sessionStorage.setItem(ACCESS_TOKEN_STORAGE_KEY, accessToken)
    else sessionStorage.removeItem(ACCESS_TOKEN_STORAGE_KEY)
  } catch { /* Private browsing can disable session storage. */ }
}
async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, headers: { 'Content-Type': 'application/json', ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}), ...init?.headers } })
  if (!response.ok) {
    const detail = await response.text()
    if(response.status===401)throw new Error('Для загрузки данных введите ключ доступа. Пустая карта не означает отсутствие объектов.')
    if(response.status===403)throw new Error('Недостаточно прав для этого действия.')
    throw new Error(detail || 'Ошибка обращения к API')
  }
  return response.status === 204 ? undefined as T : response.json()
}

function App() {
  useWorkspaceKeyboard()
  const [componentGroupMode,setComponentGroupMode]=useState<'auto'|'environment'|'zone'|'components'>('auto')
  const [expandedComponentGroup,setExpandedComponentGroup]=useState('')
  const [componentView,setComponentView]=useState<'diagram'|'registry'|'cards'|'board'>(()=>{
    try{const saved=localStorage.getItem('architecture-hub-component-view-v1');return saved==='diagram'||saved==='registry'||saved==='cards'||saved==='board'?saved:'registry'}catch{return 'registry'}
  })
  const [systemsShowDiagram,setSystemsShowDiagram]=useState(false)
  const [flowView,setFlowView]=useState<'diagram'|'cards'>(()=>{
    try{return localStorage.getItem('architecture-hub-flow-view-v1')==='cards'?'cards':'diagram'}catch{return 'diagram'}
  })
  useEffect(()=>{
    try{localStorage.setItem('architecture-hub-component-view-v1',componentView)}catch{/* Storage unavailable. */}
  },[componentView])
  useEffect(()=>{
    try{localStorage.setItem('architecture-hub-flow-view-v1',flowView)}catch{/* Storage unavailable. */}
  },[flowView])
  const [authOpen,setAuthOpen]=useState(false)
  const [authDraft,setAuthDraft]=useState('')
  const [authBusy,setAuthBusy]=useState(false)
  const [categories,setCategories] = useState<Category[]>([])
  const [processes,setProcesses] = useState<BusinessProcess[]>([])
  const [businessLinks,setBusinessLinks] = useState<BusinessLink[]>([])
  const [segments,setSegments] = useState<Segment[]>([])
  const [nics,setNics] = useState<Nic[]>([])
  const [viewMode,setViewMode] = useState<'architecture'|'security'>('architecture')
  const [selectedFlow,setSelectedFlow] = useState('')
  const [flowDataOpen,setFlowDataOpen]=useState(false)
  const [networkPathOpen,setNetworkPathOpen]=useState(false)
  const [systemDataId,setSystemDataId]=useState('')
  const [flowFocusOnly,setFlowFocusOnly] = useState(false)
  const [groupFlowEdges,setGroupFlowEdges] = useState(true)
  const [expandedFlowPair,setExpandedFlowPair] = useState('')
  const [flowDirection,setFlowDirection] = useState<'both'|'incoming'|'outgoing'>('both')
  const [flowComponentQuery,setFlowComponentQuery] = useState('')
  const [flowComponentFocus,setFlowComponentFocus] = useState('')
  const [flowSystemOverview,setFlowSystemOverview] = useState(false)
  const [flowDetailPreference,setFlowDetailPreference]=useState<'auto'|'systems'|'components'>('auto')
  const [flowLayoutDensity,setFlowLayoutDensity] = useState<'compact'|'normal'|'spacious'>('normal')
  const [flowLayoutOrientation,setFlowLayoutOrientation] = useState<'horizontal'|'vertical'>('horizontal')
  const [flowDepth,setFlowDepth] = useState(1)
  const [nicName,setNicName] = useState('eth1')
  const [nicItem,setNicItem] = useState('')
  const [nicZone,setNicZone] = useState('')
  const [nicVrf,setNicVrf] = useState('')
  const [nicVlan,setNicVlan] = useState('')
  const [kisFile,setKisFile] = useState<File|null>(null)
  const [kisPreview,setKisPreview] = useState<any>(null)
  const [kisResult,setKisResult] = useState('')
  const [focusedComponent,setFocusedComponent]=useState('')
  const [impactMode,setImpactMode]=useState(false)
  const [diagramEditMode,setDiagramEditMode]=useState(false)
  const [componentCanvasTool,setComponentCanvasTool]=useState<'move'|'connect'>('move')
  const [connectionStart,setConnectionStart]=useState('')
  // Personal canvas positions are independent of technical flow data.
  // They survive navigation/reload on this browser; no infrastructure attributes are changed.
  const [componentCanvasPositions,setComponentCanvasPositions]=useState<Record<string,Record<string,{x:number;y:number}>>>(()=>{
    try{
      const saved=JSON.parse(localStorage.getItem('architecture-hub-component-canvas-v1')||'{}')
      if(!saved||typeof saved!=='object'||Array.isArray(saved))return {}
      return saved
    }catch{return {}}
  })
  useEffect(()=>{
    try{localStorage.setItem('architecture-hub-component-canvas-v1',JSON.stringify(componentCanvasPositions))}catch{/* Storage unavailable. */}
  },[componentCanvasPositions])
  const moveComponentOnCanvas=(systemId:string,node:Node)=>{
    if(!systemId)return
    setComponentCanvasPositions(previous=>({...previous,[systemId]:{...previous[systemId],[node.id]:{x:node.position.x,y:node.position.y}}}))
  }
  const resetComponentCanvas=(systemId:string)=>{
    setComponentCanvasPositions(previous=>{
      const next={...previous}
      delete next[systemId]
      return next
    })
  }
  const [componentFieldGroup,setComponentFieldGroup]=useState<'all'|'network'|'system'|'other'>('all')
  const componentNetworkKeys=new Set(['security_zone','vrf','network_notes','ip_address','vlan','subnet','gateway','dns'])
  const componentSystemKeys=new Set(['environment','hostname','os','owner','version','cpu','memory','storage'])
  const [newComponentField,setNewComponentField]=useState('')
  const componentFieldLabels:Record<string,string>={environment:'Контур',security_zone:'Зона безопасности',vrf:'VRF',network_notes:'Примечания по сети',owner:'Владелец',responsible:'Ответственный',sla:'SLA',hostname:'Имя хоста',ip_address:'IP-адрес',os:'Операционная система',version:'Версия',cpu:'Процессор',memory:'Память',storage:'Хранилище',location:'Размещение',criticality:'Критичность',documentation:'Документация'}
  const [registrySelected,setRegistrySelected]=useState<string[]>([])
  const [registryBulkField,setRegistryBulkField]=useState('owner')
  const [registryBulkValue,setRegistryBulkValue]=useState('')
  const [registryBulkBusy,setRegistryBulkBusy]=useState(false)
  const [registrySort,setRegistrySort]=useState<'name'|'kind'|'system'>('name')
  const optionalRegistryColumns=[['parent','Родитель'],['environment','Контур'],['owner','Владелец'],['responsible','Ответственный'],['sla','SLA'],['zone','Зона'],['interfaces','Интерфейсы'],['flows','Потоки']] as const
  const [registryColumns,setRegistryColumns]=useState<string[]>(()=>{
    const defaults=['environment','zone','interfaces','flows']
    try{
      const stored=JSON.parse(localStorage.getItem('architecture-hub-registry-columns-v1')||'null')
      return Array.isArray(stored)?stored.filter((value:unknown):value is string=>typeof value==='string'&&optionalRegistryColumns.some(([id])=>id===value)):defaults
    }catch{return defaults}
  })
  useEffect(()=>{
    try{localStorage.setItem('architecture-hub-registry-columns-v1',JSON.stringify(registryColumns))}catch{/* Storage may be unavailable. */}
  },[registryColumns])
  const registryColumnVisible=(id:string)=>registryColumns.includes(id)

  const [componentEditing,setComponentEditing]=useState(false)
  const [componentSaving,setComponentSaving]=useState(false)
  const [componentDraft,setComponentDraft]=useState<{name:string;description:string;details:Record<string,unknown>}>({name:'',description:'',details:{}})
  function startComponentEdit(item:Infra){setComponentDraft({name:item.name,description:item.description||'',details:{...item.details}});setNewComponentField('');setComponentFieldGroup('all');setComponentEditing(true)}
  async function saveComponentEdit(item:Infra){
    setComponentSaving(true);setError('')
    try{
      await request('/api/infra/'+item.id,{method:'PUT',body:JSON.stringify({system_id:item.system_id,parent_id:item.parent_id,kind:item.kind,name:componentDraft.name.trim(),description:componentDraft.description,details:componentDraft.details})})
      setInfra(await request<Infra[]>('/api/infra'));setComponentEditing(false)
    }catch(e){setError(String(e))}finally{setComponentSaving(false)}
  }
  const [componentInspectId,setComponentInspectId]=useState('')
  const [componentInspectTab,setComponentInspectTab]=useState<'passport'|'network'|'flows'|'incidents'>('passport')
  function closeComponentInspector(){
    const original=infra.find(item=>item.id===componentInspectId)
    if(componentEditing&&original){
      const changed=componentDraft.name!==original.name||componentDraft.description!==(original.description||'')||JSON.stringify(componentDraft.details)!==JSON.stringify(original.details)
      if(changed&&!window.confirm('Отменить несохранённые изменения паспорта компонента?'))return
    }
    setComponentInspectId('')
    setComponentEditing(false)
  }
  const [passportEditId,setPassportEditId]=useState('')
  const [passportDraft,setPassportDraft]=useState<{name:string;description:string;status:string;fields:Record<string,string>}>({name:'',description:'',status:'draft',fields:{}})
  const [passportSaving,setPassportSaving]=useState(false)
  const [kisExporting,setKisExporting]=useState(false)
  const [kisOpen,setKisOpen] = useState(false)
  function editPassport(obj:Obj){
    const raw=obj.attributes?.kis_passport
    const fields:Record<string,string>={}
    if(raw&&typeof raw==='object'&&!Array.isArray(raw)){
      Object.entries(raw).forEach(([key,value])=>{if(typeof value==='string'||typeof value==='number')fields[key]=String(value)})
    }
    for(const key of ['Название ИС','Краткое наименование (используемое)','Функциональное назначение','Владелец ИС','Ответственный за сопровождение']){
      if(!(key in fields))fields[key]=''
    }
    fields['Название ИС']=obj.name
    setPassportDraft({name:obj.name,description:obj.description,status:obj.status,fields})
    setPassportEditId(obj.id)
  }
  async function savePassport(event:React.FormEvent){
    event.preventDefault()
    const obj=objects.find(o=>o.id===passportEditId)
    if(!obj)return
    setPassportSaving(true);setError('')
    try{
      const fields={...passportDraft.fields,'Название ИС':passportDraft.name}
      await request('/api/objects/'+obj.id,{method:'PUT',body:JSON.stringify({
        name:passportDraft.name,kind:obj.kind,status:passportDraft.status,description:passportDraft.description,
        attributes:{...obj.attributes,kis_passport:fields}
      })})
      await refresh();setPassportEditId('');setNotice('Паспорт ИС сохранён')
    }catch(e){setError('Не удалось сохранить паспорт: '+String(e))}
    finally{setPassportSaving(false)}
  }
  async function exportKis(id:string){
    setKisExporting(true);setError('')
    try{
      const result=await request<{filename:string;content_base64:string;notice:string}>('/api/kis/export/'+id)
      const binary=atob(result.content_base64)
      const bytes=new Uint8Array(binary.length)
      for(let i=0;i<binary.length;i++)bytes[i]=binary.charCodeAt(i)
      const url=URL.createObjectURL(new Blob([bytes],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}))
      const link=document.createElement('a');link.href=url;link.download=result.filename;document.body.appendChild(link);link.click();link.remove()
      window.setTimeout(()=>URL.revokeObjectURL(url),1000)
      setNotice('Карточка КИС выгружена в Excel. '+result.notice)
    }catch(e){setError('Экспорт КИС: '+String(e))}
    finally{setKisExporting(false)}
  }
  const [kisBusy,setKisBusy] = useState(false)
  const [kisError,setKisError] = useState('')
  const [objects, setObjects] = useState<Obj[]>([])
  const [kbLinks,setKbLinks]=useState<{id:string;title:string;url:string;relation_type:string}[]>([])
  const [kbPages,setKbPages]=useState<{id:number;title:string;url:string;path:string;locale:string}[]>([])
  const [kbQuery,setKbQuery]=useState('')
  const [kbLoading,setKbLoading]=useState(false)
  const [kbMessage,setKbMessage]=useState('')
  const [panelTab,setPanelTab] = useState<'overview'|'components'|'flows'|'knowledge'|'incidents'|'edit'>('overview')
  const [inspectorOpen,setInspectorOpen] = useState(false)
  const [viewsMenuOpen,setViewsMenuOpen] = useState(false)
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
  const [createReverseFlow,setCreateReverseFlow] = useState(false)
  const [multiExchange,setMultiExchange] = useState(false)
  const [exchangeSources,setExchangeSources] = useState<string[]>([])
  const [exchangeTargets,setExchangeTargets] = useState<string[]>([])
  const [exchangeOverrides,setExchangeOverrides] = useState<Record<string,{protocol:string;port:string;security:string;data_description:string;schedule:string;verification:string}>>({})
  const [flowSchedule,setFlowSchedule] = useState('')
  const [registryBusy,setRegistryBusy] = useState(false)
  const [registryError,setRegistryError] = useState('')
  const editNetwork = (n?: Segment) => {
    setPassportEditId('');setComponentInspectId('');setCreateObjectOpen(false);setKisOpen(false)
    setNetworkEditId(n?.id || '');setNetworkName(n?.name || '');setNetworkKind(n?.kind || 'zone')
    setNetworkDescription(n?.description || '');setNetworkVerification(n?.verification || 'draft')
    setRegistryError('');setRegistryOpen('network')
  }
  const editFlow = (f?: Flow) => {
    setPassportEditId('');setComponentInspectId('');setCreateObjectOpen(false);setKisOpen(false)
    setCreateReverseFlow(false)
    setMultiExchange(false)
    setExchangeSources([])
    setExchangeTargets([])
    setExchangeOverrides({})
    setFlowEditId(f?.id || '');setFlowName(f?.name || '');setFlowSource(f?.source_id || '')
    setFlowTarget(f?.target_id || '');setFlowData(f?.data_description || '')
    setFlowProtocol(f?.protocol || 'HTTPS');setFlowPort(f?.port || '443')
    setFlowSecurity(f?.security || 'TLS');setFlowVerification(f?.verification || 'draft')
    setFlowSchedule(f?.schedule || '');setRegistryError('');setRegistryOpen('flow')
  }
  function connectComponents(connection:Connection){
    const source=infra.find(i=>i.id===connection.source)
    const target=infra.find(i=>i.id===connection.target)
    if(!source||!target){setError('Компонент не найден. Обновите схему.');return}
    if(source.id===target.id){setError('Нельзя соединить компонент с самим собой');return}
    const existing=flows.find(f=>f.source_id===source.id&&f.target_id===target.id)
    if(existing){editFlow(existing);setNotice('Поток уже существует – открыто его редактирование');return}
    editFlow()
    setFlowSource(source.id)
    setFlowTarget(target.id)
    setFlowName(source.name+' → '+target.name)
    setFlowVerification('draft')
    setNotice('Заполните параметры потока и нажмите «Сохранить» – только после этого связь появится на схеме.')
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
        if(!multiExchange&&(!flowSource||!flowTarget))throw new Error('Выберите источник и получателя')
        if(!multiExchange&&flowSource===flowTarget)throw new Error('Источник и получатель должны отличаться')
        if(multiExchange&&!flowEditId){
          const sources=[...new Set(exchangeSources)]
          const targets=[...new Set(exchangeTargets)]
          if(!sources.length||!targets.length)throw new Error('Выберите хотя бы один источник и одного получателя')
          const pairs=sources.flatMap(source=>targets.filter(target=>target!==source).map(target=>({source,target})))
          if(!pairs.length)throw new Error('Источник и получатель должны отличаться')
          const shared={data_description:flowData,protocol:flowProtocol,port:flowPort,security:flowSecurity,verification:flowVerification,schedule:flowSchedule}
          let created=0
          try{
            for(const pair of pairs){
              if(flows.some(f=>f.source_id===pair.source&&f.target_id===pair.target))continue
              await request('/api/flows',{method:'POST',body:JSON.stringify({...shared,...exchangeOverrides[pair.source+'|'+pair.target],source_id:pair.source,target_id:pair.target,name:flowName.trim()+' · '+(infra.find(i=>i.id===pair.source)?.name||'Источник')+' → '+(infra.find(i=>i.id===pair.target)?.name||'Получатель')})})
              created++
            }
          }catch(e){
            setFlows(await request<Flow[]>('/api/flows'))
            throw new Error('Создано связей: '+created+'. Остальные не сохранены: '+String(e))
          }
          setFlows(await request<Flow[]>('/api/flows'))
          setRegistryOpen(null)
          setNotice('Создано связей: '+created+'. Уже существующие направления пропущены.')
          return
        }
        const uri='/api/flows'+(flowEditId?'/'+flowEditId:'')
        if(createReverseFlow&&!flowEditId&&flows.some(f=>f.source_id===flowTarget&&f.target_id===flowSource))throw new Error('Обратный поток уже существует. Откройте его для отдельного редактирования.')
        const shared={data_description:flowData,protocol:flowProtocol,port:flowPort,security:flowSecurity,verification:flowVerification,schedule:flowSchedule}
        await request(uri,{method:flowEditId?'PUT':'POST',body:JSON.stringify({
          ...shared,source_id:flowSource,target_id:flowTarget,name:flowName.trim()
        })})
        if(createReverseFlow&&!flowEditId){
          try{
            await request('/api/flows',{method:'POST',body:JSON.stringify({
              ...shared,source_id:flowTarget,target_id:flowSource,
              name:(infra.find(i=>i.id===flowTarget)?.name||'Получатель')+' → '+(infra.find(i=>i.id===flowSource)?.name||'Источник')
            })})
          }catch(e){
            setFlows(await request<Flow[]>('/api/flows'))
            throw new Error('Прямой поток сохранён, но обратный создать не удалось: '+String(e))
          }
        }
        setFlows(await request<Flow[]>('/api/flows'))
      }
      setRegistryOpen(null);setNotice('Изменения сохранены')
    }catch(e){setRegistryError(String(e))}finally{setRegistryBusy(false)}
  }
  async function deleteRegistryEntry() {
    const isFlow=registryOpen==='flow'
    const id=isFlow?flowEditId:networkEditId
    if(!id||!registryOpen)return
    const label=isFlow?'поток данных':'сетевой сегмент'
    if(!window.confirm('Удалить '+label+'? Это действие нельзя отменить.'))return
    setRegistryBusy(true);setRegistryError('')
    try{
      await request((isFlow?'/api/flows/':'/api/networks/')+id,{method:'DELETE'})
      if(isFlow){
        setFlows(await request<Flow[]>('/api/flows'))
        if(selectedFlow===id)setSelectedFlow('')
      }else{
        setSegments(await request<Segment[]>('/api/networks'))
        if(networkDetailId===id)setNetworkDetailId('')
      }
      setRegistryOpen(null);setNotice((isFlow?'Поток':'Сетевой сегмент')+' удалён')
    }catch(e){setRegistryError('Не удалось удалить: '+String(e))}
    finally{setRegistryBusy(false)}
  }
  const [savedViews,setSavedViews]=useState<SavedWorkspaceView[]>(readSavedWorkspaceViews)
  const [teamViews,setTeamViews]=useState<SavedWorkspaceView[]>([])
  const [teamViewSelection,setTeamViewSelection]=useState('')
  const [teamViewError,setTeamViewError]=useState('')
  const [viewSelection,setViewSelection]=useState('')
  const [workspaceQuery,setWorkspaceQuery] = useState('')
  const [workspaceKind,setWorkspaceKind] = useState('all')
  const [workspaceVerified,setWorkspaceVerified] = useState('all')
  const [search,setSearch] = useState('')
  const [viewSystem,setViewSystem] = useState(()=>parseWorkspaceRoute(window.location).systemId)

  const [showExternalDependencies,setShowExternalDependencies] = useState(false)
  const [zoneMode,setZoneMode] = useState(false)
  const [infra, setInfra] = useState<Infra[]>([])
  const [flows, setFlows] = useState<Flow[]>([])
  const [layer, setLayer] = useState<Section>(()=>parseWorkspaceRoute(window.location).layer)
  useEffect(()=>{
    const onPopState=()=>{
      const route=parseWorkspaceRoute(window.location)
      setLayer(route.layer)
      setViewSystem(route.systemId)
      setInspectorOpen(false)
      setInspectorExpanded(false)
    }
    window.addEventListener('popstate',onPopState)
    return ()=>window.removeEventListener('popstate',onPopState)
  },[])
  useEffect(()=>{
    const next=workspaceRouteUrl(layer,viewSystem)
    if(window.location.pathname+window.location.search!==next)window.history.pushState(null,'',next)
  },[layer,viewSystem])
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
  const [createObjectOpen,setCreateObjectOpen] = useState(false)
  const [kind, setKind] = useState('system')
  const [description, setDescription] = useState('')
  const [error, setError] = useState('')
  const [notice,setNotice] = useState('')
  const [tokenReady, setTokenReady] = useState(Boolean(accessToken))
  const [wikiConfigured,setWikiConfigured]=useState(false)
  const [wikiStatus,setWikiStatus]=useState<'checking'|'connected'|'unconfigured'|'unavailable'>('checking')
  const [wikiPublicUrl,setWikiPublicUrl]=useState('')
  useEffect(()=>{
    if(!tokenReady){setWikiConfigured(false);setWikiStatus('unavailable');setWikiPublicUrl('');return}
    let active=true
    setWikiStatus('checking')
    request<{configured:boolean;public_url?:string}>('/api/knowledge/status')
      .then(result=>{
        if(!active)return
        setWikiConfigured(result.configured)
        setWikiStatus(result.configured?'connected':'unconfigured')
        const url=result.public_url||''
        setWikiPublicUrl(/^https:\/\//i.test(url)||/^http:\/\/(?!localhost|127\.0\.0\.1|0\.0\.0\.0)/i.test(url)?url:'')
      })
      .catch(()=>{if(active){setWikiConfigured(false);setWikiStatus('unavailable');setWikiPublicUrl('')}})
    return()=>{active=false}
  },[tokenReady])
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


  const visibleObjects = objects.filter(o=>(!workspaceQuery||[o.name,o.description,o.kind].join(' ').toLowerCase().includes(workspaceQuery.toLowerCase()))&&(workspaceKind==='all'||o.kind===workspaceKind))
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
    if(!diagramEditMode)return
    const result = applyNodeChanges(changes, nodes)
    if (changes.some(c => c.type === 'position' && 'position' in c && c.position)) {
      setPositions(old => ({ ...old, ...Object.fromEntries(result.map(n => [n.id, n.position])) }))
      setDirty(true)
    }
  }, [nodes,diagramEditMode])

  const onConnect = useCallback(async (connection: Connection) => {
    if (!diagramEditMode || !connection.source || !connection.target || connection.source===connection.target) return
    try {
      await request('/api/relations', { method: 'POST', body: JSON.stringify({
        source_id: connection.source, target_id: connection.target, kind: 'data_flow',
      }) })
      setRelations(await request<Rel[]>('/api/relations'))
    } catch (e) { setError(String(e)) }
  }, [diagramEditMode])

  async function addObject(event: React.FormEvent) {
    event.preventDefault()
    if (!name.trim()) return
    setBusy(true); setError('')
    try {
      await request('/api/objects', { method: 'POST', body: JSON.stringify({ name: name.trim(), kind, description }) })
      setObjects(await request<Obj[]>('/api/objects'))
      setName(''); setDescription(''); setCreateObjectOpen(false)
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

  useEffect(()=>{setDiagramEditMode(false);setViewsMenuOpen(false)},[layer,viewSystem])

  const detail = objects.find(o => o.id === selected)
  const drill = objects.find(o=>o.id===viewSystem)
  const detailItems = infra.filter(i=>i.system_id===selected)
  const localComponents=infra.filter(i=>i.system_id===viewSystem)
  const localIds=new Set(localComponents.map(i=>i.id))
  const externalIds=new Set<string>()
  if(showExternalDependencies)for(const f of flows){
    if(localIds.has(f.source_id)&&!localIds.has(f.target_id))externalIds.add(f.target_id)
    if(localIds.has(f.target_id)&&!localIds.has(f.source_id))externalIds.add(f.source_id)
  }
  useEffect(()=>{setExpandedComponentGroup('')},[viewSystem,workspaceQuery,workspaceKind,showExternalDependencies])
  const scopedItems=infra.filter(i=>(localIds.has(i.id)||externalIds.has(i.id))&&(workspaceKind==='all'||i.kind===workspaceKind)&&(!workspaceQuery||[i.name,i.description,i.kind,...Object.values(i.details).map(v=>typeof v==='object'?JSON.stringify(v):String(v)),objects.find(o=>o.id===i.system_id)?.name||''].join(' ').toLowerCase().includes(workspaceQuery.toLowerCase())))
  const scopedIds=new Set(scopedItems.map(i=>i.id))
  const scopedFlows=flows.filter(f=>scopedIds.has(f.source_id)||scopedIds.has(f.target_id))
  const visibleDrillFlows=scopedFlows.filter(f=>scopedIds.has(f.source_id)&&scopedIds.has(f.target_id))
  const effectiveComponentGroupMode:ComponentGroupMode|null=componentGroupMode==='components'?null:componentGroupMode==='auto'?(scopedItems.length>18?'environment':null):componentGroupMode
  const groupedComponents=effectiveComponentGroupMode?groupComponents(scopedItems.map(i=>({id:i.id,environment:String(i.details.environment||''),zone:nics.find(n=>n.item_id===i.id)?.zone_id?segments.find(s=>s.id===nics.find(n=>n.item_id===i.id)?.zone_id)?.name||'':String(i.details.security_zone||'')})),visibleDrillFlows,effectiveComponentGroupMode):null
  const isComponentGroupOverview=!!groupedComponents&&!expandedComponentGroup
  const isComponentGroupDetail=!!groupedComponents&&!!expandedComponentGroup
  const groupMemberIds=new Set(groupedComponents?.nodes.find(group=>group.id===expandedComponentGroup)?.memberIds||[])
  const displayedComponentCount=isComponentGroupOverview?groupedComponents!.nodes.length:isComponentGroupDetail?groupMemberIds.size:scopedItems.length

const filterInfra=(i:Infra)=>(!viewSystem||i.system_id===viewSystem)&&(workspaceKind==='all'||i.kind===workspaceKind)&&(!workspaceQuery||[i.name,i.description,i.kind,...Object.values(i.details).map(v=>typeof v==='object'?JSON.stringify(v):String(v)),objects.find(o=>o.id===i.system_id)?.name||''].join(' ').toLowerCase().includes(workspaceQuery.toLowerCase()))
  const filterFlow=(f:Flow)=>(!viewSystem||scopedIds.has(f.source_id)||scopedIds.has(f.target_id))&&(workspaceVerified==='all'||f.verification===workspaceVerified)&&(!workspaceQuery||[f.name,f.data_description,f.protocol,infra.find(i=>i.id===f.source_id)?.name||'',infra.find(i=>i.id===f.target_id)?.name||''].join(' ').toLowerCase().includes(workspaceQuery.toLowerCase()))
  useEffect(()=>{request<SavedWorkspaceView[]>('/api/views').then(setTeamViews).catch(e=>setTeamViewError('Общие виды недоступны: '+String(e)))},[tokenReady])
  async function saveTeamView(){
    if(!workspaceLayer)return
    const name=window.prompt('Название общего представления команды')
    if(!name?.trim())return
    setTeamViewError('')
    try{
      const saved=await request<SavedWorkspaceView>('/api/views',{method:'POST',body:JSON.stringify({
        name:name.trim(),layer:workspaceLayer,query:workspaceQuery,kind:workspaceKind,verification:workspaceVerified
      })})
      setTeamViews(await request<SavedWorkspaceView[]>('/api/views'));setTeamViewSelection(saved.id)
      setNotice('Общее представление сохранено')
    }catch(e){setTeamViewError(String(e))}
  }
  function applyTeamView(id:string){
    setTeamViewSelection(id)
    const v=teamViews.find(v=>v.id===id&&v.layer===workspaceLayer)
    if(v){setWorkspaceQuery(v.query);setWorkspaceKind(v.kind);setWorkspaceVerified(v.verification)}
  }
  async function removeTeamView(){
    if(!teamViews.some(v=>v.id===teamViewSelection&&v.layer===workspaceLayer))return
    setTeamViewError('')
    try{await request('/api/views/'+teamViewSelection,{method:'DELETE'});setTeamViews(await request<SavedWorkspaceView[]>('/api/views'));setTeamViewSelection('')}
    catch(e){setTeamViewError(String(e))}
  }
  const workspaceLayer=layer==='business'||layer==='systems'||layer==='infrastructure'||layer==='flows'?layer:null
  const activeSavedViews=savedViews.filter(v=>v.layer===workspaceLayer)
  function saveCurrentView(){
    if(!workspaceLayer)return
    const name=window.prompt('Название представления (например, Только критичные потоки)')
    if(!name?.trim())return
    const view:SavedWorkspaceView={id:crypto.randomUUID(),name:name.trim().slice(0,80),layer:workspaceLayer,query:workspaceQuery,kind:workspaceKind,verification:workspaceVerified,...(workspaceLayer==='flows'?{flowLayoutOrientation,flowLayoutDensity,flowSystemOverview,flowDepth,flowDirection}:{})}
    const next=[...savedViews.filter(v=>v.name!==view.name||v.layer!==view.layer),view].slice(-30)
    try{localStorage.setItem(VIEWS_STORAGE_KEY,JSON.stringify(next));setSavedViews(next);setViewSelection(view.id);setNotice('Представление сохранено в этом браузере')}catch{setError('Не удалось сохранить представление в браузере')}
  }
  function selectSavedView(id:string){
    setViewSelection(id)
    const saved=savedViews.find(v=>v.id===id&&v.layer===workspaceLayer)
    if(!saved)return
    setWorkspaceQuery(saved.query);setWorkspaceKind(saved.kind);setWorkspaceVerified(saved.verification);if(saved.layer==='flows'){setFlowLayoutOrientation(saved.flowLayoutOrientation||'horizontal');setFlowLayoutDensity(saved.flowLayoutDensity||'normal');setFlowSystemOverview(saved.flowSystemOverview??false);setFlowDepth(saved.flowDepth??1);setFlowDirection(saved.flowDirection||'both')}
  }
  function deleteSavedView(){
    const next=savedViews.filter(v=>v.id!==viewSelection)
    try{localStorage.setItem(VIEWS_STORAGE_KEY,JSON.stringify(next));setSavedViews(next);setViewSelection('')}catch{setError('Не удалось удалить представление')}
  }
  const workspaceFilters=<div className="workspaceFilters workspaceFiltersCompact">
    <input aria-label="Фильтр по названию" placeholder="Поиск по разделу…" value={workspaceQuery} onChange={e=>setWorkspaceQuery(e.target.value)}/>
    {(layer==='systems'||layer==='infrastructure')&&<select aria-label="Фильтр типа объекта" value={workspaceKind} onChange={e=>setWorkspaceKind(e.target.value)}><option value="all">Все типы</option>{Array.from(new Set((layer==='systems'?objects:infra).map(x=>x.kind))).sort().map(k=><option key={k} value={k}>{k}</option>)}</select>}
    {layer==='flows'&&<select aria-label="Фильтр достоверности" value={workspaceVerified} onChange={e=>setWorkspaceVerified(e.target.value)}><option value="all">Все статусы</option><option value="draft">Черновик</option><option value="assumed">Предположение</option><option value="verified">Подтверждено</option></select>}
    <button type="button" onClick={()=>{setWorkspaceQuery('');setWorkspaceKind('all');setWorkspaceVerified('all')}} disabled={!workspaceQuery&&workspaceKind==='all'&&workspaceVerified==='all'}>Сбросить</button>
    <div className="workspaceViewMenu"><button type="button" aria-expanded={viewsMenuOpen} aria-controls="workspace-view-options" onClick={()=>setViewsMenuOpen(v=>!v)}>Представления {viewsMenuOpen?'▴':'▾'}</button>
    {viewsMenuOpen&&<div id="workspace-view-options" className="workspaceViewOptions"><label>Личный вид<select aria-label="Сохранённое представление" value={activeSavedViews.some(v=>v.id===viewSelection)?viewSelection:''} onChange={e=>selectSavedView(e.target.value)}><option value="">Выбрать…</option>{activeSavedViews.map(v=><option key={v.id} value={v.id}>{v.name}</option>)}</select></label><div className="workspaceViewActions"><button type="button" onClick={saveCurrentView}>Сохранить вид</button><button type="button" disabled={!activeSavedViews.some(v=>v.id===viewSelection)} onClick={deleteSavedView}>Удалить вид</button></div>
    <label>Вид команды<select aria-label="Командное представление" value={teamViews.some(v=>v.id===teamViewSelection&&v.layer===workspaceLayer)?teamViewSelection:''} onChange={e=>applyTeamView(e.target.value)}><option value="">Выбрать…</option>{teamViews.filter(v=>v.layer===workspaceLayer).map(v=><option key={v.id} value={v.id}>{v.name}</option>)}</select></label><div className="workspaceViewActions"><button type="button" onClick={saveTeamView}>Сохранить для команды</button><button type="button" disabled={!teamViews.some(v=>v.id===teamViewSelection&&v.layer===workspaceLayer)} onClick={removeTeamView}>Удалить общий вид</button></div>{teamViewError&&<small role="status">{teamViewError}</small>}</div>}</div>
  </div>
    const segmentName=(id:string|null)=>segments.find(s=>s.id===id)?.name||'Не указано'
  const zones=Array.from(new Set(scopedItems.map(i=>nics.find(n=>n.item_id===i.id)?.zone_id||String(i.details.security_zone||'Зона неизвестна'))))
  const drillPositions=compactComponentLayout(scopedItems.map(i=>i.id),visibleDrillFlows.map(f=>({source:f.source_id,target:f.target_id})),280,170)
  const visibleFlowIds=flowComponentFocus?scopedFlowIds(flowComponentFocus,flows.filter(filterFlow),flowDepth,flowDirection):new Set<string>()
  const registryItems=infra.filter(filterInfra).sort((a,b)=>registrySort==='system'?(objects.find(o=>o.id===a.system_id)?.name||'').localeCompare(objects.find(o=>o.id===b.system_id)?.name||'','ru'):String(registrySort==='kind'?a.kind:a.name).localeCompare(String(registrySort==='kind'?b.kind:b.name),'ru'))
  function exportRegistryCsv(){
    const columns=['ID','Название','Тип','Система','Описание','Контур','Владелец','Ответственный','SLA','Зона безопасности','ОС','Версия','Хост','IP','Примечания']
    const rows=registryItems.map(i=>[i.id,i.name,i.kind,objects.find(o=>o.id===i.system_id)?.name||'',i.description,...['environment','owner','responsible','sla','security_zone','os','version','hostname','ip_address','network_notes'].map(k=>String(i.details[k]??''))])
    const escapeCsv=(v:string)=>'"'+v.replace(/"/g,'""')+'"'
    const csv='\uFEFF'+[columns,...rows].map(row=>row.map(v=>escapeCsv(String(v))).join(';')).join('\r\n')
    const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download='architecture-registry.csv';a.click();URL.revokeObjectURL(url)
  }
  async function applyRegistryBulk(){
    const ids=registrySelected.filter(id=>infra.some(i=>i.id===id));if(!ids.length)return
    if(!window.confirm('Изменить поле у '+ids.length+' компонентов?'))return
    setRegistryBulkBusy(true);setError('')
    let updated=0
    try{for(const id of ids){const item=infra.find(i=>i.id===id);if(!item)continue;await request('/api/infra/'+id,{method:'PUT',body:JSON.stringify({system_id:item.system_id,parent_id:item.parent_id,kind:item.kind,name:item.name,description:item.description,details:{...item.details,[registryBulkField]:registryBulkValue}})});updated++}
      setNotice('Обновлено компонентов: '+updated);setRegistrySelected([]);setInfra(await request<Infra[]>('/api/infra'))
    }catch(e){setError('Обновлено '+updated+' из '+ids.length+'. '+String(e));setInfra(await request<Infra[]>('/api/infra'))}finally{setRegistryBulkBusy(false)}
  }
  const componentQuality=infra.filter(filterInfra).map(i=>{
    const issues:string[]=[]
    if(!i.description?.trim())issues.push('Нет описания')
    if(!String(i.details.environment||'').trim())issues.push('Не указана среда')
    if(!String(i.details.security_zone||'').trim())issues.push('Не указана зона безопасности')
    if(!flows.some(f=>f.source_id===i.id||f.target_id===i.id))issues.push('Нет потоков данных')
    if(!nics.some(n=>n.item_id===i.id))issues.push('Нет сетевых интерфейсов')
    return {item:i,issues}
  })
  const incompleteComponents=componentQuality.filter(x=>x.issues.length>0)
  const visibleFlows=flows.filter(filterFlow).filter(f=>!flowComponentFocus||visibleFlowIds.has(f.id))
  const unverifiedFlows=visibleFlows.filter(f=>!f.verification||!['verified','confirmed','подтверждено','подтверждён','проверено'].includes(f.verification.trim().toLowerCase()))
  const incompleteFlows=visibleFlows.filter(f=>!f.data_description?.trim()||!f.protocol?.trim()||!f.port?.trim()||!f.security?.trim())
  function exportVisibleFlowsCsv(){
    const columns=['ID','Название','Источник','Получатель','Данные','Протокол','Порт','Защита','Периодичность','Достоверность']
    const rows=visibleFlows.map(f=>[f.id,f.name,infra.find(i=>i.id===f.source_id)?.name||f.source_id,infra.find(i=>i.id===f.target_id)?.name||f.target_id,f.data_description,f.protocol,f.port,f.security,f.schedule,f.verification])
    const escapeCell=(value:unknown)=>'"'+String(value??'').replace(/"/g,'""')+'"'
    const csv='\uFEFF'+[columns,...rows].map(row=>row.map(escapeCell).join(';')).join('\r\n')
    const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}))
    const link=document.createElement('a')
    link.href=url
    link.download='architecture-hub-flows-'+new Date().toISOString().slice(0,10)+'.csv'
    document.body.appendChild(link)
    link.click()
    link.remove()
    URL.revokeObjectURL(url)
  }

  const flowLayoutGaps=flowLayoutDensity==='compact'?[265,125]:flowLayoutDensity==='spacious'?[425,220]:[330,175]
  const flowBasePositions=dependencyLayout(
    infra.filter(i=>visibleFlows.some(f=>f.source_id===i.id||f.target_id===i.id)).map(i=>i.id),
    visibleFlows.map(f=>({source:f.source_id,target:f.target_id})),flowLayoutGaps[0],flowLayoutGaps[1])
  const flowPositions=flowLayoutOrientation==='vertical'?Object.fromEntries(Object.entries(flowBasePositions).map(([id,p])=>[id,{x:p.y,y:p.x}])):flowBasePositions
  const flowSystemIds=[...new Set(visibleFlows.flatMap(f=>[infra.find(i=>i.id===f.source_id)?.system_id,infra.find(i=>i.id===f.target_id)?.system_id]).filter((id):id is string=>Boolean(id)))]
  const flowSystemEdges=visibleFlows.map(f=>({flow:f,source:infra.find(i=>i.id===f.source_id)?.system_id,target:infra.find(i=>i.id===f.target_id)?.system_id})).filter((x):x is {flow:Flow;source:string;target:string}=>Boolean(x.source&&x.target&&x.source!==x.target))
  const flowSystemPositions=dependencyLayout(flowSystemIds,flowSystemEdges.map(x=>({source:x.source,target:x.target})),flowLayoutGaps[0],flowLayoutGaps[1])
  const flowOverviewPositions=flowLayoutOrientation==='vertical'?Object.fromEntries(Object.entries(flowSystemPositions).map(([id,p])=>[id,{x:p.y,y:p.x}])):flowSystemPositions
  const overviewPairs=[...new Set(flowSystemEdges.map(x=>x.source+'|'+x.target))]
  const effectiveFlowOverview=shouldShowSystemsOverview(visibleFlows,flowSystemIds.length,Boolean(viewSystem),Boolean(flowComponentFocus),flowDetailPreference,flowSystemOverview)

  const adjacent=new Set([focusedComponent])
  for(const f of scopedFlows){if(f.source_id===focusedComponent)adjacent.add(f.target_id);if(f.target_id===focusedComponent)adjacent.add(f.source_id)}
  const focusActive=!!focusedComponent&&scopedIds.has(focusedComponent)
  const impacted=impactMode&&focusActive?downstreamImpact(focusedComponent,scopedFlows,scopedIds):new Set<string>()
  const visibleFocus=impactMode?new Set([focusedComponent,...impacted]):adjacent
  const impactPaths=impactMode&&focusActive?impactRoutes(focusedComponent,scopedFlows,scopedIds):[]
  const drillNodes:Node[] = scopedItems.map((i,n)=>({id:i.id,position:(componentCanvasPositions[viewSystem]?.[i.id]||drillPositions[i.id]||{x:(n%4)*260,y:Math.floor(n/4)*155}),data:{label:<div className="systemNode"><strong>{i.name}</strong><span className="componentNodeOwner">{objects.find(o=>o.id===i.system_id)?.name||'ИС не указана'}</span><span className="componentNodePurpose">{i.description?.trim()||String(i.details.purpose||i.details.role||'Назначение не описано')}</span><small>{externalIds.has(i.id)?'ВНЕШНЯЯ ИС · ':''}{i.kind} · {String(i.details.environment||'Среда не задана')}</small><small>{nics.filter(n=>n.item_id===i.id).map(n=>[segments.find(s=>s.id===n.zone_id)?.name,segments.find(s=>s.id===n.vrf_id)?.name,segments.find(s=>s.id===n.vlan_id)?.name].filter(Boolean).join(' / ')).join('; ')||String(i.details.security_zone||'Сеть не указана')}</small><button type="button" className="componentNodeOpen nodrag nopan" onClick={e=>{e.preventDefault();e.stopPropagation();setComponentEditing(false);setComponentInspectId(i.id);setComponentInspectTab('passport')}} aria-label={'Открыть паспорт компонента: '+i.name}>Подробнее</button></div>},style:{width:220,padding:12,background:i.details.environment==='TEST'?'#fff5e7':viewMode==='security'?'#eaf5f2':'#ffffff',border:i.id===focusedComponent?'2px solid #1377d5':externalIds.has(i.id)?'2px dashed #c48a4d':'1px solid #bac8d8',borderRadius:12,opacity:focusActive&&!visibleFocus.has(i.id)?0.28:1}}))
  const drillEdges:Edge[]=visibleDrillFlows.map(f=>{
    const highlighted=impactMode?(visibleFocus.has(f.source_id)&&impacted.has(f.target_id)):(f.source_id===focusedComponent||f.target_id===focusedComponent)
    const reciprocal=visibleDrillFlows.some(other=>other.source_id===f.target_id&&other.target_id===f.source_id)
    return {id:f.id,source:f.source_id,target:f.target_id,type:reciprocal?'reciprocal':'smoothstep',data:{reciprocal,caption:viewMode==='security'?`${f.protocol} : ${f.port} / ${f.security}`:f.name},
      label:reciprocal?undefined:viewMode==='security'?`${f.protocol} : ${f.port} / ${f.security}`:f.name,
      style:{stroke:focusActive&&highlighted?'#166cc2':f.security==='unknown'?'#d58c40':'#369279',
        strokeWidth:focusActive&&highlighted?2:1.5,opacity:focusActive&&!highlighted?0.2:1},
      labelStyle:{fontSize:10},markerEnd:{type:MarkerType.ArrowClosed,width:13,height:13}}
  })

  const groupedDrillPositions=groupedComponents?dependencyLayout(groupedComponents.nodes.map(n=>n.id),groupedComponents.edges,285,175):{}
  const groupedDrillNodes:Node[]=groupedComponents?.nodes.map((group,index)=>({id:group.id,position:groupedDrillPositions[group.id]||{x:(index%3)*300,y:Math.floor(index/3)*180},data:{label:<div className="componentGroupNode"><strong>{group.label}</strong><small>{group.memberIds.length} компонентов</small><small>Нажмите для просмотра</small></div>},style:{width:230,padding:14,border:'1px solid #8aaad1',borderRadius:12,background:'#eef5ff'}}))||[]
  const groupedDrillEdges:Edge[]=groupedComponents?.edges.map(edge=>({id:edge.id,source:edge.source,target:edge.target,type:'smoothstep',label:String(edge.count)+' потоков',style:{stroke:'#64748b',strokeWidth:1.6},labelStyle:{fontSize:11},markerEnd:{type:MarkerType.ArrowClosed,width:13,height:13}}))||[]
  const renderedDrillNodes=isComponentGroupOverview?groupedDrillNodes:isComponentGroupDetail?drillNodes.filter(n=>groupMemberIds.has(n.id)):drillNodes
  const renderedDrillEdges=isComponentGroupOverview?groupedDrillEdges:isComponentGroupDetail?drillEdges.filter(e=>groupMemberIds.has(e.source)&&groupMemberIds.has(e.target)):drillEdges
  const modalOpen=authOpen||kisOpen||Boolean(passportEditId)||Boolean(componentInspectId)||createObjectOpen||Boolean(registryOpen)
  useEffect(()=>{
    if(!modalOpen)return
    setViewsMenuOpen(false)
    document.querySelectorAll<HTMLDetailsElement>('details.layerActions[open], details.mobileSectionMenu[open], details.registryColumnPicker[open]').forEach(menu=>{menu.open=false})
  },[modalOpen,authOpen,kisOpen,passportEditId,componentInspectId,createObjectOpen,registryOpen])
  return <div className={`shell shellNoCatalog${inspectorOpen&&!inspectorExpanded?" shellInspectorOpen":""}`}>
    <header className="globalHeader" aria-label="Главная панель Architecture Hub">
      <div className="globalBrand"><span className="globalBrandMark">◆</span><strong>Architecture Hub</strong></div>
      <nav className="layerTabs" aria-label="Разделы архитектуры">
        <details className="mobileSectionMenu">
          <summary aria-label="Выбрать раздел">{({home:'Обзор',systems:'Системы',infrastructure:'Компоненты',flows:'Потоки',business:'Бизнес-процессы',networks:'Реестр сетей',topology:'Топология сетей',incidents:'Инциденты',knowledge:'Wiki.js'} as Record<string,string>)[layer]}</summary>
          <div className="mobileSectionOptions">
            {([['home','Обзор'],['systems','Системы'],['infrastructure','Компоненты'],['flows','Потоки'],['business','Бизнес-процессы'],['networks','Реестр сетей'],['topology','Топология сетей'],['incidents','Инциденты'],['knowledge','Wiki.js · База знаний']] as const).map(([id,label])=><button key={id} type="button" className={layer===id?'current':''} onClick={e=>{if(id==='home'||id==='systems'||id==='flows')setViewSystem('');if(id==='flows')setFlowComponentFocus('');if(id==='infrastructure'){setInspectorOpen(false);setInspectorExpanded(false)}setLayer(id);e.currentTarget.closest('details')?.removeAttribute('open')}}>{label}</button>)}
          </div>
        </details>
        <button className={layer==='home'?'current':''} onClick={()=>{setViewSystem('');setLayer('home')}}>Обзор</button>
        <button className={layer==='systems'?'current':''} onClick={()=>{setViewSystem('');setLayer('systems')}}>Системы</button>
        <button className={layer==='infrastructure'?'current':''} onClick={()=>{setLayer('infrastructure');setInspectorOpen(false);setInspectorExpanded(false)}}>Компоненты</button>
        <button className={layer==='flows'?'current':''} onClick={()=>{setViewSystem('');setFlowComponentFocus('');setLayer('flows')}}>Потоки</button>
        <details className="layerActions secondaryNavigation">
          <summary aria-label="Другие разделы">{({business:'Бизнес-процессы',networks:'Реестр сетей',topology:'Топология сетей',incidents:'Инциденты',knowledge:'Wiki.js'} as Record<string,string>)[layer]||'Ещё'} ▾</summary>
          <div className="layerActionMenu">
            {([['business','Бизнес-процессы'],['networks','Реестр сетей'],['topology','Топология сетей'],['incidents','Инциденты'],['knowledge','Wiki.js · База знаний']] as const).map(([id,label])=><button type="button" key={id} className={layer===id?'current':''} onClick={e=>{setLayer(id);e.currentTarget.closest('details')?.removeAttribute('open')}}>{label}</button>)}
          </div>
        </details>
        <div className="navEnd"><details className="layerActions">
          <summary title="Создание и импорт объектов" aria-label="Создать или импортировать">＋ <span className="navActionText">Создать</span></summary>
          <div className="layerActionMenu">
            <button onClick={()=>{setPassportEditId('');setComponentInspectId('');setRegistryOpen(null);setCreateObjectOpen(true)}}>Система</button>
            <button onClick={()=>setEditorOpen(true)}>Компонент</button>
            <button onClick={()=>editNetwork()}>Сеть</button>
            <button onClick={()=>editFlow()}>Поток</button>
            <button onClick={()=>{setPassportEditId('');setComponentInspectId('');setRegistryOpen(null);setKisOpen(true)}}>Импорт КИС</button>
            <button disabled={!selected||kisExporting} onClick={()=>selected&&exportKis(selected)}>{kisExporting?'Экспорт…':'Экспорт КИС в Excel'}</button>
          </div>
        </details></div>
      </nav>
      <div className="topActions">
        {tokenReady ? <button type="button" title="Завершить сеанс и удалить ключ доступа из вкладки" onClick={()=>{saveAccessToken('');setTokenReady(false);setObjects([]);setRelations([]);setDiagrams([]);setInfra([]);setFlows([]);setSegments([]);setNics([]);setCategories([]);setProcesses([]);setBusinessLinks([]);setSelected('');setSelectedFlow('');setError('');setNotice('Сеанс завершён')}}>Выйти</button> : <button type="button" onClick={()=>setAuthOpen(true)}>Ключ доступа</button>}
        {layer==='systems'&&<><select aria-label="Схема" value={diagramId} onChange={e => selectDiagram(e.target.value)}>
          {!diagrams.length && <option value="">Основная карта</option>}
          {diagrams.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
        <button title="Создать схему" aria-label="Создать схему" onClick={addDiagram}>＋</button>
        </>}{dirty&&<button className="primary" onClick={saveDiagram}>Сохранить изменения</button>}
      </div>
<div className="globalHeaderActions"><span className="globalHeaderSection">РАБОЧЕЕ ПРОСТРАНСТВО</span>{import.meta.env.VITE_WIKI_URL&&<a href={import.meta.env.VITE_WIKI_URL} target="_blank" rel="noopener noreferrer">Wiki.js <span aria-hidden="true">↗</span></a>}</div>
    </header>
    {authOpen&&<div className="editorBackdrop"><section className="editorDialog" role="dialog" aria-modal="true" aria-label="Вход в Architecture Hub"><div className="dialogHead"><h2>Ключ доступа</h2><button aria-label="Закрыть вход" onClick={()=>{setAuthOpen(false);setAuthDraft('')}}>×</button></div><p>Ключ хранится только в текущей вкладке до завершения сеанса.</p><form className="detailForm" onSubmit={async e=>{e.preventDefault();setAuthBusy(true);saveAccessToken(authDraft);try{await refresh();setTokenReady(true);setAuthOpen(false);setAuthDraft('');setError('')}catch(err){saveAccessToken('');setTokenReady(false);setError((err as Error).message)}finally{setAuthBusy(false)}}}><label>Ключ<input type="password" autoComplete="off" required value={authDraft} onChange={e=>setAuthDraft(e.target.value)}/></label><button className="primary" disabled={authBusy}>{authBusy?'Проверка…':'Войти'}</button></form></section></div>}
    <main className="main">
      {notice && <div className="notice" role="status">{notice}<button onClick={()=>setNotice('')}>×</button></div>}
      {error && <div className="error" role="alert">{error}<button onClick={() => setError('')}>×</button></div>}

      {['business','systems','infrastructure','flows'].includes(layer)&&workspaceFilters}
      {layer==='knowledge'?<section className="knowledgeWorkspace" aria-label="База знаний Wiki.js">
        <div className="knowledgeWorkspaceHead"><div><h2>База знаний · Wiki.js</h2><p>Документация информационных систем и связи со статьями</p></div>{wikiPublicUrl&&<a href={wikiPublicUrl} target="_blank" rel="noopener noreferrer" className="knowledgeOpenLink">Открыть Wiki.js ↗</a>}</div>
        {wikiStatus==='connected'?<div className="knowledgeWorkspaceStatus" role="status"><strong>Интеграция подключена</strong><p>Выберите информационную систему, чтобы искать статьи и привязывать документацию к её паспорту.</p></div>:<div className="knowledgeWorkspaceStatus" role="status"><strong>{wikiStatus==='checking'?'Проверяем подключение…':wikiStatus==='unconfigured'?'Wiki.js ещё не подключена к Architecture Hub':'Подключение Wiki.js не удалось проверить'}</strong><p>{wikiStatus==='unconfigured'?'Для поиска и привязки статей настройте WIKI_API_TOKEN и WIKI_PUBLIC_URL в окружении backend. Для прямой ссылки также можно задать VITE_WIKI_URL при сборке frontend.':wikiStatus==='unavailable'?'Проверьте авторизацию и доступность /api/knowledge/status.':'Настройка и состояние Wiki.js проверяются через backend.'}</p></div>}
        <div className="knowledgeWorkspaceSystems"><h3>Документация по системам</h3><div className="knowledgeWorkspaceList">{objects.filter(o=>!search||o.name.toLowerCase().includes(search.toLowerCase())).map(o=><button key={o.id} type="button" onClick={()=>{setSelected(o.id);setInspectorOpen(true);setPanelTab('knowledge')}}><span>{o.name}</span><small>Открыть документацию</small></button>)}</div>{!objects.length&&<p>После входа здесь появятся информационные системы.</p>}</div>
      </section>:layer==='home' ? <ArchitectureHome systems={objects} components={infra} flows={flows} processes={processes} links={businessLinks} networks={segments} interfaces={nics} onOpenSystem={id=>{setSelected(id);setInspectorOpen(true);setPanelTab('overview')}} onOpenComponents={id=>{setSelected(id);setViewSystem(id);setComponentView('diagram');setLayer('infrastructure');setInspectorOpen(false)}} onOpenComponent={id=>{setComponentInspectId(id);setComponentInspectTab('passport')}} onOpenFlows={()=>setLayer('flows')} onOpenNetworks={()=>setLayer('networks')}/> : layer==='incidents' ? <Incidents request={request} systems={objects} components={infra} networks={segments} flows={flows}/> : layer==='networks' ? <section className="infraPanel networkRegistry">
 <div className="registryHeader"><div><h2>Реестр сетей</h2><p className="hint">Зоны безопасности, VLAN, VRF и их фактические привязки к интерфейсам</p></div><div className="networkRegistryActions"><button type="button" onClick={()=>setNetworkPathOpen(true)}>Сетевые объекты и маршруты</button><button className="primary" onClick={()=>editNetwork()}>+ Создать сеть</button></div></div>
 <div className="networkRegistryFilters"><input aria-label="Поиск сети" placeholder="Поиск по имени и описанию" value={networkFilter} onChange={e=>setNetworkFilter(e.target.value)}/><select aria-label="Тип сети" value={networkTypeFilter} onChange={e=>setNetworkTypeFilter(e.target.value)}><option value="all">Все типы</option><option value="zone">Зоны</option><option value="vrf">VRF</option><option value="vlan">VLAN</option></select><span>{segments.filter(n=>(networkTypeFilter==='all'||n.kind===networkTypeFilter)&&[n.name,n.description].join(' ').toLowerCase().includes(networkFilter.toLowerCase())).length} записей</span></div>
 <div className="networkTableWrap"><table className="networkTable"><thead><tr><th>Имя сети</th><th>Тип</th><th>Достоверность</th>{registryColumnVisible('interfaces')&&<th>Интерфейсы</th>}<th>Описание</th><th>Действия</th></tr></thead><tbody>{segments.filter(n=>(networkTypeFilter==='all'||n.kind===networkTypeFilter)&&[n.name,n.description].join(' ').toLowerCase().includes(networkFilter.toLowerCase())).sort((a,b)=>a.kind.localeCompare(b.kind)||a.name.localeCompare(b.name)).map(n=>{
 const used=nics.filter(x=>x.zone_id===n.id||x.vrf_id===n.id||x.vlan_id===n.id)
 const synthetic=/синтетическ|демонстрационн/i.test(n.description)
 return <React.Fragment key={n.id}><tr><td><strong>{n.name}</strong>{synthetic&&<small className="networkDemo">Демонстрационные данные</small>}</td><td><span className="tag">{n.kind.toUpperCase()}</span></td><td>{n.verification==='verified'?'Подтверждено':n.verification==='draft'?'Черновик':'Предположение'}</td><td>{used.length}</td><td>{n.description||'—'}</td><td><button onClick={()=>setNetworkDetailId(networkDetailId===n.id?'':n.id)}>{networkDetailId===n.id?'Скрыть':'Использование'}</button> <button onClick={()=>editNetwork(n)}>Редактировать сеть</button></td></tr>{networkDetailId===n.id&&<tr className="networkDetailRow"><td colSpan={6}><strong>Привязанные интерфейсы и системы</strong>{used.length?<div className="networkUsage">{used.map(nic=>{const component=infra.find(i=>i.id===nic.item_id);const system=objects.find(o=>o.id===component?.system_id);return <div key={nic.id}><b>{component?.name||'Компонент не найден'}</b> · {nic.name} · {system?.name||'Система не найдена'} {nic.ip_address&&'· '+nic.ip_address}</div>})}</div>:<p className="hint">Привязанных интерфейсов нет. Это не подтверждает отсутствие использования сети.</p>}</td></tr>}</React.Fragment>
 })}</tbody></table></div>
 </section> : layer==='topology' ? <Topology systems={objects} items={infra} segments={segments} interfaces={nics} flows={flows} saveInterface={async (value,id)=>{
      const uri=id?'/api/network-interfaces/'+id:'/api/network-interfaces'
      await request(uri,{method:id?'PUT':'POST',body:JSON.stringify(value)})
      setNics(await request<Nic[]>('/api/network-interfaces'))
    }} saveSegment={async (value,id)=>{await request(id?'/api/networks/'+id:'/api/networks',{method:id?'PUT':'POST',body:JSON.stringify(value)});setSegments(await request<Segment[]>('/api/networks'))}} saveFlow={async (value,id)=>{ await request(id?'/api/flows/'+id:'/api/flows',{method:id?'PUT':'POST',body:JSON.stringify(value)}); setFlows(await request<Flow[]>('/api/flows')) }}/> : layer==='business' ? <section className="infraPanel"><h2>Бизнес-архитектура</h2><p className="hint">Категория → процесс → поддерживающие системы. Достоверность связей проверяется отдельно.</p>
      <div className="businessGrid">{categories.filter(cat=>!workspaceQuery||cat.name.toLowerCase().includes(workspaceQuery.toLowerCase())||processes.some(p=>p.category_id===cat.id&&[p.name,p.description].join(' ').toLowerCase().includes(workspaceQuery.toLowerCase()))).map(cat=><article className="businessCategory" key={cat.id}><h3>{cat.name}</h3>{processes.filter(p=>p.category_id===cat.id&&(!workspaceQuery||[p.name,p.description,cat.name].join(' ').toLowerCase().includes(workspaceQuery.toLowerCase()))).map(p=><div className="businessProcess" key={p.id}><strong>{p.name}</strong><p>{p.description}</p><div className="processSystems">{businessLinks.filter(l=>l.process_id===p.id).map(l=><button key={l.id} onClick={()=>{setSelected(l.system_id);setLayer('systems')}}>{objects.find(o=>o.id===l.system_id)?.name||'Система'}</button>)}</div></div>)}</article>)}</div>
      {!categories.length&&<p>Бизнес-процессы пока не добавлены.</p>}</section> : layer==='systems' ? <section className="systemsWorkspace" aria-label="Реестр информационных систем">
        <div className="systemsWorkspaceHead"><div><h2>Информационные системы</h2><p>Реестр, паспорта и состав ИС. Общая карта связей находится в разделе «Обзор».</p></div><div className="systemsWorkspaceActions"><button type="button" onClick={()=>setSystemsShowDiagram(v=>!v)} aria-pressed={systemsShowDiagram}>{systemsShowDiagram?'Показать реестр':'Редактор схемы'}</button><button type="button" className="primary" onClick={()=>{setPassportEditId('');setCreateObjectOpen(true)}}>+ Создать ИС</button></div></div>
        {systemsShowDiagram ? <section className="canvas" data-active-graph="systems">
        <div className="canvasMode"><button aria-pressed={diagramEditMode} onClick={()=>setDiagramEditMode(v=>!v)}>{diagramEditMode?'Завершить редактирование':'Редактировать схему'}</button></div>
        <ReactFlow minZoom={0.08} nodes={nodes} edges={edges} onNodesChange={onNodesChange} onConnect={onConnect} nodesDraggable={diagramEditMode} nodesConnectable={diagramEditMode} deleteKeyCode={null}
          onNodeClick={(_event: React.MouseEvent, node: Node) => {setSelected(node.id);setInspectorOpen(true);setPanelTab("overview")}} onNodeDoubleClick={(_event: React.MouseEvent, node: Node) => {setViewSystem(node.id);setSelected(node.id);setComponentView('diagram');setLayer("infrastructure");setInspectorOpen(false);setInspectorExpanded(false)}} onPaneClick={() => setSelected('')} fitView>
          <AutoFit layoutKey={diagramId}/><Background color="#d1dae5" gap={20} size={1}/><Controls showInteractive={false}/>
        </ReactFlow>
        {!objects.length && <div className="emptyHint">Создайте систему через меню «Создать». Для изменения связей включите редактирование схемы.</div>}
      </section> : <div className="systemsTableWrap"><table className="systemsTable"><thead><tr><th>Система</th><th>Тип</th><th>Статус</th><th>Компоненты</th><th>Действия</th></tr></thead><tbody>
          {objects.filter(o=>!workspaceQuery||[o.name,o.kind,o.status,o.description].join(' ').toLowerCase().includes(workspaceQuery.toLowerCase())).map(o=><tr key={o.id}><td><button type="button" className="systemNameLink" onClick={()=>{setSelected(o.id);setInspectorOpen(true);setPanelTab('overview')}}>{o.name}</button>{o.description&&<small className="systemDescription">{o.description}</small>}</td><td>{o.kind||'ИС'}</td><td><span className="tag">{o.status||'Не указан'}</span></td><td>{infra.filter(i=>i.system_id===o.id).length}</td><td><div className="systemRowActions"><button type="button" onClick={()=>{setSelected(o.id);setInspectorOpen(true);setPanelTab('overview')}}>Паспорт</button><button type="button" onClick={()=>{setViewSystem(o.id);setComponentView('diagram');setLayer('infrastructure');setInspectorOpen(false)}}>Компоненты</button></div></td></tr>)}
          {!objects.length&&<tr><td colSpan={5}>Информационные системы пока не добавлены.</td></tr>}
        </tbody></table></div>}
      </section> : <section className="infraPanel">
        {drill && <button onClick={()=>{setViewSystem("");setLayer("systems")}}>← К общей карте</button>}
        {layer==='infrastructure' ? <>
          <div className="viewHead"><select aria-label="Система компонентов" value={viewSystem} onChange={e=>{setViewSystem(e.target.value);setFocusedComponent('');setExpandedComponentGroup('');setDiagramEditMode(false)}}><option value="">Все системы</option>{objects.map(o=><option key={o.id} value={o.id}>{o.name}</option>)}</select><div className="viewSwitch" role="group" aria-label="Представление компонентов">{([['diagram','Схема'],['board','Доска'],['registry','Реестр'],['cards','Карточки']] as const).map(([id,label])=><button key={id} aria-pressed={componentView===id} disabled={(id==='diagram'||id==='board')&&!drill} onClick={()=>{setDiagramEditMode(false);setComponentView(id)}}>{label}</button>)}</div>{componentView==='diagram'&&<><label className="componentGroupSelector">Группировка <select aria-label="Группировка компонентов" value={componentGroupMode} onChange={e=>{setComponentGroupMode(e.target.value as 'auto'|'environment'|'zone'|'components');setExpandedComponentGroup('');setFocusedComponent('');setImpactMode(false);setDiagramEditMode(false)}}><option value="auto">Автоматически</option><option value="environment">По контурам</option><option value="zone">По сетевым зонам</option><option value="components">Все компоненты</option></select></label><button type="button" disabled={!!effectiveComponentGroupMode} className={diagramEditMode?"primary":""} aria-pressed={diagramEditMode} onClick={()=>setDiagramEditMode(v=>!v)}>{diagramEditMode?"Завершить редактирование":"Редактировать схему"}</button><label className="externalToggle"><input type="checkbox" checked={showExternalDependencies} onChange={e=>{setShowExternalDependencies(e.target.checked);setFocusedComponent('');setImpactMode(false)}}/> Смежные ИС</label><select value={viewMode} onChange={e=>setViewMode(e.target.value as 'architecture'|'security')}><option value="architecture">Архитектура ВМ</option><option value="security">Сети и защита</option></select></>}</div>
          {componentView==='board'&&drill&&<ArchitectureBoard key={viewSystem} systemId={viewSystem} items={infra.filter(i=>i.system_id===viewSystem)} networks={segments} interfaces={nics} flows={flows} request={request} onCommitted={async()=>{setInfra(await request<Infra[]>('/api/infra'));setFlows(await request<Flow[]>('/api/flows'));setSegments(await request<Segment[]>('/api/networks'));setNics(await request<Nic[]>('/api/network-interfaces'))}}/>}
          {componentView==='diagram'&&<>
          <div className="diagramLegend" aria-label="Условные обозначения схемы">
            <span><i className="legendSwatch legendLocal"></i>Компоненты текущей ИС: {scopedItems.filter(i=>localIds.has(i.id)).length}</span>
            {showExternalDependencies&&<span><i className="legendSwatch legendExternal"></i>Смежные ИС: {scopedItems.filter(i=>externalIds.has(i.id)).length}</span>}
            <span>Направленные потоки: {visibleDrillFlows.length}</span>
          </div>
          {drill && <div className="graphFocusToolbar"><span>{focusActive?`Связи компонента: ${scopedItems.find(i=>i.id===focusedComponent)?.name||''} · ${scopedFlows.filter(f=>f.source_id===focusedComponent||f.target_id===focusedComponent).length} потоков`:isComponentGroupOverview?'Нажмите на группу, чтобы увидеть её компоненты и внутренние потоки.':'Нажмите на компонент для подсветки. Чтобы связать компоненты, перетащите линию от нижней точки источника к верхней точке получателя.'}</span>{focusActive&&<><button onClick={()=>{setComponentInspectId(focusedComponent);setComponentInspectTab('passport')}}>Паспорт компонента</button><button onClick={()=>setImpactMode(v=>!v)}>{impactMode?'Прямые связи':'Влияние отказа →'}</button>{impactMode&&<span role="status">Потенциально затронуто: {impacted.size} компонентов (по направлению зарегистрированных потоков)</span>}<button onClick={()=>{setFocusedComponent('');setImpactMode(false)}}>Сбросить выделение</button></>}</div>}
          {impactMode&&focusActive&&<div className="impactRoutes" aria-label="Маршруты потенциального влияния">
            <strong>Цепочки потенциального влияния</strong>
            <p className="hint">Маршруты построены по направлению зарегистрированных потоков; даже подтверждённый поток не доказывает фактический отказ получателя.</p>
            {impactPaths.length===0?<p>Исходящие зависимости внутри выбранной схемы не зарегистрированы.</p>:impactPaths.map(route=><div className="impactRoute" key={route.target}><span>{route.nodes.map(id=>scopedItems.find(i=>i.id===id)?.name||id).join(' → ')}</span><small>{route.steps} переходов · {route.verification}</small><button type="button" onClick={()=>setFocusedComponent(route.target)}>Выделить компонент</button></div>)}
          </div>}
          {drill && <div className="graphModeHint" role="status">{effectiveComponentGroupMode?'Сгруппированная схема только для просмотра. Чтобы редактировать связи, выберите «Все компоненты».':diagramEditMode?'Режим редактирования – соедините точки компонентов для создания потока; нажмите на линию для изменения связи.':'Режим просмотра – схема защищена от случайных соединений. Для изменения связей нажмите «Редактировать схему».'}</div>}
          {drill && effectiveComponentGroupMode&&<div className="componentGroupBar" role="status">{isComponentGroupOverview?`Группы: ${displayedComponentCount} · компонентов: ${scopedItems.length} · потоки между группами: ${groupedComponents?.edges.reduce((n,e)=>n+e.count,0)||0}`:`Группа: ${groupedComponents?.nodes.find(group=>group.id===expandedComponentGroup)?.label||'Неизвестная'} · компонентов: ${displayedComponentCount}`}{expandedComponentGroup&&<button type="button" onClick={()=>{setExpandedComponentGroup('');setFocusedComponent('');setImpactMode(false)}}>← Ко всем группам</button>}</div>}
          {drill&&diagramEditMode&&!effectiveComponentGroupMode&&<div className="canvasEditTools" role="toolbar" aria-label="Инструменты схемы компонентов"><div className="canvasToolSwitch" role="group" aria-label="Инструмент доски"><button type="button" aria-pressed={componentCanvasTool==='move'} onClick={()=>{setComponentCanvasTool('move');setConnectionStart('')}}>Перемещать</button><button type="button" aria-pressed={componentCanvasTool==='connect'} onClick={()=>{setComponentCanvasTool('connect');setConnectionStart('')}}>Связать</button></div><span>{componentCanvasTool==='connect'?(connectionStart?'Выберите второй компонент – получателя потока.':'Выберите компонент-источник, затем получателя. Откроется технический редактор потока.'):'Перетаскивайте узлы, чтобы расположить их на доске.'}</span><button type="button" onClick={()=>{resetComponentCanvas(viewSystem);setConnectionStart('')}}>Сбросить расположение</button><small>Расположение сохраняется в этом браузере</small></div>}
          {drill && <div className="miniArchitecture" data-active-graph="infrastructure"><ReactFlow minZoom={0.08} maxZoom={renderedDrillNodes.length<=2?0.85:1.2} fitViewOptions={{padding:0.22,maxZoom:renderedDrillNodes.length<=2?0.85:1.2}} key={drill.id+viewMode+(effectiveComponentGroupMode||'components')+expandedComponentGroup} nodes={renderedDrillNodes} edges={renderedDrillEdges} edgeTypes={{reciprocal:ReciprocalEdge}} onNodeClick={(_,node)=>{if(isComponentGroupOverview){setExpandedComponentGroup(node.id);setFocusedComponent('');setImpactMode(false)}else if(diagramEditMode&&componentCanvasTool==='connect'&&!effectiveComponentGroupMode){if(connectionStart&&connectionStart!==node.id){connectComponents({source:connectionStart,target:node.id,sourceHandle:null,targetHandle:null});setConnectionStart('')}else setConnectionStart(node.id)}else setFocusedComponent(node.id)}} onPaneClick={()=>{setFocusedComponent('');setConnectionStart('')}} onConnect={diagramEditMode&&!effectiveComponentGroupMode?connectComponents:undefined} onEdgeClick={(_,edge)=>{const flow=flows.find(f=>f.id===edge.id);if(flow){setSelectedFlow(flow.id);if(diagramEditMode)editFlow(flow);else{setComponentInspectId(flow.source_id);setComponentInspectTab('flows')}}}} fitView nodesConnectable={diagramEditMode&&!effectiveComponentGroupMode} nodesDraggable={diagramEditMode&&!effectiveComponentGroupMode&&componentCanvasTool==='move'} onNodeDragStop={(_,node)=>{if(diagramEditMode&&!effectiveComponentGroupMode)moveComponentOnCanvas(viewSystem,node)}}><AutoFit maxFitZoom={renderedDrillNodes.length<=2?0.85:1.2} layoutKey={viewMode+(effectiveComponentGroupMode||'components')+expandedComponentGroup+visibleDrillFlows.map(f=>f.source_id+f.target_id).join('|')}/><Background gap={20}/><Controls showInteractive={false}/></ReactFlow></div>}
          {viewMode==='security'&&<div className="networkZones">{zones.map(z=><article key={z} className="zoneCard"><h3>{segments.find(s=>s.id===z)?.name||z}</h3>{scopedItems.filter(i=>(nics.find(n=>n.item_id===i.id)?.zone_id||String(i.details.security_zone||'Зона неизвестна'))===z).map(i=><button key={i.id} onClick={()=>setSelected(i.system_id)}><strong>{i.name}</strong><small>{nics.filter(n=>n.item_id===i.id).map(n=>n.name+' · '+segmentName(n.vrf_id)+' · '+segmentName(n.vlan_id)).join('; ')||'Сетевой интерфейс не задан'}</small></button>)}</article>)}</div>}
          {viewMode==='security'&&<div className="networkLegend">Цвет стрелки: зелёный – указан тип защиты; оранжевый – неизвестно. Наличие TLS не подтверждает защиту всего маршрута. Неподтверждённые параметры требуют проверки.</div>}
          </>}
          {componentView==='diagram'&&!drill&&<p role="status">Выберите систему, чтобы открыть схему компонентов.</p>}
          {componentView==='registry'&&<section className="architectureRegistry" aria-label="Архитектурный реестр"><div className="architectureRegistryHeader"><div><h3>Архитектурный реестр</h3><small>Компонентов: {registryItems.length}</small></div><div className="registryHeaderActions"><details className="registryColumnPicker"><summary>Столбцы</summary><div role="group" aria-label="Видимые столбцы реестра"><p>Компонент, тип, ИС и паспорт показываются всегда.</p>{optionalRegistryColumns.map(([id,label])=><label key={id}><input type="checkbox" checked={registryColumnVisible(id)} onChange={e=>setRegistryColumns(current=>e.target.checked?[...current,id]:current.filter(value=>value!==id))}/>{label}</label>)}<button type="button" onClick={()=>setRegistryColumns(['environment','zone','interfaces','flows'])}>По умолчанию</button></div></details><button type="button" onClick={exportRegistryCsv} disabled={!registryItems.length}>Экспорт CSV ({registryItems.length})</button></div></div><div className="architectureRegistryControls"><label>Сортировать <select value={registrySort} onChange={e=>setRegistrySort(e.target.value as 'name'|'kind'|'system')}><option value="name">По названию</option><option value="kind">По типу</option><option value="system">По системе</option></select></label>{registrySelected.length>0&&<><label>Массовое изменение <select aria-label="Массовое изменение" value={registryBulkField} onChange={e=>setRegistryBulkField(e.target.value)}><option value="owner">Владелец</option><option value="responsible">Ответственный</option><option value="sla">SLA</option><option value="environment">Контур</option><option value="security_zone">Зона безопасности</option></select></label><label>Значение <input value={registryBulkValue} onChange={e=>setRegistryBulkValue(e.target.value)} placeholder="Новое значение"/></label><button type="button" disabled={registryBulkBusy||!registrySelected.length} onClick={()=>void applyRegistryBulk()}>{registryBulkBusy?'Сохранение…':'Изменить выбранные ('+registrySelected.length+')'}</button></>}</div><div className="architectureRegistryTableWrap"><table><thead><tr><th><input type="checkbox" aria-label="Выбрать все отображаемые" checked={registryItems.length>0&&registryItems.every(i=>registrySelected.includes(i.id))} onChange={e=>setRegistrySelected(e.target.checked?registryItems.map(i=>i.id):[])}/></th><th>Компонент</th><th>Тип</th><th>ИС</th>{registryColumnVisible('parent')&&<th>Родитель</th>}{registryColumnVisible('environment')&&<th>Контур</th>}{registryColumnVisible('owner')&&<th>Владелец</th>}{registryColumnVisible('responsible')&&<th>Ответственный</th>}{registryColumnVisible('sla')&&<th>SLA</th>}{registryColumnVisible('zone')&&<th>Зона</th>}{registryColumnVisible('interfaces')&&<th>Интерфейсы</th>}{registryColumnVisible('flows')&&<th>Потоки</th>}<th>Паспорт</th></tr></thead><tbody>{registryItems.map(i=><tr key={i.id}><td><input type="checkbox" aria-label={'Выбрать '+i.name} checked={registrySelected.includes(i.id)} onChange={e=>setRegistrySelected(prev=>e.target.checked?[...prev.filter(id=>id!==i.id),i.id]:prev.filter(id=>id!==i.id))}/></td><td>{i.name}</td><td>{i.kind}</td><td>{objects.find(o=>o.id===i.system_id)?.name||'—'}</td>{registryColumnVisible('parent')&&<td>{infra.find(x=>x.id===i.parent_id)?.name||'—'}</td>}{registryColumnVisible('environment')&&<td>{String(i.details.environment||'—')}</td>}{registryColumnVisible('owner')&&<td>{String(i.details.owner||'—')}</td>}{registryColumnVisible('responsible')&&<td>{String(i.details.responsible||'—')}</td>}{registryColumnVisible('sla')&&<td>{String(i.details.sla||'—')}</td>}{registryColumnVisible('zone')&&<td>{String(i.details.security_zone||'—')}</td>}{registryColumnVisible('interfaces')&&<td>{nics.filter(n=>n.item_id===i.id).length}</td>}{registryColumnVisible('flows')&&<td>{flows.filter(f=>f.source_id===i.id||f.target_id===i.id).length}</td>}<td><button type="button" onClick={()=>{setComponentInspectId(i.id);setComponentInspectTab('passport')}}>Открыть</button></td></tr>)}</tbody></table></div></section>}
          <Disclosure label={"Качество данных · "+incompleteComponents.length+" с замечаниями"}><section className="qualityAudit"><strong>Полнота реестра: {componentQuality.length-incompleteComponents.length} из {componentQuality.length} без замечаний</strong><p className="hint">Проверяются описание, среда, зона безопасности, сетевой интерфейс и потоки. Отсутствие интерфейса или потока может быть допустимым.</p><details><summary>Компоненты с замечаниями ({incompleteComponents.length})</summary>{incompleteComponents.map(({item,issues})=><div className="qualityAuditRow" key={item.id}><button type="button" onClick={()=>{setComponentInspectId(item.id);setComponentInspectTab('passport')}}>{item.name}</button><small>{issues.join(' · ')}</small></div>)}</details></section></Disclosure>
          {componentView==='cards'&&<div className="infraGrid">{infra.filter(filterInfra).map(i=><article className="infraCard" key={i.id}>
            <span className="tag">{i.kind}</span><h3>{i.name}</h3><button type="button" onClick={()=>{setComponentInspectId(i.id);setComponentInspectTab("passport")}}>Карточка компонента</button>
            <p>{objects.find(o=>o.id===i.system_id)?.name}</p>
            {i.parent_id&&<small>Входит в: {infra.find(x=>x.id===i.parent_id)?.name||'Неизвестно'}</small>}
            <p>{i.description}</p><p><strong>{String(i.details.environment||"")}</strong> · {String(i.details.security_zone||"Зона неизвестна")} · {String(i.details.vrf||"VRF неизвестен")}</p>
          </article>)}</div>}
        </> : <>
          <div className="viewHead"><div className="viewSwitch" role="group" aria-label="Представление потоков">{([['diagram','Схема'],['cards','Карточки']] as const).map(([id,label])=><button key={id} aria-pressed={flowView===id} onClick={()=>setFlowView(id)}>{label}</button>)}</div><select aria-label="Система потоков" value={viewSystem} onChange={e=>{setViewSystem(e.target.value);setFlowComponentFocus('');setSelectedFlow('')}}><option value="">Все системы</option>{objects.map(o=><option key={o.id} value={o.id}>{o.name}</option>)}</select>{flowView==='diagram'&&<label className="flowDetailControl">Детализация <select aria-label="Детализация схемы потоков" value={flowDetailPreference} onChange={e=>{setFlowDetailPreference(e.target.value as 'auto'|'systems'|'components');setSelectedFlow('');setExpandedFlowPair('')}}><option value="auto">Автоматически</option><option value="systems">По системам</option><option value="components">Все компоненты</option></select></label>}<span>{visibleFlows.length} потоков</span></div>
          <Disclosure label="Настройки потоков и качество данных">
          <p className="hint">Каждый поток – отдельная запись от конкретного компонента-источника до компонента-получателя. Обратный независимый поток создаётся отдельно.</p>
          <div style={{display:'flex',gap:8,alignItems:'center',marginBottom:8}}><label><input type="checkbox" checked={flowFocusOnly} onChange={e=>setFlowFocusOnly(e.target.checked)}/> Только выбранный поток</label>{selectedFlow&&<button type="button" onClick={()=>setSelectedFlow('')}>Снять выделение</button>}</div>
          <div className="flowComponentSearch"><label>Поиск компонента <input type="search" aria-label="Поиск компонента на схеме" value={flowComponentQuery} onChange={e=>setFlowComponentQuery(e.target.value)} placeholder="Название системы или компонента"/></label><label>Показать связи компонента <select aria-label="Показать связи компонента" value={flowComponentFocus} onChange={e=>{setFlowComponentFocus(e.target.value);setFlowDepth(1);setSelectedFlow('');setExpandedFlowPair('')}}><option value="">Все компоненты</option>{infra.filter(i=>flows.filter(filterFlow).some(f=>f.source_id===i.id||f.target_id===i.id)).filter(i=>!flowComponentQuery||[i.name,i.kind,objects.find(o=>o.id===i.system_id)?.name||''].join(' ').toLowerCase().includes(flowComponentQuery.toLowerCase())).sort((a,b)=>a.name.localeCompare(b.name,'ru')).map(i=><option key={i.id} value={i.id}>{i.name}</option>)}</select></label>{flowComponentFocus&&<button type="button" onClick={()=>{setFlowComponentFocus('');setSelectedFlow('');setExpandedFlowPair('')}}>Сбросить фокус</button>}</div>
          <button type="button" onClick={exportVisibleFlowsCsv} disabled={!visibleFlows.length} title="Экспортировать отображаемые потоки в CSV для Excel">Экспорт потоков CSV ({visibleFlows.length})</button>
          <label className="flowGroupingToggle"><input type="checkbox" checked={groupFlowEdges} onChange={e=>setGroupFlowEdges(e.target.checked)}/> Группировать параллельные потоки на схеме <small>(все направления доступны в карточках ниже)</small></label>
                    <section className="flowAudit" aria-label="Контроль достоверности потоков"><div className="flowAuditSummary"><strong>Качество данных потоков</strong><span>Всего: {visibleFlows.length} · Требуют подтверждения: {unverifiedFlows.length} · Неполные характеристики: {incompleteFlows.length}</span></div><details><summary>Потоки, требующие проверки ({unverifiedFlows.length})</summary><p className="hint">Подтверждёнными считаются только записи с явно указанным статусом подтверждения. Статус не заменяет фактическую проверку.</p>{unverifiedFlows.map(f=><div className="qualityAuditRow" key={f.id}><button type="button" onClick={()=>editFlow(f)}>{f.name}</button><small>{f.verification||'Статус не указан'}</small></div>)}</details><details><summary>Неполные технические характеристики ({incompleteFlows.length})</summary>{incompleteFlows.map(f=><div className="qualityAuditRow" key={f.id}><button type="button" onClick={()=>editFlow(f)}>{f.name}</button><small>{[!f.data_description?.trim()?'данные':null,!f.protocol?.trim()?'протокол':null,!f.port?.trim()?'порт':null,!f.security?.trim()?'защита':null].filter(Boolean).join(', ')}</small></div>)}</details></section>
          <div className="flowLayoutControls" aria-label="Настройки расположения схемы"><label>Расположение <select value={flowLayoutOrientation} onChange={e=>setFlowLayoutOrientation(e.target.value as 'horizontal'|'vertical')}><option value="horizontal">Слева направо</option><option value="vertical">Сверху вниз</option></select></label><label>Расстояния <select value={flowLayoutDensity} onChange={e=>setFlowLayoutDensity(e.target.value as 'compact'|'normal'|'spacious')}><option value="compact">Компактно</option><option value="normal">Стандартно</option><option value="spacious">Просторно</option></select></label><small>Положение узлов рассчитывается автоматически по зависимостям.</small></div>
          </Disclosure>
          {flowComponentFocus&&<div className="flowFocusBanner" role="status"><strong>Выбран компонент: {infra.find(i=>i.id===flowComponentFocus)?.name||'Неизвестный компонент'}</strong><span>Показаны зависимости выбранного компонента. Нажмите на другой узел схемы, чтобы переключить фокус.</span><button type="button" onClick={()=>{setFlowComponentFocus('');setSelectedFlow('');setExpandedFlowPair('')}}>Показать все потоки</button></div>}
          {flowComponentFocus&&<label className="flowDepthSelect">Направление <select aria-label="Направление потоков" value={flowDirection} onChange={e=>setFlowDirection(e.target.value as 'both'|'incoming'|'outgoing')}><option value="both">Все направления</option><option value="incoming">Входящие</option><option value="outgoing">Исходящие</option></select></label>}
          {flowComponentFocus&&<label className="flowDepthSelect">Глубина связей <select aria-label="Глубина связей" value={flowDepth} onChange={e=>setFlowDepth(Number(e.target.value))}><option value={1}>1 уровень</option><option value={2}>2 уровня</option><option value={3}>3 уровня</option></select></label>}
          <div className="flowDataAccess"><button type="button" onClick={()=>setFlowDataOpen(true)}>Справочник атрибутов и состав данных</button>{selectedFlow&&<span>Выбран поток: {flows.find(f=>f.id===selectedFlow)?.name||'–'}</span>}</div>
          <div className="networkPathOpenAction"><button type="button" onClick={()=>setNetworkPathOpen(true)}>Сетевой маршрут и средства защиты</button>{selectedFlow&&<span>Выбран: {flows.find(f=>f.id===selectedFlow)?.name||'Поток'}</span>}</div>
          {flowView==='diagram'&&<div className="miniArchitecture" data-active-graph="flows">{effectiveFlowOverview?<ReactFlow minZoom={0.08} nodes={flowSystemIds.map((id,index)=>({id,position:flowOverviewPositions[id]||{x:(index%4)*320,y:Math.floor(index/4)*180},data:{label:<div><strong>{objects.find(o=>o.id===id)?.name||'ИС'}</strong><small>{infra.filter(i=>i.system_id===id).length} компонентов · {visibleFlows.filter(f=>infra.some(i=>i.id===f.source_id&&i.system_id===id)||infra.some(i=>i.id===f.target_id&&i.system_id===id)).length} потоков</small></div>},style:{width:230,border:'1px solid #94a3b8',borderRadius:12,padding:12,background:'#eff6ff'}}))} edges={overviewPairs.map(pair=>{const [source,target]=pair.split('|');const count=flowSystemEdges.filter(x=>x.source===source&&x.target===target).length;return {id:pair,source,target,type:'smoothstep',label:count+' потоков',style:{stroke:'#64748b',strokeWidth:1.5},markerEnd:{type:MarkerType.ArrowClosed,width:12,height:12,color:'#64748b'}}})} onNodeClick={(_,node)=>{setViewSystem(node.id);setFlowDetailPreference('components');setFlowSystemOverview(false);setFlowComponentFocus('');setSelectedFlow('')}} onEdgeClick={(_,edge)=>{const item=flowSystemEdges.find(x=>x.source+'|'+x.target===edge.id);if(item){setFlowDetailPreference('components');setFlowSystemOverview(false);setViewSystem('');setSelectedFlow(item.flow.id);setExpandedFlowPair(item.flow.source_id+'|'+item.flow.target_id)}}} fitView nodesDraggable={false} nodesConnectable={false}><AutoFit layoutKey={flowLayoutOrientation+flowLayoutDensity+flowComponentFocus+':'+flowDepth+':'+flowDirection+':'+visibleFlows.map(f=>f.source_id+f.target_id).join('|')}/>
            <FocusNeighborhood selectedId={flowComponentFocus} edgePairs={visibleFlows.map(f=>({source:f.source_id,target:f.target_id}))}/><Background gap={20}/><Controls showInteractive={false}/></ReactFlow>:<ReactFlow
            edgeTypes={{reciprocal:ReciprocalEdge}} nodes={infra.filter(i=>visibleFlows.some(f=>f.source_id===i.id||f.target_id===i.id)).map((i,idx)=>({id:i.id,sourcePosition:flowLayoutOrientation==='horizontal'?Position.Right:Position.Bottom,targetPosition:flowLayoutOrientation==='horizontal'?Position.Left:Position.Top,position:flowPositions[i.id]||{x:(idx%5)*230,y:Math.floor(idx/5)*120},data:{label:<div><strong>{i.name}</strong><small>{i.kind} · {String(i.details.security_zone||'зона не задана')}</small></div>},style:{width:200,border:selectedFlow&&flows.some(f=>f.id===selectedFlow&&(f.source_id===i.id||f.target_id===i.id))?'3px solid #2563eb':'1px solid #aab8cb',borderRadius:9,background:'#fff',padding:9,opacity:selectedFlow&&!flows.some(f=>f.id===selectedFlow&&(f.source_id===i.id||f.target_id===i.id))?0.28:1}})).filter(n=>!flowFocusOnly||!selectedFlow||flows.some(f=>f.id===selectedFlow&&(f.source_id===n.id||f.target_id===n.id)))}
            edges={visibleFlows.filter(f=>!flowFocusOnly||!selectedFlow||f.id===selectedFlow).filter((f,idx,all)=>!groupFlowEdges||!all.slice(0,idx).some(previous=>previous.source_id===f.source_id&&previous.target_id===f.target_id)).map(f=>({id:f.id,source:f.source_id,target:f.target_id,type:visibleFlows.some(x=>x.source_id===f.target_id&&x.target_id===f.source_id)?'reciprocal':'smoothstep',data:{caption:groupFlowEdges?String(visibleFlows.filter(x=>x.source_id===f.source_id&&x.target_id===f.target_id).length)+' потоков':f.name},pathOptions:{borderRadius:12,offset:24},label:groupFlowEdges&&visibleFlows.filter(x=>x.source_id===f.source_id&&x.target_id===f.target_id).length>1?String(visibleFlows.filter(x=>x.source_id===f.source_id&&x.target_id===f.target_id).length)+' '+(visibleFlows.filter(x=>x.source_id===f.source_id&&x.target_id===f.target_id).length%10===1&&visibleFlows.filter(x=>x.source_id===f.source_id&&x.target_id===f.target_id).length%100!==11?'поток':visibleFlows.filter(x=>x.source_id===f.source_id&&x.target_id===f.target_id).length%10>=2&&visibleFlows.filter(x=>x.source_id===f.source_id&&x.target_id===f.target_id).length%10<=4&&!([12,13,14].includes(visibleFlows.filter(x=>x.source_id===f.source_id&&x.target_id===f.target_id).length%100))?'потока':'потоков'):'',labelStyle:{fontSize:11,fill:'#475569'},labelBgStyle:{fill:'#fff',fillOpacity:0.92},style:{stroke:visibleFlows.some(x=>x.id===selectedFlow&&x.source_id===f.source_id&&x.target_id===f.target_id)?'#2563eb':'#94a3b8',strokeWidth:visibleFlows.some(x=>x.id===selectedFlow&&x.source_id===f.source_id&&x.target_id===f.target_id)?1.8:1.15,opacity:selectedFlow&&!visibleFlows.some(x=>x.id===selectedFlow&&x.source_id===f.source_id&&x.target_id===f.target_id)?0.16:1},markerEnd:{type:MarkerType.ArrowClosed,width:12,height:12,color:visibleFlows.some(x=>x.id===selectedFlow&&x.source_id===f.source_id&&x.target_id===f.target_id)?'#2563eb':'#94a3b8'},zIndex:visibleFlows.some(x=>x.id===selectedFlow&&x.source_id===f.source_id&&x.target_id===f.target_id)?100:0}))}
            onEdgeClick={(_,edge)=>{const flow=flows.find(f=>f.id===edge.id);if(flow){setSelectedFlow(flow.id);const pair=flow.source_id+'|'+flow.target_id;setExpandedFlowPair(current=>current===pair?'':pair)}}} onNodeClick={(_,node)=>{setFlowComponentFocus(node.id);setFlowDepth(1);setSelectedFlow('');setExpandedFlowPair('')}} fitView nodesDraggable={false} nodesConnectable={false} elementsSelectable={true}>            <AutoFit layoutKey={flowLayoutOrientation+flowLayoutDensity+flowComponentFocus+':'+flowDepth+':'+flowDirection+':'+visibleFlows.map(f=>f.source_id+f.target_id).join('|')}/>
            <Background gap={20}/><Controls showInteractive={false}/>
          </ReactFlow>}</div>}
          {expandedFlowPair&&<section className="expandedFlowPanel" aria-label="Потоки выбранной группы"><div className="expandedFlowHead"><div><strong>Потоки выбранного направления</strong><small>{infra.find(i=>i.id===expandedFlowPair.split('|')[0])?.name||'Источник'} → {infra.find(i=>i.id===expandedFlowPair.split('|')[1])?.name||'Получатель'} · {visibleFlows.filter(f=>f.source_id+'|'+f.target_id===expandedFlowPair).length} связей</small></div><button type="button" onClick={()=>setExpandedFlowPair('')}>Свернуть ×</button></div>{visibleFlows.filter(f=>f.source_id+'|'+f.target_id===expandedFlowPair).map(f=><div className="expandedFlowRow" key={f.id}><button type="button" aria-pressed={selectedFlow===f.id} onClick={()=>setSelectedFlow(f.id)}>{f.name} · {f.protocol||'Протокол не указан'} · {f.port||'порт ?'} · {f.security||'защита не указана'}</button><button type="button" onClick={()=>{setSelectedFlow(f.id);setFlowDataOpen(true)}}>Атрибуты</button><button type="button" onClick={()=>editFlow(f)}>Редактировать</button></div>)}</section>}

          {flowView==='cards'&&<div className="infraGrid">{visibleFlows.map(f=><article className="infraCard" key={f.id} role="button" tabIndex={0} aria-pressed={selectedFlow===f.id} onKeyDown={e=>{if(e.target===e.currentTarget&&(e.key==="Enter"||e.key===" ")){e.preventDefault();setSelectedFlow(selectedFlow===f.id?"":f.id)}}} onClick={()=>setSelectedFlow(selectedFlow===f.id?"":f.id)} style={{cursor:"pointer",borderColor:selectedFlow===f.id?"#2563eb":undefined}}>
            <span className="tag">{f.verification}</span><h3>{f.name}</h3>
            <strong>{infra.find(i=>i.id===f.source_id)?.name} → {infra.find(i=>i.id===f.target_id)?.name}</strong>
            <p>{f.data_description}</p><button type="button" onClick={e=>{e.stopPropagation();setSelectedFlow(f.id);setFlowDataOpen(true)}}>Атрибуты</button><button type="button" onClick={e=>{e.stopPropagation();setSelectedFlow(f.id);setNetworkPathOpen(true)}}>Сетевой маршрут</button><button type="button" onClick={e=>{e.stopPropagation();editFlow(f)}}>Редактировать</button><small>{f.protocol} · порт {f.port||'?'} · {f.security}</small>{selectedFlow===f.id&&<div className="flowDetails"><strong>Защита: {f.security}</strong><p>Достоверность: {f.verification}</p><p>Периодичность: {f.schedule||"Не указана"}</p><p>Зона источника: {segmentName(nics.find(n=>n.item_id===f.source_id)?.zone_id||null)}</p><p>Зона получателя: {segmentName(nics.find(n=>n.item_id===f.target_id)?.zone_id||null)}</p><p>Неизвестно, разрешён ли маршрут на межсетевом экране.</p></div>}
          </article>)}</div>}
        </>}
      </section>}
    </main>
    {systemDataId&&<SystemDataMap request={request} systems={objects} components={infra} flows={flows} processes={processes} initialSystemId={systemDataId} onClose={()=>setSystemDataId('')} onOpenFlow={id=>{setSelectedFlow(id);setSystemDataId('');setFlowDataOpen(true)}}/>}
    {networkPathOpen&&<NetworkPathCatalog request={request} flows={flows} components={infra} interfaces={nics} segments={segments} initialFlowId={selectedFlow} onClose={()=>setNetworkPathOpen(false)}/>}
    {flowDataOpen&&<FlowDataCatalog request={request} flows={flows} systems={objects} components={infra} processes={processes} initialFlowId={selectedFlow} onClose={()=>setFlowDataOpen(false)}/>}
    {inspectorOpen&&<><aside className={inspectorExpanded ? "details detailsExpanded" : "details"} aria-label="Карточка архитектурного объекта">
      <div className="inspectorToolbar"><div className="sideLabel">КАРТОЧКА ОБЪЕКТА</div><button type="button" aria-label="Закрыть правую панель" onClick={()=>{setInspectorOpen(false);setInspectorExpanded(false)}}>Закрыть ×</button><button type="button" onClick={()=>setInspectorExpanded(v=>!v)} aria-label={inspectorExpanded?"Свернуть карточку":"Развернуть карточку"}>{inspectorExpanded?"Свернуть ↘":"Развернуть ↗"}</button></div>
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
          {!wikiConfigured&&<div className="knowledgeWorkspaceStatus" role="status"><strong>Wiki.js не подключена</strong><p>Откройте раздел «База знаний» для состояния подключения и параметров настройки.</p></div>}
          {wikiConfigured&&<>
          <div className="knowledgeHeading"><h3>Документация</h3><span className="knowledgeCount">{kbLinks.length}</span></div><p className="knowledgeIntro">Статьи хранятся в Wiki.js. Изменения доступны в обеих системах.</p>
          {kbLinks.map(k=><div key={k.id} className="inspectorItem"><a className="knowledgeArticleLink" href={k.url} target="_blank" rel="noopener noreferrer">📄 {k.title} ↗</a><button className="knowledgeUnlink" onClick={()=>unlinkWiki(k.id)}>Убрать связь</button></div>)}
          {!kbLinks.length&&<p>Связанных статей пока нет.</p>}
          <div className="knowledgeHeading"><h3>Найти или создать статью</h3></div>{(wikiPublicUrl||import.meta.env.VITE_WIKI_URL)&&<a className="knowledgeCreate" href={wikiPublicUrl||import.meta.env.VITE_WIKI_URL} target="_blank" rel="noopener noreferrer">+ Новая статья в Wiki.js ↗</a>}
          <input value={kbQuery} onChange={e=>setKbQuery(e.target.value)} placeholder="Поиск по названию или пути" className="knowledgeSearch"/>
          <button disabled={kbLoading} onClick={searchWiki}>{kbLoading?'Поиск…':'Найти в Wiki.js'}</button>
          {kbPages.filter(p=>!kbLinks.some(k=>k.url===p.url)).map(p=><div className="inspectorItem knowledgeSearchResult" key={p.id}><div><strong>{p.title}</strong><small>{p.path}</small></div><button onClick={()=>attachWiki(p)}>+ Связать</button></div>)}
          {kbMessage&&<p role="status">{kbMessage}</p>}
          </>}
        </div>}
        {panelTab==='overview'&&<><button type="button" onClick={()=>editPassport(detail)}>Редактировать паспорт КИС</button><h3>Назначение</h3><p>{detail.description||'Описание не указано'}</p><h3>Статус</h3><p>{detail.status}</p>
          <div className="statPills"><span>{detailItems.length} компонентов</span><span>{flows.filter(f=>detailItems.some(i=>i.id===f.source_id||i.id===f.target_id)).length} потоков</span></div>
          {layer==='infrastructure'&&viewSystem===detail.id?<div className="currentContext" role="status">Архитектура этой ИС уже открыта</div>:<button className="primary" onClick={()=>{setViewSystem(detail.id);setComponentView('diagram');setLayer('infrastructure');setInspectorOpen(false)}}>{layer==='infrastructure'?'Показать компоненты этой ИС →':'Перейти к архитектуре ИС →'}</button>}</>}
        {panelTab==='components'&&<>{detailItems.map(i=><article className="inspectorItem" key={i.id}><strong>{i.name}</strong><small>{i.kind} · {String(i.details.environment||'—')} · {String(i.details.security_zone||'Зона не указана')}</small></article>)}
          {!detailItems.length&&<p>Компонентов пока нет</p>}</>}
        {panelTab==='flows'&&<><button type="button" className="primary" onClick={()=>{setSystemDataId(detail.id);setInspectorOpen(false)}}>Карта потоков и атрибутов ИС</button>{flows.filter(f=>detailItems.some(i=>i.id===f.source_id||i.id===f.target_id)).map(f=><article className="inspectorItem" key={f.id}><strong>{f.name}</strong><small>{infra.find(i=>i.id===f.source_id)?.name} → {infra.find(i=>i.id===f.target_id)?.name}</small><small>{f.protocol} / {f.security}</small></article>)}</>}
      </>:<p className="hint">Выберите систему на карте. Двойной клик откроет её внутреннюю архитектуру.</p>}
      <div className="disclaimer">Architecture Hub · Реестр архитектуры</div>
    </aside></>}
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
    {passportEditId&&<div className="editorBackdrop" onClick={()=>setPassportEditId('')}>
      <div className="editorDialog passportDialog" role="dialog" aria-modal="true" aria-label="Редактор паспорта КИС" onClick={e=>e.stopPropagation()}>
        <div className="dialogHead"><h2>Паспорт информационной системы</h2><button type="button" onClick={()=>setPassportEditId('')}>Закрыть ×</button></div>
        <p className="hint">Изменения сохраняются в реестре Architecture Hub и попадут в следующий экспорт КИС.</p>
        <form className="detailForm" onSubmit={savePassport}>
          <label>Название ИС<input required maxLength={250} value={passportDraft.name} onChange={e=>setPassportDraft({...passportDraft,name:e.target.value})}/></label>
          <label>Описание<textarea value={passportDraft.description} maxLength={4000} onChange={e=>setPassportDraft({...passportDraft,description:e.target.value})}/></label>
          <label>Статус<select value={passportDraft.status} onChange={e=>setPassportDraft({...passportDraft,status:e.target.value})}><option value="active">Действует</option><option value="draft">Черновик</option><option value="planned">Планируется</option><option value="retired">Выведена</option></select></label>
          <h3>Поля карточки КИС</h3>
          {Object.entries(passportDraft.fields).filter(([key])=>key!=='Название ИС').map(([key,value])=><label key={key}>{key}<input value={value} onChange={e=>setPassportDraft({...passportDraft,fields:{...passportDraft.fields,[key]:e.target.value}})}/></label>)}
          <button className="primary" disabled={passportSaving}>{passportSaving?'Сохранение…':'Сохранить паспорт'}</button>
        </form>
      </div>
    </div>}
    {componentInspectId&&(()=>{
      const component=infra.find(i=>i.id===componentInspectId)
      if(!component)return null
      const system=objects.find(o=>o.id===component.system_id)
      const interfaces=nics.filter(n=>n.item_id===component.id)
      const connected=flows.filter(f=>f.source_id===component.id||f.target_id===component.id)
      return <div className="editorBackdrop" onClick={closeComponentInspector}>
        <div className="editorDialog componentInspector architectureDrawer" role="dialog" aria-modal="true" aria-label={'Карточка компонента '+component.name} onClick={e=>e.stopPropagation()}>
          <div className="dialogHead"><div><small className="hint">{component.kind} · {system?.name||'Система не найдена'}</small><h2>{component.name}</h2></div><button type="button" onClick={closeComponentInspector}>Закрыть ×</button></div>
          <div className="componentInspectorTabs" role="tablist" aria-label="Разделы карточки">{([['passport','Паспорт'],['network','Сети'],['flows','Потоки'],['incidents','Инциденты']] as const).map(([id,label])=><button type="button" role="tab" key={id} aria-selected={componentInspectTab===id} className={componentInspectTab===id?'current':''} onClick={()=>setComponentInspectTab(id)}>{label}</button>)}</div>
          {componentInspectTab==='passport'&&<section><div className="componentPassportHealth"><strong>Полнота паспорта</strong><span>{[component.description?.trim(),String(component.details.environment||'').trim(),String(component.details.security_zone||'').trim(),interfaces.length>0,connected.length>0].filter(Boolean).length} из 5 критериев</span><small>{[!component.description?.trim()&&'Описание',!String(component.details.environment||'').trim()&&'Контур',!String(component.details.security_zone||'').trim()&&'Зона безопасности',!interfaces.length&&'Сетевые интерфейсы',!connected.length&&'Потоки данных'].filter(Boolean).length?'Требуют заполнения: '+[!component.description?.trim()&&'описание',!String(component.details.environment||'').trim()&&'контур',!String(component.details.security_zone||'').trim()&&'зона безопасности',!interfaces.length&&'сетевые интерфейсы',!connected.length&&'потоки данных'].filter(Boolean).join(', '):'Основные сведения заполнены'}</small><div className="componentPassportLinks"><button type="button" onClick={()=>setComponentInspectTab('network')}>Сетевые интерфейсы ({interfaces.length})</button><button type="button" onClick={()=>setComponentInspectTab('flows')}>Потоки ({connected.length})</button></div></div>{!componentEditing?<button type="button" onClick={()=>startComponentEdit(component)}>Редактировать паспорт</button>:<form className="detailForm" onSubmit={e=>{e.preventDefault();void saveComponentEdit(component)}}><h3>Основные сведения</h3><label>Название<input required value={componentDraft.name} onChange={e=>setComponentDraft({...componentDraft,name:e.target.value})}/></label><label>Описание<textarea value={componentDraft.description} onChange={e=>setComponentDraft({...componentDraft,description:e.target.value})}/></label><h3>Основные параметры реестра</h3><div className="componentStandardFields">{(['owner','responsible','sla','environment','security_zone','criticality','hostname','ip_address','os','version','location'] as const).map(key=><label key={key}>{componentFieldLabels[key]}<input value={String(componentDraft.details[key]??'')} onChange={e=>setComponentDraft(d=>({...d,details:{...d.details,[key]:e.target.value}}))}/></label>)}</div><h3>Дополнительные характеристики</h3><div className="componentFieldGroups" role="group" aria-label="Группы характеристик">{([['all','Все'],['network','Сеть'],['system','Система'],['other','Прочие']] as const).map(([id,label])=><button type="button" key={id} aria-pressed={componentFieldGroup===id} className={componentFieldGroup===id?'current':''} onClick={()=>setComponentFieldGroup(id)}>{label}</button>)}</div>{Object.entries(componentDraft.details).filter(([key])=>!['owner','responsible','sla','environment','security_zone','criticality','hostname','ip_address','os','version','location'].includes(key)).filter(([key])=>componentFieldGroup==='all'||(componentFieldGroup==='network'?componentNetworkKeys.has(key):componentFieldGroup==='system'?componentSystemKeys.has(key):!componentNetworkKeys.has(key)&&!componentSystemKeys.has(key))).map(([key,value])=><div key={key} className="componentFieldEditor"><label>{componentFieldLabels[key]||key}<input value={typeof value==='string'?value:JSON.stringify(value)??''} readOnly={value!==null&&typeof value==='object'} title={value!==null&&typeof value==='object'?'Сложное значение доступно только для просмотра':'Значение параметра'} onChange={e=>setComponentDraft(d=>({...d,details:{...d.details,[key]:e.target.value}}))}/></label><button type="button" onClick={()=>{if(!window.confirm('Удалить параметр «'+key+'»?'))return;setComponentDraft(d=>{const details={...d.details};delete details[key];return {...d,details}})}}>Удалить</button></div>)}<div className="componentFieldEditor"><label>Новый параметр<input placeholder="Например, версия ПО" value={newComponentField} onChange={e=>setNewComponentField(e.target.value)}/></label><button type="button" disabled={!newComponentField.trim()||Object.keys(componentDraft.details).includes(newComponentField.trim())} onClick={()=>{const key=newComponentField.trim();if(!key)return;setComponentDraft(d=>({...d,details:{...d.details,[key]:''}}));setNewComponentField('')}}>Добавить</button></div><div><button type="submit" className="primary" disabled={componentSaving||!componentDraft.name.trim()}>{componentSaving?'Сохранение…':'Сохранить'}</button><button type="button" onClick={()=>setComponentEditing(false)}>Отмена</button></div></form>}<p>{component.description||'Описание не заполнено'}</p><dl className="componentFacts"><dt>Система</dt><dd>{system?.name||'Не указана'}</dd><dt>Тип</dt><dd>{component.kind}</dd><dt>Контур</dt><dd>{String(component.details.environment||'Не указан')}</dd><dt>Родительский компонент</dt><dd>{infra.find(i=>i.id===component.parent_id)?.name||'Не указан'}</dd><dt>Зона безопасности</dt><dd>{String(component.details.security_zone||'Не указана')}</dd><dt>VRF</dt><dd>{String(component.details.vrf||'Не указан')}</dd></dl><h3>Дополнительные характеристики</h3>{Object.entries(component.details).filter(([key])=>!['environment','security_zone','vrf'].includes(key)).length?<dl className="componentFacts">{Object.entries(component.details).filter(([key])=>!['environment','security_zone','vrf'].includes(key)).map(([key,value])=><React.Fragment key={key}><dt>{key}</dt><dd>{value===null||value===undefined||value===''?'Не указано':typeof value==='object'?JSON.stringify(value):String(value)}</dd></React.Fragment>)}</dl>:<p className="hint">Дополнительные параметры пока не заполнены.</p>}<div className="componentInspectorStats"><span>Интерфейсы: {interfaces.length}</span><span>Входящие: {connected.filter(f=>f.target_id===component.id).length}</span><span>Исходящие: {connected.filter(f=>f.source_id===component.id).length}</span></div></section>}
          {componentInspectTab==='network'&&<section><h3>Сетевые интерфейсы</h3>{interfaces.length?interfaces.map(n=><article className="inspectorItem" key={n.id}><strong>{n.name} – {n.ip_address||'IP не указан'}</strong><small>VRF: {segments.find(x=>x.id===n.vrf_id)?.name||'Не указана'} · VLAN: {segments.find(x=>x.id===n.vlan_id)?.name||'Не указан'}</small><small>Зона: {segments.find(x=>x.id===n.zone_id)?.name||'Не указана'}</small></article>):<p>Интерфейсы пока не описаны.</p>}<button type="button" onClick={()=>{setComponentInspectId('');setLayer('topology')}}>Открыть топологию</button></section>}
          {componentInspectTab==='flows'&&<section><div className="componentFlowHeader"><h3>Известные зависимости</h3><button type="button" className="primary" onClick={()=>{editFlow();setFlowSource(component.id);setComponentInspectId('')}}>+ Создать исходящий поток</button><button type="button" onClick={()=>{editFlow();setFlowTarget(component.id);setComponentInspectId('')}}>+ Создать входящий поток</button></div>{connected.length?connected.map(f=>{const outgoing=f.source_id===component.id;const peer=infra.find(i=>i.id===(outgoing?f.target_id:f.source_id));return <article className="inspectorItem" key={f.id}><strong>{outgoing?'→ Исходящий':'← Входящий'}: {peer?.name||'Неизвестный компонент'}</strong><small>{f.name} · {f.protocol||'Протокол не указан'} · {f.port||'Порт не указан'} · {f.verification}</small><button type="button" onClick={()=>{setSelectedFlow(f.id);setComponentInspectId('');setLayer('flows')}}>Открыть поток</button>{peer&&<button type="button" onClick={()=>{setComponentInspectId(peer.id);setComponentInspectTab('passport')}}>Связанный компонент</button>}</article>}):<p>Описанных потоков нет – это не подтверждает отсутствие зависимостей.</p>}</section>}
          {componentInspectTab==='incidents'&&<Incidents request={request} systems={objects} components={infra} networks={segments} flows={flows} context={{entity_type:'component',entity_id:component.id}}/>}
        </div>
      </div>
    })()}
    {createObjectOpen&&<div className="editorBackdrop" onClick={()=>setCreateObjectOpen(false)}>
      <div className="editorDialog" role="dialog" aria-modal="true" aria-label="Создать объект архитектуры" onClick={event=>event.stopPropagation()}>
        <div className="dialogHead"><h2>Новый объект</h2><button type="button" onClick={()=>setCreateObjectOpen(false)}>Закрыть ×</button></div>
        <form className="detailForm" onSubmit={addObject}>
        
        <input aria-label="Название" placeholder="Название системы" value={name} onChange={e => setName(e.target.value)} required />
        <select aria-label="Тип" value={kind} onChange={e => setKind(e.target.value)}>
          <option value="system">ИТ-система</option><option value="process">Бизнес-процесс</option>
          <option value="database">База данных</option><option value="integration">Интеграция</option>
          <option value="service">Сервис</option><option value="other">Другое</option>
        </select>
        <textarea aria-label="Описание" placeholder="Описание (необязательно)" value={description} onChange={e => setDescription(e.target.value)} rows={3} />
        <button className="primary" disabled={busy}>+ Добавить</button>
      </form>
      </div>
    </div>}
    {registryOpen&&<div className="editorBackdrop" onClick={()=>setRegistryOpen(null)}>
      <div className="editorDialog registryDialog architectureDrawer" role="dialog" aria-modal="true" aria-label={registryOpen==='network'?'Редактор сети':'Редактор потока'} onClick={e=>e.stopPropagation()}>
        <div className="dialogHead"><h2>{registryOpen==='network'?(networkEditId?'Редактировать сеть':'Создать сеть'):(flowEditId?'Редактировать поток':'Создать поток')}</h2><button onClick={()=>setRegistryOpen(null)}>Закрыть ×</button></div>
        <form className="detailForm" onSubmit={saveRegistry}>
          {registryOpen==='network'?<>
            <label>Название<input required maxLength={250} value={networkName} onChange={e=>setNetworkName(e.target.value)}/></label>
            <label>Тип сети<select value={networkKind} onChange={e=>setNetworkKind(e.target.value)}><option value="zone">Зона</option><option value="vlan">VLAN</option><option value="vrf">VRF</option></select></label>
            <label>Описание<textarea value={networkDescription} onChange={e=>setNetworkDescription(e.target.value)}/></label>
            <label>Достоверность<select value={networkVerification} onChange={e=>setNetworkVerification(e.target.value)}><option value="draft">Черновик</option><option value="assumed">Предположение</option><option value="verified">Подтверждено</option></select></label>
          </>:<>
            {!flowEditId&&<label className="reverseFlowOption"><input type="checkbox" checked={multiExchange} onChange={e=>{setMultiExchange(e.target.checked);setCreateReverseFlow(false);if(e.target.checked){setExchangeSources(flowSource?[flowSource]:[]);setExchangeTargets(flowTarget?[flowTarget]:[])}}}/> Несколько источников и получателей</label>}
            {multiExchange&&!flowEditId?<div className="exchangeEndpoints"><p>Выберите участников. Будет создан отдельный направленный поток для каждой пары «источник → получатель».</p>{([['Источники',exchangeSources,setExchangeSources],['Получатели',exchangeTargets,setExchangeTargets]] as const).map(([title,values,setValues])=><fieldset key={title}><legend>{title}</legend>{infra.map(i=><label key={i.id}><input type="checkbox" checked={values.includes(i.id)} onChange={e=>setValues(e.target.checked?[...values,i.id]:values.filter(id=>id!==i.id))}/>{i.name}</label>)}</fieldset>)}</div>:<>
            <label>Источник<select required value={flowSource} onChange={e=>setFlowSource(e.target.value)}><option value="">Выберите компонент</option>{infra.map(i=><option key={i.id} value={i.id}>{i.name}</option>)}</select></label>
            <label>Получатель<select required value={flowTarget} onChange={e=>setFlowTarget(e.target.value)}><option value="">Выберите компонент</option>{infra.map(i=><option key={i.id} value={i.id}>{i.name}</option>)}</select></label>
            <div className="flowDirectionActions"><span>Направление обмена: <strong>{infra.find(i=>i.id===flowSource)?.name||'Источник'} → {infra.find(i=>i.id===flowTarget)?.name||'Получатель'}</strong></span><button type="button" disabled={!flowSource||!flowTarget} onClick={()=>{setFlowSource(flowTarget);setFlowTarget(flowSource);if(!flowEditId)setFlowName((infra.find(i=>i.id===flowTarget)?.name||'Источник')+' → '+(infra.find(i=>i.id===flowSource)?.name||'Получатель'))}}>⇄ Поменять направление</button></div>
            {!flowEditId&&!multiExchange&&<label className="reverseFlowOption"><input type="checkbox" checked={createReverseFlow} onChange={e=>setCreateReverseFlow(e.target.checked)}/> Создать также обратный поток (две независимые связи)</label>}
            </>}
            {multiExchange&&!flowEditId&&exchangeSources.length>0&&exchangeTargets.length>0&&<section className="exchangePairOverrides"><h3>Параметры отдельных потоков</h3><p>Поля ниже применяются к каждой связи независимо. Изначально используются общие значения; изменение одного потока не влияет на другие.</p>{exchangeSources.flatMap(source=>exchangeTargets.filter(target=>target!==source).map(target=>{const key=source+'|'+target;const base={protocol:flowProtocol,port:flowPort,security:flowSecurity,data_description:flowData,schedule:flowSchedule,verification:flowVerification};const current=exchangeOverrides[key]||base;const update=(field:keyof typeof base,value:string)=>setExchangeOverrides(prev=>({...prev,[key]:{...(prev[key]||base),[field]:value}}));return <details className="exchangePairCard" key={key}><summary>{infra.find(i=>i.id===source)?.name||source} → {infra.find(i=>i.id===target)?.name||target}{exchangeOverrides[key]?' · настроен':''}</summary><div className="formPair"><label>Протокол<input aria-label={'Протокол '+key} value={current.protocol} onChange={e=>update('protocol',e.target.value)}/></label><label>Порт<input aria-label={'Порт '+key} value={current.port} onChange={e=>update('port',e.target.value)}/></label></div><label>Состав данных<textarea value={current.data_description} onChange={e=>update('data_description',e.target.value)}/></label><label>Защита<select value={current.security} onChange={e=>update('security',e.target.value)}>{['unknown','TLS','mTLS','VPN','private_connector','none'].map(v=><option key={v}>{v}</option>)}</select></label><label>Периодичность<input value={current.schedule} onChange={e=>update('schedule',e.target.value)}/></label><label>Достоверность<select value={current.verification} onChange={e=>update('verification',e.target.value)}><option value="draft">Черновик</option><option value="assumed">Предположение</option><option value="verified">Подтверждено</option></select></label><button type="button" onClick={()=>setExchangeOverrides(prev=>{const next={...prev};delete next[key];return next})}>Вернуть общие значения</button></details>}))}</section>}
            <label>Название<input required value={flowName} onChange={e=>setFlowName(e.target.value)}/></label>
            <label>Состав данных<textarea value={flowData} onChange={e=>setFlowData(e.target.value)}/></label>
            <div className="formPair"><label>Протокол<input value={flowProtocol} onChange={e=>setFlowProtocol(e.target.value)}/></label><label>Порт<input value={flowPort} onChange={e=>setFlowPort(e.target.value)}/></label></div>
            <label>Защита<select value={flowSecurity} onChange={e=>setFlowSecurity(e.target.value)}>{['unknown','TLS','mTLS','VPN','private_connector','none'].map(v=><option key={v}>{v}</option>)}</select></label>
            <label>Периодичность<input value={flowSchedule} onChange={e=>setFlowSchedule(e.target.value)} placeholder="По событию, ежедневно…"/></label>
            <label>Достоверность<select value={flowVerification} onChange={e=>setFlowVerification(e.target.value)}><option value="draft">Черновик</option><option value="assumed">Предположение</option><option value="verified">Подтверждено</option></select></label>
          </>}
          {registryError&&<p role="alert" className="kisError">{registryError}</p>}
          <div className="registryFormActions">
            <button className="primary" disabled={registryBusy}>{registryBusy?'Сохранение…':'Сохранить'}</button>
            {(registryOpen==='flow'?Boolean(flowEditId):Boolean(networkEditId))&&<button type="button" className="dangerAction" disabled={registryBusy} onClick={()=>void deleteRegistryEntry()}>Удалить {registryOpen==='flow'?'поток':'сеть'}</button>}
          </div>
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
