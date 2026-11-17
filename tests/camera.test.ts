import {test} from 'node:test'
import assert from 'node:assert/strict'
import {cameraRequests,canUseMeasuredCapture,captureProfiles,hasFullPreview,isTargetCapture,isVerified60,isVerifiedCapture,openCameraCapture,promoteTrack,rateCheckPassed,suggestedCapture,summarizeSettings,verifyCaptureOutput,type CameraAttempt,type CameraReport} from '../src/camera.ts'
import {defaultCapture,cropRectangle,type CaptureSpec} from '../src/capture-spec.ts'
test('接受实际前置1080p60参数，包括旋转后的尺寸',()=>{assert.ok(isTargetCapture({width:1080,height:1920,frameRate:60}));assert.ok(isTargetCapture({width:1920,height:1080,frameRate:59.94}))})
test('不把30帧、720p或未知参数标记为1080p60',()=>{assert.equal(isTargetCapture({width:1080,height:1920,frameRate:30}),false);assert.equal(isTargetCapture({width:720,height:1280,frameRate:60}),false);assert.equal(isTargetCapture({width:1080,height:1920}),false)})

const portrait={width:1080,height:1920,fps:60}
test('首帧稳定后已取得正确竖屏和帧率时保留相机原配置',async()=>{
  let settings={width:1920,height:1080,frameRate:30},applied=0,settled=false
  const events:CameraAttempt[]=[]
  await promoteTrack({getSettings:()=>{assert.ok(settled);return settings},applyConstraints:async()=>{applied++}},async()=>{settings={width:1080,height:1920,frameRate:59.94};settled=true;return portrait},event=>events.push(event),new AbortController().signal)
  assert.equal(applied,0);assert.equal(events[0].settings?.frameRate,59.94)
})
test('预览稳定后先只协商帧率，等新画面后再检查',async()=>{
  let settings={width:1080,height:1920,frameRate:30},settles=0
  const constraints:MediaTrackConstraints[]=[]
  await promoteTrack({getSettings:()=>settings,applyConstraints:async value=>{constraints.push(value!)}},async()=>{if(++settles===2)settings={...settings,frameRate:60};return portrait},()=>{},new AbortController().signal)
  assert.equal(settles,2);assert.equal(constraints.length,1)
  assert.deepEqual(constraints[0],{frameRate:{min:59,ideal:60,max:60}})
})
test('协商帧率保留已有高清尺寸、镜头和未缩放偏好',async()=>{
  const requested={width:{ideal:1920},height:{ideal:1080},facingMode:{exact:'user'},resizeMode:{ideal:'none'}}
  let applied:MediaTrackConstraints|undefined
  await promoteTrack({getSettings:()=>({width:1080,height:1920,frameRate:applied?60:30}),getConstraints:()=>requested,applyConstraints:async value=>{applied=value}},async()=>portrait,()=>{},new AbortController().signal)
  assert.deepEqual(applied,{...requested,frameRate:{min:59,ideal:60,max:60}})
})
test('前置在竖屏首帧后只支持30帧时保留完整取景',async()=>{
  const request=captureProfiles()[0]
  const settings={width:1080,height:1920,frameRate:30}
  let changes=0
  const preview=await promoteTrack({getSettings:()=>settings,getCapabilities:()=>({frameRate:{min:15,max:30}}),applyConstraints:async()=>{changes++}},async()=>({...portrait,fps:30}),()=>{},new AbortController().signal,defaultCapture,request)
  assert.equal(changes,0);assert.equal(preview.width,1080)
})
test('前置60帧协商使画面变宽时恢复初始取景参数，避免请求反向尺寸',async()=>{
  const request=captureProfiles()[0],constraints:MediaTrackConstraints[]=[]
  const preview=await promoteTrack({getSettings:()=>({width:1080,height:1920,frameRate:30}),applyConstraints:async value=>{constraints.push(value!)}},async()=>[0,3].includes(constraints.length)?{...portrait,fps:30}:{width:1920,height:1080,fps:30},()=>{},new AbortController().signal,defaultCapture,request)
  assert.equal(constraints.length,3)
  assert.deepEqual(constraints[1].width,{exact:1920});assert.deepEqual(constraints[2],request)
  assert.equal(preview.width,1080)
})
test('60 帧请求从打开相机起要求至少 59 帧，参数不支持时还有普通请求',()=>{
  const requests=cameraRequests(defaultCapture,true)
  assert.deepEqual(requests[0].frameRate,{min:59,ideal:60})
  assert.deepEqual(requests[0].width,{exact:1920})
  assert.deepEqual(requests[1].width,{ideal:1920})
  assert.ok(requests.some(request=>request.frameRate&&typeof request.frameRate==='object'&&!request.frameRate.min))
  assert.ok(!cameraRequests({...defaultCapture,fps:30},true).some(request=>typeof request.frameRate==='object'&&request.frameRate.min))
})
for(const [width,height] of [[1080,1920],[1920,1080],[1280,720]])test(`浏览器提供 ${width}×${height} 30帧时仍进入文件检查，预览不携带音轨`,async t=>{
  let stopped=false,frame=0,opened=0,encoded=0
  const track={readyState:'live',muted:false,getSettings:()=>({width,height,frameRate:30,facingMode:'user'}),getConstraints:()=>({}),applyConstraints:async()=>{},stop:()=>{stopped=true}}
  const microphone={readyState:'live',muted:false,stop:()=>{}}
  const media={getVideoTracks:()=>[track],getAudioTracks:()=>[microphone],getTracks:()=>[track,microphone]} as unknown as MediaStream
  const originalNavigator=Object.getOwnPropertyDescriptor(globalThis,'navigator')!
  Object.defineProperty(globalThis,'navigator',{value:{userAgent:'test',mediaDevices:{getSupportedConstraints:()=>({frameRate:true}),getUserMedia:async()=>{
    if(++opened===1)throw new DOMException('strict size unsupported','OverconstrainedError')
    return media
  }}},configurable:true})
  Object.defineProperty(globalThis,'isSecureContext',{value:true,configurable:true})
  Object.defineProperty(globalThis,'MediaStream',{value:class {tracks:unknown[];constructor(tracks:unknown[]){this.tracks=tracks}},configurable:true})
  Object.defineProperty(globalThis,'MediaRecorder',{value:class {
    static isTypeSupported(){return true}
    constructor(input:MediaStream){assert.equal(input,media);encoded++}
    start(){throw new Error('校准编码测试失败')}
  },configurable:true})
  t.after(()=>{Object.defineProperty(globalThis,'navigator',originalNavigator);for(const name of ['isSecureContext','MediaStream','MediaRecorder'])Reflect.deleteProperty(globalThis,name)})
  const video={videoWidth:width,videoHeight:height,play:async()=>{},requestVideoFrameCallback:(callback:(now:number,metadata:object)=>void)=>{const id=++frame;queueMicrotask(()=>callback(id*1000,{presentedFrames:id*30,width,height}));return id},cancelVideoFrameCallback:()=>{}} as unknown as HTMLVideoElement
  let visible:MediaStream|undefined
  const result=await openCameraCapture(video,defaultCapture,{signal:new AbortController().signal,onProgress:()=>{},onReport:()=>{},onLive:stream=>{visible=stream}})
  assert.equal(visible,media);assert.equal(opened,2);assert.equal(stopped,false);assert.equal(encoded,1)
  assert.deepEqual((video.srcObject as unknown as {tracks:unknown[]}).tracks,[track])
  assert.equal(isVerifiedCapture(result.report,defaultCapture),false)
  assert.match(result.report.reason??'',/校准编码测试失败/)
  assert.deepEqual(suggestedCapture(result.report,defaultCapture),{...defaultCapture,fps:30})
  assert.equal(canUseMeasuredCapture(result.report,defaultCapture),false)
})
test('相机上报1080P但实际帧仍是720P时继续协商，等实际高清帧才放行',async()=>{
  let attempts=0
  const lowFrame={...portrait,frameWidth:720,frameHeight:1280}
  assert.equal(hasFullPreview(lowFrame,defaultCapture),false)
  assert.equal(hasFullPreview({...portrait,frameWidth:1920,frameHeight:1080},defaultCapture),true)
  assert.equal(hasFullPreview({width:1920,height:1080},defaultCapture),true)
  const preview=await promoteTrack(
    {getSettings:()=>({width:1080,height:1920,frameRate:60}),applyConstraints:async()=>{attempts++}},
    async()=>attempts<2?lowFrame:{...portrait,frameWidth:1080,frameHeight:1920},
    ()=>{},
    new AbortController().signal,
  )
  assert.equal(attempts,2)
  assert.equal(hasFullPreview(preview,defaultCapture),true)
})
test('iPhone 1080P60 恢复首版请求，无法通过试录时继续对比低帧率但可取景的方案',async t=>{
  const requests:MediaStreamConstraints[]=[],closed:number[]=[]
  const originalNavigator=Object.getOwnPropertyDescriptor(globalThis,'navigator')!
  Object.defineProperty(globalThis,'navigator',{value:{userAgent:'iPhone',mediaDevices:{getSupportedConstraints:()=>({frameRate:true}),getUserMedia:async(request:MediaStreamConstraints)=>{
    const index=requests.push(request)
    const camera={readyState:'live',muted:false,getSettings:()=>({width:1080,height:1920,frameRate:30,facingMode:'user'}),applyConstraints:async()=>{},stop:()=>closed.push(index)}
    const mic={readyState:'live',muted:false,stop:()=>{}}
    return {getVideoTracks:()=>[camera],getAudioTracks:()=>request.audio?[mic]:[],getTracks:()=>request.audio?[camera,mic]:[camera]}
  }}},configurable:true})
  Object.defineProperty(globalThis,'isSecureContext',{value:true,configurable:true})
  Object.defineProperty(globalThis,'MediaStream',{value:class {},configurable:true})
  Object.defineProperty(globalThis,'MediaRecorder',{value:class {static isTypeSupported(){return true}start(){throw new Error('试录未达到目标')}},configurable:true})
  t.after(()=>{Object.defineProperty(globalThis,'navigator',originalNavigator);for(const name of ['isSecureContext','MediaStream','MediaRecorder'])Reflect.deleteProperty(globalThis,name)})
  let frame=0,live=0
  const video={videoWidth:1080,videoHeight:1920,play:async()=>{},requestVideoFrameCallback:(callback:(now:number,metadata:object)=>void)=>{const id=++frame;queueMicrotask(()=>callback(id*1000,{presentedFrames:id*30,width:1080,height:1920}));return id},cancelVideoFrameCallback:()=>{}} as unknown as HTMLVideoElement
  const result=await openCameraCapture(video,defaultCapture,{retry60:true,signal:new AbortController().signal,onProgress:()=>{},onReport:()=>{},onLive:()=>{live++}})
  assert.deepEqual(requests[0],{
    video:{facingMode:{exact:'user'},width:{ideal:1080},height:{ideal:1920},aspectRatio:{ideal:9/16},frameRate:{exact:60}},
    audio:{echoCancellation:false,noiseSuppression:false,autoGainControl:false},
  })
  assert.deepEqual((requests[1].video as MediaTrackConstraints).width,{exact:3840})
  assert.deepEqual(requests[2].video,{facingMode:{exact:'user'},width:{min:1920},height:{min:1081},frameRate:{min:59,ideal:60}})
  assert.equal((requests[3].video as MediaTrackConstraints).width,undefined)
  assert.deepEqual(requests.slice(1,8).map(item=>item.audio),[true,true,true,requests[0].audio,true,false,true])
  assert.deepEqual(closed,[1,2,3,4,5,6,7])
  assert.equal(live,1)
  assert.equal(result.report.verified,false)
  assert.ok(result.report.attempts.some(attempt=>attempt.step==='首版竖屏 · 结果'))
  assert.ok(result.report.attempts.some(attempt=>attempt.step==='4K 取流 · 结果'&&attempt.error?.includes('没有收到接近 60 帧')))
  assert.ok(result.report.attempts.some(attempt=>attempt.step==='竖屏兼容取流 · 结果'))
})
test('帧率单独设置失败后继续尝试尺寸组合，保留失败原因',async()=>{
  let settings={width:1080,height:1920,frameRate:30},applied=0
  const events:CameraAttempt[]=[]
  await promoteTrack({getSettings:()=>settings,applyConstraints:async()=>{if(++applied===1)throw new DOMException('not supported','OverconstrainedError');settings={...settings,frameRate:60}}},async()=>portrait,event=>events.push(event),new AbortController().signal)
  assert.equal(applied,2);assert.match(events.find(event=>event.error)?.error||'',/OverconstrainedError/)
})
test('设置无效时有界尝试，不无限重启；中途取消不会继续协商',async()=>{
  let applied=0
  const track={getSettings:()=>({width:1080,height:1920,frameRate:30}),applyConstraints:async()=>{applied++}}
  await promoteTrack(track,async()=>portrait,()=>{},new AbortController().signal)
  assert.equal(applied,3)
  const controller=new AbortController()
  await assert.rejects(promoteTrack(track,async()=>{controller.abort();return portrait},()=>{},controller.signal),{name:'AbortError'})
  assert.equal(applied,3)
})
test('启动使用两个方向的前置配置；检查记录去掉设备标识',()=>{
  const profiles=captureProfiles()
  assert.equal(profiles.length,2);assert.deepEqual(profiles[0].width,{ideal:1920});assert.deepEqual(profiles[1].width,{ideal:1080})
  assert.ok(profiles.every(profile=>JSON.stringify(profile.facingMode)==='{"exact":"user"}'))
  const summary=summarizeSettings({width:1080,height:1920,frameRate:60,deviceId:'private-device',groupId:'private-group'})
  assert.equal('deviceId' in summary,false);assert.equal('groupId' in summary,false)
})
test('仅相机参数为60帧或无法解析文件，都不能开启正式拍摄',()=>{
  const report:CameraReport={version:2,userAgent:'test',frameRateConstraint:true,attempts:[],verified:false}
  assert.equal(isVerified60(null),false);assert.equal(isVerified60(report),false)
  for(const fps of [undefined,NaN,Infinity,30,58.9])assert.equal(isVerified60({...report,verified:true,fileFps:fps}),false)
  assert.equal(isVerified60({...report,verified:false,fileFps:60}),false)
  assert.equal(isVerified60({...report,verified:true,fileFps:59.94}),true)
})

