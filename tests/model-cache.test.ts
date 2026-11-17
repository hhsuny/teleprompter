import {test} from 'node:test'
import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {readModelChunk} from '../src/model-cache.ts'

test('已下载语音分片再次打开时无需网络，缺损分片才补下载',async t=>{
  const url='https://example.test/model-part'
  const body=new Uint8Array([1,2,3,4])
  const chunk={size:body.length,sha256:createHash('sha256').update(body).digest('hex')}
  let saved:Response|undefined
  const cache={
    match:async()=>saved?.clone(),
    put:async (_key:RequestInfo|URL,value:Response)=>{saved=value},
    delete:async()=>{saved=undefined;return true},
  }
  const network=t.mock.method(globalThis,'fetch',async()=>new Response(body))
  assert.equal((await readModelChunk(url,chunk,cache)).saved,true)
  assert.deepEqual((await readModelChunk(url,chunk,cache)).bytes,body)
  assert.equal(network.mock.callCount(),1)
  saved=new Response(new Uint8Array([1,2,3,5]))
  assert.deepEqual((await readModelChunk(url,chunk,cache)).bytes,body)
  assert.equal(network.mock.callCount(),2)
})
test('本机缓存失败时从网络补齐，并自动重试暂时不可用的分片',async t=>{
  const url='https://example.test/model-part'
  const body=new Uint8Array([6,7,8,9])
  const chunk={size:body.length,sha256:createHash('sha256').update(body).digest('hex')}
  let attempts=0
  t.mock.method(globalThis,'fetch',async()=>++attempts===1?new Response('<p>更新中</p>',{status:503,headers:{'content-type':'text/html'}}):new Response(body))
  const cache={match:async()=>{throw new Error('cache unavailable')},put:async()=>{}}
  assert.deepEqual(await readModelChunk(url,chunk,cache),{bytes:body,saved:true})
  assert.equal(attempts,2)
})
test('将站点登录页与模型文件区分开，明确提示如何恢复',async t=>{
  const request=t.mock.method(globalThis,'fetch',async()=>new Response('<p>登录</p>',{headers:{'content-type':'text/html'}}))
  await assert.rejects(readModelChunk('https://example.test/model-part',{size:0,sha256:''}),/完成登录/)
  assert.equal(request.mock.callCount(),1)
})
