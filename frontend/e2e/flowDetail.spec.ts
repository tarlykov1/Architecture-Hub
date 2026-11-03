import {test,expect} from '@playwright/test'
import {shouldShowSystemsOverview} from '../src/flowDetail'
const flows=(size:number)=>Array.from({length:size},(_,i)=>({source_id:'node-'+i,target_id:'node-'+(i+1)}))
test('large multi-system dependency maps default to a compact overview',()=>{
 expect(shouldShowSystemsOverview(flows(20),3,false,false,'auto')).toBe(true)
 expect(shouldShowSystemsOverview(flows(19),3,false,false,'auto')).toBe(false)
 expect(shouldShowSystemsOverview(flows(30),1,false,false,'auto')).toBe(false)
 expect(shouldShowSystemsOverview(flows(30),3,true,false,'auto')).toBe(false)
 expect(shouldShowSystemsOverview(flows(30),3,false,true,'auto')).toBe(false)
})
test('explicit detail preferences override auto aggregation without dropping data',()=>{
 const records=flows(30)
 expect(shouldShowSystemsOverview(records,3,false,false,'components')).toBe(false)
 expect(shouldShowSystemsOverview(records,3,true,true,'systems')).toBe(true)
 expect(shouldShowSystemsOverview(records,3,false,false,'auto',true)).toBe(true)
})
