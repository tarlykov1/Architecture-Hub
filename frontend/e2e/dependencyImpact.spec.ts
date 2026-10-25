import {expect,test} from '@playwright/test'
import {downstreamImpact,impactRoutes} from '../src/dependencyImpact'
test('impact follows directed dependencies transitively, handles cycles',()=>{
 const links=[{source_id:'a',target_id:'b'},{source_id:'b',target_id:'c'},{source_id:'c',target_id:'b'},{source_id:'x',target_id:'a'}]
 expect([...downstreamImpact('a',links,new Set(['a','b','c','x']))].sort()).toEqual(['b','c'])
 expect([...downstreamImpact('c',links,new Set(['a','b','c','x']))]).toEqual(['b'])
})
test('impact does not leave currently visible graph',()=>{
 const links=[{source_id:'a',target_id:'external'},{source_id:'external',target_id:'b'}]
 expect(downstreamImpact('a',links,new Set(['a','b'])).size).toBe(0)
 expect(downstreamImpact('absent',links,new Set(['a','b'])).size).toBe(0)
})

test('impact routes report shortest path and conservative verification',()=>{
 const links=[{source_id:'a',target_id:'b',verification:'verified'},{source_id:'b',target_id:'c',verification:'draft'},{source_id:'c',target_id:'a',verification:'verified'}]
 const routes=impactRoutes('a',links,new Set(['a','b','c']))
 expect(routes.map(x=>x.nodes.join('>'))).toEqual(['a>b','a>b>c'])
 expect(routes[0].verification).toBe('Подтверждённые записи')
 expect(routes[1].verification).toBe('Есть неподтверждённые записи')
})
