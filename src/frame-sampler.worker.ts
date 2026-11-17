import {readInputFrames} from './frame-sampler'

const scope=self as unknown as {onmessage:((event:MessageEvent<MediaStreamTrack|'cancel'>)=>void)|null;postMessage:(message:unknown)=>void}
const controller=new AbortController()
scope.onmessage=async({data})=>{
  if(data==='cancel'){controller.abort();return}
  const sample=await readInputFrames(data,controller.signal).catch(()=>null)
  data.stop()
  scope.postMessage(sample)
}
