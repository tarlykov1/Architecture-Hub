import React,{useCallback,useEffect,useState} from 'react'

import {assetKinds as kinds, emptyEquipment, emptyPlace, placeName, placeLabels, placeKeys, type Asset, type Place, type Request} from './equipment'

type Segment={id:string;name:string;kind:string;verification:string}
type Flow={id:string;name:string;source_id:string;target_id:string;verification:string}
type Component={id:string;name:string;system_id:string}
type Nic={id:string;item_id:string;name:string;ip_address:string;zone_id:string|null;vlan_id:string|null;vrf_id:string|null}
type Usage={flow_id:string;flow_name:string;asset_id:string|null;segment_id:string|null;position:number;verification:string}
type Hop={asset_id:string|null;segment_id:string|null;position:number;notes:string;verification:string;name?:string;kind?:string}
type FlowPath={flow_id:string;declared_only:boolean;hops:Hop[]}
type Props={security?:boolean;inventory?:boolean;systems?:{id:string;name:string}[];canEditAssets?:boolean;request:Request;flows:Flow[];components:Component[];interfaces:Nic[];segments:Segment[];initialFlowId:string;onClose:()=>void}
const emptyAsset={equipment:emptyEquipment,name:'',kind:'firewall',description:'',address:'',verification:'draft'}
const status:{[key:string]:string}={draft:'Черновик',assumed:'Предположение',verified:'Подтверждено'}

