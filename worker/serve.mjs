// The bucket holds only published program/model assets. Personal drafts,
// microphone audio and recordings continue to stay in the phone's IndexedDB.
export function createHandler(assets,release,{checkExisting=false}={}){
  const allowed=new Map(Object.values(assets).map(asset=>[asset.sha256,asset]))
  let ready=false
  const remoteRetryAfter=new Map()
  let nextCheck=0
  const key=sha=>`assets/${sha}`
  const inline=asset=>{const value=atob(asset.inline);return Uint8Array.from(value,char=>char.charCodeAt(0))}
  const reply=(message,status=200)=>Response.json(message,{status,headers:{'cache-control':'no-store'}})
  async function missingAssets(bucket,includeOptional=true){
    const stored=[...allowed].filter(([,asset])=>asset.inline===undefined&&(includeOptional||!asset.optional))
    const missing=[]
    for(let i=0;i<stored.length;i+=5){
      await Promise.all(stored.slice(i,i+5).map(async ([sha,asset])=>{
        const head=await bucket.head(key(sha))
        if(!head||head.size!==asset.size)missing.push(sha)
      }))
    }
    return missing
  }
  async function readyForTraffic(bucket){
    if(ready)return true
    if(await bucket.head(`releases/${release}`)){ready=true;return true}
    if(!checkExisting||Date.now()<nextCheck)return false
    if((await missingAssets(bucket,false)).length){
      nextCheck=Date.now()+15000
      return false
    }
    await bucket.put(`releases/${release}`,'ready')
    ready=true
    return true
  }
  async function importModel(asset,sha,bucket){
    if(!asset.remote||Date.now()<(remoteRetryAfter.get(sha)||0))return null
    const source=asset.remote
    try{
      const response=await fetch(source.url,{headers:{range:`bytes=${source.start}-${source.end}`},signal:AbortSignal.timeout(12000)})
      if(response.status!==206||response.headers.get('content-range')!==`bytes ${source.start}-${source.end}/${source.total}`){await response.body?.cancel();throw new Error('Public range unavailable')}
      const reader=response.body.getReader(),bytes=new Uint8Array(asset.size);let offset=0
      for(;;){const {value,done}=await reader.read();if(done)break;if(offset+value.length>source.end-source.start+1){await reader.cancel();throw new Error('Incorrect public range')};bytes.set(value,offset);offset+=value.length}
      if(offset!==source.end-source.start+1)throw new Error('Incomplete public range')
      if(source.tail){const tail=atob(source.tail);for(let i=0;i<tail.length;i++)bytes[offset++]=tail.charCodeAt(i)}
      const digest=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(x=>x.toString(16).padStart(2,'0')).join('')
      if(offset!==asset.size||digest!==sha)throw new Error('Prepared model checksum mismatch')
      await bucket.put(key(sha),bytes,{httpMetadata:{contentType:asset.type}})
      return {size:bytes.length}
    }catch{remoteRetryAfter.set(sha,Date.now()+300000);return null}
  }
  return {
    async fetch(request,env){
      const url=new URL(request.url),path=url.pathname
      if(!env.BUCKET)return reply({error:'Published asset storage is unavailable'},503)
      if(path.startsWith('/__publish/')){
        // In addition to Sites' private audience boundary, keep publishing
        // protected if this app is deliberately made public in the future.
        const email=request.headers.get('oai-authenticated-user-email')?.toLowerCase(),owner=env.ASSET_PUBLISH_OWNER_EMAIL?.toLowerCase()
        const ownerRequest=!!owner&&email===owner&&(['GET','HEAD'].includes(request.method)||request.headers.get('origin')===url.origin)
        const serviceRequest=!!env.ASSET_PUBLISH_TOKEN&&request.headers.get('x-site-publish-key')===env.ASSET_PUBLISH_TOKEN
        if(!ownerRequest&&!serviceRequest)return reply({error:'Unauthorized. Sign in as the Site owner.'},401)
        if(path==='/__publish/panel'&&request.method==='GET')return new Response(publishPage(assets),{headers:{'content-type':'text/html;charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff','content-security-policy':"default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; frame-ancestors 'none'"}})
        if(path==='/__publish/ready'&&request.method==='POST'){
          const missing=await missingAssets(env.BUCKET)
          if(missing.length)return reply({error:'Assets incomplete',missing},409)
          await env.BUCKET.put(`releases/${release}`,'ready');ready=true
          return reply({ready:true,release,assets:allowed.size})
        }
        const sha=path.slice('/__publish/assets/'.length),asset=path.startsWith('/__publish/assets/')&&allowed.get(sha)
        if(!asset)return reply({error:'Unknown published asset'},404)
        if(request.method==='HEAD'){
          const head=asset.inline!==undefined?{size:asset.size}:await env.BUCKET.head(key(sha))||await importModel(asset,sha,env.BUCKET)
          return new Response(null,{status:head&&head.size===asset.size?200:404,headers:{'x-asset-sha256':sha,'content-length':String(head?.size??0),'cache-control':'no-store'}})
        }
        if(request.method!=='PUT')return reply({error:'Method not allowed'},405)
        if(Number(request.headers.get('content-length'))!==asset.size)return reply({error:'Asset length mismatch'},400)
        // Bound memory even for a malformed publisher. The largest current
        // asset is the 14 MB WASM runtime; model pieces are at most 8 MiB.
        if(asset.size>16*1024*1024)return reply({error:'Asset exceeds upload limit'},413)
        const reader=request.body?.getReader();if(!reader)return reply({error:'Missing asset'},400)
        const bytes=new Uint8Array(asset.size);let size=0
        for(;;){const {done,value}=await reader.read();if(done)break;if(size+value.length>bytes.length){await reader.cancel();return reply({error:'Asset too large'},413)}bytes.set(value,size);size+=value.length}
        if(size!==asset.size)return reply({error:'Incomplete asset'},400)
        const digest=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(x=>x.toString(16).padStart(2,'0')).join('')
        if(digest!==sha)return reply({error:'Asset checksum mismatch'},422)
        await env.BUCKET.put(key(sha),bytes,{httpMetadata:{contentType:asset.type}})
        return reply({stored:true,sha256:sha,size})
      }
      if(!['GET','HEAD'].includes(request.method))return new Response('Method not allowed',{status:405})
      const asset=assets[path==='/'||path==='/latest'?'/index.html':path]
      if(!asset)return new Response('Not found',{status:404})
      if(!await readyForTraffic(env.BUCKET))return new Response(request.method==='HEAD'?null:'<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>提词器 · 正在更新</title><body style="font-family:system-ui;padding:15vh 8vw"><h1>提词器正在更新</h1><p>正在校验相机程序和中文语音资源，请稍后刷新。</p></body></html>',{status:503,headers:{'content-type':'text/html;charset=utf-8','cache-control':'no-store','retry-after':'15'}})
      const etag=`"${asset.sha256}"`,headers={'content-type':asset.type,'content-length':String(asset.size),'etag':etag,'cache-control':path.startsWith('/assets/')?'private,max-age=31536000,immutable':'private,no-cache','x-content-type-options':'nosniff'}
      if(request.headers.get('if-none-match')===etag)return new Response(null,{status:304,headers:{etag,'cache-control':headers['cache-control']}})
      let object=asset.inline!==undefined?{size:asset.size,body:request.method==='HEAD'?null:inline(asset)}:request.method==='HEAD'?await env.BUCKET.head(key(asset.sha256)):await env.BUCKET.get(key(asset.sha256))
      if(!object&&asset.optional&&await importModel(asset,asset.sha256,env.BUCKET)){
        object=request.method==='HEAD'?await env.BUCKET.head(key(asset.sha256)):await env.BUCKET.get(key(asset.sha256))
      }
      if(!object||object.size!==asset.size)return reply({error:'Published asset temporarily unavailable'},503)
      return new Response(request.method==='HEAD'?null:object.body,{headers})
    },
  }
}

