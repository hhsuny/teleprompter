import {test} from 'node:test'
import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {createHandler} from '../worker/serve.mjs'
function fixture(){
  const bytes=new TextEncoder().encode('<title>提词器</title>'),sha=createHash('sha256').update(bytes).digest('hex'),assets={'/index.html':{sha256:sha,size:bytes.length,type:'text/html;charset=utf-8'}},objects=new Map<string,Uint8Array>()
  const env={ASSET_PUBLISH_TOKEN:'test-secret',BUCKET:{head:async(key:string)=>objects.has(key)?{size:objects.get(key)!.length}:null,get:async(key:string)=>objects.has(key)?{size:objects.get(key)!.length,body:objects.get(key)}:null,put:async(key:string,value:Uint8Array|string)=>{objects.set(key,typeof value==='string'?new TextEncoder().encode(value):value)}}}
  const server=createHandler(assets,'release-a'),request=(path:string,init:RequestInit={})=>server.fetch(new Request('https://test.example'+path,init),env),headers={'x-site-publish-key':'test-secret','content-length':String(bytes.length)}
  return {bytes,sha,assets,objects,env,server,request,headers}
}
test('资源不完整时明确维护，不把缺失识别模型的页面标为可用',async()=>{const f=fixture();assert.equal((await f.request('/')).status,503);assert.equal((await f.request('/__publish/ready',{method:'POST',headers:f.headers})).status,409)})
test('发布端点要求独立密钥，拒绝陌生文件和错误大小',async()=>{const f=fixture();assert.equal((await f.request('/__publish/assets/'+f.sha,{method:'PUT',body:f.bytes})).status,401);assert.equal((await f.request('/__publish/assets/unknown',{method:'PUT',headers:f.headers,body:f.bytes})).status,404);assert.equal((await f.request('/__publish/assets/'+f.sha,{method:'PUT',headers:{...f.headers,'content-length':'1'},body:f.bytes})).status,400);assert.equal(f.objects.size,0)})
test('校验实际内容而非仅信任文件名；错误片段不能覆盖模型',async()=>{const f=fixture(),bad=new Uint8Array(f.bytes.length);assert.equal((await f.request('/__publish/assets/'+f.sha,{method:'PUT',headers:f.headers,body:bad})).status,422);assert.equal(f.objects.size,0)})
test('分片可重复上传并检查；全部就绪后才能提供完整网页',async()=>{const f=fixture(),path='/__publish/assets/'+f.sha;assert.equal((await f.request(path,{method:'HEAD',headers:f.headers})).status,404);assert.equal((await f.request(path,{method:'PUT',headers:f.headers,body:f.bytes})).status,200);assert.equal((await f.request(path,{method:'HEAD',headers:f.headers})).headers.get('content-length'),String(f.bytes.length));assert.equal((await f.request('/')).status,503);assert.equal((await f.request('/__publish/ready',{method:'POST',headers:f.headers})).status,200);const page=await f.request('/');assert.equal(page.status,200);assert.equal(await page.text(),new TextDecoder().decode(f.bytes));assert.match(page.headers.get('content-type')!,/text\/html/);assert.equal((await f.request('/',{headers:{'if-none-match':page.headers.get('etag')!}})).status,304);assert.equal((await f.request('/',{method:'HEAD'})).body,null)})
test('旧版本的就绪记录不能放行未上传的新版本；不接收音视频或未知业务路径',async()=>{const f=fixture();f.objects.set('releases/old-release',new Uint8Array([1]));assert.equal((await f.request('/')).status,503);assert.equal((await f.request('/recordings',{method:'POST',body:'private audio'})).status,405);assert.equal((await f.request('/not-found')).status,404);assert.equal(f.objects.size,1)})
test('浏览器发布要求精确的所有者身份，写入还必须同源，页面不包含密钥',async()=>{const f=fixture();Object.assign(f.env,{ASSET_PUBLISH_OWNER_EMAIL:'owner@example.test'});const headers={'oai-authenticated-user-email':'owner@example.test'};const panel=await f.request('/__publish/panel',{headers});assert.equal(panel.status,200);assert.ok(!(await panel.text()).includes('test-secret'));assert.equal((await f.request('/__publish/panel',{headers:{'oai-authenticated-user-email':'other@example.test'}})).status,401);assert.equal((await f.request('/__publish/ready',{method:'POST',headers})).status,401);assert.equal((await f.request('/__publish/ready',{method:'POST',headers:{...headers,origin:'https://evil.example'}})).status,401);assert.equal((await f.request('/__publish/ready',{method:'POST',headers:{...headers,origin:'https://test.example'}})).status,409)})
test('官方范围下载加元数据尾部仍须满足原发布片段的完整哈希',async()=>{const f=fixture(),prefix=f.bytes.slice(0,-3),native=globalThis.fetch;Object.assign(f.assets['/index.html'],{remote:{url:'https://huggingface.co/public/model',start:0,end:prefix.length-1,total:prefix.length,tail:Buffer.from(f.bytes.slice(-3)).toString('base64')}});globalThis.fetch=async(url,init)=>{assert.equal(init?.headers&&new Headers(init.headers).get('range'),`bytes=0-${prefix.length-1}`);return new Response(prefix,{status:206,headers:{'content-range':`bytes 0-${prefix.length-1}/${prefix.length}`}})};try{assert.equal((await f.request('/__publish/assets/'+f.sha,{method:'HEAD',headers:f.headers})).status,200);assert.deepEqual(f.objects.get('assets/'+f.sha),f.bytes)}finally{globalThis.fetch=native}})
test('官方源错误时不缓存、不连续重试，仍可走原上传入口',async()=>{const f=fixture(),native=globalThis.fetch;let calls=0;Object.assign(f.assets['/index.html'],{remote:{url:'https://huggingface.co/public/model',start:0,end:f.bytes.length-1,total:f.bytes.length}});globalThis.fetch=async()=>{calls++;return new Response(new Uint8Array(f.bytes.length),{status:206,headers:{'content-range':`bytes 0-${f.bytes.length-1}/${f.bytes.length}`}})};try{const path='/__publish/assets/'+f.sha;assert.equal((await f.request(path,{method:'HEAD',headers:f.headers})).status,404);assert.equal((await f.request(path,{method:'HEAD',headers:f.headers})).status,404);assert.equal(calls,1);assert.equal(f.objects.size,0);assert.equal((await f.request(path,{method:'PUT',headers:f.headers,body:f.bytes})).status,200)}finally{globalThis.fetch=native}})
test('随程序打包的小资源无需重复上传，仍需整体就绪且返回完整原字节',async()=>{const f=fixture();Object.assign(f.assets['/index.html'],{inline:Buffer.from(f.bytes).toString('base64')});assert.equal((await f.request('/')).status,503);assert.equal((await f.request('/__publish/assets/'+f.sha,{method:'HEAD',headers:f.headers})).status,200);assert.equal((await f.request('/__publish/ready',{method:'POST',headers:f.headers})).status,200);assert.equal(await (await f.request('/')).text(),new TextDecoder().decode(f.bytes));assert.equal(f.objects.size,1)})
test('网页更新可直接复用现有资源，资源缺失时仍不放行',async()=>{
  const f=fixture()
  const request=()=>new Request('https://test.example/')
  const incomplete=createHandler(f.assets,'reuse',{checkExisting:true})
  assert.equal((await incomplete.fetch(request(),f.env)).status,503)
  f.objects.set('assets/'+f.sha,f.bytes)
  const reusable=createHandler(f.assets,'reuse',{checkExisting:true})
  assert.equal((await reusable.fetch(request(),f.env)).status,200)
  assert.ok(f.objects.has('releases/reuse'))
})
test('试用模型未缓存不影响打开网页，首次请求从公开模型源校验并填充',async t=>{
  const f=fixture()
  f.objects.set('assets/'+f.sha,f.bytes)
  const bytes=new Uint8Array([1,2,3,4])
  const sha=createHash('sha256').update(bytes).digest('hex')
  const path='/models/mandarin/demo.bin'
  const assets={...f.assets,[path]:{size:4,sha256:sha,type:'application/octet-stream',optional:true,remote:{url:'https://test.example/source',start:0,end:3,total:4}}}
  const download=t.mock.method(globalThis,'fetch',async()=>new Response(bytes,{status:206,headers:{'content-range':'bytes 0-3/4'}}))
  const handler=createHandler(assets,'optional-model',{checkExisting:true})
  const request=(path:string)=>handler.fetch(new Request('https://test.example'+path),f.env)
  assert.equal((await request('/')).status,200)
  assert.equal(await (await request('/latest')).text(),new TextDecoder().decode(f.bytes))
  assert.equal(download.mock.callCount(),0)
  for(let i=0;i<2;i++)assert.deepEqual(new Uint8Array(await (await request(path)).arrayBuffer()),bytes)
  assert.equal(download.mock.callCount(),1)
})
