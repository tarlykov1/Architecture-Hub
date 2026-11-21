import {expect,test} from '@playwright/test'
import {interSystemExchanges,overviewExchangeLabel} from '../src/systemExchanges'
import {focusedSystemIds,focusedSystemPositions} from '../src/overviewFocus'

test('internal VM traffic never becomes an IS exchange or a self-loop',()=>{
 const components=[
  {id:'a1',system_id:'A',name:'NAU-PROD-VM-01'},
  {id:'a2',system_id:'A',name:'NAU-PROD-VM-06'},
  {id:'b1',system_id:'B',name:'Keycloak VM'},
  {id:'c1',system_id:'C',name:'Database VM'}
 ]
 const flows=[
  {id:'internal',source_id:'a1',target_id:'a2',name:'NAU-PROD-VM-01 → NAU-PROD-VM-06',data_description:'Репликация'},
  {id:'login',source_id:'a1',target_id:'b1',name:'Вход пользователей Naumen',data_description:'Авторизация'},
  {id:'lookup',source_id:'a2',target_id:'c1',name:'NAU-PROD-VM-06 → Database VM',data_description:'Сопоставление пользователей'},
  {id:'broken',source_id:'a1',target_id:'missing',name:'Unknown',data_description:''}
 ]
 const exchanges=interSystemExchanges(flows,components,new Set(['A','B','C']))
 expect(exchanges.map(x=>x.flow.id)).toEqual(['login','lookup'])
 expect(exchanges.map(x=>[x.source,x.target])).toEqual([['A','B'],['A','C']])
 expect(overviewExchangeLabel(flows[2],components)).toBe('Сопоставление пользователей')
 expect(overviewExchangeLabel(flows[1],components)).toBe('Вход пользователей Naumen')
 expect(overviewExchangeLabel({...flows[2],data_description:''},components)).toBe('Обмен данными')
})

test('focused IS shows only its one-hop partners with centered immutable presentation positions',()=>{
 const edges=[{source:'A',target:'B'},{source:'C',target:'A'},{source:'D',target:'E'}]
 expect([...focusedSystemIds('A',edges)].sort()).toEqual(['A','B','C'])
 const layout=focusedSystemPositions('A',edges,['A','B','C'])
 expect(layout['A'].x).toBeGreaterThan(layout['C'].x)
 expect(layout['A'].x).toBeLessThan(layout['B'].x)
 expect(layout['D']).toBeUndefined()
})
