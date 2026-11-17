import {hasLocalFrameRenderer,renderTrack,type RenderPlan} from './track-renderer.ts'

type TrackOutput={track:MediaStreamTrack;dispose:()=>void}

export async function renderCameraTrack(input:MediaStreamTrack,plan:RenderPlan,signal:AbortSignal,onFailure:()=>void):Promise<TrackOutput|null>{
  if(signal.aborted)return null
  if(hasLocalFrameRenderer()){
    const result=renderTrack(input,plan,onFailure)
    if(!result)return null
    const dispose=()=>{signal.removeEventListener('abort',dispose);result.stop()}
    const timeout=setTimeout(dispose,2600)
    signal.addEventListener('abort',dispose,{once:true})
    try{
      if(await result.ready&&!signal.aborted)return {track:result.track,dispose}
      dispose();return null
    }finally{clearTimeout(timeout)}
  }
  if(typeof Worker==='undefined'||typeof input.clone!=='function')return null
  return new Promise(resolve=>{
    const clone=input.clone()
    let worker:Worker
    try{worker=new Worker(new URL('./track-renderer.worker.ts',import.meta.url),{type:'module'})}
    catch{clone.stop();resolve(null);return}
    let stopped=false,track:MediaStreamTrack|undefined
    const dispose=()=>{
      if(stopped)return
      stopped=true;clearTimeout(timeout);signal.removeEventListener('abort',dispose)
      track?.stop()
      try{worker.postMessage('cancel')}catch{/* Worker already disposed. */}
      setTimeout(()=>worker.terminate(),150)
      resolve(null)
    }
    const failed=()=>{
      const running=!!track
      dispose()
      if(running)onFailure()
    }
    const timeout=setTimeout(dispose,2800)
    signal.addEventListener('abort',dispose,{once:true})
    worker.onmessage=({data}:MessageEvent<{track?:MediaStreamTrack;error?:boolean}>)=>{
      if(data.error){failed();return}
      if(stopped){data.track?.stop();return}
      if(data.track){track=data.track;clearTimeout(timeout);resolve({track,dispose})}
    }
    worker.onerror=failed
    try{worker.postMessage({track:clone,plan},[clone as unknown as Transferable])}
    catch{clone.stop();dispose()}
  })
}
