import {inspectMp4,inspectMp4Format,mirrorMp4,normalizePortraitMp4} from './mp4.ts'
import {highFrameRateFormats,recordingOptions} from './capture-format.ts'

import {defaultCapture,captureDimensions,matchesDimensions,matchesRate,specLabel,type CaptureSpec} from './capture-spec.ts'
import {canScaleToFullHd,createCaptureOutput,createFullHdOutput,type CaptureOutput} from './zoom.ts'
import {sampleCameraInput} from './camera-input.ts'
import type {InputFrames} from './frame-sampler.ts'
import {isAppleMobile} from './fullscreen.ts'
type Settings=Pick<MediaTrackSettings,'width'|'height'|'frameRate'|'facingMode'>
type Preview={width:number;height:number;fps:number|null;frameWidth?:number;frameHeight?:number}
export type CameraAttempt={step:string;settings?:Settings;preview?:Preview;input?:InputFrames;fileDimensions?:{width:number;height:number};fileFps?:number;error?:string}
export type CameraReport={version:2;userAgent:string;frameRateConstraint:boolean;capabilities?:{frameRate?:{min?:number;max?:number};width?:{min?:number;max?:number};height?:{min?:number;max?:number}};attempts:CameraAttempt[];trackFps?:number;observedFps?:number;input?:InputFrames;previewDimensions?:{width:number;height:number};fileFps?:number;fileDimensions?:{width:number;height:number};fileHasAudio?:boolean;portraitCorrection?:boolean;preferredMime?:string;target?:CaptureSpec;zoomMethod?:CaptureOutput['method'];hd60Alternative?:boolean;bitrate?:number;verified:boolean;reason?:string}

export function isFullHd({width=0,height=0}:Settings){return Math.min(width,height)===1080&&Math.max(width,height)===1920}
export function isTargetCapture(settings:Settings,spec:CaptureSpec=defaultCapture){return matchesDimensions(settings,spec)&&matchesRate(settings.frameRate,spec.fps)}
export function hasFullPreview(preview:Pick<Preview,'width'|'height'|'frameWidth'|'frameHeight'>,spec:CaptureSpec){
  if(!matchesDimensions(preview,spec))return false
  if(preview.frameWidth&&preview.frameHeight)return matchesDimensions({width:preview.frameWidth,height:preview.frameHeight},spec)
  return true
}
type MeasuredCameraReport=CameraReport&{fileFps:number;fileDimensions:{width:number;height:number}}
function hasCalibratedCapture(report:CameraReport|null,spec:CaptureSpec):report is MeasuredCameraReport{
  return !!report?.target&&(['resolution','fps','facing','zoom'] as const).every(key=>report.target![key]===spec[key])&&
    report.fileHasAudio===true&&Number.isFinite(report.fileFps)&&report.fileFps!>0&&!!report.fileDimensions
}
export function isVerifiedCapture(report:CameraReport|null,spec:CaptureSpec){
  return hasCalibratedCapture(report,spec)&&report.verified&&matchesRate(report.fileFps,spec.fps)&&
    report.fileDimensions.height>report.fileDimensions.width&&matchesDimensions(report.fileDimensions,spec)
}
export function canUseMeasuredCapture(report:CameraReport|null,spec:CaptureSpec):report is MeasuredCameraReport{
  return hasCalibratedCapture(report,spec)&&report.fileDimensions.height>report.fileDimensions.width&&
    !(spec.fps===60&&report.fileFps>=59&&report.input&&report.input.fps<59)
}
export function suggestedCapture(report:CameraReport|null,spec:CaptureSpec):CaptureSpec|null{
  if(!report||isVerifiedCapture(report,spec))return null
  const fps=report.input&&report.input.fps<59?report.input.fps:report.fileFps??report.trackFps??report.capabilities?.frameRate?.max
  const next={...spec}
  if(spec.fps===60&&fps!==undefined&&fps>0&&fps<59&&report.fileHasAudio!==false)next.fps=30
  const lastPreview=report.previewDimensions??report.attempts.filter(attempt=>attempt.preview).at(-1)?.preview
  const dimensions=report.fileDimensions??lastPreview
  if(spec.resolution==='4k'&&dimensions&&!matchesDimensions(dimensions,spec))next.resolution='1080p'
  if(next.fps!==spec.fps||next.resolution!==spec.resolution)return next
  if(spec.zoom!==1&&report.fileHasAudio!==false)return {...spec,zoom:1}
  return null
}
export function isVerified60(report:CameraReport|null){return !!report?.verified&&Number.isFinite(report.fileFps)&&report.fileFps!>=59}
export function summarizeSettings({width,height,frameRate,facingMode}:MediaTrackSettings):Settings{return {width,height,frameRate,facingMode}}
const rate=(fps:number)=>({min:fps===60?59:29,ideal:fps,max:fps})
export function captureProfiles(spec:CaptureSpec=defaultCapture):MediaTrackConstraints[]{
  const [long,short]=captureDimensions(spec)
  return [[long,short],[short,long]].map(([width,height])=>({facingMode:{exact:spec.facing},width:{ideal:width},height:{ideal:height},frameRate:{ideal:spec.fps}}))
}
export function cameraRequests(spec:CaptureSpec,canRequestFrameRate:boolean):MediaTrackConstraints[]{
  const soft=captureProfiles(spec),fallback={facingMode:{exact:spec.facing}}
  if(spec.fps!==60||!canRequestFrameRate)return [...soft,fallback]
  const [width,height]=captureDimensions(spec)
  const frameRate={min:59,ideal:60}
  return [{...soft[0],width:{exact:width},height:{exact:height},frameRate},{...soft[0],frameRate},...soft,fallback]
}

