import {test} from 'node:test'
import assert from 'node:assert/strict'
import {CameraRecorder,recordingResult} from '../src/recorder.ts'
import type {Take} from '../src/storage.ts'

test('空间不足时只保留连续写入的片段，且保存等待不计入录像时长',async t=>{
  let instance:FakeRecorder
  class FakeRecorder {
    static isTypeSupported(){return true}
    state='inactive'
    mimeType='video/mp4'
    ondataavailable?:(event:{data:Blob})=>void
    onstop?:()=>void
    constructor(){instance=this}
    start(){this.state='recording'}
    stop(){this.state='inactive';queueMicrotask(()=>this.onstop?.())}
    data(){this.ondataavailable?.({data:new Blob(['part'])})}
  }
  const original=Object.getOwnPropertyDescriptor(globalThis,'MediaRecorder')
  Object.defineProperty(globalThis,'MediaRecorder',{configurable:true,value:FakeRecorder})
  t.after(()=>{if(original)Object.defineProperty(globalThis,'MediaRecorder',original);else Reflect.deleteProperty(globalThis,'MediaRecorder')})
  let now=1_000
  t.mock.method(performance,'now',()=>now)
  const written:number[]=[]
  const checkpoints:Take[]=[]
  let stored:Take|undefined
  const recorder=new CameraRecorder(()=>{},{
    saveTake:async take=>{stored={...take};return take.id},
    saveChunk:async (_id,index,_blob,progress)=>{
      written.push(index)
      if(index===1){now+=8_000;throw new DOMException('quota','QuotaExceededError')}
      checkpoints.push(progress)
      return index
    },
  })
  const track={readyState:'live',muted:false,getSettings:()=>({width:1080,height:1920,frameRate:60})}
  const media={getTracks:()=>[track],getVideoTracks:()=>[track]} as unknown as MediaStream
  await recorder.start(media,'测试')
  instance!.data()
  instance!.data()
  instance!.data()
  now=4_000
  const take=await recorder.stop()
  assert.deepEqual(written,[0,1])
  assert.equal(take.bytes,4)
  assert.equal(checkpoints[0].bytes,4)
  assert.equal(checkpoints[0].status,'recording')
  assert.equal(take.duration,3)
  assert.equal(stored?.status,'interrupted')
  assert.match(recordingResult(take,true),/存储空间不足.*部分片段/)
})
