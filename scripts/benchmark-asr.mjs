import {readFile,writeFile} from 'node:fs/promises'
import {join,resolve} from 'node:path'
import {createOnlineRecognizer,initASRModule} from '@sherpaw/asr'
import {transcriptionErrors} from './asr-metrics.mjs'
const root=resolve(import.meta.dirname,'..'),model=process.argv[2]||'zipformer'
if(!['zipformer','paraformer'].includes(model))throw new Error('Use zipformer or paraformer')
const module=await initASRModule(),loadedAt=performance.now()
let config
if(model==='zipformer'){
  const manifest=JSON.parse(await readFile(join(root,'public/models/manifest.json'),'utf8'))
  for(const file of manifest.files){const chunks=await Promise.all(file.chunks.map(chunk=>readFile(join(root,'public/models',chunk.url))));module.FS_createDataFile('/',file.name,Buffer.concat(chunks),true,false,true)}
  config={type:0,modelConfig:{transducer:{encoder:'/encoder.onnx',decoder:'/decoder.onnx',joiner:'/joiner.onnx'},tokens:'/tokens.txt',numThreads:1,debug:0},decodingMethod:'greedy_search',enableEndpoint:1}
}else{
  for(const [source,target] of [['encoder.onnx','encoder.onnx'],['decoder.onnx','decoder.onnx'],['sherpa-tokens.txt','tokens.txt']])module.FS_createDataFile('/',target,new Uint8Array(await readFile(join(root,'.cache/paraformer',source))),true,false,true)
  config={type:1,modelConfig:{paraformer:{encoder:'/encoder.onnx',decoder:'/decoder.onnx'},tokens:'/tokens.txt',numThreads:1,debug:0},decodingMethod:'greedy_search',enableEndpoint:1}
}
const recognizer=createOnlineRecognizer(module,config)
if(!recognizer.handle)throw new Error('Recognizer did not initialize')
const loadMs=performance.now()-loadedAt,results=[]
const base=join(root,'.cache/sherpa-onnx-streaming-zipformer-small-bilingual-zh-en-2023-02-16/test_wavs')
const cases=[...Array.from({length:5},(_,index)=>({name:`official-${index}`,path:join(base,`${index}.wav`)})),{name:'funasr-welcome',path:join(root,'.cache/paraformer/asr_example_zh.wav'),reference:'欢迎大家来体验达摩院推出的语音识别模型'}]
function wave(bytes){
  let rate=0,channels=0,bits=0,data
  for(let p=12;p+8<=bytes.length;){const type=bytes.toString('ascii',p,p+4),size=bytes.readUInt32LE(p+4);if(type==='fmt '){rate=bytes.readUInt32LE(p+12);channels=bytes.readUInt16LE(p+10);bits=bytes.readUInt16LE(p+22)}if(type==='data')data=bytes.subarray(p+8,p+8+size);p+=8+size+(size%2)}
  if(!data||bits!==16||channels!==1)throw new Error('Expected mono PCM16 WAV')
  const samples=new Float32Array(data.length/2);for(let i=0;i<samples.length;i++)samples[i]=data.readInt16LE(i*2)/32768
  return {samples,rate}
}
try{
  for(const entry of cases){
    const {samples,rate}=wave(await readFile(entry.path)),stream=recognizer.createStream(),start=performance.now(),chunk=Math.round(rate/10)
    let text='',firstTextAtAudioMs=null,maxChunkMs=0
    for(let offset=0;offset<samples.length+rate*1.2;offset+=chunk){
      const packet=new Float32Array(chunk);packet.set(samples.subarray(offset,offset+chunk))
      const before=performance.now();stream.acceptWaveform(rate,packet);while(recognizer.isReady(stream))recognizer.decode(stream)
      text=String(recognizer.getResult(stream).text||'');maxChunkMs=Math.max(maxChunkMs,performance.now()-before)
      if(text&&firstTextAtAudioMs===null)firstTextAtAudioMs=(offset+chunk)*1000/rate
    }
    const computeMs=performance.now()-start,duration=samples.length/rate,result={sample:entry.name,text,audioSeconds:+duration.toFixed(2),computeMs:Math.round(computeMs),rtf:+(computeMs/duration/1000).toFixed(3),maxChunkMs:Math.round(maxChunkMs),firstTextAtAudioMs,...entry.reference?{reference:entry.reference,...transcriptionErrors(entry.reference,text)}:{reference:null,note:'No independently verified reference; transcript comparison only'}}
    results.push(result);console.log(JSON.stringify(result));stream.free()
  }
}finally{recognizer.free()}
await writeFile(join(root,`.cache/asr-benchmark-${model}.json`),JSON.stringify({model,loadMs:Math.round(loadMs),preprocessing:'raw PCM; no gain or manuscript hints',note:'Desktop WASM only. One scored example is not an accuracy benchmark or iPhone performance acceptance.',results},null,2))
