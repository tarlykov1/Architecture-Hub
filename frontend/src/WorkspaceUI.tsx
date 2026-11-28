import React, {useEffect,useRef,type ReactNode} from 'react'
import {getViewportForBounds,useNodes,useNodesInitialized,useReactFlow} from '@xyflow/react'

/** Refit measured graphs on membership/layout changes and actual canvas resize. */
export function AutoFit({layoutKey='',maxFitZoom=1,groupParentsOnly=false,focusIds=[],suspended=false,settleDelayMs=300,ignoreNodePrefixes='',trackNodeBounds=false,mobileAnchorId=''}:{mobileAnchorId?:string;layoutKey?:string;maxFitZoom?:number;groupParentsOnly?:boolean;focusIds?:string[];suspended?:boolean;settleDelayMs?:number;ignoreNodePrefixes?:string;trackNodeBounds?:boolean}){
 const anchor=useRef<HTMLSpanElement>(null)
 const {fitView,setCenter,setViewport}=useReactFlow()
 const initialized=useNodesInitialized()
 const graphNodes=useNodes()
 const ignored=ignoreNodePrefixes.split(',').filter(Boolean)
 const stableNodes=graphNodes.filter(n=>!ignored.some(prefix=>n.id.startsWith(prefix)))
 const ids=stableNodes.map(n=>n.id).sort().join('|')
 const boundsKey=trackNodeBounds&&!suspended?stableNodes.map(node=>
  [node.id,node.position.x,node.position.y,node.measured?.width,node.measured?.height].join(':')
 ).join('|'):''
 const topLevelIds=stableNodes.filter(n=>!n.parentId).map(n=>n.id).sort().join('|')
 const visibleFocusIds=focusIds.filter(id=>graphNodes.some(node=>node.id===id)).sort().join('|')
 // Optional overlays should not block fitting measured target IS cards.
 const measuredFocusReady=focusIds.length>0&&focusIds.every(id=>{
  const node=graphNodes.find(item=>item.id===id)
  return Boolean(node&&((node.measured?.width||node.initialWidth||node.width||0)>0)&&((node.measured?.height||node.initialHeight||node.height||0)>0))
 })
 useEffect(()=>{
  const canvas=anchor.current?.closest('.react-flow')
  // A delayed resize refit during an active React Flow connection would move
  // both handles away from the pointer and cancel the drawn edge.
  if(suspended||(!initialized&&!measuredFocusReady)||!ids||!canvas)return
  let frame=0,inner=0,settle=0,width=0,height=0
  const fit=()=>{
   cancelAnimationFrame(frame);cancelAnimationFrame(inner)
   frame=requestAnimationFrame(()=>{
    inner=requestAnimationFrame(()=>{
     const targetIds=visibleFocusIds.split('|').filter(Boolean)
     if(trackNodeBounds){
      const targets=new Set(targetIds)
      const positions=new Map(graphNodes.map(node=>[node.id,node.position]))
      const boxes=Array.from(canvas.querySelectorAll<HTMLElement>('.react-flow__node[data-id]')).flatMap(element=>{
       const id=element.dataset.id
       if(!id||(targets.size&&!targets.has(id)))return []
       const point=positions.get(id)
       return point?[{id,...point,right:point.x+element.offsetWidth,bottom:point.y+element.offsetHeight}]:[]
      })
      if(boxes.length){
       const x=Math.min(...boxes.map(box=>box.x)),y=Math.min(...boxes.map(box=>box.y))
       const width=Math.max(...boxes.map(box=>box.right))-x,height=Math.max(...boxes.map(box=>box.bottom))-y
       const viewport=getViewportForBounds({x,y,width,height},canvas.clientWidth,canvas.clientHeight,0.02,maxFitZoom,0.2)
       const anchorBox=boxes.find(box=>box.id===mobileAnchorId)
       if(anchorBox&&window.matchMedia('(max-width:700px)').matches&&viewport.zoom<0.8){
        const zoom=Math.min(0.9,(canvas.clientWidth-24)/(anchorBox.right-anchorBox.x))
        void setCenter((anchorBox.x+anchorBox.right)/2,(anchorBox.y+anchorBox.bottom)/2,{zoom})
        return
       }
       void setViewport(viewport)
       return
      }
     }
     // Fitting one selected IS with fitView can still leave it outside the
     // viewport while the rest of the overview is being measured. Its
     // intrinsic geometry is enough to center it deterministically.
     if(targetIds.length===1){
      const node=graphNodes.find(item=>item.id===targetIds[0])
      const boxWidth=node?.measured?.width||node?.initialWidth||node?.width||Number(node?.style?.width)||0
      const boxHeight=node?.measured?.height||node?.initialHeight||node?.height||Number(node?.style?.height)||0
      if(node&&boxWidth>0&&boxHeight>0&&canvas.clientWidth>=100&&canvas.clientHeight>=100){
       const zoom=Math.min(maxFitZoom,(canvas.clientWidth-64)/boxWidth,(canvas.clientHeight-64)/boxHeight)
       void setCenter(node.position.x+boxWidth/2,node.position.y+boxHeight/2,{zoom:Math.max(0.02,zoom),duration:0})
       return
      }
     }
     void fitView({padding:visibleFocusIds?0.32:0.2,maxZoom:maxFitZoom,minZoom:0.02,duration:0,...(visibleFocusIds?{nodes:targetIds.map(id=>({id}))}:groupParentsOnly?{nodes:topLevelIds.split('|').filter(Boolean).map(id=>({id}))}:{})})
    })
   })
  }
  const refit=()=>{
   fit()
   // React Flow measures its pane asynchronously after a parent/window resize.
   // Repeat once when the final dimensions are known rather than keeping the
   // viewport fitted to stale measurements.
   window.clearTimeout(settle)
   if(settleDelayMs>0)settle=window.setTimeout(fit,settleDelayMs)
  }
  const observer=new ResizeObserver(entries=>{
   const rect=entries[0].contentRect
   if(rect.width<100||rect.height<100)return
   if(Math.abs(width-rect.width)<2&&Math.abs(height-rect.height)<2)return
   width=rect.width;height=rect.height;refit()
  })
  observer.observe(canvas)
  const cardObserver=trackNodeBounds?new ResizeObserver(refit):undefined
  if(cardObserver)canvas.querySelectorAll('.react-flow__node').forEach(card=>cardObserver.observe(card))
  window.addEventListener('resize',refit)
  refit()
  return()=>{
   observer.disconnect()
   cardObserver?.disconnect()
   window.removeEventListener('resize',refit)
   window.clearTimeout(settle)
   cancelAnimationFrame(frame);cancelAnimationFrame(inner)
  }
 },[fitView,setCenter,setViewport,trackNodeBounds,mobileAnchorId,initialized,measuredFocusReady,ids,boundsKey,topLevelIds,visibleFocusIds,layoutKey,maxFitZoom,groupParentsOnly,suspended,settleDelayMs])
 return <span ref={anchor} hidden/>
}

