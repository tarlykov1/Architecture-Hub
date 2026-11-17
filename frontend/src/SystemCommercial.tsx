import React, {useEffect,useMemo,useState} from 'react'
import './systemCommercial.css'

type AgreementType='purchase'|'subscription'|'support'|'development'|'other'
type LicenseType='named'|'concurrent'|'per_device'|'per_core'|'per_server'|'site'|'other'
type Agreement={
 id:string;system_id:string;title:string;contract_number:string;agreement_type:AgreementType
 vendor:string;contractor:string;start_date:string|null;end_date:string|null;renewal_date:string|null
 automatic_renewal:boolean;notice_days:number|null;support_level:string;support_window:string
 sla_response_hours:number|null;sla_availability_percent:number|null;support_contact:string;notes:string
}
type Entitlement={
 id:string;system_id:string;contract_id:string|null;product:string;license_type:LicenseType
 quantity:number;valid_from:string|null;valid_until:string|null;notes:string
}
type AgreementDraft=Omit<Agreement,'id'|'system_id'|'start_date'|'end_date'|'renewal_date'|'notice_days'|'sla_response_hours'|'sla_availability_percent'> & {
 start_date:string;end_date:string;renewal_date:string;notice_days:string
 sla_response_hours:string;sla_availability_percent:string
}
type LicenseDraft=Omit<Entitlement,'id'|'system_id'|'contract_id'|'quantity'|'valid_from'|'valid_until'> & {
 contract_id:string;quantity:string;valid_from:string;valid_until:string
}
const agreementTypes:Record<AgreementType,string>={purchase:'Покупка',subscription:'Подписка',support:'Техническая поддержка',development:'Разработка / внедрение',other:'Другое'}
const licenseTypes:Record<LicenseType,string>={named:'Именные (Named)',concurrent:'Конкурентные (Concurrent)',per_device:'На устройство',per_core:'На ядро',per_server:'На сервер',site:'Корпоративная / Site',other:'Другое'}
const emptyAgreement=():AgreementDraft=>({
 title:'',contract_number:'',agreement_type:'purchase',vendor:'',contractor:'',
 start_date:'',end_date:'',renewal_date:'',automatic_renewal:false,notice_days:'',
 support_level:'',support_window:'',sla_response_hours:'',sla_availability_percent:'',
 support_contact:'',notes:''
})
const emptyLicense=():LicenseDraft=>({
 contract_id:'',product:'',license_type:'named',quantity:'1',valid_from:'',valid_until:'',notes:''
})
const inputDate=(value:string|null|undefined)=>value||''
const formattedDate=(value:string|null|undefined)=>value?value.split('-').reverse().join('.'):'Не указана'
const due=(date:string|null|undefined)=>{
 if(!date)return null
 const days=Math.ceil((Date.parse(date+'T00:00:00Z')-Date.now())/86400000)
 if(!Number.isFinite(days))return null
 if(days<0)return 'Срок прошёл'
 if(days<=30)return 'В течение 30 дней'
 if(days<=90)return 'В течение 90 дней'
 return null
}

