import {useEffect,useRef,useState,type RefObject} from 'react'
import {hasReservedStandaloneStrip,isAppleMobile,requestAppFullscreen} from './fullscreen'

type FullscreenDocument=Document&{webkitFullscreenElement?:Element;webkitExitFullscreen?:()=>Promise<void>}
const installed=()=>Boolean((navigator as Navigator&{standalone?:boolean}).standalone)||matchMedia('(display-mode: standalone)').matches||matchMedia('(display-mode: fullscreen)').matches
const fullElement=()=>document.fullscreenElement||(document as FullscreenDocument).webkitFullscreenElement

/** Fullscreen the whole app, never the video: native video fullscreen hides the prompter. */
export function useCameraScreen(root:RefObject<HTMLElement|null>){
  const [standalone,setStandalone]=useState(installed),[fullscreen,setFullscreen]=useState(()=>!!fullElement()),[immersive,setImmersive]=useState(false)
  const owned=useRef<HTMLElement|null>(null),wasFullscreen=useRef(false)
  const ios=isAppleMobile()
  useEffect(()=>{
    const element=root.current,viewport=window.visualViewport
    if(!element||!viewport)return
    const size=()=>{
      if(viewport.scale!==1){
        element.style.removeProperty('--camera-viewport-height');element.style.removeProperty('--camera-viewport-top');delete element.dataset.reservedBottom;return
      }
      element.style.setProperty('--camera-viewport-height',`${viewport.height}px`)
      element.style.setProperty('--camera-viewport-top',`${Math.max(0,viewport.offsetTop)}px`)
      delete element.dataset.reservedBottom
      if(ios&&standalone&&Math.abs(viewport.offsetTop)<=1&&window.screen.height>window.screen.width&&Math.abs(window.screen.width-viewport.width)<3){
        const style=getComputedStyle(element)
        const top=parseFloat(style.getPropertyValue('--device-safe-top'))
        const bottom=parseFloat(style.getPropertyValue('--device-safe-bottom'))
        if(hasReservedStandaloneStrip(window.screen.height,viewport.height,top,bottom))element.dataset.reservedBottom='true'
      }
    }
    size();viewport.addEventListener('resize',size);viewport.addEventListener('scroll',size);window.addEventListener('pageshow',size)
    return()=>{viewport.removeEventListener('resize',size);viewport.removeEventListener('scroll',size);window.removeEventListener('pageshow',size);element.style.removeProperty('--camera-viewport-height');element.style.removeProperty('--camera-viewport-top');delete element.dataset.reservedBottom}
  },[root,ios,standalone])
  useEffect(()=>{
    const modes=[matchMedia('(display-mode: standalone)'),matchMedia('(display-mode: fullscreen)')]
    const update=()=>{
      const full=!!fullElement();setFullscreen(full);setStandalone(installed())
      if(wasFullscreen.current&&!full){setImmersive(false);owned.current=null}
      wasFullscreen.current=full
    }
    document.addEventListener('fullscreenchange',update);document.addEventListener('webkitfullscreenchange',update);window.addEventListener('pageshow',update)
    modes.forEach(mode=>mode.addEventListener('change',update))
    return()=>{document.removeEventListener('fullscreenchange',update);document.removeEventListener('webkitfullscreenchange',update);window.removeEventListener('pageshow',update);modes.forEach(mode=>mode.removeEventListener('change',update))}
  },[])
  async function enter(element:HTMLElement){
    if(installed()||fullElement()){setImmersive(true);return true}
    owned.current=element
    if(!await requestAppFullscreen(element)){owned.current=null;return false}
    wasFullscreen.current=true;setFullscreen(true);setImmersive(true);return true
  }
  async function exit(){
    setImmersive(false)
    if(owned.current&&fullElement()===owned.current){const leave=document.exitFullscreen||(document as FullscreenDocument).webkitExitFullscreen;try{await leave?.call(document)}catch{/* Recording continues if the browser refuses to leave fullscreen. */}}
  }
  return {standalone,fullscreen,immersive,ios,enter,exit,useWindow:()=>setImmersive(true)}
}
