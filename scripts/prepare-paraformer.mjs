import {readFile,writeFile,copyFile,mkdir} from 'node:fs/promises'
import {createHash} from 'node:crypto'
import {resolve,join} from 'node:path'

// Convert the author's ONNX export using the metadata values documented by
// add-model-metadata.py. Appending protobuf field 14 leaves model tensors intact.
const folder=resolve(import.meta.dirname,'../.cache/paraformer')
const manifest=JSON.parse((await readFile(join(folder,'downloads.json'),'utf8')).replace(/^\uFEFF/,''))
for(const file of manifest){
  const bytes=await readFile(join(folder,file.path))
  if(bytes.length!==file.size)throw new Error(`Incomplete download: ${file.path} (${bytes.length}/${file.size})`)
  if(file.lfs?.oid&&createHash('sha256').update(bytes).digest('hex')!==file.lfs.oid)throw new Error(`Hash mismatch: ${file.path}`)
}
const config=await readFile(join(folder,'config.yaml'),'utf8'),cmvn=await readFile(join(folder,'am.mvn'),'utf8')
function property(section,key){const block=config.match(new RegExp(`^${section}:\\n((?:[ \\t].*\\n)*)`,'m'))?.[1];const value=block?.match(new RegExp(`^\\s+${key}: (\\d+)`,'m'))?.[1];if(!value)throw new Error(`Missing ${section}.${key}`);return value}
const moments=cmvn.split(/\r?\n/).filter(line=>line.startsWith('<LearnRateCoef>')).map(line=>line.trim().split(/\s+/).slice(3,-1))
if(moments.length!==2||moments.some(values=>values.length!==560||values.some(value=>!Number.isFinite(+value))))throw new Error('Invalid CMVN')
const tokens=(await readFile(join(folder,'tokens.txt'),'utf8')).trim().split(/\r?\n/)
const metadata={lfr_window_size:property('frontend_conf','lfr_m'),lfr_window_shift:property('frontend_conf','lfr_n'),neg_mean:moments[0].join(','),inv_stddev:moments[1].join(','),encoder_output_size:property('encoder_conf','output_size'),decoder_num_blocks:property('decoder_conf','num_blocks'),decoder_kernel_size:property('decoder_conf','kernel_size'),model_type:'paraformer',version:'1',model_author:'damo',maintainer:'k2-fsa',vocab_size:String(tokens.length),comment:'speech_paraformer_asr_nat-zh-cn-16k-common-vocab8404-online'}
function varint(value){const bytes=[];do{let byte=value&127;value=Math.floor(value/128);if(value)byte|=128;bytes.push(byte)}while(value);return Buffer.from(bytes)}
function field(number,value){const bytes=Buffer.from(value);return Buffer.concat([varint(number*8+2),varint(bytes.length),bytes])}
const fields=Object.entries(metadata).map(([key,value])=>field(14,Buffer.concat([field(1,key),field(2,value)])))
await writeFile(join(folder,'encoder.onnx'),Buffer.concat([await readFile(join(folder,'model_quant.onnx')),...fields]))
await copyFile(join(folder,'decoder_quant.onnx'),join(folder,'decoder.onnx'))
await writeFile(join(folder,'sherpa-tokens.txt'),tokens.map((token,index)=>`${token} ${index}`).join('\n')+'\n')
console.log(JSON.stringify({model:'streaming-paraformer-int8',files:'encoder.onnx, decoder.onnx, sherpa-tokens.txt',vocabSize:tokens.length,source:'csukuangfj/streaming-paraformer-zh'}))
if(process.argv.includes('--publish')){
  const target=resolve(folder,'../../public/models/paraformer');await mkdir(target,{recursive:true})
  const manifest={version:'paraformer-zh-online-int8-v1',architecture:'paraformer',label:'免费中文增强 · Paraformer',license:'Apache-2.0',source:'https://huggingface.co/csukuangfj/streaming-paraformer-zh',files:[]}
  for(const [source,name] of [['encoder.onnx','encoder.onnx'],['decoder.onnx','decoder.onnx'],['sherpa-tokens.txt','tokens.txt']]){
    const bytes=await readFile(join(folder,source)),chunks=[]
    for(let offset=0,index=0;offset<bytes.length;offset+=8*1024*1024,index++){
      const chunk=bytes.subarray(offset,offset+8*1024*1024),url=`${name}.${index}.bin`
      await writeFile(join(target,url),chunk);chunks.push({url,size:chunk.length,sha256:createHash('sha256').update(chunk).digest('hex')})
    }
    manifest.files.push({name,size:bytes.length,chunks})
  }
  await writeFile(join(target,'manifest.json'),JSON.stringify(manifest,null,2))
  console.log(`Prepared ${(manifest.files.reduce((sum,file)=>sum+file.size,0)/1024/1024).toFixed(1)} MiB of free Chinese model assets.`)
}