export default function SystemCommercial({systemId,readOnly,request}:{systemId:string;readOnly:boolean;request:<T>(url:string,init?:RequestInit)=>Promise<T>}){
 const [contracts,setContracts]=useState<Agreement[]>([])
 const [licenses,setLicenses]=useState<Entitlement[]>([])
 const [loading,setLoading]=useState(true)
 const [busy,setBusy]=useState(false)
 const [error,setError]=useState('')
 const [notice,setNotice]=useState('')
 const [editor,setEditor]=useState<'contract'|'license'|''>('')
 const [editingId,setEditingId]=useState('')
 const [contractDraft,setContractDraft]=useState<AgreementDraft>(emptyAgreement)
 const [licenseDraft,setLicenseDraft]=useState<LicenseDraft>(emptyLicense)
 const base='/api/systems/'+systemId
 useEffect(()=>{
  let active=true
  setLoading(true);setError('');setNotice('');setEditor('');setEditingId('')
  Promise.all([request<Agreement[]>(base+'/contracts'),request<Entitlement[]>(base+'/licenses')])
   .then(([a,b])=>{if(active){setContracts(a);setLicenses(b)}})
   .catch(e=>{if(active)setError('Не удалось загрузить договоры и лицензии: '+String(e))})
   .finally(()=>{if(active)setLoading(false)})
  return()=>{active=false}
 },[base,request])
 const contractById=useMemo(()=>new Map(contracts.map(c=>[c.id,c])),[contracts])
 const reload=async()=>{
  const [a,b]=await Promise.all([request<Agreement[]>(base+'/contracts'),request<Entitlement[]>(base+'/licenses')])
  setContracts(a);setLicenses(b)
 }
 const openContract=(record?:Agreement)=>{
  setError('');setNotice('');setEditor('contract');setEditingId(record?.id||'')
  setContractDraft(record?{
   ...record,start_date:inputDate(record.start_date),end_date:inputDate(record.end_date),
   renewal_date:inputDate(record.renewal_date),notice_days:record.notice_days==null?'':String(record.notice_days),
   sla_response_hours:record.sla_response_hours==null?'':String(record.sla_response_hours),
   sla_availability_percent:record.sla_availability_percent==null?'':String(record.sla_availability_percent)
  }:emptyAgreement())
 }
 const openLicense=(record?:Entitlement)=>{
  setError('');setNotice('');setEditor('license');setEditingId(record?.id||'')
  setLicenseDraft(record?{...record,contract_id:record.contract_id||'',quantity:String(record.quantity),valid_from:inputDate(record.valid_from),valid_until:inputDate(record.valid_until)}:emptyLicense())
 }
 const saveContract=async(event:React.FormEvent)=>{
  event.preventDefault();if(!contractDraft.title.trim()||busy)return
  setBusy(true);setError('')
  try{
   const data={
    ...contractDraft,title:contractDraft.title.trim(),
    start_date:contractDraft.start_date||null,end_date:contractDraft.end_date||null,
    renewal_date:contractDraft.renewal_date||null,
    notice_days:contractDraft.notice_days===''?null:Number(contractDraft.notice_days),
    sla_response_hours:contractDraft.sla_response_hours===''?null:Number(contractDraft.sla_response_hours),
    sla_availability_percent:contractDraft.sla_availability_percent===''?null:Number(contractDraft.sla_availability_percent),
   }
   const stored=await request<Agreement>(base+'/contracts'+(editingId?'/'+editingId:''),{method:editingId?'PUT':'POST',body:JSON.stringify(data)})
   setEditingId(stored.id) // A failed refresh must not create another agreement on retry.
   await reload();setEditor('');setEditingId('');setNotice('Договор сохранён')
  }catch(e){setError('Договор не сохранён: '+String(e))}
  finally{setBusy(false)}
 }
 const saveLicense=async(event:React.FormEvent)=>{
  event.preventDefault();if(!licenseDraft.product.trim()||busy)return
  setBusy(true);setError('')
  try{
   const data={...licenseDraft,product:licenseDraft.product.trim(),
    contract_id:licenseDraft.contract_id||null,quantity:Number(licenseDraft.quantity),
    valid_from:licenseDraft.valid_from||null,valid_until:licenseDraft.valid_until||null}
   const stored=await request<Entitlement>(base+'/licenses'+(editingId?'/'+editingId:''),{method:editingId?'PUT':'POST',body:JSON.stringify(data)})
   setEditingId(stored.id)
   await reload();setEditor('');setEditingId('');setNotice('Лицензия сохранена')
  }catch(e){setError('Лицензия не сохранена: '+String(e))}
  finally{setBusy(false)}
 }
 const remove=async(kind:'contracts'|'licenses',record:{id:string},name:string)=>{
  if(busy||!window.confirm('Удалить запись «'+name+'»? Операцию нельзя отменить.'))return
  setBusy(true);setError('')
  try{await request(base+'/'+kind+'/'+record.id,{method:'DELETE'});await reload();setNotice('Запись удалена')}
  catch(e){setError('Удаление не выполнено: '+String(e)+'. Если к договору привязаны лицензии, сначала отвяжите их.')}
  finally{setBusy(false)}
 }
 return <section className="systemCommercial" aria-label="Договоры и лицензии ИС">
  <p className="systemCommercialHint">Договоры, права использования и обязательства поставщиков. Не храните здесь лицензионные ключи, пароли и закрытые документы.</p>
  {loading&&<p role="status">Загружаю договорные сведения…</p>}
  {error&&<p className="systemCommercialError" role="alert">{error}</p>}
  {notice&&<p role="status">{notice}</p>}
  {!loading&&<div className="systemCommercialContent">
   <div className="systemCommercialHead"><h3>Договоры ({contracts.length})</h3>{!readOnly&&<button type="button" onClick={()=>openContract()}>+ Договор</button>}</div>
   {contracts.map(contract=>{
    const renewal=due(contract.renewal_date)
    const expiry=due(contract.end_date)
    const bound=licenses.filter(license=>license.contract_id===contract.id).length
    return <article className="systemCommercialCard" key={contract.id}>
     <strong>{contract.title}</strong>
     <small>{agreementTypes[contract.agreement_type]}{contract.contract_number?' · № '+contract.contract_number:''}</small>
     {(contract.vendor||contract.contractor)&&<p>Вендор: {contract.vendor||'—'}{contract.contractor?' · Подрядчик: '+contract.contractor:''}</p>}
     <p>Действует до: {formattedDate(contract.end_date)}{expiry&&<span className="systemCommercialDue"> · {expiry}</span>}</p>
     <p>Продление: {formattedDate(contract.renewal_date)}{renewal&&<span className="systemCommercialDue"> · {renewal}</span>}{contract.automatic_renewal?' · Автопродление':''}</p>
     {contract.notice_days!=null&&<p>Предупреждение за {contract.notice_days} дн.</p>}
     {(contract.support_level||contract.support_window)&&<p>Поддержка: {[contract.support_level,contract.support_window].filter(Boolean).join(' · ')}</p>}
     {contract.sla_response_hours!=null&&<p>SLA реакции: {contract.sla_response_hours} ч.</p>}
     {contract.sla_availability_percent!=null&&<p>SLA доступности: {contract.sla_availability_percent}%</p>}
     {contract.support_contact&&<p>Контакт поддержки: {contract.support_contact}</p>}
     {contract.notes&&<p>{contract.notes}</p>}
     {bound>0&&<small>Привязано лицензий: {bound}</small>}
     {!readOnly&&<div className="systemCommercialActions"><button type="button" onClick={()=>openContract(contract)}>Изменить договор</button><button type="button" disabled={busy||bound>0} title={bound?'Сначала отвяжите лицензии':''} onClick={()=>void remove('contracts',contract,contract.title)}>Удалить договор</button></div>}
    </article>
   })}
   {!contracts.length&&<p className="systemCommercialHint">Договоры пока не внесены.</p>}
   <div className="systemCommercialHead"><h3>Лицензии ({licenses.length})</h3>{!readOnly&&<button type="button" onClick={()=>openLicense()}>+ Лицензия</button>}</div>
   {licenses.map(license=>{
    const expiry=due(license.valid_until)
    return <article className="systemCommercialCard" key={license.id}>
     <strong>{license.product}</strong><small>{licenseTypes[license.license_type]} · {license.quantity} шт.</small>
     <p>Действует до: {formattedDate(license.valid_until)}{expiry&&<span className="systemCommercialDue"> · {expiry}</span>}</p>
     <p>Договор: {license.contract_id?(contractById.get(license.contract_id)?.title||'Связанный договор не найден'):'Не указан'}</p>
     {license.notes&&<p>{license.notes}</p>}
     {!readOnly&&<div className="systemCommercialActions"><button type="button" onClick={()=>openLicense(license)}>Изменить лицензию</button><button type="button" disabled={busy} onClick={()=>void remove('licenses',license,license.product)}>Удалить лицензию</button></div>}
    </article>
   })}
   {!licenses.length&&<p className="systemCommercialHint">Лицензии пока не внесены.</p>}
   {!readOnly&&editor==='contract'&&<form className="systemCommercialForm" aria-label="Редактор договора ИС" onSubmit={saveContract}>
    <h3>{editingId?'Редактирование договора':'Новый договор'}</h3>
    <label>Предмет / название договора<input required maxLength={250} value={contractDraft.title} onChange={e=>setContractDraft(p=>({...p,title:e.target.value}))}/></label>
    <label>Номер договора<input maxLength={120} value={contractDraft.contract_number} onChange={e=>setContractDraft(p=>({...p,contract_number:e.target.value}))}/></label>
    <label>Тип приобретения<select value={contractDraft.agreement_type} onChange={e=>setContractDraft(p=>({...p,agreement_type:e.target.value as AgreementType}))}>{Object.entries(agreementTypes).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label>
    <label>Вендор<input maxLength={250} value={contractDraft.vendor} onChange={e=>setContractDraft(p=>({...p,vendor:e.target.value}))}/></label>
    <label>Подрядчик / поставщик<input maxLength={250} value={contractDraft.contractor} onChange={e=>setContractDraft(p=>({...p,contractor:e.target.value}))}/></label>
    <label>Дата начала<input type="date" value={contractDraft.start_date} onChange={e=>setContractDraft(p=>({...p,start_date:e.target.value}))}/></label>
    <label>Дата окончания<input type="date" value={contractDraft.end_date} onChange={e=>setContractDraft(p=>({...p,end_date:e.target.value}))}/></label>
    <label>Дата продления<input type="date" value={contractDraft.renewal_date} onChange={e=>setContractDraft(p=>({...p,renewal_date:e.target.value}))}/></label>
    <label className="systemCommercialCheck"><input type="checkbox" checked={contractDraft.automatic_renewal} onChange={e=>setContractDraft(p=>({...p,automatic_renewal:e.target.checked}))}/>Автоматическое продление</label>
    <label>Уведомить о продлении за, дней<input type="number" min="0" max="365" value={contractDraft.notice_days} onChange={e=>setContractDraft(p=>({...p,notice_days:e.target.value}))}/></label>
    <label>Уровень поддержки<input maxLength={120} placeholder="Стандартная, расширенная, Premium…" value={contractDraft.support_level} onChange={e=>setContractDraft(p=>({...p,support_level:e.target.value}))}/></label>
    <label>Окно поддержки<input maxLength={120} placeholder="8×5, 24×7…" value={contractDraft.support_window} onChange={e=>setContractDraft(p=>({...p,support_window:e.target.value}))}/></label>
    <label>SLA: реакция, часов<input type="number" min="0" max="8760" step="any" value={contractDraft.sla_response_hours} onChange={e=>setContractDraft(p=>({...p,sla_response_hours:e.target.value}))}/></label>
    <label>SLA: доступность, %<input type="number" min="0" max="100" step="any" value={contractDraft.sla_availability_percent} onChange={e=>setContractDraft(p=>({...p,sla_availability_percent:e.target.value}))}/></label>
    <label>Контакт поддержки<input maxLength={250} value={contractDraft.support_contact} onChange={e=>setContractDraft(p=>({...p,support_contact:e.target.value}))}/></label>
    <label>Примечание<textarea maxLength={2000} value={contractDraft.notes} onChange={e=>setContractDraft(p=>({...p,notes:e.target.value}))}/></label>
    <div className="systemCommercialActions"><button type="submit" disabled={busy}>{busy?'Сохранение…':'Сохранить договор'}</button><button type="button" disabled={busy} onClick={()=>{setEditor('');setError('')}}>Отмена</button></div>
   </form>}
   {!readOnly&&editor==='license'&&<form className="systemCommercialForm" aria-label="Редактор лицензии ИС" onSubmit={saveLicense}>
    <h3>{editingId?'Редактирование лицензии':'Новая лицензия'}</h3>
    <label>Продукт / редакция<input required maxLength={250} value={licenseDraft.product} onChange={e=>setLicenseDraft(p=>({...p,product:e.target.value}))}/></label>
    <label>Тип лицензии<select value={licenseDraft.license_type} onChange={e=>setLicenseDraft(p=>({...p,license_type:e.target.value as LicenseType}))}>{Object.entries(licenseTypes).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label>
    <label>Количество<input type="number" min="1" max="100000000" required value={licenseDraft.quantity} onChange={e=>setLicenseDraft(p=>({...p,quantity:e.target.value}))}/></label>
    <label>Связанный договор<select value={licenseDraft.contract_id} onChange={e=>setLicenseDraft(p=>({...p,contract_id:e.target.value}))}><option value="">Без договора</option>{contracts.map(c=><option value={c.id} key={c.id}>{c.title}{c.contract_number?' № '+c.contract_number:''}</option>)}</select></label>
    <label>Дата начала лицензии<input type="date" value={licenseDraft.valid_from} onChange={e=>setLicenseDraft(p=>({...p,valid_from:e.target.value}))}/></label>
    <label>Дата окончания лицензии<input type="date" value={licenseDraft.valid_until} onChange={e=>setLicenseDraft(p=>({...p,valid_until:e.target.value}))}/></label>
    <label>Примечание<textarea maxLength={2000} value={licenseDraft.notes} onChange={e=>setLicenseDraft(p=>({...p,notes:e.target.value}))}/></label>
    <div className="systemCommercialActions"><button type="submit" disabled={busy}>{busy?'Сохранение…':'Сохранить лицензию'}</button><button type="button" disabled={busy} onClick={()=>{setEditor('');setError('')}}>Отмена</button></div>
   </form>}
  </div>}
 </section>
}