const originalSound:MediaTrackConstraints={echoCancellation:false,noiseSuppression:false,autoGainControl:false}
const originalFront60:MediaTrackConstraints={facingMode:{exact:'user'},width:{ideal:1080},height:{ideal:1920},aspectRatio:{ideal:9/16},frameRate:{exact:60}}
type CameraProfile={video:MediaTrackConstraints;audio:boolean|MediaTrackConstraints;probe?:'original'|'wide'|'portrait'|'separate'|'4k-input'|'larger-input'|'rate-first'}

function openProfiles(spec:CaptureSpec,canRequestFrameRate:boolean,retry:boolean,appleMobile:boolean,diagnostic:boolean,preferHighRateHd:boolean):CameraProfile[]{
  const normal=cameraRequests(spec,canRequestFrameRate).map(video=>({video,audio:true}))
  const [wide,portrait]=captureProfiles(spec)
  if(spec.fps===30&&diagnostic&&spec.resolution==='4k'){
    const [width,height]=captureDimensions(spec)
    return [{video:{...wide,width:{exact:width},height:{exact:height}},audio:true,probe:'wide'},
      {video:portrait,audio:true,probe:'portrait'},...normal]
  }
  if(spec.fps!==60||!canRequestFrameRate)return normal
  const original:CameraProfile[]=[]
  const highRate:CameraProfile[]=[]
  if(appleMobile&&spec.facing==='user'&&spec.resolution==='1080p'&&spec.zoom===1){
    original.push({video:originalFront60,audio:originalSound,probe:'original'})
    if(retry||preferHighRateHd){
      const frameRate={min:59,ideal:60},facingMode={exact:spec.facing}
      highRate.push({video:{facingMode,width:{exact:3840},height:{exact:2160},frameRate},audio:true,probe:'4k-input'},
        // Let Safari pick another native preset, including 4:3 presets between HD and 4K.
        {video:{facingMode,width:{min:1920},height:{min:1081},frameRate},audio:true,probe:'larger-input'},
        {video:{facingMode,frameRate},audio:true,probe:'rate-first'})
    }
  }
  const first=preferHighRateHd?[...highRate,...original]:[...original,...highRate]
  if(!retry)return [...first,...normal]
  return [...first,
    {video:{...wide,frameRate:{exact:60}},audio:originalSound,probe:'wide'},
    {video:portrait,audio:true,probe:'portrait'},
    {video:{...wide,frameRate:{exact:60}},audio:false,probe:'separate'},
    ...normal]
}
function promotions(spec:CaptureSpec,requested?:MediaTrackConstraints):MediaTrackConstraints[]{
  const [long,short]=captureDimensions(spec)
  return [{...requested,frameRate:rate(spec.fps)},...[[long,short],[short,long]].map(([width,height])=>({...requested,width:{exact:width},height:{exact:height},frameRate:rate(spec.fps)}))]
}
const checkAbort=(signal:AbortSignal)=>{if(signal.aborted)throw new DOMException('相机检查已取消','AbortError')}
const describe=(error:unknown)=>error instanceof Error?`${error.name}: ${error.message}`:String(error)

