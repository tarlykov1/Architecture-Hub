import {test,expect} from '@playwright/test'
import {groupComponents} from '../src/componentGroups'

const items=[
 {id:'a',environment:'PROD',zone:'DMZ'},
 {id:'b',environment:'PROD',zone:'LAN'},
 {id:'c',environment:'TEST',zone:'LAN'},
 {id:'d',environment:'',zone:''},
]
const flows=[
 {id:'ab',source_id:'a',target_id:'b'},
 {id:'ac',source_id:'a',target_id:'c'},
 {id:'ac2',source_id:'a',target_id:'c'},
 {id:'ca',source_id:'c',target_id:'a'},
 {id:'bc',source_id:'b',target_id:'c'},
 {id:'unknown',source_id:'missing',target_id:'b'},
]
test('environment groups preserve members and directed independent flow ids',()=>{
 const grouped=groupComponents(items,flows,'environment')
 expect(grouped.nodes.map(x=>[x.label,x.memberIds.length])).toEqual([['Не указано',1],['PROD',2],['TEST',1]])
 expect(grouped.edges.map(e=>[e.source,e.target,e.count])).toEqual([
  ['group:PROD','group:TEST',3],['group:TEST','group:PROD',1],
 ])
 expect(grouped.edges.find(e=>e.source==='group:PROD')?.flowIds).toEqual(['ac','ac2','bc'])
 expect(grouped.edges.reduce((n,e)=>n+e.count,0)).toBe(4)
})
test('network zones regroup without modifying source records or showing internal links',()=>{
 const original=JSON.stringify({items,flows})
 const grouped=groupComponents(items,flows,'zone')
 expect(grouped.nodes.find(g=>g.label==='LAN')?.memberIds).toEqual(['b','c'])
 expect(grouped.edges.some(e=>e.source===e.target)).toBe(false)
 expect(grouped.edges.find(e=>e.source==='group:DMZ'&&e.target==='group:LAN')?.count).toBe(3)
 expect(JSON.stringify({items,flows})).toBe(original)
})
