import {cropRectangle} from './capture-spec.ts'

export type RenderPlan={width:number;height:number;zoom:number;mirror:boolean;portrait:boolean}
type Processor=new(options:{track:MediaStreamTrack;maxBufferSize:number})=>{readable:ReadableStream<VideoFrame>}
type Generator={track:MediaStreamTrack;writable:WritableStream<VideoFrame>}
type LegacyGenerator=MediaStreamTrack&{writable:WritableStream<VideoFrame>}
const media=globalThis as typeof globalThis&{
  MediaStreamTrackProcessor?:Processor
  VideoTrackGenerator?:new()=>Generator
  MediaStreamTrackGenerator?:new(options:{kind:'video'})=>LegacyGenerator
}

export const hasLocalFrameRenderer=()=>!!(media.MediaStreamTrackProcessor&&(media.VideoTrackGenerator||media.MediaStreamTrackGenerator))

export function renderTrack(input:MediaStreamTrack,plan:RenderPlan,onFailure:()=>void){
  if(!hasLocalFrameRenderer()||typeof OffscreenCanvas==='undefined')return null
  const canvas=new OffscreenCanvas(plan.width,plan.height)
  const context=canvas.getContext('2d',{alpha:false})
  if(!context)return null
  if(plan.mirror)context.setTransform(-1,0,0,1,plan.width,0)
  const reader=new media.MediaStreamTrackProcessor!({track:input,maxBufferSize:4}).readable.getReader()
  const legacy=media.VideoTrackGenerator?undefined:new media.MediaStreamTrackGenerator!({kind:'video'})
  const {track,writable}=legacy?{track:legacy,writable:legacy.writable}:new media.VideoTrackGenerator!()
  const writer=writable.getWriter()

  let stopped=false,lastTimestamp=-Infinity,started=false
  let onReady:(value:boolean)=>void=()=>{}
  const ready=new Promise<boolean>(resolve=>{onReady=resolve})
  const stop=()=>{
    if(stopped)return
    stopped=true;onReady(false)
    void reader.cancel().catch(()=>{});void writer.abort().catch(()=>{});track.stop()
  }
  void (async()=>{
    try{
      while(!stopped){
        const {done,value:frame}=await reader.read()
        if(done)break
        try{
          if(!Number.isFinite(frame.timestamp)||frame.timestamp<=lastTimestamp)continue
          const width=frame.displayWidth,height=frame.displayHeight
          if(!width||!height||(height>width)!==plan.portrait)throw new Error('相机原始帧的方向已改变。')
          const ratio=plan.width/plan.height
          const baseWidth=Math.min(width,height*ratio),baseHeight=Math.min(height,width/ratio)
          const crop=cropRectangle(baseWidth,baseHeight,plan.zoom)
          context.drawImage(frame,(width-baseWidth)/2+crop.x,(height-baseHeight)/2+crop.y,crop.width,crop.height,0,0,plan.width,plan.height)
          const rendered=new VideoFrame(canvas,{timestamp:frame.timestamp,...frame.duration!==null?{duration:frame.duration}:{}})
          lastTimestamp=frame.timestamp
          try{await writer.write(rendered)}finally{rendered.close()}
          if(!started){started=true;onReady(true)}
        }finally{frame.close()}
      }
    }catch{/* The caller can retry with the preview-based renderer before recording. */}
    finally{
      const failed=!stopped&&started
      stop()
      reader.releaseLock();writer.releaseLock()
      if(failed)onFailure()
    }
  })()
  return {track,ready,stop}
}