/** Read live settings only after frames arrive; startup settings can still describe the old preset. */
export async function promoteTrack(track:Pick<MediaStreamTrack,'getSettings'|'applyConstraints'>&Partial<Pick<MediaStreamTrack,'getCapabilities'|'getConstraints'>>,settle:()=>Promise<Preview>,record:(attempt:CameraAttempt)=>void,signal:AbortSignal,spec:CaptureSpec=defaultCapture,initialRequest?:MediaTrackConstraints){
  let preview=await settle();checkAbort(signal)
  const initial=summarizeSettings(track.getSettings())
  record({step:'首帧稳定后',settings:initial,preview})
  if(isTargetCapture(initial,spec)&&hasFullPreview(preview,spec)&&preview.height>preview.width)return preview
  const capabilities=track.getCapabilities?.() as (MediaTrackCapabilities&{focusMode?:string[]})|undefined
  const continuousFocus:MediaTrackConstraintSet&{focusMode:string}={focusMode:'continuous'}
  const requested=initialRequest??track.getConstraints?.()
  // applyConstraints replaces the entire set. Keep dimensions and camera preferences when locking the rate.
  const attempts=promotions(spec,requested)
  // The front sensor can deliver an upright image from a wide request. Forcing
  // portrait constraints on that stream can replace it with an upright wide crop.
  const frontWithWideRequest=spec.facing==='user'&&requested?.width!==undefined&&requested.height!==undefined&&
    typeof requested.width==='object'&&typeof requested.height==='object'&&(requested.width.exact??requested.width.ideal??0)>(requested.height.exact??requested.height.ideal??0)
  if(frontWithWideRequest)attempts.pop()
  if(frontWithWideRequest&&spec.fps===60&&capabilities?.frameRate?.max!==undefined&&capabilities.frameRate.max<59&&
    hasFullPreview(preview,spec)&&preview.height>preview.width)return preview
  for(const [index,constraints] of attempts.entries()){
    checkAbort(signal)
    try{
      const options=capabilities?.focusMode?.includes('continuous')?{...constraints,advanced:[...(constraints.advanced??[]),continuousFocus]}:constraints
      await track.applyConstraints(options);checkAbort(signal)
      preview=await settle();checkAbort(signal)
      record({step:`${spec.fps} 帧协商 ${index+1}`,settings:summarizeSettings(track.getSettings()),preview})
      // On iPhone the sensor-oriented request can be needed for portrait capture.
      // Keep a full-size stream from that request for the file orientation check.
      if(isTargetCapture(track.getSettings(),spec)&&hasFullPreview(preview,spec)&&(preview.height>preview.width||index===1&&!frontWithWideRequest))return preview
    }catch(error){checkAbort(signal);record({step:`${spec.fps} 帧协商 ${index+1}`,error:describe(error)})}
  }
  if(frontWithWideRequest&&preview.width>=preview.height){
    try{
      await track.applyConstraints(requested);checkAbort(signal)
      preview=await settle();checkAbort(signal)
      record({step:'恢复前置取景参数',settings:summarizeSettings(track.getSettings()),preview})
    }catch(error){checkAbort(signal);record({step:'恢复前置取景参数',error:describe(error)})}
  }
  return preview
}

function requestMedia(constraints:MediaStreamConstraints,signal:AbortSignal):Promise<MediaStream>{
  checkAbort(signal)
  return new Promise((resolve,reject)=>{
    let finished=false
    const finish=(error?:unknown,media?:MediaStream)=>{
      if(finished){media?.getTracks().forEach(t=>t.stop());return}
      finished=true;clearTimeout(timer);signal.removeEventListener('abort',abort)
      if(error)reject(error);else resolve(media!)
    }
    const abort=()=>finish(new DOMException('相机检查已取消','AbortError'))
    const timer=setTimeout(()=>finish(new Error('等待相机权限超时，请允许相机与麦克风权限后重试。')),30_000)
    signal.addEventListener('abort',abort,{once:true})
    navigator.mediaDevices.getUserMedia(constraints).then(media=>finish(undefined,media),finish)
  })
}

function observeVideo(video:HTMLVideoElement,signal:AbortSignal):Promise<Preview>{
  checkAbort(signal)
  return new Promise((resolve,reject)=>{
    let callback=0,firstTime=0,firstFrames=0,finished=false
    let stableWidth=0,stableHeight=0
    const startTime=video.currentTime
    const finish=(error?:unknown,fps:number|null=null,meta?:VideoFrameCallbackMetadata)=>{
      if(finished)return
      finished=true;clearTimeout(deadline);clearInterval(poll);signal.removeEventListener('abort',abort)
      if(callback)video.cancelVideoFrameCallback?.(callback)
      if(error)reject(error);else resolve({width:video.videoWidth,height:video.videoHeight,fps,frameWidth:meta?.width,frameHeight:meta?.height})
    }
    const abort=()=>finish(new DOMException('相机检查已取消','AbortError'))
    const frame=(now:number,meta:VideoFrameCallbackMetadata)=>{
      if(!firstTime||stableWidth!==meta.width||stableHeight!==meta.height){
        firstTime=now;firstFrames=meta.presentedFrames;stableWidth=meta.width;stableHeight=meta.height
      }
      if(now-firstTime>=900){finish(undefined,(meta.presentedFrames-firstFrames)*1000/(now-firstTime),meta);return}
      callback=video.requestVideoFrameCallback(frame)
    }
    const deadline=setTimeout(()=>finish(new Error('相机未及时输出预览画面，请保持页面在前台后重试。')),5000)
    // Some browsers defer frame callbacks while the startup card covers the video.
    const poll=setInterval(()=>{if(!firstTime&&video.readyState>=2&&video.videoWidth&&video.currentTime-startTime>=1.25)finish()},100)
    signal.addEventListener('abort',abort,{once:true})
    if(video.requestVideoFrameCallback)callback=video.requestVideoFrameCallback(frame)
  })
}

