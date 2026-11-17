import { createOnlineRecognizer, initASRModule, type OnlineRecognizer, type OnlineStream } from '@sherpaw/asr'
import paraformer from '../public/models/paraformer/manifest.json'
import mandarin from '../public/models/mandarin/manifest.json'
import zipformer from '../public/models/zipformer/manifest.json'
import {restoreSpeechModel,type SpeechModel} from './speech-model'
import {boundedCache,readModelChunk} from './model-cache'

type Runtime={FS_createDataFile:(parent:string,name:string,data:Uint8Array,read:boolean,write:boolean,own:boolean)=>void;FS_unlink:(path:string)=>void}
const scope=globalThis as unknown as {postMessage:(message:unknown)=>void;onmessage:((e:MessageEvent)=>void)|null}
let recognizer:OnlineRecognizer|undefined,stream:OnlineStream|undefined,run=0,sequence=0,segment=0,lastText=''
const send=(message:object)=>scope.postMessage(message)
function reset(nextRun:number){stream?.free();stream=recognizer?.createStream();run=nextRun;lastText='';segment++;sequence=0}
async function load(base:string,model:SpeechModel){
  if(recognizer){send({type:'ready'});return}
  if(!globalThis.WebAssembly)throw new Error('当前浏览器不支持本地识别，请使用更新的 Safari。')
  const modelBase=new URL(`models/${model}/`,base)
  const manifest={mandarin,paraformer,zipformer}[model]
  const firstModel=manifest.files[0]
  // Fetch model chunks while WebAssembly starts. For the small model the
  // assembled buffer fits comfortably alongside the runtime; keep the larger
  // model's files sequential to limit peak memory on phones.
  send({type:'stage',message:'正在启动本机语音引擎'})
  const runtimeReady=initASRModule().catch(()=>{throw new Error('本机语音引擎加载失败，请联网后点重试语音。')})
  const total=manifest.files.reduce((n,f)=>n+f.size,0)
  let loaded=0,cache:Cache|undefined,downloaded=false,cacheComplete=true
  const cacheReady=async()=>{
    send({type:'stage',message:'正在检查本机中文语音文件'})
    try{cache=await boundedCache(caches.open(`jtq-model-${manifest.version}`))}catch{cacheComplete=false}
  }
  async function assemble(file:typeof firstModel){
    const data=new Uint8Array(file.size);let offset=0
    for(const [index,chunk] of file.chunks.entries()){
      let result:Awaited<ReturnType<typeof readModelChunk>>
      try {
        result=await readModelChunk(new URL(chunk.url,modelBase).href,chunk,cache,()=>{
          if(!downloaded){downloaded=true;send({type:'stage',message:'正在补下载缺少的语音文件'})}
        })
      }catch(error){
        throw new Error(`${error instanceof Error?error.message:'语音加载失败。'}（${file.name} ${index+1}/${file.chunks.length}）`)
      }
      cacheComplete&&=result.saved
      data.set(result.bytes,offset);offset+=result.bytes.length;loaded+=result.bytes.length
      send({type:'progress',loaded,total})
    }
    return data
  }
  const [asr,firstData]=await Promise.all([runtimeReady,cacheReady().then(()=>assemble(firstModel))])
  const runtime=asr as unknown as Runtime
  runtime.FS_createDataFile('/',firstModel.name,firstData,true,false,true)
  for(const file of manifest.files.slice(1))runtime.FS_createDataFile('/',file.name,await assemble(file),true,false,true)
  send({type:'stage',message:'语音文件已读取，正在启动识别'})
  const backend=model==='mandarin'
    ?{type:2 as const,modelConfig:{zipformer2Ctc:{model:'/model.int8.onnx'}}}
    :model==='zipformer'
      ?{type:0 as const,modelConfig:{transducer:{encoder:'/encoder.onnx',decoder:'/decoder.onnx',joiner:'/joiner.onnx'}}}
      :{type:1 as const,modelConfig:{paraformer:{encoder:'/encoder.onnx',decoder:'/decoder.onnx'}}}
  recognizer=createOnlineRecognizer(runtime as Parameters<typeof createOnlineRecognizer>[0],{
    type:backend.type,modelConfig:{...backend.modelConfig,tokens:'/tokens.txt',numThreads:1,provider:'cpu',debug:0},
    decodingMethod:'greedy_search',enableEndpoint:1,rule1MinTrailingSilence:2.4,rule2MinTrailingSilence:1.2,rule3MinUtteranceLength:20,
  })
  if(!recognizer.handle)throw new Error('语音引擎初始化失败，请重新加载。')
  for(const file of manifest.files)runtime.FS_unlink(`/${file.name}`)
  send({type:'ready',cacheComplete})
}
scope.onmessage=e=>{
  const message=e.data
  if(message.type==='load'){void load(message.base,restoreSpeechModel(message.model)).catch(error=>send({type:'error',message:error instanceof Error?error.message:String(error)}));return}
  try{
    if(message.type==='reset'){reset(message.run);send({type:'reset',run});return}
    if(message.type==='stop'){run=0;stream?.free();stream=undefined;return}
    if(message.type!=='audio'||message.run!==run||!run||!recognizer||!stream)return
    const samples=message.samples as Float32Array
    // Paraformer includes its trained feature normalization. Keep PCM unchanged;
    // per-packet gain pumping amplifies pauses and can introduce spurious words.
    stream.acceptWaveform(16000,samples)
    while(recognizer.isReady(stream))recognizer.decode(stream)
    const text=String(recognizer.getResult(stream).text||'').replaceAll('<unk>',' ').trim(),final=recognizer.isEndpoint(stream)
    if(text!==lastText||(final&&text)){send({type:'result',text:text.slice(-160),final,sequence:++sequence,segment,run,capturedAt:message.capturedAt});lastText=text}
    send({type:'ack',id:message.id,run,capturedAt:message.capturedAt})
    // Native reset retains unread feature frames, unlike freeing the stream.
    // Bound decoder history during long takes and keep pauses inexpensive.
    if(final){recognizer.reset(stream);lastText='';segment++}
  }catch(error){send({type:'error',message:error instanceof Error?error.message:'语音识别已中断，请重新启动跟随。'})}
}
