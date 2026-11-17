import {readFile,writeFile,mkdir,stat} from 'node:fs/promises'
import {createHash} from 'node:crypto'
import {execFileSync} from 'node:child_process'
import {resolve,join} from 'node:path'
const root=resolve(import.meta.dirname,'..'),cache=join(root,'.cache'),name='sherpa-onnx-streaming-zipformer-small-bilingual-zh-en-2023-02-16'
await mkdir(cache,{recursive:true})
const archive=join(cache,'small-model.tar.bz2'),folder=join(cache,name)
if(!await stat(join(folder,'tokens.txt')).catch(()=>null)){
  if(!await stat(archive).catch(()=>null)){
    console.log('Downloading official model archive. This archive includes extra training files; only ~48 MB is deployed.')
    execFileSync('gh',['release','download','asr-models','--repo','k2-fsa/sherpa-onnx','--pattern',`${name}.tar.bz2`,'--dir',cache,'--skip-existing'],{stdio:'inherit',timeout:600_000})
  }
  const selected=['encoder-epoch-99-avg-1.int8.onnx','decoder-epoch-99-avg-1.int8.onnx','joiner-epoch-99-avg-1.int8.onnx','tokens.txt',...Array.from({length:5},(_,index)=>`test_wavs/${index}.wav`)]
  const source=await stat(archive).catch(()=>null)?archive:join(cache,`${name}.tar.bz2`)
  execFileSync('tar',['-xjf',source,'-C',cache,...selected.map(p=>`${name}/${p}`)],{stdio:'inherit',timeout:120_000})
}
const target=join(root,'public','models');await mkdir(target,{recursive:true})
const manifest={version:'zipformer-small-20230216-int8-1',source:'https://huggingface.co/csukuangfj/k2fsa-zipformer-bilingual-zh-en-t',files:[]}
for(const [source,name] of [['encoder-epoch-99-avg-1.int8.onnx','encoder.onnx'],['decoder-epoch-99-avg-1.int8.onnx','decoder.onnx'],['joiner-epoch-99-avg-1.int8.onnx','joiner.onnx'],['tokens.txt','tokens.txt']]){
  const bytes=await readFile(join(folder,source)),chunks=[]
  for(let offset=0,index=0;offset<bytes.length;offset+=8*1024*1024,index++){
    const chunk=bytes.subarray(offset,offset+8*1024*1024),url=`${name}.${index}.bin`
    await writeFile(join(target,url),chunk);chunks.push({url,size:chunk.length,sha256:createHash('sha256').update(chunk).digest('hex')})
  }
  manifest.files.push({name,size:bytes.length,chunks})
}
await writeFile(join(target,'manifest.json'),JSON.stringify(manifest,null,2))
console.log(`Prepared ${(manifest.files.reduce((n,f)=>n+f.size,0)/1024/1024).toFixed(1)} MiB of model assets.`)
