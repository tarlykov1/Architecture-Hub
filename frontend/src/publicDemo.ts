/** Public, synthetic-only demo. Never fetch production API data without a token. */
const ids={
 systemA:'11111111-1111-4111-8111-111111111111',
 systemB:'22222222-2222-4222-8222-222222222222',
 vmA:'33333333-3333-4333-8333-333333333333',
 vmB:'44444444-4444-4444-8444-444444444444',
 vmC:'55555555-5555-4555-8555-555555555555',
 flow:'66666666-6666-4666-8666-666666666666',
 zone:'77777777-7777-4777-8777-777777777777',
 nic:'88888888-8888-4888-8888-888888888888',
}
const objects=[
 {id:ids.systemA,kind:'system',name:'Демо: портал сотрудников',description:'Вымышленная система для знакомства с редактором',status:'active',attributes:{}},
 {id:ids.systemB,kind:'system',name:'Демо: каталог персонала',description:'Синтетический источник данных',status:'active',attributes:{}},
]
const infra=[
 {id:ids.vmA,system_id:ids.systemA,parent_id:null,kind:'vm',name:'DEMO-WEB-01',description:'Веб-сервер портала',details:{purpose:'Frontend',environment:'DEMO'}},
 {id:ids.vmB,system_id:ids.systemA,parent_id:null,kind:'vm',name:'DEMO-API-01',description:'Сервис API',details:{purpose:'Backend',environment:'DEMO'}},
 {id:ids.vmC,system_id:ids.systemB,parent_id:null,kind:'vm',name:'DEMO-DIR-01',description:'Каталог сотрудников (вымышленные данные)',details:{purpose:'Directory',environment:'DEMO'}},
]
const data:Record<string,unknown>={
 '/api/objects':objects,
 '/api/relations':[],
 '/api/diagrams':[],
 '/api/infra':infra,
 '/api/flows':[{id:ids.flow,source_id:ids.vmA,target_id:ids.vmB,name:'Демо: запросы портала',data_description:'Синтетические запросы',protocol:'HTTPS',port:'443',security:'TLS',schedule:'online',verification:'draft'}],
 '/api/networks':[{id:ids.zone,name:'DEMO-ZONE',kind:'zone',description:'Вымышленная зона',verification:'draft'}],
 '/api/network-interfaces':[{id:ids.nic,item_id:ids.vmA,name:'eth0',ip_address:'',zone_id:ids.zone,vlan_id:null,vrf_id:null}],
 '/api/business/categories':[],
 '/api/business/processes':[],
 '/api/business/system-links':[],
 '/api/views':[],
 '/api/knowledge/status':{configured:false},
 '/api/knowledge/links':[],
 '/api/knowledge/pages':[],
 '/api/incidents':[],
 '/api/data-attributes':[],
 '/api/flow-data-uses':[],
 '/api/network-assets':[],
}
export function publicDemoResponse(url:string):unknown{
 const pathname=url.split('?')[0]
 if(pathname==='/api/health')return {status:'ok'}
 // The network path endpoint returns an object, never an array. Demo paths
 // are intentionally unconfigured, but the drawer must remain usable.
 if(/^\/api\/flows\/[^/]+\/network-path$/.test(pathname))return {
   flow_id:pathname.split('/')[3],declared_only:true,hops:[]
 }
 if(pathname==='/api/network-paths/usage')return []
 if(pathname in data)return data[pathname]
 // Never fall through to the real API while browsing anonymously.
 return []
}
