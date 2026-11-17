import {createHash} from 'node:crypto'
import {mkdir,readFile,writeFile} from 'node:fs/promises'
import {resolve,join} from 'node:path'

const root=resolve(import.meta.dirname,'..')
const input=resolve(process.argv[2]??join(root,'.cache/mandarin-ctc-eval'))
const output=join(root,'public/models/mandarin')
const chunkSize=8*1024*1024
const source='https://huggingface.co/csukuangfj/sherpa-onnx-streaming-zipformer-small-ctc-zh-int8-2025-04-01/resolve/a5f60fe'
const hashes={
  'model.int8.onnx':'68c9c943840f7d9cf3e8a4970ba50f404feb5277f611fa82b7e72267786fa84a',
  'tokens.txt':'6fed8c6c248516f38e7faa19404b57413e8ce259f1cbc1fa4aebc86eac32fdfd',
}
const sha256=data=>createHash('sha256').update(data).digest('hex')
const models=await Promise.all(Object.entries(hashes).map(async ([name,expected])=>{
  const bytes=await readFile(join(input,name))
  if(sha256(bytes)!==expected)throw new Error(`Model checksum mismatch: ${name}`)
  return {name,bytes}
}))
const files=[]
await mkdir(output,{recursive:true})
for(const {name,bytes} of models){
  const chunks=[]
  for(let start=0;start<bytes.length;start+=chunkSize){
    const data=bytes.subarray(start,start+chunkSize)
    const url=`${name}.${start/chunkSize}.bin`
    await writeFile(join(output,url),data)
    chunks.push({url,size:data.length,sha256:sha256(data)})
  }
  files.push({name,size:bytes.length,chunks})
}
await writeFile(join(output,'manifest.json'),JSON.stringify({version:'mandarin-ctc-int8-2025-04-01',architecture:'zipformer2-ctc',source,files},null,2)+'\n')
