import {test} from 'node:test'
import assert from 'node:assert/strict'
import {hasAudibleSamples} from '../src/recorded-audio.ts'

test('文件有音轨时仍区分静音、零星噪点和持续音频信号',()=>{
  const quiet=new Float32Array(800)
  quiet[0]=0.025
  quiet[4]=0.05
  const volume=Float32Array.from({length:800},(_,index)=>0.01*Math.sin(index/8))
  assert.equal(hasAudibleSamples({numberOfChannels:1,getChannelData:()=>quiet}),false)
  assert.equal(hasAudibleSamples({numberOfChannels:2,getChannelData:channel=>channel===0?quiet:volume}),true)
})
