import {readdir,readFile,writeFile,mkdir,rm,stat} from 'node:fs/promises'
import {createHash} from 'node:crypto'
import {resolve,join,relative,extname} from 'node:path'
const root=resolve(import.meta.dirname,'..'),web=join(root,'.cache/web'),dist=join(root,'dist')
const types={'.html':'text/html;charset=utf-8','.js':'text/javascript;charset=utf-8','.css':'text/css;charset=utf-8','.json':'application/json','.webmanifest':'application/manifest+json','.wasm':'application/wasm','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.txt':'text/plain;charset=utf-8'}
const assets={}
async function walk(dir){for(const entry of (await readdir(dir,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){const file=join(dir,entry.name);if(entry.name==='.openai')continue;if(entry.isDirectory())await walk(file);else{const bytes=await readFile(file),path='/'+relative(web,file).replaceAll('\\','/');if(bytes.length>16*1024*1024)throw new Error(`Split this published asset before deployment: ${path}`);assets[path]={sha256:createHash('sha256').update(bytes).digest('hex'),size:bytes.length,type:types[extname(file)]||'application/octet-stream'}}}}
await walk(web)
for(const model of ['mandarin','paraformer','zipformer']){
  const manifest=JSON.parse(await readFile(join(web,`models/${model}/manifest.json`),'utf8'))
  for(const file of manifest.files){
    for(const chunk of file.chunks){
      const asset=assets[`/models/${model}/${chunk.url}`]
      if(!asset||asset.sha256!==chunk.sha256||asset.size!==chunk.size)throw new Error(`Invalid ${model} model chunk: ${chunk.url}`)
    }
  }
}
const mandarin=JSON.parse(await readFile(join(web,'models/mandarin/manifest.json'),'utf8'))
for(const file of mandarin.files){
  let offset=0
  for(const chunk of file.chunks){
    const asset=assets['/models/mandarin/'+chunk.url]
    asset.optional=true
    asset.remote={url:`${mandarin.source}/${file.name}?download=true`,start:offset,end:offset+asset.size-1,total:file.size}
    offset+=asset.size
  }
}
// Use the model author's byte-identical files to populate the cache on demand.
// A fresh release can serve the app while its additional model downloads.
const zipformerOrigin='https://huggingface.co/csukuangfj/sherpa-onnx-streaming-zipformer-zh-14M-2023-02-23/resolve/204ad334e2e683fd295359930cc16fc0432a23ac'
const zipformerFiles={
  'encoder.onnx':'encoder-epoch-99-avg-1.int8.onnx',
  'decoder.onnx':'decoder-epoch-99-avg-1.onnx',
  'joiner.onnx':'joiner-epoch-99-avg-1.int8.onnx',
}
const zipformer=JSON.parse(await readFile(join(web,'models/zipformer/manifest.json'),'utf8'))
for(const file of zipformer.files){
  const filename=zipformerFiles[file.name]
  if(!filename)continue
  let offset=0
  for(const chunk of file.chunks){
    const asset=assets['/models/zipformer/'+chunk.url]
    asset.optional=true
    asset.remote={url:`${zipformerOrigin}/${filename}?download=true`,start:offset,end:offset+asset.size-1,total:file.size}
    offset+=asset.size
  }
}
// Bundle the app shell so ordinary UI updates can reuse the existing model
// and WASM objects without waiting for another asset upload.
for(const [path,asset] of Object.entries(assets)){
  const scriptOrStyle=path.startsWith('/assets/')&&/\.(js|css)$/.test(path)
  if(asset.size<=(scriptOrStyle?512*1024:65536))asset.inline=(await readFile(join(web,path.slice(1)))).toString('base64')
}
// The prepared encoder is the official quantized model plus a small metadata
// suffix; decoder bytes are unchanged. Allow the server to import public model
// ranges itself, verifying the exact same prepared chunk SHA-256 before caching.
for(const [path,asset] of Object.entries(assets)){
  const match=path.match(/^\/models\/paraformer\/(encoder|decoder)\.onnx\.(\d+)\.bin$/)
  if(!match)continue
  const source=match[1]==='encoder'?'model_quant.onnx':'decoder_quant.onnx'
  let original;try{original=await stat(join(root,'.cache/paraformer',source))}catch{continue}
  const start=Number(match[2])*8*1024*1024,end=Math.min(start+asset.size,original.size)-1
  if(end<start)continue
  const tail=asset.size-(end-start+1)
  asset.remote={url:`https://huggingface.co/csukuangfj/streaming-paraformer-zh/resolve/main/${source}?download=true`,start,end,total:original.size,...(tail?{tail:(await readFile(join(web,path.slice(1)))).subarray(asset.size-tail).toString('base64')}:{})}
}
const release=createHash('sha256').update(JSON.stringify(assets)).digest('hex')
const config=JSON.parse(await readFile(join(root,'.openai/hosting.json'),'utf8'))
if(config.static||!config.r2)throw new Error('Worker publishing requires the declared R2 asset binding')
// This resolved, fixed build target is inside this project; never remove source.
if(dist!==resolve(root,'dist'))throw new Error('Unexpected build target')
await rm(dist,{recursive:true,force:true});await mkdir(join(dist,'server'),{recursive:true});await mkdir(join(dist,'.openai'),{recursive:true})
const server=await readFile(join(root,'worker/serve.mjs'),'utf8')
await writeFile(join(dist,'server/index.js'),`${server}\nexport default createHandler(${JSON.stringify(assets)},${JSON.stringify(release)}, {checkExisting:true});\n`)
await writeFile(join(dist,'.openai/hosting.json'),JSON.stringify(config,null,2)+'\n')
await writeFile(join(root,'.cache/site-assets.json'),JSON.stringify({release,assets},null,2)+'\n')
console.log(`Small Worker ready: ${Object.keys(assets).length} assets uploaded independently; release ${release.slice(0,12)}`)
