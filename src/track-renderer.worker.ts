import {renderTrack,type RenderPlan} from './track-renderer'
const scope=self as unknown as {
  onmessage:((event:MessageEvent<{track:MediaStreamTrack;plan:RenderPlan}|'cancel'>)=>void)|null
  postMessage:(message:unknown,transfer?:Transferable[])=>void
}
let stop:()=>void=()=>{}
scope.onmessage=async({data})=>{
  if(data==='cancel'){stop();return}
  try{
    const result=renderTrack(data.track,data.plan,()=>scope.postMessage({error:true}))
    stop=()=>{result?.stop();data.track.stop()}
    if(!result||!await result.ready){stop();scope.postMessage({error:true});return}
    scope.postMessage({track:result.track},[result.track as unknown as Transferable])
  }catch{stop();data.track.stop();scope.postMessage({error:true})}
}
