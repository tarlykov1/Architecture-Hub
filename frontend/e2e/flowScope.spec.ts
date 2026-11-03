import {test,expect} from '@playwright/test'
import {scopedFlowIds} from '../src/flowScope'
const flows=[{id:'ab',source_id:'a',target_id:'b'},{id:'bc',source_id:'b',target_id:'c'},{id:'db',source_id:'d',target_id:'b'},{id:'ca',source_id:'c',target_id:'a'}]
test('direction is respected at every dependency depth',()=>{
 expect([...scopedFlowIds('a',flows,2,'outgoing')]).toEqual(['ab','bc'])
 expect([...scopedFlowIds('c',flows,2,'incoming')]).toEqual(['bc','ab','db'])
 expect([...scopedFlowIds('a',flows,1,'both')]).toEqual(['ab','ca'])
})
test('cycles terminate and parallel records remain independently visible',()=>{
 const parallel=[...flows,{id:'ab2',source_id:'a',target_id:'b'}]
 expect([...scopedFlowIds('a',parallel,20,'outgoing')].sort()).toEqual(['ab','ab2','bc','ca'])
 expect(scopedFlowIds('missing',parallel,3,'both').size).toBe(0)
})
