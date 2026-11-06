import React, {useMemo} from 'react'
import {BaseEdge,EdgeLabelRenderer,getSmoothStepPath,useNodes,Position,type EdgeProps} from '@xyflow/react'

type Point={x:number;y:number}
type Rect={left:number;top:number;right:number;bottom:number}
const GAP=22
const EPS=0.01
const key=(x:number,y:number)=>x+','+y
const uniq=(values:number[])=>[...new Set(values.map(v=>Math.round(v*10)/10))].sort((a,b)=>a-b)
function inside(p:Point,r:Rect){return p.x>r.left+EPS&&p.x<r.right-EPS&&p.y>r.top+EPS&&p.y<r.bottom-EPS}
function clear(a:Point,b:Point,rects:Rect[]){
 if(a.x!==b.x&&a.y!==b.y)return false
 return rects.every(r=>{
   if(a.x===b.x)return a.x<=r.left+EPS||a.x>=r.right-EPS||Math.max(a.y,b.y)<=r.top+EPS||Math.min(a.y,b.y)>=r.bottom-EPS
   return a.y<=r.top+EPS||a.y>=r.bottom-EPS||Math.max(a.x,b.x)<=r.left+EPS||Math.min(a.x,b.x)>=r.right-EPS
 })
}
function simplified(points:Point[]){
 const out:Point[]=[]
 for(const p of points){
   const previous=out[out.length-1]
   if(previous&&previous.x===p.x&&previous.y===p.y)continue
   const a=out[out.length-2],b=out[out.length-1]
   if(a&&b&&((a.x===b.x&&b.x===p.x)||(a.y===b.y&&b.y===p.y)))out.pop()
   out.push(p)
 }
 return out
}
/** Visibility-graph orthogonal router: avoids component rectangles and penalizes turns. */
export function routeAroundNodes(start:Point,end:Point,rects:Rect[]):Point[]{
 const obstacles=rects.filter(r=>!inside(start,r)&&!inside(end,r))
 const xs=uniq([start.x,end.x,...obstacles.flatMap(r=>[r.left-GAP,r.right+GAP])])
 const ys=uniq([start.y,end.y,...obstacles.flatMap(r=>[r.top-GAP,r.bottom+GAP])])
 // A crowded map should not stall dragging; fall back to React Flow's native router.
 if(xs.length*ys.length>2400)return []
 const points:Point[]=[],lookup=new Map<string,number>()
 for(const x of xs)for(const y of ys){
   const p={x,y}
   if(obstacles.some(r=>inside(p,r)))continue
   lookup.set(key(x,y),points.length);points.push(p)
 }
 const source=lookup.get(key(start.x,start.y)),target=lookup.get(key(end.x,end.y))
 if(source===undefined||target===undefined)return []
 const rows=new Map<number,number[]>(),cols=new Map<number,number[]>()
 points.forEach((p,i)=>{rows.set(p.y,[...(rows.get(p.y)||[]),i]);cols.set(p.x,[...(cols.get(p.x)||[]),i])})
 const neighbors:number[][]=points.map(()=>[])
 for(const group of [...rows.values(),...cols.values()]){
   group.sort((a,b)=>points[a].x-points[b].x||points[a].y-points[b].y)
   for(let i=1;i<group.length;i++)if(clear(points[group[i-1]],points[group[i]],obstacles)){
     neighbors[group[i-1]].push(group[i]);neighbors[group[i]].push(group[i-1])
   }
 }
 type State={id:number;axis:number;cost:number;bends:number;prev:string|null}
 const queue:State[]=[{id:source,axis:0,cost:0,bends:0,prev:null}]
 const best=new Map<string,State>(),stateKey=(id:number,axis:number)=>id+':'+axis
 best.set(stateKey(source,0),queue[0])
 let finish:State|undefined
 while(queue.length){
   queue.sort((a,b)=>a.cost-b.cost)
   const current=queue.shift()!
   if(best.get(stateKey(current.id,current.axis))!==current)continue
   if(current.id===target){finish=current;break}
   for(const next of neighbors[current.id]){
     const horizontal=points[current.id].y===points[next].y,axis=horizontal?1:2
     const turn=current.axis!==0&&current.axis!==axis?1:0
     const cost=current.cost+Math.abs(points[current.id].x-points[next].x)+Math.abs(points[current.id].y-points[next].y)+turn*36
     const k=stateKey(next,axis)
     if(cost>=(best.get(k)?.cost??Infinity))continue
     const state={id:next,axis,cost,bends:current.bends+turn,prev:stateKey(current.id,current.axis)}
     best.set(k,state);queue.push(state)
   }
 }
 if(!finish)return []
 const path:Point[]=[]
 let cursor:string|null=stateKey(finish.id,finish.axis)
 while(cursor){const state=best.get(cursor);if(!state)break;path.push(points[state.id]);cursor=state.prev}
 return simplified(path.reverse())
}
/** Extend the edge from its actual React Flow handle, not always bottom-to-top. */
export function portExit(point:Point,position:Position,distance=GAP):Point{
 switch(position){
   case Position.Left:return {x:point.x-distance,y:point.y}
   case Position.Right:return {x:point.x+distance,y:point.y}
   case Position.Top:return {x:point.x,y:point.y-distance}
   default:return {x:point.x,y:point.y+distance}
 }
}
function pathString(points:Point[]){
 return points.map((p,i)=>(i?'L ':'M ')+p.x+' '+p.y).join(' ')
}
function midpoint(points:Point[]):Point{
 const lengths=points.slice(1).map((p,i)=>Math.abs(p.x-points[i].x)+Math.abs(p.y-points[i].y))
 const half=lengths.reduce((a,b)=>a+b,0)/2
 let covered=0
 for(let i=0;i<lengths.length;i++){
   if(covered+lengths[i]>=half){
     const a=points[i],b=points[i+1],t=lengths[i]?((half-covered)/lengths[i]):0
     return {x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t}
   }
   covered+=lengths[i]
 }
 return points[Math.floor(points.length/2)]||{x:0,y:0}
}
export function ObstacleAwareEdge({id,source,target,sourceX,sourceY,targetX,targetY,sourcePosition,targetPosition,markerEnd,style,data}:EdgeProps){
 const nodes=useNodes()
 const {path,label}=useMemo(()=>{
   const a={x:sourceX,y:sourceY},b={x:targetX,y:targetY}
   const obstacles:Rect[]=nodes.filter(n=>n.id!==source&&n.id!==target&&!n.id.startsWith('network:')&&!n.hidden).map(n=>{
     const x=n.measured?.width||Number(n.style?.width)||220
     const y=n.measured?.height||Number(n.style?.height)||140
     return {left:n.position.x-10,top:n.position.y-10,right:n.position.x+x+10,bottom:n.position.y+y+10}
   })
   const reciprocal=Boolean(data?.reciprocal)
   // Reciprocal directions receive separate lanes without losing the arrow direction.
   const lane=reciprocal?16:0
   const sourcePort=sourcePosition||Position.Bottom,targetPort=targetPosition||Position.Top
   const sourceExit=portExit(a,sourcePort),targetExit=portExit(b,targetPort)
   // Offset only the route's free corridor, never the handle attachment itself.
   const start={x:sourceExit.x+(sourcePort===Position.Top||sourcePort===Position.Bottom?lane:0),y:sourceExit.y+(sourcePort===Position.Left||sourcePort===Position.Right?lane:0)}
   const end={x:targetExit.x+(targetPort===Position.Top||targetPort===Position.Bottom?lane:0),y:targetExit.y+(targetPort===Position.Left||targetPort===Position.Right?lane:0)}
   const routed=routeAroundNodes(start,end,obstacles)
   if(!routed.length){
     const [fallback,x,y]=getSmoothStepPath({sourceX,sourceY,targetX,targetY,borderRadius:8})
     return {path:fallback,label:{x,y}}
   }
   const points=simplified([a,sourceExit,start,...routed.slice(1,-1),end,targetExit,b])
   return {path:pathString(points),label:midpoint(points)}
 },[nodes,source,target,sourceX,sourceY,targetX,targetY,sourcePosition,targetPosition,data?.reciprocal])
 const caption=typeof data?.caption==='string'?data.caption:''
 return <>
   <BaseEdge id={id} path={path} markerEnd={markerEnd} style={style} interactionWidth={18}/>
   {caption&&<EdgeLabelRenderer><div className="reciprocalEdgeLabel" style={{position:'absolute',transform:`translate(-50%,-50%) translate(${label.x}px,${label.y}px)`,pointerEvents:'none',opacity:style?.opacity??1}}>{caption}</div></EdgeLabelRenderer>}
 </>
}
