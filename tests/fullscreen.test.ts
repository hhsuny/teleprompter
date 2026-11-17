import {test} from 'node:test'
import assert from 'node:assert/strict'
import {hasReservedStandaloneStrip,requestAppFullscreen} from '../src/fullscreen.ts'

test('没有整页全屏接口时拒绝，不调用视频全屏来隐藏提词',async()=>{
  let videoCalls=0
  const app={webkitEnterFullscreen:()=>videoCalls++} as unknown as HTMLElement
  assert.equal(await requestAppFullscreen(app,{}),false)
  assert.equal(videoCalls,0)
})
test('浏览器拒绝或请求无效时不能假装已经进入全屏',async()=>{
  const denied={requestFullscreen:async()=>{throw new Error('Not allowed')}} as unknown as HTMLElement
  const ignored={requestFullscreen:async()=>{}} as unknown as HTMLElement
  assert.equal(await requestAppFullscreen(denied,{}),false)
  assert.equal(await requestAppFullscreen(ignored,{}),false)
})
test('确认全屏的是整个App，其他元素进入全屏不能放行',async()=>{
  const context:{fullscreenElement?:Element}={}
  const app={requestFullscreen:async function(this:HTMLElement){context.fullscreenElement=this}} as unknown as HTMLElement
  assert.equal(await requestAppFullscreen(app,context),true)
  context.fullscreenElement={} as Element
  const ignored={requestFullscreen:async()=>{}} as unknown as HTMLElement
  assert.equal(await requestAppFullscreen(ignored,context),false)
})
test('支持旧版WebKit的整页接口并保持正确的this绑定',async()=>{
  const context:{webkitFullscreenElement?:Element}={}
  const app={webkitRequestFullscreen:async function(this:HTMLElement){context.webkitFullscreenElement=this}} as unknown as HTMLElement
  assert.equal(await requestAppFullscreen(app,context),true)
})

test('仅在 iOS 视口出现额外系统底条时缩减底部留白',()=>{
  assert.equal(hasReservedStandaloneStrip(852,793,59,34),true)
  assert.equal(hasReservedStandaloneStrip(852,852,59,34),false)
  assert.equal(hasReservedStandaloneStrip(852,818,59,34),false)
  assert.equal(hasReservedStandaloneStrip(852,500,59,34),false)
  assert.equal(hasReservedStandaloneStrip(852,793,0,34),false)
})
