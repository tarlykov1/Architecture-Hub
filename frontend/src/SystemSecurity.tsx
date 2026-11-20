import type {ReactNode} from 'react'

/**
 * Classification metadata only. Never store actual subjects' personal data.
 * A missing profile is UNKNOWN, not evidence that the system processes no PD.
 */
export type PersonalDataStatus='unknown'|'yes'|'no'
export type PdnProtectionLevel=''|'UZ1'|'UZ2'|'UZ3'|'UZ4'
export type GisProtectionClass=''|'K1'|'K2'|'K3'|'not_applicable'
export type PersonalDataCategory='general'|'special'|'biometric'|'other'
export type SystemSecurityProfile={
  personal_data:PersonalDataStatus
  pdn_level:PdnProtectionLevel
  gis_class:GisProtectionClass
  internal_class:string
  categories:PersonalDataCategory[]
  verification:'unverified'|'verified'
  notes:string
}
export const EMPTY_SECURITY_PROFILE:SystemSecurityProfile={
  personal_data:'unknown',
  pdn_level:'',
  gis_class:'',
  internal_class:'',
  categories:[],
  verification:'unverified',
  notes:'',
}
const personalDataText:Record<PersonalDataStatus,string>={
  unknown:'Не выяснено',yes:'Обрабатываются',no:'Не обрабатываются',
}
const categories:ReadonlyArray<{id:PersonalDataCategory;label:string}>=[
  {id:'general',label:'Общие ПДн'},
  {id:'special',label:'Специальные категории'},
  {id:'biometric',label:'Биометрические ПДн'},
  {id:'other',label:'Иные категории'},
]
const values=<T extends string>(options:readonly T[],candidate:unknown,fallback:T):T=>
  typeof candidate==='string'&&options.includes(candidate as T)?candidate as T:fallback

export function readSystemSecurity(attributes:Record<string,unknown>|null|undefined):SystemSecurityProfile{
  const raw=attributes?.security_profile
  if(!raw||typeof raw!=='object'||Array.isArray(raw))return {...EMPTY_SECURITY_PROFILE,categories:[]}
  const input=raw as Record<string,unknown>
  const personal_data=values(['unknown','yes','no'] as const,input.personal_data,'unknown')
  const pdn_level=personal_data==='yes'?values(['','UZ1','UZ2','UZ3','UZ4'] as const,input.pdn_level,''):''
  const rawCategories=Array.isArray(input.categories)?input.categories:[]
  return {
    personal_data,
    pdn_level,
    gis_class:values(['','K1','K2','K3','not_applicable'] as const,input.gis_class,''),
    internal_class:typeof input.internal_class==='string'?input.internal_class:'',
    categories:personal_data==='yes'?categories.filter(item=>rawCategories.includes(item.id)).map(item=>item.id):[],
    verification:values(['unverified','verified'] as const,input.verification,'unverified'),
    notes:typeof input.notes==='string'?input.notes:'',
  }
}

export const pdnLevelLabel=(level:PdnProtectionLevel)=>level?level.replace('UZ','УЗ-'):'Не определён'
export const gisClassLabel=(value:GisProtectionClass)=>value==='not_applicable'?'Не применяется':value?value.replace(/^K/,'К'):'Не указан'

export function SystemSecurityMarker({profile}: {profile:SystemSecurityProfile}){
  return <span className={'systemSecurityMarker systemSecurityMarker-'+profile.personal_data}
    title={profile.verification==='verified'?'Подтверждено ответственным':'Требует подтверждения'}>
    ПДн: {personalDataText[profile.personal_data]}
  </span>
}

