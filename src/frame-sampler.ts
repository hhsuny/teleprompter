export type InputFrames={fps:number;width:number;height:number;frames:number;durationMs:number}

type FrameProcessor=new(options:{track:MediaStreamTrack;maxBufferSize:number})=>{readable:ReadableStream<VideoFrame>}

export async function readInputFrames(track:MediaStreamTrack,signal:AbortSignal):Promise<InputFrames|null>{
  const Processor=(globalThis as {MediaStreamTrackProcessor?:FrameProcessor}).MediaStreamTrackProcessor
  if(!Processor||signal.aborted)return null
  const reader=new Processor({track,maxBufferSize:4}).readable.getReader()
  const cancel=()=>{void reader.cancel().catch(()=>{})}
  const timeout=setTimeout(cancel,3400)
  signal.addEventListener('abort',cancel,{once:true})
  let first=0,last=-1,frames=0,width=0,height=0
  try{
    while(!signal.aborted){
      const {done,value}=await reader.read()
      if(done)break
      const {timestamp,displayWidth,displayHeight}=value
      value.close()
      if(!Number.isFinite(timestamp)||timestamp<=last)continue
      if(displayWidth!==width||displayHeight!==height){first=timestamp;frames=0;width=displayWidth;height=displayHeight}
      last=timestamp;frames++
      const durationMs=(last-first)/1000
      if(durationMs>=1800)return {fps:(frames-1)*1000/durationMs,width,height,frames,durationMs}
    }
    return null
  }finally{clearTimeout(timeout);signal.removeEventListener('abort',cancel);cancel();reader.releaseLock()}
}
