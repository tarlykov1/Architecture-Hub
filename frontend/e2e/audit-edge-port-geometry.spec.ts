import {expect,test} from '@playwright/test'
import {portExit,routeAroundNodes} from '../src/ObstacleAwareEdge'
import {Position} from '@xyflow/react'

const straight=(a:{x:number;y:number},b:{x:number;y:number})=>a.x===b.x||a.y===b.y
const inside=(p:{x:number;y:number},r:{left:number;top:number;right:number;bottom:number})=>
 p.x>r.left&&p.x<r.right&&p.y>r.top&&p.y<r.bottom

test('QA-WORK: fractional React Flow handle locations route without fallback or unconnected endpoints',()=>{
 const source={x:207.333333333,y:160.666666667}
 const target={x:584.666666667,y:160.666666667}
 const a=portExit(source,Position.Right)
 const b=portExit(target,Position.Left)
 const path=routeAroundNodes(a,b,[
  {left:90,top:95,right:207.333333333,bottom:240},
  {left:584.666666667,top:95,right:700,bottom:240}
 ])
 expect(path.length).toBeGreaterThanOrEqual(2)
 expect(path[0]).toEqual(a)
 expect(path.at(-1)).toEqual(b)
 for(let i=1;i<path.length;i++)expect(straight(path[i-1],path[i])).toBe(true)
})

test('QA-WORK: an endpoint card blocks detours through its interior',()=>{
 const a={x:140,y:115},b={x:415,y:115}
 const source={left:100,top:100,right:200,bottom:200}
 const target={left:355,top:100,right:455,bottom:200}
 const start=portExit({x:200,y:115},Position.Right)
 const end=portExit({x:355,y:115},Position.Left)
 const route=routeAroundNodes(start,end,[source,target,{left:265,top:100,right:300,bottom:160}])
 expect(route.length).toBeGreaterThan(2)
 for(let i=1;i<route.length;i++){
  const p=route[i-1],q=route[i]
  expect(straight(p,q)).toBe(true)
  const midpoint={x:(p.x+q.x)/2,y:(p.y+q.y)/2}
  expect([source,target].some(r=>inside(midpoint,r))).toBe(false)
 }
 expect(route[0]).toEqual(start)
 expect(route.at(-1)).toEqual(end)
 expect(a.x).toBeLessThan(start.x)
 expect(b.x).toBeGreaterThan(end.x)
})