/** Discarded local calibration clip: raw camera stream, same encoder targets as a real take. */
export function recordCalibration(stream:MediaStream,signal:AbortSignal,bitrate=16_000_000,preferredMime?:string,durationMs=3000,timeslice?:number):Promise<Blob>{
  checkAbort(signal)
  const options=recordingOptions(true,bitrate,preferredMime)
  return new Promise((resolve,reject)=>{
    const recorder=new MediaRecorder(stream,options),chunks:Blob[]=[]
    let finished=false
    const finish=(error?:unknown)=>{
      if(finished)return
      finished=true;clearTimeout(stop);clearTimeout(deadline);signal.removeEventListener('abort',abort)
      if(recorder.state!=='inactive')try{recorder.stop()}catch{/* already stopped */}
      if(error)reject(error);else if(chunks.length)resolve(new Blob(chunks,{type:recorder.mimeType}));else reject(new Error('相机测试没有生成视频，请重新检查。'))
    }
    const abort=()=>finish(new DOMException('相机检查已取消','AbortError'))
    const stop=setTimeout(()=>{if(recorder.state!=='inactive')try{recorder.stop()}catch(error){finish(error)}},durationMs)
    const deadline=setTimeout(()=>finish(new Error('相机测试片段未及时完成，请重试。')),durationMs+5000)
    recorder.ondataavailable=event=>{if(!finished&&event.data.size)chunks.push(event.data)}
    recorder.onerror=()=>finish(new Error('相机测试编码失败，请重新检查。'))
    recorder.onstop=()=>finish()
    signal.addEventListener('abort',abort,{once:true})
    try{recorder.start(timeslice)}catch(error){finish(error)}
  })
}

export type CameraOpenOptions={signal:AbortSignal;onProgress:(message:string)=>void;onReport:(report:CameraReport)=>void;onInterrupted?:(reason:string)=>void;onLive?:(media:MediaStream,output:CaptureOutput)=>void;bitrate?:number;retry60?:boolean;measureInput?:boolean;preferHighRateHd?:boolean;pixelMirror?:boolean}

type Front60Clip={fps?:number;width?:number;height?:number;hasAudio?:boolean;duration?:number;frames?:number;error?:string}
export type Front60Check={settings?:Settings;firstVersionAllowed?:boolean;preview?:Preview;input?:InputFrames;raw?:Front60Clip;mirrored?:Front60Clip;mirrorInFile?:boolean;error?:string}

async function readCameraClip(file:Blob,signal:AbortSignal):Promise<Front60Clip>{
  const [samples,format]=await Promise.all([inspectMp4(file),inspectMp4Format(file)])
  checkAbort(signal)
  return {fps:samples?.fps,duration:samples?.duration,frames:samples?.frames,...format?.display,hasAudio:format?.hasAudio,error:samples?undefined:'读不出成片的帧率。'}
}

export async function compareFront60(video:HTMLVideoElement,signal:AbortSignal,onProgress:(message:string)=>void):Promise<Front60Check>{
  const result:Front60Check={}
  let stream:MediaStream|undefined,output:CaptureOutput|undefined
  const firstVersionAllows=(s:Settings)=>Math.min(s.width??0,s.height??0)>=1080&&Math.max(s.width??0,s.height??0)>=1920&&(s.frameRate??0)>=59
  function recordClip(media:MediaStream){
    const preferredMime=['video/mp4','video/mp4;codecs=avc1.64002a,mp4a.40.2','video/webm;codecs=vp8,opus','video/webm'].find(type=>MediaRecorder.isTypeSupported(type))
    return recordCalibration(media,signal,16_000_000,preferredMime,7000,1000)
  }
  try{
    if(!globalThis.isSecureContext||!navigator.mediaDevices?.getUserMedia||!globalThis.MediaRecorder)throw new Error('请用 Safari 打开此 HTTPS 页面并允许相机和麦克风。')
    onProgress('正在用第一版参数打开前置相机…')
    stream=await requestMedia({video:originalFront60,audio:originalSound},signal)
    const track=stream.getVideoTracks()[0]
    result.settings=summarizeSettings(track.getSettings())
    result.firstVersionAllowed=firstVersionAllows(result.settings)
    if(!result.firstVersionAllowed){
      // The first release performed this retry before attaching a preview.
      try{await track.applyConstraints({width:{ideal:1920},height:{ideal:1080},frameRate:{exact:60}})}
      catch(error){result.error=`第一版会在重新要求 60 帧时停止。${describe(error)}`}
      checkAbort(signal)
      result.settings=summarizeSettings(track.getSettings())
      result.firstVersionAllowed=!result.error&&firstVersionAllows(result.settings)
    }
    video.srcObject=new MediaStream([track]);void video.play().catch(()=>{})
    result.preview=await observeVideo(video,signal)
    result.input=await sampleCameraInput(track,signal)??undefined
    checkAbort(signal)
    onProgress('正在直接录相机原流（7 秒）…')
    let rawFile:Blob|undefined
    try{rawFile=await recordClip(stream);result.raw=await readCameraClip(rawFile,signal)}catch(error){checkAbort(signal);result.raw={error:describe(error)}}
    try{
      const preferRaw=Math.max(result.input?.fps??0,result.preview.fps??0,result.settings.frameRate??0)>=59
      output=await createCaptureOutput(stream,video,defaultCapture,signal,undefined,true,preferRaw)
      result.mirrorInFile=output.mirrorInFile
      onProgress(output.mirrorInFile?'正在检查导出镜像后的原始录像…':'正在用同一条相机流镜像试录（7 秒）…')
      const file=output.mirrorInFile?await mirrorMp4(rawFile??await recordClip(stream),true):await recordClip(output.stream)
      result.mirrored=await readCameraClip(file,signal)
    }catch(error){checkAbort(signal);result.mirrored={error:describe(error)}}
  }catch(error){
    checkAbort(signal)
    result.error=error instanceof DOMException&&error.name==='OverconstrainedError'
      ?'浏览器拒绝了第一版的前置 60 帧请求。':describe(error)
  }finally{
    output?.dispose();stream?.getTracks().forEach(track=>track.stop());video.srcObject=null
  }
  return result
}