/** Focus a selected node and its visible first-hop neighbors after React Flow measures them. */
export function FocusNeighborhood({selectedId,edgePairs}:{selectedId:string;edgePairs:Array<{source:string;target:string}>}){
 const {fitView}=useReactFlow()
 const nodes=useNodes()
 const initialized=useNodesInitialized()
 const ids=nodes.map(n=>n.id).sort().join('|')
 const neighborIds=selectedId?[selectedId,...edgePairs.flatMap(e=>e.source===selectedId?[e.target]:e.target===selectedId?[e.source]:[])]:[]
 const selection=Array.from(new Set(neighborIds)).filter(id=>nodes.some(n=>n.id===id))
 const selectionKey=selection.slice().sort().join('|')
 useEffect(()=>{
  if(!selectedId||!initialized||!selectionKey)return
  const frame=requestAnimationFrame(()=>{
   void fitView({nodes:selection.map(id=>({id})),padding:0.28,minZoom:0.2,maxZoom:1,duration:220})
  })
  return()=>cancelAnimationFrame(frame)
 // Depend on stable selection membership rather than the transient node object identities.
 },[fitView,initialized,selectedId,selectionKey,ids])
 return null
}

/** Bring both endpoints of the selected flow into view without changing graph layout. */
export function FocusSelectedFlow({flow}:{flow?:{id:string;source_id:string;target_id:string}}){
 const {fitView}=useReactFlow()
 const nodes=useNodes()
 const initialized=useNodesInitialized()
 const source=flow?.source_id||''
 const target=flow?.target_id||''
 const hasEndpoints=nodes.some(n=>n.id===source)&&nodes.some(n=>n.id===target)
 useEffect(()=>{
  if(!initialized||!source||!target||!hasEndpoints)return
  const frame=requestAnimationFrame(()=>{
   void fitView({nodes:[{id:source},{id:target}],padding:0.35,minZoom:0.08,maxZoom:1.25,duration:350})
  })
  return()=>cancelAnimationFrame(frame)
 },[fitView,initialized,source,target,hasEndpoints,flow?.id])
 return null
}

