import {test} from 'node:test'
import assert from 'node:assert/strict'
import {createCaptureOutput,createFullHdOutput} from '../src/zoom.ts'
import {defaultCapture} from '../src/capture-spec.ts'

test('1倍绕过绘制与编码转换，不操作原始相机和音轨',async()=>{
  const source={getVideoTracks:()=>[{}]} as MediaStream
  const result=await createCaptureOutput(source,{} as HTMLVideoElement,defaultCapture,new AbortController().signal)
  assert.equal(result.stream,source);assert.equal(result.method,'original');result.dispose()
})
test('iPhone 的 1 倍镜像录像保留相机原流及麦克风，导出时再写镜像方向',async t=>{
  const saved=Object.getOwnPropertyDescriptor(globalThis,'navigator')
  Object.defineProperty(globalThis,'navigator',{value:{userAgent:'iPhone'},configurable:true})
  t.after(()=>saved?Object.defineProperty(globalThis,'navigator',saved):Reflect.deleteProperty(globalThis,'navigator'))
  const stream={getVideoTracks:()=>[{}]} as MediaStream
  const output=await createCaptureOutput(stream,{} as HTMLVideoElement,{...defaultCapture,fps:30},new AbortController().signal,undefined,true)
  assert.equal(output.stream,stream);assert.equal(output.mirrorInFile,true);assert.equal(output.pixelsMirrored,undefined)
  assert.equal(output.renderer,undefined)
  output.dispose()
})
test('相机接受且确认倍率后使用原流；清理不结束源轨道',async()=>{
  let zoom=1,stopped=false
  const track={getCapabilities:()=>({zoom:{min:1,max:3}}),getSettings:()=>({zoom}),applyConstraints:async(value:{advanced:{zoom:number}[]})=>{zoom=value.advanced[0].zoom},stop:()=>{stopped=true}}
  const source={getVideoTracks:()=>[track]} as unknown as MediaStream
  const result=await createCaptureOutput(source,{} as HTMLVideoElement,{...defaultCapture,zoom:3},new AbortController().signal)
  assert.equal(zoom,3);assert.equal(result.method,'hardware');assert.equal(result.stream,source);result.dispose();assert.equal(stopped,false)
})
test('无法确认原生倍率时停止，不在未知变焦上叠加数字裁切；取消后不访问设备',async()=>{
  const track={getCapabilities:()=>({zoom:{min:1,max:3}}),getSettings:()=>({zoom:1.5}),applyConstraints:async()=>{}}
  const source={getVideoTracks:()=>[track]} as unknown as MediaStream
  await assert.rejects(createCaptureOutput(source,{} as HTMLVideoElement,{...defaultCapture,zoom:2},new AbortController().signal),/没有确认变焦倍率/)
  const controller=new AbortController();controller.abort()
  await assert.rejects(createCaptureOutput({} as MediaStream,{} as HTMLVideoElement,defaultCapture,controller.signal),{name:'AbortError'})
})

test('同一相机直接从3倍回到1倍会恢复轨道倍率，不重新申请麦克风',async()=>{
  let zoom=3,changes=0
  const constraints={width:{exact:1080},height:{exact:1920},frameRate:{min:59},advanced:[{focusMode:'continuous'},{zoom:3}]}
  const track={getCapabilities:()=>({zoom:{min:1,max:3}}),getSettings:()=>({zoom}),getConstraints:()=>constraints,applyConstraints:async(value:typeof constraints)=>{changes++;assert.deepEqual(value,{...constraints,advanced:[{focusMode:'continuous'},{zoom:1}]});zoom=value.advanced[1].zoom!}}
  const source={getVideoTracks:()=>[track]} as unknown as MediaStream
  const output=await createCaptureOutput(source,{} as HTMLVideoElement,defaultCapture,new AbortController().signal)
  assert.equal(zoom,1);assert.equal(changes,1);assert.equal(output.stream,source);assert.equal(output.method,'original')
})

test('高清源逐帧缩到 1080P 并写入镜像像素，重复时间戳不补帧，保留原音轨',async t=>{
  let next:VideoFrameRequestCallback,frames=0,stopped=0
  const audio={},added:unknown[]=[],draws:unknown[][]=[],transforms:unknown[][]=[]
  const track={requestFrame:()=>frames++,stop:()=>stopped++}
  const canvas={width:0,height:0,getContext:()=>({drawImage:(...args:unknown[])=>draws.push(args),setTransform:(...args:unknown[])=>transforms.push(args)}),
    captureStream:(fps:number)=>{assert.equal(fps,0);return {getVideoTracks:()=>[track],addTrack:(value:unknown)=>added.push(value)}}}
  Object.defineProperty(globalThis,'document',{value:{createElement:()=>canvas},configurable:true})
  t.after(()=>Reflect.deleteProperty(globalThis,'document'))
  const video={videoWidth:2160,videoHeight:3840,requestVideoFrameCallback:(callback:VideoFrameRequestCallback)=>{next=callback;return 1},cancelVideoFrameCallback:()=>{}} as unknown as HTMLVideoElement
  const media={getVideoTracks:()=>[],getAudioTracks:()=>[audio]} as unknown as MediaStream
  const controller=new AbortController()
  const result=await createFullHdOutput(media,video,controller.signal,undefined,true)
  for(const mediaTime of [0,0,1/60])next!(0,{mediaTime} as VideoFrameCallbackMetadata)
  assert.deepEqual([canvas.width,canvas.height,frames],[1080,1920,2])
  assert.deepEqual(draws[0],[video,0,0,2160,3840,0,0,1080,1920])
  assert.deepEqual(transforms,[[-1,0,0,1,1080,0]])
  assert.deepEqual(added,[audio]);assert.equal(result.pixelsMirrored,true)
  controller.abort();result.dispose();assert.equal(stopped,1)
})
