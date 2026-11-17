import {cropRectangle,type CaptureSpec} from './capture-spec.ts'
import {renderCameraTrack} from './camera-renderer.ts'
import {isAppleMobile} from './fullscreen.ts'

type ZoomTrack=Omit<MediaStreamTrack,'getCapabilities'|'getSettings'>&{getCapabilities:()=>MediaTrackCapabilities&{zoom?:{min:number;max:number;step?:number}};getSettings:()=>MediaTrackSettings&{zoom?:number}}
export type CaptureOutput={stream:MediaStream;method:'original'|'hardware'|'digital'|'downscale';renderer?:'raw'|'preview';canvas?:HTMLCanvasElement;pixelsMirrored?:boolean;mirrorInFile?:boolean;dispose:()=>void}

export function canScaleToFullHd({width,height}:{width:number;height:number}){
  return Math.min(width,height)>=1080&&Math.max(width,height)>=1920
}

/** Scale each new camera image once. CSS mirrors the preview outside this path. */
export async function createFullHdOutput(input:MediaStream,video:HTMLVideoElement,signal:AbortSignal,onInterrupted?:(reason:string)=>void,mirror=false,preferRaw=true):Promise<CaptureOutput>{
  const source={width:video.videoWidth,height:video.videoHeight}
  if(source.height<=source.width||!canScaleToFullHd(source))throw new Error('没有收到足够清晰的竖屏画面。')
  return renderCameraOutput(input,video,{width:1080,height:1920},1,mirror,'downscale',signal,preferRaw,onInterrupted)
}

async function renderCameraOutput(input:MediaStream,video:HTMLVideoElement,size:{width:number;height:number},zoom:number,mirror:boolean,
  method:CaptureOutput['method'],signal:AbortSignal,preferRaw:boolean,onInterrupted?:(reason:string)=>void):Promise<CaptureOutput>{
  if(signal.aborted)throw new DOMException('相机检查已取消','AbortError')
  const source={width:video.videoWidth,height:video.videoHeight}
  if(!source.width||!source.height)throw new Error('取景尚未输出画面。')
  const trackInput=input.getVideoTracks()[0]
  const raw=preferRaw&&trackInput&&await renderCameraTrack(trackInput,{...size,zoom,mirror,portrait:source.height>source.width},signal,
    ()=>onInterrupted?.('相机原始帧的处理已中断。')).catch(()=>null)
  if(signal.aborted){if(raw)raw.dispose();throw new DOMException('相机检查已取消','AbortError')}
  if(raw)return {stream:new MediaStream([raw.track,...input.getAudioTracks()]),method,renderer:'raw',pixelsMirrored:mirror,dispose:raw.dispose}
  const canvas=document.createElement('canvas');canvas.width=size.width;canvas.height=size.height
  const context=canvas.getContext('2d',{alpha:false})
  if(!context||!canvas.captureStream||!video.requestVideoFrameCallback)throw new Error('此浏览器不支持录制镜像或缩放画面。')
  const stream=canvas.captureStream(0),track=stream.getVideoTracks()[0] as CanvasCaptureMediaStreamTrack|undefined
  if(!track?.requestFrame){track?.stop();throw new Error('浏览器没有提供逐帧输出。')}
  const ratio=size.width/size.height
  const {x,y,width,height}=cropRectangle(Math.min(source.width,source.height*ratio),Math.min(source.height,source.width/ratio),zoom)
  const left=x+(source.width-width*zoom)/2,top=y+(source.height-height*zoom)/2
  if(mirror)context.setTransform(-1,0,0,1,size.width,0)
  let request=0,lastFrame=-1,disposed=false
  const dispose=()=>{
    if(disposed)return
    disposed=true;video.cancelVideoFrameCallback(request);track.stop();canvas.width=0;canvas.height=0
    signal.removeEventListener('abort',dispose)
  }
  const draw=(_now:number,metadata:VideoFrameCallbackMetadata)=>{
    if(disposed)return
    if(video.videoWidth!==source.width||video.videoHeight!==source.height){dispose();onInterrupted?.('相机画面尺寸已改变，请保持手机竖直并重新打开相机。');return}
    if(metadata.mediaTime>lastFrame){
      lastFrame=metadata.mediaTime
      try{context.drawImage(video,left,top,width,height,0,0,size.width,size.height);track.requestFrame()}
      catch{dispose();onInterrupted?.('录像画面处理已中断。');return}
    }
    request=video.requestVideoFrameCallback(draw)
  }
  for(const audio of input.getAudioTracks())stream.addTrack(audio)
  signal.addEventListener('abort',dispose,{once:true})
  request=video.requestVideoFrameCallback(draw)
  return {stream,method,renderer:'preview',canvas,pixelsMirrored:mirror,dispose}
}
/** Original audio tracks are shared, never stopped by this output wrapper. */
export async function createCaptureOutput(input:MediaStream,video:HTMLVideoElement,spec:CaptureSpec,signal:AbortSignal,onInterrupted?:(reason:string)=>void,mirror=false,preferRaw=spec.fps===60):Promise<CaptureOutput>{
  if(signal.aborted)throw new DOMException('相机检查已取消','AbortError')
  const track=input.getVideoTracks()[0] as ZoomTrack
  const source={width:video.videoWidth,height:video.videoHeight}
  const unchanged=():CaptureOutput|Promise<CaptureOutput>=>{
    const method=spec.zoom===1?'original':'hardware'
    if(mirror&&!isAppleMobile())return renderCameraOutput(input,video,source,1,true,method,signal,preferRaw,onInterrupted)
    // Preserve camera timestamps on iOS when mirroring is the only operation.
    // Review and export apply the MP4 display transform without re-encoding.
    return {stream:input,method,mirrorInFile:mirror,dispose:()=>{}}
  }
  const caps=track.getCapabilities?.().zoom
  const applyZoom=(zoom:number)=>{
    const constraints=track.getConstraints?.()??{}
    const advanced=(constraints.advanced??[])
      .map(({zoom:previous,...entry}:MediaTrackConstraintSet&{zoom?:number})=>entry)
      .filter(entry=>Object.keys(entry).length>0)
    return track.applyConstraints({...constraints,advanced:[...advanced,{zoom} as MediaTrackConstraintSet]})
  }
  // Reusing a camera track must undo the previous hardware zoom before 1× or
  // software crop. Otherwise switching back from 3× can silently stay zoomed in.
  const reset=async()=>{if((track.getSettings?.().zoom??1)!==1){await applyZoom(1);if(Math.abs((track.getSettings().zoom??0)-1)>.05)throw new Error('相机未确认恢复 1×，请重试切换。')}}
  if(spec.zoom===1){await reset();return unchanged()}
  if(caps&&caps.min<=spec.zoom&&caps.max>=spec.zoom){
    try{
      await applyZoom(spec.zoom)
      if(signal.aborted)throw new DOMException('相机检查已取消','AbortError')
      if(Math.abs((track.getSettings().zoom??0)-spec.zoom)<.05)return unchanged()
      // A browser may accept and ignore a constraint. Do not apply a second crop
      // over an unknown zoom: reacquire instead of pretending the output is 2×.
      if((track.getSettings().zoom??1)!==1)throw new Error('浏览器没有确认变焦倍率，请重新打开相机。')
    }catch(error){if(signal.aborted||!(error instanceof DOMException&&error.name==='OverconstrainedError'))throw error}
  }
  if(signal.aborted)throw new DOMException('相机检查已取消','AbortError')
  await reset()
  return renderCameraOutput(input,video,source,spec.zoom,mirror,'digital',signal,preferRaw,onInterrupted)
}