test('四种分辨率和帧率组合按所选目标判断，不把1080p或30帧冒充4K60',()=>{
  for(const resolution of ['1080p','4k'] as const)for(const fps of [30,60] as const){
    const spec:CaptureSpec={resolution,fps,facing:'environment',zoom:2},width=resolution==='4k'?2160:1080,height=resolution==='4k'?3840:1920
    assert.ok(isTargetCapture({width,height,frameRate:fps===60?59.94:29.97},spec))
    assert.equal(isTargetCapture({width,height,frameRate:fps===60?30:60},spec),false)
    assert.equal(isTargetCapture({width:720,height:1280,frameRate:fps},spec),false)
    assert.deepEqual(captureProfiles(spec)[0].facingMode,{exact:'environment'})
    assert.deepEqual(captureProfiles(spec)[0].width,{ideal:height})
  }
})
test('通过旧规格的测试文件不能放行新镜头、倍率、帧率或分辨率',()=>{
  const report:CameraReport={version:2,userAgent:'test',frameRateConstraint:true,attempts:[],verified:true,target:{...defaultCapture},fileFps:59.94,fileDimensions:{width:1080,height:1920},fileHasAudio:true}
  assert.ok(isVerifiedCapture(report,defaultCapture))
  for(const change of [{facing:'environment'},{zoom:2},{resolution:'4k'},{fps:30}])assert.equal(isVerifiedCapture(report,{...defaultCapture,...change} as CaptureSpec),false)
  assert.equal(isVerifiedCapture({...report,fileDimensions:{width:720,height:1280}},defaultCapture),false)
  assert.equal(isVerifiedCapture({...report,fileDimensions:{width:1920,height:1080}},defaultCapture),false)
  assert.equal(isVerifiedCapture({...report,fileDimensions:undefined},defaultCapture),false)
})
test('只有实测竖屏、有音轨且匹配当前设置的片段才提供实测规格录制',()=>{
  const target:CaptureSpec={...defaultCapture,fps:30}
  const report:CameraReport={version:2,userAgent:'test',frameRateConstraint:true,attempts:[],verified:false,target,fileFps:27.42,fileDimensions:{width:720,height:1280},fileHasAudio:true}
  assert.equal(isVerifiedCapture(report,target),false)
  assert.equal(canUseMeasuredCapture(report,target),true)
  assert.equal(canUseMeasuredCapture({...report,fileDimensions:{width:1280,height:720}},target),false)
  assert.equal(canUseMeasuredCapture({...report,fileHasAudio:false},target),false)
  assert.equal(canUseMeasuredCapture({...report,fileFps:undefined},target),false)
  assert.equal(canUseMeasuredCapture(report,{...target,facing:'environment'}),false)
})
test('前置源帧实测只有 30 时，即使文件读数是 60 也只建议主动改用 30',()=>{
  const report:CameraReport={version:2,userAgent:'iPhone',frameRateConstraint:true,attempts:[],verified:false,target:defaultCapture,
    input:{width:1920,height:1080,fps:30,frames:55,durationMs:1800},fileFps:60,fileDimensions:{width:1080,height:1920},fileHasAudio:true}
  assert.equal(canUseMeasuredCapture(report,defaultCapture),false)
  assert.deepEqual(suggestedCapture(report,defaultCapture),{...defaultCapture,fps:30})
})
test('60 帧验收必须同时具有原始输入、15 秒有声成片和匹配的设备',()=>{
  const input={width:1920,height:1080,fps:59.94,frames:109,durationMs:1800}
  const raw={width:1080,height:1920,fps:59.86,frames:899,duration:15,hasAudio:true}
  assert.equal(rateCheckPassed(60,1920,1080,input,raw,true),true)
  assert.equal(rateCheckPassed(60,1920,1080,undefined,raw,true),false,'缺少原始输入不能放行')
  assert.equal(rateCheckPassed(60,1920,1080,{...input,fps:30},raw,true),false,'只有文件高帧率不能放行')
  assert.equal(rateCheckPassed(60,1920,1080,input,{...raw,duration:7},true),false,'短于验收时长不能放行')
  assert.equal(rateCheckPassed(60,1920,1080,input,raw,false),false,'实际设备与请求 ID 不同不能放行')
  assert.equal(rateCheckPassed(60,1920,1080,input,{...raw,hasAudio:false},true),false)
})
test('4K 60 帧无法取得时，使用当前镜头建议 1080P 30 帧，不误称完成校准',()=>{
  const target:CaptureSpec={...defaultCapture,resolution:'4k',facing:'environment'}
  const report:CameraReport={version:2,userAgent:'test',frameRateConstraint:true,attempts:[],verified:false,target,trackFps:30,previewDimensions:{width:1920,height:1080}}
  assert.deepEqual(suggestedCapture(report,target),{...target,resolution:'1080p',fps:30})
  assert.equal(canUseMeasuredCapture(report,target),false)
})
test('数字变焦从画面中心裁切，保持竖屏比例，不裁入界面',()=>{
  assert.deepEqual(cropRectangle(1080,1920,1),{x:0,y:0,width:1080,height:1920})
  assert.deepEqual(cropRectangle(1080,1920,2),{x:270,y:480,width:540,height:960})
  const crop=cropRectangle(2160,3840,3);assert.equal(crop.width,720);assert.equal(crop.height,1280);assert.ok(Math.abs(crop.x-720)<.001)
})
test('持续相机的输出检查拒绝缺失音轨，不产生无声录像的通过状态',async()=>{
  const media={getAudioTracks:()=>[],getTracks:()=>[{readyState:'live',muted:false}]} as unknown as MediaStream
  const report:CameraReport={version:2,userAgent:'test',frameRateConstraint:true,attempts:[],verified:false}
  await assert.rejects(verifyCaptureOutput(media,{stream:media,method:'original',dispose:()=>{}},defaultCapture,report,new AbortController().signal),/麦克风/)
  assert.equal(report.verified,false)
})