const frontRateModes=[['前置 1080P／60','user',1920,1080,60],['前置 720P／60','user',1280,720,60],
  ['前置 4K／60','user',3840,2160,60],['后置 1080P／60','environment',1920,1080,60],
  ['前置 1080P／30','user',1920,1080,30],['后置 1080P／30','environment',1920,1080,30]] as const

export type CameraRateCheck={label:string;request:'首选'|'严格';settings?:Settings;maxFps?:number;input?:InputFrames;preview?:Preview;raw?:Front60Clip;passed?:boolean;error?:string;deviceMatched?:boolean;deviceCount?:number}

export function rateCheckPassed(fps:30|60,width:number,height:number,input:InputFrames|undefined,raw:Front60Clip|undefined,deviceMatched?:boolean){
  if(!raw||deviceMatched===false)return false
  const fileSize=[raw.width??0,raw.height??0]
  if(Math.max(...fileSize)!==width||Math.min(...fileSize)!==height||raw.hasAudio!==true||!matchesRate(raw.fps,fps))return false
  if(fps===60)return !!input&&matchesRate(input.fps,60)&&(raw.duration??0)>=14.5
  return !input||matchesRate(input.fps,fps)
}

type RateCheckConfig={label:string;request:'首选'|'严格';video:MediaTrackConstraints;width:number;height:number;fps:30|60;expectedDeviceId?:string;deviceCount?:number}
async function measureCameraRate(video:HTMLVideoElement,config:RateCheckConfig,signal:AbortSignal,onProgress:(message:string)=>void){
  const {label,request,width,height,fps}=config,result:CameraRateCheck={label,request,deviceCount:config.deviceCount}
  let source:MediaStream|undefined
  try{
    onProgress(`正在打开${label}（${request}）…`)
    source=await requestMedia({video:config.video,audio:originalSound},signal)
    const track=source.getVideoTracks()[0]
    if(config.expectedDeviceId)result.deviceMatched=track.getSettings().deviceId===config.expectedDeviceId
    video.srcObject=new MediaStream([track]);void video.play().catch(()=>{})
    result.preview=await observeVideo(video,signal)
    result.settings=summarizeSettings(track.getSettings())
    result.maxFps=track.getCapabilities?.().frameRate?.max
    result.input=await sampleCameraInput(track,signal)??undefined
    checkAbort(signal)
    const inputFps=result.input?.fps??Math.max(result.settings.frameRate??0,result.preview.fps??0)
    const duration=fps===60&&inputFps>=59?15:4
    onProgress(`正在用原始相机流试录${label}（${duration} 秒）…`)
    result.raw=await readCameraClip(await recordCalibration(source,signal,16_000_000,undefined,duration*1000,1000),signal)
    result.passed=rateCheckPassed(fps,width,height,result.input,result.raw,result.deviceMatched)
  }catch(error){
    checkAbort(signal)
    result.error=describe(error)
  }finally{source?.getTracks().forEach(track=>track.stop());video.srcObject=null}
  return result
}

export async function scanCameraRates(video:HTMLVideoElement,signal:AbortSignal,onProgress:(message:string)=>void,onResult:(result:CameraRateCheck)=>void){
  if(!globalThis.isSecureContext||!navigator.mediaDevices?.getUserMedia||!globalThis.MediaRecorder)throw new Error('请用 Safari 打开此 HTTPS 页面并允许相机和麦克风。')
  for(const [label,facingMode,width,height,fps] of frontRateModes){
    for(const mode of ['ideal','exact'] as const){
      checkAbort(signal)
      const result=await measureCameraRate(video,{label,request:mode==='ideal'?'首选':'严格',width,height,fps,
        video:{facingMode:{exact:facingMode},width:{[mode]:width},height:{[mode]:height},frameRate:{[mode]:fps}}},signal,onProgress)
      onResult(result)
      if(/^(NotAllowedError|SecurityError):/.test(result.error??''))return
      if(result.passed||fps===30)break
    }
  }
}