function publishPage(assets){return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>提词器 · 发布资源</title><style>body{font:16px system-ui;max-width:650px;margin:8vh auto;padding:24px;color:#232323;background:#f8f3ea}button,input{font:inherit;margin:12px 0}button{padding:12px 22px;background:#ec695c;color:white;border:0;border-radius:12px}pre{white-space:pre-wrap;line-height:1.7;background:white;padding:20px;border-radius:16px}progress{width:100%}</style><h1>提词器资源发布</h1><p>仅站点所有者可用。选择构建后的程序和模型文件，只上传该版本清单内的程序和模型，不上传其他文件。</p><input id="files" type="file" multiple><br><button id="start">上传并校验此版本</button><button id="verify">校验已存资源并开放</button><progress id="progress" value="0" max="1"></progress><pre id="status" role="status">请选择构建资源文件</pre><script>
const assets=${JSON.stringify(assets)},input=document.querySelector('#files'),button=document.querySelector('#start'),status=document.querySelector('#status'),progress=document.querySelector('#progress');
document.querySelector('#verify').onclick=async()=>{status.textContent='正在校验服务器已存资源';try{const response=await fetch('/__publish/ready',{method:'POST'}),result=await response.json();if(!response.ok)throw new Error('仍缺少 '+(result.missing?.length??'?')+' 个资源');status.textContent='发布完成 · '+result.assets+' 个资源全部校验通过';const link=document.createElement('a');link.href='/';link.textContent='打开正式提词器';document.body.append(link)}catch(error){status.textContent=error.message}};input.onchange=()=>{status.textContent='已选择 '+input.files.length+' 个资源文件，点击上传开始校验'};button.onclick=async()=>{button.disabled=true;try{const selected=new Map([...input.files].map(file=>['/'+file.webkitRelativePath.split('/').slice(1).join('/'),file])),jobs=[...new Map(Object.entries(assets).map(([path,asset])=>[asset.sha256,{path,...asset}])).values()];for(const job of jobs)if(!(selected.has(job.path)||[...input.files].some(file=>file.name===job.path.split('/').pop()&&file.size===job.size)))throw new Error('文件夹缺少资源：'+job.path);progress.max=jobs.length;let count=0;for(const job of jobs){const path='/__publish/assets/'+job.sha256;let response=await fetch(path,{method:'HEAD'});if(response.status!==200){if(response.status!==404)throw new Error('资源状态检查失败 '+response.status);const file=selected.get(job.path)||[...input.files].find(file=>file.name===job.path.split('/').pop()&&file.size===job.size);if(file.size!==job.size)throw new Error('本机文件大小不一致');let success=false;for(let retry=0;retry<3;retry++){response=await fetch(path,{method:'PUT',body:file});if(response.ok){success=true;break}if(response.status<500)break}if(!success)throw new Error('上传失败 '+response.status+' '+job.path)}progress.value=++count;status.textContent='已校验 '+count+' / '+jobs.length+'\\n'+job.path}const response=await fetch('/__publish/ready',{method:'POST'});if(!response.ok)throw new Error('整体验证未通过 '+response.status);const result=await response.json();status.textContent='发布完成 · '+result.assets+' 个资源全部校验通过\\n版本 '+result.release;const link=document.createElement('a');link.href='/';link.textContent='打开正式提词器';document.body.append(link)}catch(error){status.textContent=error.message;button.disabled=false}};
</script></html>`}