export function Disclosure({label,children}:{label:string;children:ReactNode}){
 return <details className="workspaceDisclosure"><summary>{label}</summary><div className="disclosureContent">{children}</div></details>
}

/** Dismiss action menus and provide keyboard containment and focus return for dialogs. */
export function useWorkspaceKeyboard(){
 useEffect(()=>{
  const closeMenus=(target:EventTarget|null)=>{
   document.querySelectorAll<HTMLDetailsElement>('details.layerActions[open], details.mobileSectionMenu[open]').forEach(menu=>{
    if(!(target instanceof Node)||!menu.contains(target))menu.open=false
   })
  }
  const click=(event:MouseEvent)=>{
   closeMenus(event.target)
   if(event.target instanceof Element&&event.target.closest('.layerActionMenu button, .mobileSectionOptions button'))event.target.closest('details')?.removeAttribute('open')
  }
  let active:HTMLElement|null=null,returnTo:HTMLElement|null=null
  const sync=()=>{
   const dialogs=Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"][aria-modal="true"]'))
   const next=dialogs[dialogs.length-1]||null
   if(next===active)return
   if(next){if(!active)returnTo=document.activeElement as HTMLElement;active=next;queueMicrotask(()=>next.querySelector<HTMLElement>('input:not([type="hidden"]),select,textarea,button,[tabindex="0"]')?.focus())}
   else{active=null;if(returnTo?.isConnected)returnTo.focus();returnTo=null}
  }
  const key=(event:KeyboardEvent)=>{
   if(event.key==='Escape'){
    const menu=document.querySelector<HTMLDetailsElement>('details.layerActions[open], details.mobileSectionMenu[open]')
    if(menu){menu.open=false;menu.querySelector<HTMLElement>('summary')?.focus();event.preventDefault();return}
    if(active){const close=active.querySelector<HTMLButtonElement>('.dialogHead button,button[aria-label^="Закрыть"]');if(close&&!close.disabled){close.click();event.preventDefault()}}
   }
   if(event.key==='Tab'&&active){
    const focusable=Array.from(active.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href],[tabindex="0"]')).filter(el=>el.getClientRects().length)
    const first=focusable[0],last=focusable[focusable.length-1]
    if(!first){event.preventDefault();return}
    if(event.shiftKey&&(document.activeElement===first||!active.contains(document.activeElement))){last.focus();event.preventDefault()}
    else if(!event.shiftKey&&(document.activeElement===last||!active.contains(document.activeElement))){first.focus();event.preventDefault()}
   }
  }
  const observer=new MutationObserver(sync);observer.observe(document.body,{childList:true,subtree:true});sync()
  document.addEventListener('click',click);document.addEventListener('keydown',key)
  return()=>{observer.disconnect();document.removeEventListener('click',click);document.removeEventListener('keydown',key)}
 },[])
}

/** Keep a failed inspector panel from taking down the surrounding workspace. */
export class InspectorErrorBoundary extends React.Component<{children:ReactNode},{failed:boolean}>{
 state={failed:false}
 static getDerivedStateFromError(){return {failed:true}}
 render(){
  return this.state.failed?<p role="alert">Не удалось открыть вкладку. Закройте карточку или выберите другой раздел.</p>:this.props.children
 }
}
