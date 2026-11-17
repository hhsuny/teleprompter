import {openCameraCapture,type CameraReport} from './camera.ts'
import type {CaptureSpec} from './capture-spec.ts'

export type CaptureCheck={spec:CaptureSpec;report?:CameraReport;error?:string}
export const captureModes=[{resolution:'1080p',fps:30},{resolution:'1080p',fps:60},{resolution:'4k',fps:30},{resolution:'4k',fps:60}] as const
export const captureModeLabel=(mode:Pick<CaptureSpec,'resolution'|'fps'>)=>`${mode.resolution==='4k'?'4K':'1080P'}／${mode.fps} 帧`

export async function runCaptureMatrix(video:HTMLVideoElement,facing:CaptureSpec['facing'],bitrate:number,signal:AbortSignal,
  onProgress:(message:string)=>void,onResult:(result:CaptureCheck)=>void,open:typeof openCameraCapture=openCameraCapture,pixelMirror=false){
  for(const mode of captureModes){
    if(signal.aborted)break
    const spec:CaptureSpec={...mode,facing,zoom:1}
    let report:CameraReport|undefined
    let result:CaptureCheck
    try{
      const live=await open(video,spec,{signal,bitrate,measureInput:true,retry60:mode.fps===60,pixelMirror,
        onProgress:message=>onProgress(`${captureModeLabel(mode)} · ${message}`),onReport:value=>{report=value}})
      try{result={spec,report:live.report}}
      finally{live.output.dispose();live.stream.getTracks().forEach(track=>track.stop())}
    }catch(error){result={spec,report,error:error instanceof Error?error.message:'无法完成本档试录。'}}
    finally{video.srcObject=null}
    if(signal.aborted)break
    onResult(result)
    if(result.error&&/权限未允许|需要安全连接|浏览器无法打开相机/.test(result.error))break
  }
}