export function SystemSecuritySummary({profile,actions}:{
  profile:SystemSecurityProfile;actions?:ReactNode
}){
  return <section className="systemSecuritySummary" aria-label="ПДн и классы защиты">
    <div className="systemSecuritySummaryHead"><strong>Информационная безопасность</strong>{actions}</div>
    <div className="systemSecuritySummaryGrid">
      <div><small>Персональные данные</small><SystemSecurityMarker profile={profile}/></div>
      <div><small>Уровень защищённости ПДн</small><strong>{profile.personal_data==='yes'?pdnLevelLabel(profile.pdn_level):'Не применяется / не определён'}</strong></div>
      <div><small>Класс защищённости ГИС</small><strong>{gisClassLabel(profile.gis_class)}</strong></div>
      <div><small>Внутренний класс ИБ</small><strong>{profile.internal_class||'Не указан'}</strong></div>
      <div><small>Статус сведений</small><strong>{profile.verification==='verified'?'Подтверждены':'Требуют подтверждения'}</strong></div>
    </div>
    {profile.personal_data==='yes'&&profile.categories.length>0&&
      <p>Категории ПДн: {categories.filter(item=>profile.categories.includes(item.id)).map(item=>item.label).join(', ')}</p>}
    {profile.notes&&<p className="systemSecurityNotes">{profile.notes}</p>}
    <small className="systemSecurityCaution">Это сведения реестра, а не результат автоматической проверки соответствия требованиям ИБ.</small>
  </section>
}

export function SystemSecurityEditor({value,onChange}:{value:SystemSecurityProfile;onChange:(value:SystemSecurityProfile)=>void}){
  const set=<K extends keyof SystemSecurityProfile>(key:K,next:SystemSecurityProfile[K])=>onChange({...value,[key]:next})
  return <fieldset className="systemSecurityEditor">
    <legend>Информационная безопасность</legend>
    <p className="hint">Фиксируйте признаки обработки ПДн и утверждённые уровни/классы защиты. Сами персональные данные в паспорт не вводите.</p>
    <label>Персональные данные
      <select aria-label="Персональные данные" value={value.personal_data} onChange={event=>{
        const next=event.target.value as PersonalDataStatus
        onChange({...value,personal_data:next,...(next==='yes'?{}:{pdn_level:'',categories:[]})})
      }}>
        <option value="unknown">Не выяснено</option><option value="yes">Обрабатываются</option><option value="no">Не обрабатываются</option>
      </select>
    </label>
    <label>Уровень защищённости ПДн
      <select aria-label="Уровень защищённости ПДн" disabled={value.personal_data!=='yes'} value={value.pdn_level} onChange={event=>set('pdn_level',event.target.value as PdnProtectionLevel)}>
        <option value="">Не определён</option><option value="UZ1">УЗ-1</option><option value="UZ2">УЗ-2</option><option value="UZ3">УЗ-3</option><option value="UZ4">УЗ-4</option>
      </select>
    </label>
    {value.personal_data==='yes'&&<fieldset className="systemSecurityCategories">
      <legend>Категории ПДн (без данных конкретных людей)</legend>
      {categories.map(item=><label key={item.id}>
        <input type="checkbox" checked={value.categories.includes(item.id)}
          onChange={event=>set('categories',event.target.checked?[...value.categories,item.id]:value.categories.filter(id=>id!==item.id))}/>
        {item.label}
      </label>)}
    </fieldset>}
    <label>Класс защищённости ГИС (если применимо)
      <select aria-label="Класс защищённости ГИС" value={value.gis_class} onChange={event=>set('gis_class',event.target.value as GisProtectionClass)}>
        <option value="">Не указан</option><option value="K1">К1</option><option value="K2">К2</option><option value="K3">К3</option><option value="not_applicable">Не применяется</option>
      </select>
    </label>
    <label>Внутренний класс ИБ
      <input aria-label="Внутренний класс ИБ" maxLength={80} placeholder="По классификации организации" value={value.internal_class} onChange={event=>set('internal_class',event.target.value)}/>
    </label>
    <label>Достоверность сведений
      <select aria-label="Достоверность сведений ИБ" value={value.verification} onChange={event=>set('verification',event.target.value as SystemSecurityProfile['verification'])}>
        <option value="unverified">Требуют подтверждения</option><option value="verified">Подтверждены ответственным</option>
      </select>
    </label>
    <label>Основание / примечание
      <textarea aria-label="Примечание по ИБ" maxLength={1000} rows={2} placeholder="Документ классификации, дата проверки, ответственное подразделение – без персональных данных" value={value.notes} onChange={event=>set('notes',event.target.value)}/>
    </label>
  </fieldset>
}
