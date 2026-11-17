import {readFile} from 'node:fs/promises'
import {resolve,join} from 'node:path'
import {createHash} from 'node:crypto'
// Credentials are accepted only on hidden stdin, never argv, disk or logs.
if(process.stdin.isTTY)process.stdin.setRawMode(true)
process.stdin.setEncoding('utf8');process.stdin.resume()
console.log('Ready for asset publication JSON on stdin (input is hidden).')
const input=await new Promise((resolve,reject)=>{let buffer='';const data=chunk=>{buffer+=chunk;if(buffer.includes('\u0003')){reject(new Error('Publication cancelled'));process.stdin.off('data',data);return}if(buffer.includes('\n')||buffer.includes('\r')){process.stdin.off('data',data);if(process.stdin.isTTY)process.stdin.setRawMode(false);process.stdin.pause();try{resolve(JSON.parse(buffer.trim()))}catch{reject(new Error('Invalid publication input'))}}};process.stdin.on('data',data)})
const {baseUrl,token,publishKey}=input,base=new URL(baseUrl)
if(base.protocol!=='https:'||base.username||base.password||base.pathname!=='/'||!base.hostname.endsWith('.chatgpt.site')||!token||!publishKey)throw new Error('Expected the selected HTTPS Site and publication credentials')
const root=resolve(import.meta.dirname,'..'),manifest=JSON.parse(await readFile(join(root,'.cache/site-assets.json'),'utf8'))
const headers={'OAI-Sites-Authorization':`Bearer ${token}`,'x-site-publish-key':publishKey}
async function request(path,options={}){
  let failure
  for(let attempt=0;attempt<3;attempt++)try{const response=await fetch(new URL(path,base),{...options,headers:{...headers,...options.headers},redirect:'error',signal:AbortSignal.timeout(55_000)});if(response.status>=500){await response.body?.cancel();throw new Error(`HTTP ${response.status}`)}return response}catch{failure=new Error(`Asset request failed (attempt ${attempt+1})`);if(attempt<2)await new Promise(resolve=>setTimeout(resolve,1000*(attempt+1)))}
  throw failure
}
const jobs=[...new Map(Object.entries(manifest.assets).map(([path,asset])=>[asset.sha256,{path,...asset}])).values()];let next=0,done=0
async function upload(){for(;;){const asset=jobs[next++];if(!asset)return;const endpoint='/__publish/assets/'+asset.sha256,head=await request(endpoint,{method:'HEAD'});if(head.status===200&&Number(head.headers.get('content-length'))===asset.size){console.log(`Cached ${++done}/${jobs.length}: ${asset.path}`);continue}if(head.status!==404)throw new Error(`Asset authorization/status failed (HTTP ${head.status})`);const bytes=await readFile(join(root,'.cache/web',asset.path.slice(1)));if(createHash('sha256').update(bytes).digest('hex')!==asset.sha256)throw new Error('Local assets changed; rebuild before publishing');const response=await request(endpoint,{method:'PUT',body:bytes,headers:{'content-type':'application/octet-stream','content-length':String(bytes.length)}});if(!response.ok)throw new Error(`Asset upload rejected (HTTP ${response.status})`);await response.body?.cancel();console.log(`Uploaded ${++done}/${jobs.length}: ${asset.path}`)}}
try{await Promise.all([upload(),upload()]);const ready=await request('/__publish/ready',{method:'POST'});if(!ready.ok)throw new Error(`Release verification failed (HTTP ${ready.status})`);console.log(JSON.stringify(await ready.json()))}catch(error){console.error(error instanceof Error?error.message:'Asset publication failed');process.exitCode=1}
