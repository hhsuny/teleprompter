import {readFile,writeFile,mkdir,stat} from 'node:fs/promises'
import {createHash} from 'node:crypto'
import {execFileSync} from 'node:child_process'
import {resolve,join} from 'node:path'

const root=resolve(import.meta.dirname,'..'),cache=join(root,'.cache')
const name='sherpa-onnx-streaming-zipformer-zh-14M-2023-02-23'
const archive=join(cache,'zipformer-zh-14m.tar.bz2'),folder=join(cache,name),target=join(root,'public','models','zipformer')
await mkdir(cache,{recursive:true})
if(!await stat(archive).catch(()=>null)){
  execFileSync('curl.exe',['-L','--fail','--output',archive,`https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/${name}.tar.bz2`],{stdio:'inherit',timeout:600_000})
}
if(!await stat(join(folder,'tokens.txt')).catch(()=>null)){
  const selected=['encoder-epoch-99-avg-1.int8.onnx','decoder-epoch-99-avg-1.onnx','joiner-epoch-99-avg-1.int8.onnx','tokens.txt']
  execFileSync('tar',['-xjf',archive,'-C',cache,...selected.map(path=>`${name}/${path}`)],{stdio:'inherit',timeout:120_000})
}
await mkdir(target,{recursive:true})
const manifest={version:'zipformer-zh-14m-20230223-int8-1',architecture:'zipformer-transducer',source:'https://github.com/k2-fsa/sherpa-onnx/releases/tag/asr-models',files:[]}
for(const [source,name] of [['encoder-epoch-99-avg-1.int8.onnx','encoder.onnx'],['decoder-epoch-99-avg-1.onnx','decoder.onnx'],['joiner-epoch-99-avg-1.int8.onnx','joiner.onnx'],['tokens.txt','tokens.txt']]){
  const bytes=await readFile(join(folder,source)),chunks=[]
  for(let offset=0,index=0;offset<bytes.length;offset+=8*1024*1024,index++){
    const chunk=bytes.subarray(offset,offset+8*1024*1024),url=`${name}.${index}.bin`
    await writeFile(join(target,url),chunk)
    chunks.push({url,size:chunk.length,sha256:createHash('sha256').update(chunk).digest('hex')})
  }
  manifest.files.push({name,size:bytes.length,chunks})
}
await writeFile(join(target,'manifest.json'),JSON.stringify(manifest,null,2)+'\n')
console.log(`Prepared ${(manifest.files.reduce((n,f)=>n+f.size,0)/1024/1024).toFixed(1)} MiB of streaming Zipformer assets.`)
