import {readdir,readFile,writeFile} from 'node:fs/promises'
import {createHash} from 'node:crypto'
import {join,resolve} from 'node:path'
const dist=resolve(import.meta.dirname,'../.cache/web')
async function walk(dir){const files=[];for(const item of await readdir(dir,{withFileTypes:true})){const name=join(dir,item.name);if(item.isDirectory())files.push(...await walk(name));else files.push(name)}return files}
const files=(await walk(dist)).filter(x=>!x.includes(`${join('models','')}`)&&!x.endsWith('sw.js'))
const assets=files.map(x=>'./'+x.slice(dist.length+1).replaceAll('\\','/'))
const version=createHash('sha256').update(await readFile(join(dist,'index.html'))).digest('hex').slice(0,12)
await writeFile(join(dist,'sw.js'),`const CACHE='jtq-shell-${version}';
const ASSETS=${JSON.stringify(assets)};
// Leave a new worker waiting until existing camera tabs close.
self.addEventListener('install',event=>{event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(ASSETS)));});
self.addEventListener('activate',event=>{event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith('jtq-shell-')&&key!==CACHE).map(key=>caches.delete(key)))));});
self.addEventListener('fetch',event=>{
  const url=new URL(event.request.url);
  if(event.request.method!=='GET'||url.origin!==self.location.origin||url.pathname.includes('/models/'))return;
  const root=new URL(self.registration.scope);
  if(event.request.mode==='navigate'){
    if(url.pathname===root.pathname||url.pathname===new URL('index.html',root).pathname||url.pathname===new URL('latest',root).pathname){
      event.respondWith((async()=>{
        try{
          const response=await fetch(event.request);
          if(response.status<500)return response;
          return await caches.match('./index.html',{cacheName:CACHE})||response;
        }catch{
          return await caches.match('./index.html',{cacheName:CACHE})||Response.error();
        }
      })());
    }
    return;
  }
  event.respondWith(caches.open(CACHE).then(cache=>cache.match(event.request)).then(cached=>cached||fetch(event.request)));
});
`)
console.log(`Offline shell: ${assets.length} assets; model cache loads on demand.`)
