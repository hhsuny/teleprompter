import {defaultSpeechModel,speechModels,type SpeechModel} from './speech-model'

export type SpeechResult={text:string;sequence:number;final:boolean;segment:number;capturedAt:number}
export type SpeechState='idle'|'loading'|'ready'|'listening'|'paused'|'error'
export class SpeechFollower {
  private worker?:Worker
  private run=0
  private id=0
  private pending=new Map<number,number>()
  private watchdog?:ReturnType<typeof setInterval>
  private loadTimer?:ReturnType<typeof setTimeout>
  private ready=false
  private loading=false
  private failed=false
  private model?:SpeechModel
  private enabled=false
  constructor(private onState:(state:SpeechState,message:string)=>void,private onResult:(result:SpeechResult)=>void,private onProgress:(value:number)=>void,private onLatency:(ms:number)=>void,private onCache:(complete:boolean)=>void=()=>{}){}
  load(model:SpeechModel=defaultSpeechModel){
    if(this.model===model&&(this.ready||this.loading))return
    this.disposeWorker()
    this.failed=false
    this.model=model
    this.onState('loading','正在准备本机语音')
    let worker:Worker
    try{worker=new Worker(new URL('./speech.worker.ts',import.meta.url),{type:'module'})}
    catch{this.fail('无法打开本机语音引擎，请联网后点重试语音。');return}
    this.worker=worker;this.loading=true
    void navigator.storage?.persist?.().catch(()=>{})
    this.loadTimer=setTimeout(()=>this.fail('模型加载超时，请保持联网后重试。'),180_000)
    worker.onerror=()=>this.fail('本机语音引擎已中断，请点重试语音。')
    worker.onmessage=e=>{
      const m=e.data
      if(m.type==='progress'){
        this.onProgress(Math.round(m.loaded/m.total*100))
        clearTimeout(this.loadTimer);this.loadTimer=setTimeout(()=>this.fail('语音文件准备超时，请重试。'),180_000)
      }
      if(m.type==='ready'){clearTimeout(this.loadTimer);this.ready=true;this.loading=false;this.onCache(m.cacheComplete===true);this.onState('ready',`${speechModels[model].label}已就绪`)}
      if(m.type==='stage')this.onState('loading',m.message)
      if(m.type==='error'){this.fail(m.message);return}
      if(m.run!==this.run||!this.enabled)return
      const latency=performance.now()-m.capturedAt
      if(m.type==='ack'){this.pending.delete(m.id);this.onLatency(latency)}
      if(m.type==='result'){
        if(latency>2000){this.pause('识别已落后，跟随暂停；录像继续。点选当前句后重新跟随。');return}
        this.onResult(m)
      }
    }
    worker.postMessage({type:'load',model,base:new URL(import.meta.env.BASE_URL,document.baseURI).href})
  }
  start(){
    if(!this.ready||!this.worker)throw new Error('请先准备语音模型。')
    this.enabled=true;this.run++;this.pending.clear();this.worker.postMessage({type:'reset',run:this.run})
    clearInterval(this.watchdog)
    this.watchdog=setInterval(()=>{const oldest=this.pending.values().next().value;if(oldest!==undefined&&performance.now()-oldest>2500)this.pause('识别处理变慢，跟随暂停；录像继续。请重新跟随。')},400)
    this.onState('listening','正在听你说话')
  }
  feed(samples:Float32Array){
    if(!this.enabled||!this.worker)return
    if(this.pending.size>=20){this.pause('识别跟不上当前速度，跟随暂停；录像继续。');return}
    const id=++this.id,capturedAt=performance.now();this.pending.set(id,capturedAt)
    this.worker.postMessage({type:'audio',run:this.run,id,capturedAt,samples},[samples.buffer])
  }
  pause(message='跟随已暂停，点选文字可重新定位'){
    this.enabled=false;this.run++;this.pending.clear();clearInterval(this.watchdog)
    this.worker?.postMessage({type:'stop'});if(!this.loading&&!this.failed)this.onState(this.ready?'paused':'idle',message)
  }
  private fail(message:string){this.disposeWorker();this.failed=true;this.onState('error',message)}
  private disposeWorker(){clearInterval(this.watchdog);clearTimeout(this.loadTimer);this.worker?.terminate();this.worker=undefined;this.ready=false;this.loading=false;this.enabled=false;this.pending.clear()}
  dispose(){this.disposeWorker()}
}
export class AudioCapture {
  private generation=0
  private context?:AudioContext
  private node?:AudioWorkletNode
  private source?:MediaStreamAudioSourceNode
  prepare(){
    if(!this.context||this.context.state==='closed')this.context=new AudioContext({latencyHint:'interactive'})
    // Called directly from the camera button, while a user gesture is still active.
    void this.context.resume().catch(()=>{})
  }
  async start(stream:MediaStream,onAudio:(samples:Float32Array)=>void,onLevel:(level:number)=>void,onInterrupted:()=>void){
    const generation=++this.generation
    this.node?.disconnect();this.source?.disconnect()
    // Capture at the native device rate and downsample once in the worklet.
    // Avoid an additional live resampler between MediaStream and this context.
    this.prepare();const context=this.context!
    await context.audioWorklet.addModule(`${import.meta.env.BASE_URL}audio-capture.js`)
    if(this.context!==context||this.generation!==generation)throw new DOMException('音频启动已取消','AbortError')
    this.source=context.createMediaStreamSource(stream)
    this.node=new AudioWorkletNode(context,'capture-processor',{numberOfInputs:1,numberOfOutputs:1,outputChannelCount:[1]})
    this.node.port.onmessage=e=>{if(e.data.type==='audio')onAudio(e.data.samples);else if(e.data.type==='level')onLevel(e.data.value)}
    this.source.connect(this.node);this.node.connect(context.destination)
    let timeout:ReturnType<typeof setTimeout>|undefined
    try{await Promise.race([context.resume(),new Promise<never>((_,reject)=>{timeout=setTimeout(()=>reject(new Error('麦克风音频处理未能启动，请轻点「启用语音」重试。')),4000)})])}finally{clearTimeout(timeout)}
    if(this.context!==context||this.generation!==generation)throw new DOMException('音频启动已取消','AbortError')
    if(context.state!=='running')throw new Error('麦克风音频处理未运行，请轻点「启用语音」。')
    context.onstatechange=()=>{if(context.state!=='running'&&context.state!=='closed')onInterrupted()}
  }
  detach(){this.generation++;this.node?.disconnect();this.source?.disconnect();if(this.context)this.context.onstatechange=null;this.node=undefined;this.source=undefined}
  recordingAudio(){
    if(!this.source||this.context?.state!=='running')return
    const source=this.source,destination=this.context.createMediaStreamDestination()
    source.connect(destination)
    const track=destination.stream.getAudioTracks()[0]
    return {track,dispose:()=>{try{source.disconnect(destination)}catch{/* The camera already disconnected this source. */}track.stop()}}
  }
  async stop(){this.detach();const context=this.context;this.context=undefined;if(context)await context.close().catch(()=>{})}
}