/** Compare device selection without exporting persistent camera identifiers. */
export async function scanFrontDeviceRates(video:HTMLVideoElement,signal:AbortSignal,onProgress:(message:string)=>void,onResult:(result:CameraRateCheck)=>void){
  if(!globalThis.isSecureContext||!navigator.mediaDevices?.getUserMedia||!globalThis.MediaRecorder)throw new Error('请用 Safari 打开此 HTTPS 页面并允许相机和麦克风。')
  let permission:MediaStream|undefined,frontId='',deviceCount=0
  try{
    onProgress('正在读取当前前置设备，并枚举视频输入…')
    permission=await requestMedia({video:{facingMode:{exact:'user'}},audio:originalSound},signal)
    frontId=permission.getVideoTracks()[0]?.getSettings().deviceId??''
    const devices=await navigator.mediaDevices.enumerateDevices()
    deviceCount=devices.filter(device=>device.kind==='videoinput').length
    if(!frontId)throw new Error('Safari 没有提供当前前置设备 ID，无法进行这组对照。')
  }finally{permission?.getTracks().forEach(track=>track.stop())}
  checkAbort(signal)
  const frameRate={min:59,ideal:60},deviceId={exact:frontId},size={width:{ideal:1920},height:{ideal:1080}}
  const checks:Omit<RateCheckConfig,'expectedDeviceId'|'deviceCount'>[]=[
    {label:'前置 1080P／60 · facingMode 对照',request:'首选',width:1920,height:1080,fps:60,video:{facingMode:{exact:'user'},...size,frameRate}},
    {label:'前置 1080P／60 · 设备 ID',request:'首选',width:1920,height:1080,fps:60,video:{deviceId,...size,frameRate}},
    {label:'前置竖屏 1080P／60 · 设备 ID',request:'首选',width:1920,height:1080,fps:60,video:{deviceId,width:{ideal:1080},height:{ideal:1920},aspectRatio:{ideal:9/16},frameRate}},
    {label:'前置 1080P／60 · 设备 ID 严格参数',request:'严格',width:1920,height:1080,fps:60,video:{deviceId,width:{exact:1920},height:{exact:1080},frameRate:{exact:60}}},
  ]
  for(const check of checks){
    checkAbort(signal)
    const result=await measureCameraRate(video,{...check,expectedDeviceId:frontId,deviceCount},signal,onProgress)
    onResult(result)
    if(/^(NotAllowedError|SecurityError):/.test(result.error??''))return
  }
}

/** Check the current output without reacquiring the camera or microphone. */
export async function verifyCaptureOutput(media:MediaStream,output:CaptureOutput,spec:CaptureSpec,report:CameraReport,signal:AbortSignal){
  report.verified=false;report.target={...spec};report.zoomMethod=output.method
  report.fileDimensions=undefined;report.fileFps=undefined;report.fileHasAudio=undefined;report.portraitCorrection=undefined
  if(!media.getAudioTracks().length||[...media.getTracks(),...output.stream.getTracks()].some(t=>t.readyState!=='live'||t.muted))throw new Error('相机或麦克风已中断，请重试。')
  const highRateProcessing=spec.fps===60&&output.renderer==='raw'&&Math.max(report.input?.fps??0,report.observedFps??0,report.trackFps??0)>=59
  const durationMs=highRateProcessing?(output.method==='downscale'?8000:5000):3000
  let clip=await recordCalibration(output.stream,signal,report.bitrate,report.preferredMime,durationMs);checkAbort(signal)
  const [inspection,format]=await Promise.all([inspectMp4(clip),inspectMp4Format(clip)]);checkAbort(signal)
  let dimensions=format?.display
  if(spec.facing==='user'&&globalThis.matchMedia?.('(orientation: portrait)').matches&&format&&dimensions&&
    dimensions.width>dimensions.height&&format.encoded.height>format.encoded.width){
    clip=await normalizePortraitMp4(clip)
    dimensions=(await inspectMp4Format(clip))?.display;checkAbort(signal)
    report.portraitCorrection=!!dimensions&&dimensions.height>dimensions.width
  }
  if([...media.getTracks(),...output.stream.getTracks()].some(t=>t.readyState!=='live'||t.muted))throw new Error('测试期间相机、变焦画面或麦克风已中断，请重试。')
  report.fileDimensions=dimensions??undefined;report.fileFps=inspection?.fps;report.fileHasAudio=format?.hasAudio
  if(format&&!format.hasAudio)throw new Error('测试录像没有音轨，请重新授权麦克风后重试。')
  if(!dimensions)throw new Error('未能读取测试成片分辨率。')
  if(!matchesDimensions(dimensions,spec))throw new Error(`测试成片分辨率为 ${dimensions.width} × ${dimensions.height}，未达到所选规格。`)
  if(dimensions.width>=dimensions.height)throw new Error('当前规格会录成横屏视频，请调整拍摄规格后重试。')
  if(!inspection||!matchesRate(inspection.fps,spec.fps))throw new Error(inspection?`测试文件实际为 ${inspection.fps.toFixed(2)} 帧 / 秒，未达到所选 ${spec.fps} 帧目标。`:'无法确认测试文件的实际帧率。')
  if(spec.fps===60&&report.input&&!matchesRate(report.input.fps,60))throw new Error(`相机原始输入实测 ${report.input.fps.toFixed(2)} 帧 / 秒，未达到 60 帧。`)
  if(output.mirrorInFile){await mirrorMp4(clip,true);checkAbort(signal)}
  report.verified=true;report.reason=`${durationMs/1000} 秒试录成片已通过。长时间拍摄与语音同时运行仍需实测。`
  return report
}

