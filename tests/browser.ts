// Dev-server-only integration harness. Not an application entry or production build asset.
import {SpeechFollower} from '../src/speech'
import {AudioCapture} from '../src/speech'
import {CameraRecorder,exportTake} from '../src/recorder'
import {deleteTake,allTakes} from '../src/storage'
import {inspectMp4} from '../src/mp4'
import {locateSpeech} from '../src/alignment'
import {recordCalibration,isVerified60} from '../src/camera'
import {transcriptionErrors} from '../scripts/asr-metrics.mjs'
const output=document.querySelector<HTMLPreElement>('#output')!
const log=(value:unknown)=>{output.textContent+='\n'+(typeof value==='string'?value:JSON.stringify(value))}
const speechReference='欢迎大家来体验达摩院推出的语音识别模型'
const energy=(input:Float32Array,rate:number)=>Array.from({length:Math.ceil(input.length/rate)},(_,second)=>{let sum=0;const end=Math.min(input.length,(second+1)*rate);for(let i=second*rate;i<end;i++)sum+=input[i]*input[i];return +Math.sqrt(sum/Math.max(1,end-second*rate)).toFixed(5)})

const calibration=document.createElement('button');calibration.textContent='检查60帧校准与取消';document.querySelector('#record')!.after(calibration)
calibration.onclick=()=>{void(async()=>{
  output.textContent='合成画面校准检查；不代表 iPhone 实测。'
  const canvas=document.querySelector<HTMLCanvasElement>('canvas')!,context=canvas.getContext('2d')!,audio=new AudioContext(),destination=audio.createMediaStreamDestination(),tone=audio.createOscillator(),gain=audio.createGain()
  tone.connect(gain).connect(destination);gain.gain.value=.01;tone.start();await audio.resume()
  let frame=0,request=0,media:MediaStream|undefined
  const draw=()=>{frame++;context.fillStyle='#294f64';context.fillRect(0,0,1080,1920);context.fillStyle='#ffffff';context.font='70px sans-serif';context.fillText(String(frame),60,130);context.fillRect((frame*13)%900,400,100,100);request=requestAnimationFrame(draw)};draw()
  try{
    for(const target of [60,30]){
      media=canvas.captureStream(target);destination.stream.getAudioTracks().forEach(track=>media!.addTrack(track))
      const blob=await recordCalibration(media,new AbortController().signal),inspection=await inspectMp4(blob)
      log({target,bytes:blob.size,inspection,drawnFrames:frame})
      if(!inspection||inspection.frames<2||inspection.duration<=0||!Number.isFinite(inspection.fps))throw new Error('校准文件无法读取有效视频样本')
      if(target===30&&inspection.fps>=40)throw new Error('30帧控制样本未被正确识别')
      if(inspection.fps<59&&isVerified60({version:2,userAgent:'test',frameRateConstraint:true,attempts:[],verified:true,fileFps:inspection.fps}))throw new Error('低帧率文件被错误放行')
      const controller=new AbortController(),promise=recordCalibration(media,controller.signal);setTimeout(()=>controller.abort(),100)
      try{await promise;throw new Error('取消后仍然完成录制')}catch(error){if(!(error instanceof DOMException&&error.name==='AbortError'))throw error}
      if(media.getTracks().some(track=>track.readyState!=='live'))throw new Error('校准意外关闭了源轨道')
      media.getVideoTracks().forEach(track=>track.stop())
    }
    log({result:'PASS: MP4编码解析、低帧率拒绝、取消后保留源轨道；合成画面帧率不代表手机验收'})
  }catch(error){log({result:'FAIL',error:String(error)})}
  finally{cancelAnimationFrame(request);media?.getTracks().forEach(track=>track.stop());destination.stream.getTracks().forEach(track=>track.stop());tone.stop();await audio.close()}
})()}
document.querySelector<HTMLButtonElement>('#speech')!.onclick=()=>{
  output.textContent='正在启动真实浏览器 Worker…'
  let sent=false,position=0,received=0;const transcripts=new Map<number,string>()
  const follower=new SpeechFollower((state,message)=>{
    log({state,message})
    if(state==='ready'&&!sent){sent=true;void run()}
  },result=>{received++;if(result.text)transcripts.set(result.segment,result.text);const match=locateSpeech(speechReference,result.text,position);position=match.position;log({text:result.text,final:result.final,segment:result.segment,position,matched:match.matched})},()=>{},()=>{})
  async function run(){
    try{
      const context=new AudioContext(),res=await fetch('/.cache/paraformer/asr_example_zh.wav'),buffer=await context.decodeAudioData(await res.arrayBuffer())
      const repeated=context.createBuffer(1,Math.ceil((buffer.duration*2+10)*context.sampleRate),context.sampleRate);repeated.copyToChannel(buffer.getChannelData(0),0,0);repeated.copyToChannel(buffer.getChannelData(0),0,Math.round((buffer.duration+10)*context.sampleRate));const source=context.createBufferSource(),destination=context.createMediaStreamDestination();source.buffer=repeated;source.connect(destination)
      const capture=new AudioCapture();let packets=0,totalSamples=0,maxLevel=0;const captured:Float32Array[]=[]
      await capture.start(destination.stream,samples=>{packets++;totalSamples+=samples.length;captured.push(samples.slice());follower.feed(samples)},level=>{maxLevel=Math.max(maxLevel,level)},()=>{})
      follower.start();source.start();await new Promise<void>(resolve=>{source.onended=()=>resolve()});await new Promise(resolve=>setTimeout(resolve,2000))
      await capture.stop();await context.close();follower.dispose();destination.stream.getTracks().forEach(t=>t.stop())
      const combined=new Float32Array(totalSamples);let cursor=0;for(const packet of captured){combined.set(packet,cursor);cursor+=packet.length}
      log({packets,totalSamples,maxLevel,duration:buffer.duration,sampleRate:context.sampleRate,received,position,inputEnergy:energy(buffer.getChannelData(0),buffer.sampleRate),capturedEnergy:energy(combined,16000)})
      const scored=[...transcripts].map(([segment,text])=>({segment,text,...transcriptionErrors(speechReference,text)}));log({transcriptionScores:scored});if(scored.filter(score=>score.cer!==null&&score.cer<=.1).length<2)throw new Error('两次转写未通过字错误率检查，不能仅凭定位成功判定通过');if(!received||position<speechReference.length)throw new Error('流式识别没有推进到样本末尾')
      log({result:'PASS: Browser AudioWorklet → Worker → 原稿定位',packets,received,position})
    }catch(e){follower.dispose();log({result:'FAIL',error:String(e)})}
  }
  follower.load()
}
const direct=document.createElement('button');direct.textContent='检查直接音频输入';document.querySelector('#record')!.after(direct)
direct.onclick=()=>{
  output.textContent='直接输入16kHz音频，隔离采集与模型问题。';let started=false,received=0,last=''
  const follower=new SpeechFollower((state,message)=>{log({state,message});if(state==='ready'&&!started){started=true;void run()}},result=>{received++;last=result.text;log({text:last})},()=>{},()=>{})
  async function run(){
    try{const context=new OfflineAudioContext(1,16000,16000),res=await fetch('/.cache/paraformer/asr_example_zh.wav'),buffer=await context.decodeAudioData(await res.arrayBuffer()),samples=buffer.getChannelData(0);follower.start();for(let p=0;p<samples.length+32000;p+=3200){const part=new Float32Array(3200);part.set(samples.subarray(p,p+3200));follower.feed(part);await new Promise(resolve=>setTimeout(resolve,200))}log({result:transcriptionErrors(speechReference,last).cer===0?'PASS':'FAIL',last,received,sampleRate:buffer.sampleRate})}catch(e){log(String(e))}finally{follower.dispose()}
  };follower.load()
}
document.querySelector<HTMLButtonElement>('#record')!.onclick=()=>{void(async()=>{
  output.textContent='正在用合成1080×1920画面测试；不代表真机60帧验收。'
  const canvas=document.querySelector<HTMLCanvasElement>('canvas')!,context=canvas.getContext('2d')!,audioContext=new AudioContext(),destination=audioContext.createMediaStreamDestination(),oscillator=audioContext.createOscillator(),gain=audioContext.createGain()
  oscillator.frequency.value=440;gain.gain.value=0.02;oscillator.connect(gain).connect(destination);oscillator.start()
  const media=canvas.captureStream(60);destination.stream.getAudioTracks().forEach(track=>media.addTrack(track))
  let request=0,frame=0
  const draw=()=>{context.fillStyle=frame++%2?'#385f79':'#567c94';context.fillRect(0,0,1080,1920);context.fillStyle='white';context.font='80px sans-serif';context.fillText(String(frame),80,150);request=requestAnimationFrame(draw)};draw()
  const recorder=new CameraRecorder(error=>log({recordError:String(error)}))
  try{
    for(let i=1;i<=3;i++){
      await recorder.start(media,`集成检查-${i}`);await new Promise(resolve=>setTimeout(resolve,2200));const take=await recorder.stop();const file=await exportTake(take)
      if(!file.size||take.status!=='ready')throw new Error('录制或存储失败')
      const video=document.querySelector('video')!,url=URL.createObjectURL(file)
      video.src=url;await new Promise<void>((resolve,reject)=>{video.onloadedmetadata=()=>resolve();video.onerror=()=>reject(new Error('保存的视频无法读取'))})
      const decoded=await audioContext.decodeAudioData(await file.arrayBuffer()),samples=decoded.getChannelData(0)
      const hasAudio=energy(samples,decoded.sampleRate).some(value=>value>0.001)
      log({take:i,size:file.size,width:video.videoWidth,height:video.videoHeight,duration:video.duration,metadata:take.mime.includes('mp4')?await inspectMp4(file):null,hasAudio})
      if(!hasAudio)throw new Error('保存的视频没有有效音频')
      if(video.videoWidth!==1080||video.videoHeight!==1920)throw new Error('保存后分辨率不正确')
      video.removeAttribute('src');video.load();URL.revokeObjectURL(url);await deleteTake(take.id)
    }
    log({result:'PASS: 三次合成录制、IndexedDB持久化、重组、媒体读取和清理',remainingTakes:(await allTakes()).length})
  }catch(error){log({result:'FAIL',error:String(error)})}
  finally{cancelAnimationFrame(request);media.getTracks().forEach(t=>t.stop());await audioContext.close()}
})()}
