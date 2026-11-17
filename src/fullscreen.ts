type FullscreenHost=HTMLElement&{webkitRequestFullscreen?:()=>Promise<void>|void}
type FullscreenContext={fullscreenElement?:Element|null;webkitFullscreenElement?:Element|null}

export function isAppleMobile(){
  const browser=globalThis.navigator
  return !!browser&&(/iPhone|iPad|iPod/.test(browser.userAgent)||(browser.platform==='MacIntel'&&browser.maxTouchPoints>1))
}

/** A resolved request alone is not proof that browser chrome was removed. */
export async function requestAppFullscreen(element:HTMLElement,context:FullscreenContext=document):Promise<boolean>{
  const request=element.requestFullscreen||(element as FullscreenHost).webkitRequestFullscreen
  if(!request)return false
  try{await request.call(element);return (context.fullscreenElement||context.webkitFullscreenElement)===element}catch{return false}
}

/** iOS can leave an extra status-bar-height strip outside the standalone web view. */
export function hasReservedStandaloneStrip(screenHeight:number,windowHeight:number,safeTop:number,safeBottom:number){
  const gap=screenHeight-windowHeight
  return safeTop>=44&&safeBottom>0&&gap>=safeTop-3&&gap<=safeTop+5&&gap>=safeBottom
}
