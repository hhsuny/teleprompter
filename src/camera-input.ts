import {readInputFrames,type InputFrames} from './frame-sampler.ts'

/** Sample the video track separately from the compositor. No frames are kept. */
export async function sampleCameraInput(track:MediaStreamTrack,signal:AbortSignal):Promise<InputFrames|null>{
  if(signal.aborted)return null
  if('MediaStreamTrackProcessor' in globalThis){
    try{return await readInputFrames(track,signal)}catch{return null}
  }
  if(typeof Worker==='undefined'||typeof track.clone!=='function')return null
  return new Promise(resolve=>{
    let worker:Worker,clone:MediaStreamTrack
    try{
      clone=track.clone()
      try{worker=new Worker(new URL('./frame-sampler.worker.ts',import.meta.url),{type:'module'})}
      catch(error){clone.stop();throw error}
    }catch{resolve(null);return}
    let finished=false
    const finish=(sample:InputFrames|null,cancel=false)=>{
      if(finished)return
      finished=true
      clearTimeout(timeout)
      signal.removeEventListener('abort',abort)
      if(cancel){
        try{worker.postMessage('cancel')}catch{/* The worker may already have closed. */}
        // Let the worker stop its transferred track before tearing it down.
        setTimeout(()=>worker.terminate(),150)
      }else worker.terminate()
      resolve(sample)
    }
    const abort=()=>finish(null,true)
    const timeout=setTimeout(abort,4200)
    signal.addEventListener('abort',abort,{once:true})
    worker.onmessage=(event:MessageEvent<InputFrames|null>)=>finish(event.data)
    worker.onerror=()=>finish(null)
    try{worker.postMessage(clone,[clone as unknown as Transferable])}
    catch{clone.stop();finish(null)}
  })
}
