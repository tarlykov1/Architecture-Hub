import React, {useEffect,useRef,type ReactNode} from 'react'
import {useNodes,useNodesInitialized,useReactFlow} from '@xyflow/react'

/** Refit measured graphs on membership/layout changes and actual canvas resize. */
export function AutoFit({layoutKey=''}:{layoutKey?:string}){
 const anchor=useRef<HTMLSpanElement>(null)
 const {fitView}=useReactFlow()
 const initialized=useNodesInitialized()
 const ids=useNodes().map(n=>n.id).sort().join('|')
 useEffect(()=>{
  const canvas=anchor.current?.closest('.react-flow')
  if(!initialized||!ids||!canvas)return
  let frame=0,inner=0,width=0,height=0
  const fit=()=>{cancelAnimationFrame(frame);cancelAnimationFrame(inner);frame=requestAnimationFrame(()=>{inner=requestAnimationFrame(()=>{void fitView({padding:0.14,maxZoom:1,minZoom:0.08,duration:180})})})}
  const observer=new ResizeObserver(entries=>{
   const rect=entries[0].contentRect
   if(rect.width<100||rect.height<100)return
   if(Math.abs(width-rect.width)<4&&Math.abs(height-rect.height)<4)return
   width=rect.width;height=rect.height;fit()
  })
  observer.observe(canvas);fit()
  return()=>{observer.disconnect();cancelAnimationFrame(frame);cancelAnimationFrame(inner)}
 },[fitView,initialized,ids,layoutKey])
 return <span ref={anchor} hidden/>
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
