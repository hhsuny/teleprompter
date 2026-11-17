import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readInputFrames} from '../src/frame-sampler.ts'

test('通过源帧时间戳计算输入速率，同一帧的重复时间戳只计一次',async t=>{
  const step=1e6/60
  const frames=Array.from({length:110},(_,i)=>Math.round(i*step))
  frames.splice(12,0,frames[11])
  let released=0
  const stream=new ReadableStream({start(controller){
    for(const timestamp of frames)controller.enqueue({timestamp,displayWidth:2160,displayHeight:3840,close:()=>released++})
    controller.close()
  }})
  Object.defineProperty(globalThis,'MediaStreamTrackProcessor',{value:class {readable=stream},configurable:true})
  t.after(()=>Reflect.deleteProperty(globalThis,'MediaStreamTrackProcessor'))
  const result=await readInputFrames({} as MediaStreamTrack,new AbortController().signal)
  assert.ok(result)
  assert.equal(result.width,2160);assert.equal(result.height,3840)
  assert.ok(Math.abs(result.fps-60)<.01)
  assert.equal(released,result.frames+1)
})

test('输入停止或页面取消时不返回虚假的帧率',async t=>{
  const controller=new AbortController()
  let cancelled=false
  Object.defineProperty(globalThis,'MediaStreamTrackProcessor',{value:class {readable=new ReadableStream({cancel(){cancelled=true}})},configurable:true})
  t.after(()=>Reflect.deleteProperty(globalThis,'MediaStreamTrackProcessor'))
  const pending=readInputFrames({} as MediaStreamTrack,controller.signal)
  controller.abort()
  assert.equal(await pending,null);assert.equal(cancelled,true)
})
