export type PlaceFields={city:string;site:string;building:string;room:string;rack:string}
export type Place=PlaceFields & {id:string}
export const placeLabels:Record<keyof PlaceFields,string>={city:'Город',site:'Объект / площадка',building:'Офис / корпус',room:'Кабинет / помещение',rack:'Стойка'}
export const placeKeys=Object.keys(placeLabels) as (keyof PlaceFields)[]
export const emptyPlace:PlaceFields={city:'',site:'',building:'',room:'',rack:''}
export const placeName=(place:PlaceFields)=>placeKeys.map(key=>place[key]).filter(Boolean).join(' › ')
export type Equipment={location_id:string|null;model:string;inventory_number:string;serial_number:string;component_ids:string[]}
export const emptyEquipment:Equipment={location_id:null,model:'',inventory_number:'',serial_number:'',component_ids:[]}
export type Asset={id:string;name:string;kind:string;description:string;address:string;verification:string;equipment?:Equipment|null}
export const assetKinds:Record<string,string>={server:'Физический сервер',storage:'СХД',switch:'Коммутатор',router:'Маршрутизатор',access_point:'Точка доступа',firewall:'Межсетевой экран',waf:'WAF',ptaf:'PTAF',gateway:'Шлюз',load_balancer:'Балансировщик',vpn:'VPN',dmz:'DMZ',subnet:'Подсеть',other:'Другой объект'}
export type Request=<T>(url:string,init?:RequestInit)=>Promise<T>