async function verifyWithAlternatives(media:MediaStream,output:CaptureOutput,spec:CaptureSpec,report:CameraReport,signal:AbortSignal,onProgress:CameraOpenOptions['onProgress']){
  try{return await verifyCaptureOutput(media,output,spec,report,signal)}
  catch(initialError){
    checkAbort(signal)
    // Changing encoders can only help when the source actually supports the higher cadence.
    if(spec.fps!==60||Math.max(report.input?.fps??0,report.observedFps??0,report.trackFps??0)<59||report.fileHasAudio===false||!globalThis.MediaRecorder)throw initialError
    const original=recordingOptions(true,report.bitrate).mimeType
    const formats=spec.resolution==='4k'?[highFrameRateFormats[1],'video/mp4;codecs=avc1.640034,mp4a.40.2']:highFrameRateFormats
    for(const mime of formats){
      if(mime===original||!MediaRecorder.isTypeSupported(mime))continue
      const candidate:CameraReport={...report,preferredMime:mime}
      onProgress('相机已提供高帧率，正在尝试另一种编码…')
      try{
        await verifyCaptureOutput(media,output,spec,candidate,signal)
        report.attempts.push({step:`通过 ${mime.includes('hvc1')?'HEVC':'H.264'} 检查 · ${candidate.fileFps?.toFixed(2)} 帧`})
        return Object.assign(report,candidate)
      }catch(error){
        checkAbort(signal)
        report.attempts.push({step:mime.includes('hvc1')?'HEVC 编码':'H.264 高帧率编码',error:describe(error)})
      }
    }
    throw initialError
  }
}
export async function openCameraCapture(video:HTMLVideoElement,spec:CaptureSpec,options:CameraOpenOptions){
  const {signal,onProgress,onReport}=options
  if(!isSecureContext)throw new Error('相机需要安全连接，请用 HTTPS 地址在 Safari 打开。')
  if(!navigator.mediaDevices?.getUserMedia)throw new Error('当前浏览器无法打开相机，请使用 Safari。')
  const supported=navigator.mediaDevices.getSupportedConstraints()
  const baseline:CameraReport={version:2,userAgent:navigator.userAgent,frameRateConstraint:!!supported.frameRate,attempts:[],verified:false,bitrate:options.bitrate??16_000_000,target:{...spec}}
  let report=baseline
  let stream:MediaStream|undefined,previewStream:MediaStream|undefined,output:CaptureOutput|undefined,lastError:unknown
  try{
    const appleMobile=isAppleMobile()
    const profiles=openProfiles(spec,baseline.frameRateConstraint,!!options.retry60,appleMobile,!!options.measureInput,!!options.preferHighRateHd)
    for(const [index,{video:profile,audio,probe}] of profiles.entries()){
      checkAbort(signal)
      report={...baseline}
      const probeNames={original:'首版竖屏',wide:'宽幅取流',portrait:'竖屏兼容取流',separate:'单开镜头后接入麦克风','4k-input':'4K 取流','larger-input':'高于 1080P 的相机模式','rate-first':'优先请求 60 帧'}
      const name=probe?probeNames[probe]:`兼容方案 ${index+1}`
      const highRateHd=probe==='4k-input'||probe==='larger-input'||probe==='rate-first'
      try{
        onProgress(probe?`正在测试 ${spec.fps} 帧 · ${name}…`:index?'正在尝试兼容相机参数…':`正在打开${spec.facing==='user'?'前置':'后置'}相机，请允许相机与麦克风…`)
        stream=await requestMedia({video:profile,audio},signal);checkAbort(signal)
        const track=stream.getVideoTracks()[0],caps=track.getCapabilities?.()
        // Only numeric ranges are exported; camera IDs and labels stay out of diagnostics.
        const range=(value?:{min?:number;max?:number})=>value?{min:value.min,max:value.max}:undefined
        report.capabilities={frameRate:range(caps?.frameRate),width:range(caps?.width),height:range(caps?.height)}
        report.attempts.push({step:`${name}（首帧前）`,settings:summarizeSettings(track.getSettings())})
        previewStream=new MediaStream([track])
        video.muted=true;video.playsInline=true;video.srcObject=previewStream
        // Do not await play(): Safari may leave that promise pending until capture has settled.
        void video.play().catch(()=>{})
        if(!probe)onProgress(`正在等待画面稳定，并协商 ${specLabel(spec)}…`)
        const reportAttempt=(attempt:CameraAttempt)=>report.attempts.push(attempt)
        let preview=probe?await observeVideo(video,signal):await promoteTrack(track,()=>observeVideo(video,signal),reportAttempt,signal,spec,profile)
        if(probe==='original'&&!isTargetCapture(track.getSettings(),spec)&&!matchesRate(preview.fps??undefined,60)){
          // The original app also retried once with the sensor's wide orientation.
          const [width,height]=captureDimensions(spec)
          await track.applyConstraints({width:{ideal:width},height:{ideal:height},frameRate:{exact:60}});checkAbort(signal)
          preview=await observeVideo(video,signal)
        }
        if(probe)reportAttempt({step:name,settings:summarizeSettings(track.getSettings()),preview})
        report.previewDimensions={width:preview.width,height:preview.height}
        report.observedFps=preview.fps??undefined
        report.trackFps=track.getSettings().frameRate
        if(track.getSettings().facingMode&&track.getSettings().facingMode!==spec.facing)throw new Error('浏览器未打开所选镜头，请重试。')
        if(probe==='separate'){
          if(!hasFullPreview(preview,spec)||!options.measureInput&&Math.max(report.observedFps??0,report.trackFps??0)<59)throw new Error('镜头单开时没有收到所选分辨率的 60 帧。')
          const audio=await requestMedia({video:false,audio:true},signal)
          for(const microphone of audio.getAudioTracks())stream.addTrack(microphone)
          checkAbort(signal)
        }
        if(highRateHd&&(preview.height<=preview.width||!canScaleToFullHd(preview)))throw new Error(`取流只提供 ${preview.width} × ${preview.height}，无法输出高清竖屏。`)
        if(options.measureInput||highRateHd){
          onProgress(`正在测量相机原始帧 · ${name}…`)
          report.input=await sampleCameraInput(track,signal)??undefined;checkAbort(signal)
        }
        if(highRateHd){
          const source=report.input??{width:preview.frameWidth??preview.width,height:preview.frameHeight??preview.height}
          if(!canScaleToFullHd(source))throw new Error(`相机原始帧为 ${source.width} × ${source.height}，低于 1080P。`)
          if((report.input?.fps??Math.max(report.observedFps??0,report.trackFps??0))<59)throw new Error('这个相机模式没有收到接近 60 帧的输入。')
        }
        // Keep any usable picture even if this camera mode cannot produce the selected file.
        const showPreview=(reason:string)=>{
          report.reason=reason
          output??={stream:stream!,method:'original',dispose:()=>{}}
          options.onLive?.(stream!,output);onReport(report);return {stream:stream!,output,report}
        }
        const onOutputInterrupted=(reason:string)=>{if(!probe||report.verified)options.onInterrupted?.(reason)}
        const tryRaw=spec.fps===60&&Math.max(report.input?.fps??0,report.observedFps??0,report.trackFps??0)>=59
        const prepareOutput=(preferRaw=tryRaw)=>highRateHd&&!hasFullPreview(preview,spec)
          ?createFullHdOutput(stream!,video,signal,onOutputInterrupted,options.pixelMirror,preferRaw)
          :createCaptureOutput(stream!,video,spec,signal,onOutputInterrupted,options.pixelMirror,preferRaw)
        try{
          output=await prepareOutput()
          checkAbort(signal)
        }
        catch(error){
          checkAbort(signal)
          if(probe)throw error
          return showPreview(`取景已开启。${error instanceof Error?error.message:'所选变焦不可用于录制，请切回 1×。'}`)
        }
        if(!probe)options.onLive?.(stream,output)
        onProgress(probe?`正在检查试录 · ${name}…`:'正在检查文件的实际帧率和音轨…')
        try{
          try{await verifyWithAlternatives(stream,output,spec,report,signal,onProgress)}
          catch(error){
            checkAbort(signal)
            if(output.renderer!=='raw'||report.fileDimensions&&report.fileFps!==undefined)throw error
            reportAttempt({step:'原始帧处理 · 结果',error:describe(error)})
            output.dispose()
            output=await prepareOutput(false);checkAbort(signal)
            if(!probe)options.onLive?.(stream,output)
            await verifyWithAlternatives(stream,output,spec,report,signal,onProgress)
          }
        }
        catch(error){
          checkAbort(signal)
          if(probe||track.readyState!=='live'||track.muted||!video.videoWidth||!video.videoHeight)throw error
          report.reason=`取景已开启。${error instanceof Error?error.message:'成片检查未通过，请调整拍摄规格。'}`
        }
        if(highRateHd&&report.verified)report.hd60Alternative=true
        if(probe)options.onLive?.(stream,output)
        reportAttempt({step:`${name} · ${report.verified?'成片通过':'结果'}`,input:report.input,fileDimensions:report.fileDimensions,fileFps:report.fileFps})
        onReport(report);return {stream,output,report}
      }catch(error){
        lastError=error;report.attempts.push({step:`${name} · 结果`,input:report.input,fileDimensions:report.fileDimensions,fileFps:report.fileFps,error:describe(error)})
        output?.dispose();output=undefined;stream?.getTracks().forEach(t=>t.stop());if(previewStream&&video.srcObject===previewStream)video.srcObject=null;stream=undefined
        checkAbort(signal)
        if(error instanceof DOMException&&(['NotAllowedError','SecurityError'].includes(error.name)||!probe&&error.name==='NotReadableError'))throw error
      }
    }
    throw lastError
  }catch(error){
    output?.dispose();output=undefined;stream?.getTracks().forEach(t=>t.stop());checkAbort(signal)
    let reason=error instanceof Error?error.message:'无法完成所选规格检查。'
    if(error instanceof DOMException){
      if(error.name==='NotAllowedError')reason='相机或麦克风权限未允许。请在 Safari 网站设置中允许后重试。'
      if(error.name==='NotReadableError')reason='相机正被占用或无法读取，请关闭其他拍摄应用后重试。'
      if(error.name==='OverconstrainedError')reason=`当前浏览器没有接受 ${specLabel(spec)} 请求。请主动选择其他规格后重试。`
    }
    report.reason=reason;onReport(report)
    throw new Error(reason)
  }
}
