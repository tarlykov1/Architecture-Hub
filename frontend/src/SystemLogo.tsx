import React, {useEffect,useState} from 'react'
import './systemLogo.css'

export function logoFromAttributes(attributes:Record<string,unknown>|undefined|null):string|undefined{
 const value=attributes?.system_logo
 return typeof value==='string'&&/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(value)&&value.length<140000?value:undefined
}

/** Self-contained, 192px image. Uploaded media never needs a public file URL. */
export async function prepareSystemLogo(file:File):Promise<string>{
 if(!['image/png','image/jpeg','image/webp'].includes(file.type))throw new Error('Разрешены только PNG, JPG и WebP.')
 if(file.size>4*1024*1024)throw new Error('Файл логотипа должен быть меньше 4 МБ.')
 const source=await new Promise<string>((resolve,reject)=>{
  const reader=new FileReader()
  reader.onload=()=>resolve(String(reader.result||''))
  reader.onerror=()=>reject(new Error('Не удалось прочитать изображение.'))
  reader.readAsDataURL(file)
 })
 const image=await new Promise<HTMLImageElement>((resolve,reject)=>{
  const value=new Image()
  value.onload=()=>resolve(value)
  value.onerror=()=>reject(new Error('Не удалось открыть изображение.'))
  value.src=source
 })
 if(!image.naturalWidth||!image.naturalHeight)throw new Error('Пустое изображение логотипа.')
 const canvas=document.createElement('canvas')
 const ratio=Math.min(1,192/image.naturalWidth,192/image.naturalHeight)
 canvas.width=Math.max(1,Math.round(image.naturalWidth*ratio))
 canvas.height=Math.max(1,Math.round(image.naturalHeight*ratio))
 const context=canvas.getContext('2d')
 if(!context)throw new Error('Не удалось подготовить логотип.')
 context.clearRect(0,0,canvas.width,canvas.height)
 context.drawImage(image,0,0,canvas.width,canvas.height)
 let optimized=canvas.toDataURL('image/webp',0.82)
 if(!optimized.startsWith('data:image/webp;'))optimized=canvas.toDataURL('image/png')
 if(optimized.length>135000){
  canvas.width=Math.max(1,Math.round(canvas.width/1.5))
  canvas.height=Math.max(1,Math.round(canvas.height/1.5))
  context.drawImage(image,0,0,canvas.width,canvas.height)
  optimized=canvas.toDataURL('image/jpeg',0.68)
 }
 if(optimized.length>135000)throw new Error('Не удалось уменьшить логотип до безопасного размера.')
 return optimized
}

export function SystemLogo({logo,size='normal'}:{logo?:string;size?:'small'|'normal'|'large'}){
 const [broken,setBroken]=useState(false)
 useEffect(()=>setBroken(false),[logo])
 return <span className={'systemLogo systemLogo--'+size} data-has-logo={Boolean(logo&&!broken)}>
  {logo&&!broken?<img src={logo} alt="" onError={()=>setBroken(true)} draggable={false}/>:<span aria-hidden="true" className="systemLogoFallback">▦</span>}
 </span>
}