export default function NetworkPathCatalog({request,flows,components,interfaces,segments,initialFlowId,onClose,inventory=false,security=false,systems=[],canEditAssets=true}:Props){
  const [tab,setTab]=useState<'path'|'assets'|'security'>(inventory?'assets':security?'security':'path')
  const [flowId,setFlowId]=useState(initialFlowId||flows[0]?.id||'')
  const [assets,setAssets]=useState<Asset[]>([])
  const [usage,setUsage]=useState<Usage[]>([])
  const [hops,setHops]=useState<Hop[]>([])
  const [loading,setLoading]=useState(true)
  const [busy,setBusy]=useState(false)
  const [error,setError]=useState('')
  const [notice,setNotice]=useState('')
  const [dirty,setDirty]=useState(false)
  const [assetForm,setAssetForm]=useState(false)
  const [assetEditId,setAssetEditId]=useState('')
  const [assetDraft,setAssetDraft]=useState(emptyAsset)
  const [newTarget,setNewTarget]=useState('')
  const [places,setPlaces]=useState<Place[]>([])
  const [newPlace,setNewPlace]=useState(false)
  const [place,setPlace]=useState(emptyPlace)
  const [placeFilter,setPlaceFilter]=useState('')
  const [selectedAsset,setSelectedAsset]=useState('')
  const [assetQuery,setAssetQuery]=useState('')
  const flow=flows.find(f=>f.id===flowId)
  const source=components.find(c=>c.id===flow?.source_id)
  const target=components.find(c=>c.id===flow?.target_id)

  const loadAssets=useCallback(async()=>{
    try{const [a,u,p]=await Promise.all([request<Asset[]>('/api/network-assets'),request<Usage[]>('/api/network-paths/usage'),request<Place[]>('/api/network-assets/locations')]);setPlaces(p);setAssets(a);setUsage(u);setError('')}
    catch(e){setError('Не удалось загрузить сетевой реестр: '+String(e))}
  },[request])
  useEffect(()=>{void loadAssets()},[loadAssets])
  const loadRoute=!inventory||tab==='path'
  useEffect(()=>{
    if(!loadRoute||!flowId){setHops([]);setLoading(false);return}
    let active=true
    setLoading(true)
    request<FlowPath>('/api/flows/'+flowId+'/network-path')
      .then(path=>{if(active){
        if(!path||!Array.isArray(path.hops)){
          setHops([]);setError('Маршрут пока недоступен: сервер вернул неожиданный формат данных.');return
        }
        setHops(path.hops);setDirty(false);setError('')
      }})
      .catch(e=>{if(active){setError('Не удалось загрузить маршрут: '+String(e));setHops([])}})
      .finally(()=>{if(active)setLoading(false)})
    return()=>{active=false}
  },[request,flowId,loadRoute])
  function close(){if((dirty||assetForm&&assetDraft.name.trim())&&!window.confirm('Закрыть без сохранения изменений?'))return;onClose()}
  const entries=[...segments.map(s=>({value:'segment:'+s.id,label:s.name,kind:s.kind})),...assets.map(a=>({value:'asset:'+a.id,label:a.name,kind:a.kind}))]
  function addHop(){
    const match=entries.find(e=>e.value===newTarget)
    if(!match)return
    const [kind,id]=newTarget.split(':')
    if(hops.some(h=>kind==='asset'?h.asset_id===id:h.segment_id===id)){setError('Этот объект уже добавлен в маршрут');return}
    setHops(prev=>[...prev,{position:prev.length,asset_id:kind==='asset'?id:null,segment_id:kind==='segment'?id:null,notes:'',verification:'draft',name:match.label,kind:match.kind}])
    setDirty(true);setNewTarget('');setError('')
  }
  function updateHop(i:number,patch:Partial<Hop>){setHops(prev=>prev.map((h,j)=>i===j?{...h,...patch}:h));setDirty(true)}
  function moveHop(i:number,direction:number){const j=i+direction;if(j<0||j>=hops.length)return;setHops(prev=>{const next=[...prev];[next[i],next[j]]=[next[j],next[i]];return next.map((hop,k)=>({...hop,position:k}))});setDirty(true)}
  function removeHop(i:number){setHops(prev=>prev.filter((_,j)=>i!==j).map((hop,k)=>({...hop,position:k})));setDirty(true)}
  async function savePath(){
    if(!flowId)return
    setBusy(true);setError('')
    try{
      const payload=hops.map((h,i)=>({asset_id:h.asset_id,segment_id:h.segment_id,position:i,notes:h.notes,verification:h.verification}))
      await request('/api/flows/'+flowId+'/network-path',{method:'PUT',body:JSON.stringify(payload)})
      setDirty(false);setNotice('Маршрут сохранён как заявленная техническая модель');setUsage(await request<Usage[]>('/api/network-paths/usage'))
    }catch(e){setError('Не удалось сохранить маршрут: '+String(e))}finally{setBusy(false)}
  }
  function editAsset(asset?:Asset){setNewPlace(false);setPlace(emptyPlace);setAssetEditId(asset?.id||'');setAssetDraft(asset?{equipment:asset.equipment||emptyEquipment,name:asset.name,kind:asset.kind,description:asset.description,address:asset.address,verification:asset.verification}:{...emptyAsset,kind:inventory?'server':'firewall'});setAssetForm(true);setTab('assets')}
  async function saveAsset(event:React.FormEvent){
    event.preventDefault();setBusy(true);setError('')
    try{
      let equipment=assetDraft.equipment
      if(newPlace){
        const created=await request<Place>('/api/network-assets/locations',{method:'POST',body:JSON.stringify(place)})
        equipment={...equipment,location_id:created.id}
        setPlaces(current=>current.some(p=>p.id===created.id)?current:[...current,created])
        setAssetDraft({...assetDraft,equipment});setNewPlace(false)
      }
      await request('/api/network-assets'+(assetEditId?'/'+assetEditId:''),{method:assetEditId?'PUT':'POST',body:JSON.stringify({...assetDraft,equipment})})
      setAssetForm(false);setAssetEditId('');setNotice('Сетевой объект сохранён');await loadAssets()
    }catch(e){setError('Не удалось сохранить объект: '+String(e))}finally{setBusy(false)}
  }
  const endpoint=(item:Component|undefined)=>{
    if(!item)return 'Компонент неизвестен'
    const nic=interfaces.filter(n=>n.item_id===item.id)
    const label=(id:string|null)=>segments.find(s=>s.id===id)?.name||'—'
    return nic.length?nic.map(n=>n.name+': '+(n.ip_address||'IP не задан')+' · '+['VRF '+label(n.vrf_id),'VLAN '+label(n.vlan_id),'зона '+label(n.zone_id)].join(' · ')).join('; '):'Сетевые интерфейсы не описаны'
  }
  function openUsage(flow:string){if(dirty&&!window.confirm('Отменить несохранённые изменения маршрута?'))return;setTab('path');setFlowId(flow);setDirty(false);setNotice('')}
  function hopName(h:Hop){return assets.find(a=>a.id===h.asset_id)?.name||segments.find(s=>s.id===h.segment_id)?.name||h.name||'Неизвестный объект'}
  const visibleAssets=assets.filter(a=>{const p=places.find(p=>p.id===a.equipment?.location_id);return (!placeFilter||placeFilter===(p?.id||'unassigned'))&&[a.name,kinds[a.kind],a.description,a.equipment?.model,a.equipment?.serial_number,a.equipment?.inventory_number,p&&placeName(p)].join(' ').toLowerCase().includes(assetQuery.toLowerCase())})
  return <div className={inventory?'equipmentWorkspace':'architectureDrawerBackdrop'} onMouseDown={e=>{if(!inventory&&e.target===e.currentTarget)close()}}>
    <section className={inventory?'equipmentRegistry':'architectureDrawer networkPathDrawer'} role={inventory?'region':'dialog'} aria-modal={inventory?undefined:true} aria-label={inventory?'Оборудование':'Технический маршрут потока'}>
      <div className="networkPathHead"><div><h2>{inventory?'Реестр оборудования':'Маршрут потока'}</h2></div><button type="button" onClick={close} aria-label={inventory?undefined:'Закрыть маршрут'}>{inventory?'К реестру ИС':'Закрыть ×'}</button></div>
      {!inventory&&<p className="hint">Здесь фиксируется заявленная последовательность сетевых объектов. Она не доказывает фактическую доступность и прохождение трафика.</p>}
      {error&&<p role="alert" className="kisError">{error}</p>}{notice&&<p role="status" className="hint">{notice}</p>}
      {(!inventory||tab==='path')&&<div className="networkPathTabs" role="tablist" aria-label="Инфраструктурные данные">
        <button type="button" role="tab" aria-selected={tab==='path'} className={tab==='path'?'current':''} onClick={()=>setTab('path')}>Маршрут данных</button>
        <button type="button" role="tab" aria-selected={tab==='assets'} className={tab==='assets'?'current':''} onClick={()=>setTab('assets')}>Справочник объектов ({assets.length})</button>
        {!inventory&&<button type="button" role="tab" aria-selected={tab==='security'} onClick={()=>setTab('security')}>СЗИ потока</button>}
      </div>}
      {tab==='security'&&<section><h3>Средства защиты в маршруте</h3><label>Поток<select value={flowId} onChange={e=>{if(!dirty||window.confirm('Отменить изменения маршрута?')){setDirty(false);setFlowId(e.target.value)}}}>{flows.map(f=><option key={f.id} value={f.id}>{f.name}</option>)}</select></label>{loading?<p>Загрузка…</p>:hops.some(h=>['firewall','waf','ptaf','vpn'].includes(assets.find(a=>a.id===h.asset_id)?.kind||''))?<ol>{hops.filter(h=>['firewall','waf','ptaf','vpn'].includes(assets.find(a=>a.id===h.asset_id)?.kind||'')).map(h=><li key={h.asset_id}>{hopName(h)}</li>)}</ol>:<p>Для этого маршрута средства защиты не указаны.</p>}<button onClick={()=>setTab('path')}>Открыть маршрут</button></section>}
      {tab==='path'&&<>
        <label className="networkPathField">Поток<select aria-label="Поток для сетевого маршрута" value={flowId} onChange={e=>{if(dirty&&!window.confirm('Отменить изменения текущего маршрута?'))return;setFlowId(e.target.value);setDirty(false);setNotice('')}}><option value="">Выберите поток</option>{flows.map(f=><option key={f.id} value={f.id}>{f.name}</option>)}</select></label>
        {flow&&<div className="networkPathEndpoints"><div><strong>{source?.name||'Источник не указан'}</strong><small>{endpoint(source)}</small></div><span>→</span><div><strong>{target?.name||'Получатель не указан'}</strong><small>{endpoint(target)}</small></div></div>}
        {loading?<p role="status">Загрузка маршрута…</p>:flow&&<>
          <div className="networkPathSteps" role="region" aria-label="Шаги технического маршрута">
            {hops.map((hop,i)=><article className="networkPathStep" key={(hop.asset_id||hop.segment_id||'')+i}><div className="networkPathStepHeader"><strong>{i+1}. {hopName(hop)}</strong><span>{hop.kind||entries.find(e=>e.value.endsWith(hop.asset_id||hop.segment_id||''))?.kind||'объект'}</span></div><label>Примечание<input aria-label={'Примечание шага '+(i+1)} value={hop.notes} onChange={e=>updateHop(i,{notes:e.target.value})}/></label><label>Достоверность<select aria-label={'Достоверность шага '+(i+1)} value={hop.verification} onChange={e=>updateHop(i,{verification:e.target.value})}>{Object.entries(status).map(([id,label])=><option key={id} value={id}>{label}</option>)}</select></label><div className="networkPathStepActions"><button type="button" disabled={i===0} onClick={()=>moveHop(i,-1)}>↑ Выше</button><button type="button" disabled={i===hops.length-1} onClick={()=>moveHop(i,1)}>↓ Ниже</button><button type="button" onClick={()=>removeHop(i)}>Удалить из маршрута</button></div></article>)}
            {!hops.length&&<p className="hint">Промежуточные объекты не описаны. Это не означает прямое сетевое соединение.</p>}
          </div>
          <div className="networkPathAdd"><label>Добавить участок<select aria-label="Добавить объект в маршрут" value={newTarget} onChange={e=>setNewTarget(e.target.value)}><option value="">Выберите VRF, VLAN, зону или средство защиты</option>{entries.map(entry=><option key={entry.value} value={entry.value}>{entry.kind.toUpperCase()} · {entry.label}</option>)}</select></label><button type="button" disabled={!newTarget} onClick={addHop}>+ Добавить</button></div>
          <div className="networkPathSave"><button type="button" onClick={()=>{editAsset()}}>+ Новый сетевой объект</button><button type="button" className="primary" disabled={!dirty||busy} onClick={()=>void savePath()}>{busy?'Сохранение…':dirty?'Сохранить маршрут':'Изменений нет'}</button></div>
        </>}
      </>}
      {tab==='assets'&&<>
        <div className="networkPathCatalogSearch"><input type="search" aria-label="Поиск сетевых объектов" placeholder="Название, вид, назначение…" value={assetQuery} onChange={e=>setAssetQuery(e.target.value)}/><select aria-label="Место оборудования" value={placeFilter} onChange={e=>setPlaceFilter(e.target.value)}><option value="">Все места</option><option value="unassigned">Без места</option>{places.map(p=><option key={p.id} value={p.id}>{placeName(p)}</option>)}</select>{canEditAssets&&<button type="button" onClick={()=>editAsset()}>+ Объект</button>}</div>
        {assetForm&&<form className="networkPathAssetForm" onSubmit={saveAsset}><h3>{assetEditId?'Редактировать объект':'Новый сетевой объект'}</h3><label>Название<input required maxLength={250} value={assetDraft.name} onChange={e=>setAssetDraft({...assetDraft,name:e.target.value})}/></label><label>Тип<select value={assetDraft.kind} onChange={e=>setAssetDraft({...assetDraft,kind:e.target.value})}>{Object.entries(kinds).map(([kind,label])=><option key={kind} value={kind}>{label}</option>)}</select></label><label>Место<select aria-label="Размещение оборудования" value={newPlace?'new':assetDraft.equipment.location_id||''} onChange={e=>{setNewPlace(e.target.value==='new');if(e.target.value!=='new')setAssetDraft({...assetDraft,equipment:{...assetDraft.equipment,location_id:e.target.value||null}})}}><option value="">Не указано</option>{places.map(p=><option key={p.id} value={p.id}>{placeName(p)}</option>)}<option value="new">＋ Новое место</option></select></label>
          {newPlace&&<fieldset><legend>Новое место</legend>{placeKeys.map(key=><label key={key}>{placeLabels[key]}<input maxLength={120} value={place[key]} onChange={e=>setPlace({...place,[key]:e.target.value})}/></label>)}</fieldset>}
          {([['model','Модель'],['inventory_number','Инвентарный номер'],['serial_number','Серийный номер']] as const).map(([key,label])=><label key={key}>{label}<input maxLength={key==='model'?200:120} value={assetDraft.equipment[key]} onChange={e=>setAssetDraft({...assetDraft,equipment:{...assetDraft.equipment,[key]:e.target.value}})}/></label>)}
          <label>Связанные компоненты<select multiple aria-label="Связанные компоненты" value={assetDraft.equipment.component_ids} onChange={e=>setAssetDraft({...assetDraft,equipment:{...assetDraft.equipment,component_ids:Array.from(e.target.selectedOptions,o=>o.value)}})}>{components.map(c=><option key={c.id} value={c.id}>{systems.find(s=>s.id===c.system_id)?.name} · {c.name}</option>)}</select></label><label>Адрес, CIDR или идентификатор<input maxLength={120} value={assetDraft.address} onChange={e=>setAssetDraft({...assetDraft,address:e.target.value})} placeholder="Только технические метаданные"/></label><label>Назначение / описание<textarea value={assetDraft.description} maxLength={2000} onChange={e=>setAssetDraft({...assetDraft,description:e.target.value})}/></label><label>Достоверность<select value={assetDraft.verification} onChange={e=>setAssetDraft({...assetDraft,verification:e.target.value})}>{Object.entries(status).map(([id,label])=><option key={id} value={id}>{label}</option>)}</select></label><div><button type="button" onClick={()=>setAssetForm(false)}>Отмена</button><button className="primary" disabled={busy}>{busy?'Сохранение…':'Сохранить объект'}</button></div></form>}
        {inventory?<div className="equipmentTableScroll"><table className="equipmentTable"><thead><tr>
          {['Устройство','Тип','Модель','Размещение','Инв. номер','Серийный номер','Связанные компоненты','Маршруты',''].map(label=><th key={label}>{label}</th>)}
        </tr></thead><tbody>{visibleAssets.map(asset=>{
          const profile=asset.equipment
          const location=places.find(p=>p.id===profile?.location_id)
          const routes=usage.filter(u=>u.asset_id===asset.id)
          return <React.Fragment key={asset.id}><tr><th scope="row"><button className="entityName" aria-expanded={selectedAsset===asset.id} onClick={()=>setSelectedAsset(selectedAsset===asset.id?'':asset.id)}>{asset.name}</button></th><td>{kinds[asset.kind]||asset.kind}</td>
            <td>{profile?.model||'—'}</td><td>{location?placeName(location):'—'}</td>
            <td>{profile?.inventory_number||'—'}</td><td>{profile?.serial_number||'—'}</td>
            <td>{components.filter(c=>profile?.component_ids.includes(c.id)).map(c=>c.name).join(', ')||'—'}</td>
            <td>{routes.length?routes.map(u=><button key={u.flow_id} onClick={()=>openUsage(u.flow_id)}>{u.flow_name}</button>):'—'}</td>
            <td>{canEditAssets&&<button onClick={()=>editAsset(asset)}>Редактировать</button>}</td></tr>{selectedAsset===asset.id&&<tr><td colSpan={9}><section aria-label={'Карточка устройства '+asset.name}><strong>{asset.name}</strong><p>{asset.description||'Назначение не указано'}</p><p>{[asset.address,location&&placeName(location),profile?.model,status[asset.verification]].filter(Boolean).join(' · ')}</p><button onClick={()=>setSelectedAsset('')}>Свернуть карточку</button></section></td></tr>}</React.Fragment>
        })}</tbody></table>{!visibleAssets.length&&<p>Оборудование не найдено.</p>}</div>:<div className="networkPathRegistry">{visibleAssets.map(a=><article key={a.id}><div><strong>{a.name}</strong><small>{kinds[a.kind]||a.kind} · {status[a.verification]||a.verification}</small></div><small>{places.filter(p=>p.id===a.equipment?.location_id).map(placeName).join('')}</small><small>{[a.equipment?.model,a.equipment?.inventory_number&&'Инв. '+a.equipment.inventory_number,a.equipment?.serial_number&&'S/N '+a.equipment.serial_number].filter(Boolean).join(' · ')}</small><p>{a.description||'Назначение не описано'}{a.address?' · '+a.address:''}</p><small>Упоминаний в маршрутах: {usage.filter(u=>u.asset_id===a.id).length}</small><div className="networkPathUsageLinks">{usage.filter(u=>u.asset_id===a.id).map(u=><button type="button" key={u.flow_id} onClick={()=>openUsage(u.flow_id)}>{u.flow_name} · шаг {u.position+1}</button>)}</div>{canEditAssets&&<button type="button" onClick={()=>editAsset(a)}>Редактировать</button>}</article>)}{!assets.length&&<p className="hint">В справочнике пока нет объектов. VRF, VLAN и зоны используются из существующего сетевого реестра.</p>}</div>}
        {!inventory&&<><h3>Существующие VRF, VLAN и зоны</h3>
        <p className="hint">Редактируются в «Реестре сетей». Здесь видно, в каких маршрутах они зарегистрированы.</p>
        <div className="networkPathRegistry">{segments.filter(seg=>(seg.name+' '+seg.kind).toLowerCase().includes(assetQuery.toLowerCase())).map(seg=><article key={seg.id}><div><strong>{seg.name}</strong><small>{seg.kind.toUpperCase()} · {status[seg.verification]||seg.verification}</small></div><small>Упоминаний в маршрутах: {usage.filter(u=>u.segment_id===seg.id).length}</small><div className="networkPathUsageLinks">{usage.filter(u=>u.segment_id===seg.id).map(u=><button type="button" key={u.flow_id} onClick={()=>openUsage(u.flow_id)}>{u.flow_name} · шаг {u.position+1}</button>)}</div></article>)}</div></>}
      </>}
    </section>
  </div>
}
