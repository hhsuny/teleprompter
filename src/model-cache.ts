type Chunk={size:number;sha256:string}
type ChunkCache=Pick<Cache,'match'|'put'>
const cacheTimeout=7000

export function boundedCache<T>(work:Promise<T>):Promise<T>{
  return new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(new Error('本机缓存没有响应。')),cacheTimeout)
    void work.then(resolve,reject).finally(()=>clearTimeout(timer))
  })
}

async function valid(buffer:ArrayBuffer,chunk:Chunk){
  if(buffer.byteLength!==chunk.size)return false
  const digest=new Uint8Array(await crypto.subtle.digest('SHA-256',buffer))
  return Array.from(digest,value=>value.toString(16).padStart(2,'0')).join('')===chunk.sha256
}

export async function readModelChunk(url:string,chunk:Chunk,cache?:ChunkCache,onDownload?:()=>void){
  try{
    const stored=cache?await boundedCache(cache.match(url)):undefined
    if(stored){
      const buffer=await boundedCache(stored.arrayBuffer())
      if(await valid(buffer,chunk))return {bytes:new Uint8Array(buffer),saved:true}
    }
  }catch{/* Unreadable caches can still use the downloaded bytes. */}
  onDownload?.()
  const buffer=await downloadChunk(url,chunk)
  let saved=false
  try{
    if(cache){
      await boundedCache(cache.put(url,new Response(buffer,{headers:{'content-type':'application/octet-stream'}})))
      saved=true
    }
  }catch{/* Report an incomplete cache without losing the current session. */}
  return {bytes:new Uint8Array(buffer),saved}
}

async function downloadChunk(url:string,chunk:Chunk){
  let reason='无法连接语音文件，请检查网络后重试。'
  for(const cache of ['no-cache','reload'] as const){
    const controller=new AbortController()
    const timeout=setTimeout(()=>controller.abort(),45_000)
    let response:Response|undefined
    try{
      response=await fetch(url,{cache,signal:controller.signal})
      if(response.ok&&!response.redirected&&!response.headers.get('content-type')?.includes('text/html')){
        const bytes=await response.arrayBuffer()
        if(await valid(bytes,chunk))return bytes
        reason='语音文件校验失败，请点重试语音。'
      }
    }catch{
      reason='语音文件下载中断，请检查网络后重试。'
    }finally{clearTimeout(timeout)}
    if(!response)continue
    if(response.redirected||response.status===401||response.status===403||(response.ok&&response.headers.get('content-type')?.includes('text/html'))){
      throw new Error('语音文件的访问验证已失效，请在 Safari 重新打开提词器并完成登录。')
    }
    if(response.status===404)throw new Error('线上缺少一部分语音文件，请稍后重试。')
    if(!response.ok)reason=`语音文件暂时无法下载（${response.status}），请点重试语音。`
  }
  throw new Error(reason)
}
