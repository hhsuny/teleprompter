// Real local inference on the model author's 16 kHz Chinese test recording.
import {readFile,writeFile} from 'node:fs/promises'
import {resolve,join} from 'node:path'
import {initASRModule,createOnlineRecognizer} from '@sherpaw/asr'
const root=resolve(import.meta.dirname,'..'),manifest=JSON.parse(await readFile(join(root,'public/models/manifest.json'),'utf8'))
const module=await initASRModule()
for(const file of manifest.files){const parts=await Promise.all(file.chunks.map(chunk=>readFile(join(root,'public/models',chunk.url))));module.FS_createDataFile('/',file.name,Buffer.concat(parts),true,false,true)}
const recognizer=createOnlineRecognizer(module,{modelConfig:{transducer:{encoder:'/encoder.onnx',decoder:'/decoder.onnx',joiner:'/joiner.onnx'},tokens:'/tokens.txt',numThreads:1,debug:0},decodingMethod:'greedy_search',enableEndpoint:1})
const sample=process.argv[2]||'0'
if(!/^\d+$/.test(sample))throw new Error('Use a numeric sample id')
const wav=await readFile(join(root,`.cache/sherpa-onnx-streaming-zipformer-small-bilingual-zh-en-2023-02-16/test_wavs/${sample}.wav`))
let rate=0,channels=0,bits=0,pcm
for(let p=12;p+8<wav.length;){const id=wav.toString('ascii',p,p+4),size=wav.readUInt32LE(p+4);if(id==='fmt '){channels=wav.readUInt16LE(p+10);rate=wav.readUInt32LE(p+12);bits=wav.readUInt16LE(p+22)}if(id==='data')pcm=wav.subarray(p+8,p+8+size);p+=8+size+(size%2)}
if(!pcm||bits!==16||channels!==1)throw new Error('Unsupported test WAV format')
const samples=new Float32Array(pcm.length/2);for(let i=0;i<samples.length;i++)samples[i]=pcm.readInt16LE(i*2)/32768
const stream=recognizer.createStream(),start=performance.now();let text=''
for(let p=0;p<samples.length;p+=3200){stream.acceptWaveform(rate,samples.subarray(p,p+3200));while(recognizer.isReady(stream))recognizer.decode(stream);text=recognizer.getResult(stream).text}
stream.acceptWaveform(rate,new Float32Array(rate));stream.inputFinished();while(recognizer.isReady(stream))recognizer.decode(stream)
text=recognizer.getResult(stream).text
const result={text,audioSeconds:samples.length/rate,computeMs:Math.round(performance.now()-start),note:'Desktop local inference only; not iPhone camera acceptance.'}
if((text.match(/[\u4e00-\u9fff]/g)||[]).length<4)throw new Error('Chinese inference did not return a useful transcript: '+text)
await writeFile(join(root,'.cache/asr-check.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));stream.free();recognizer.free()
