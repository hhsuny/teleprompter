import {createCaptureOutput} from '../src/zoom'
import {defaultCapture} from '../src/capture-spec'
import {recordCalibration} from '../src/camera'
import {inspectMp4,inspectMp4Dimensions} from '../src/mp4'
const logElement=document.querySelector('#output')!,button=document.querySelector<HTMLButtonElement>('#verify')!
const log=(value:unknown)=>logElement.textContent+='\n'+JSON.stringify(value)
button.onclick=()=>{void(async()=>{
  button.disabled=true;logElement.textContent='合成源真实编码、解码检查。此测试不代表 iPhone 验收。'
  const canvas=document.querySelector('canvas')!,painter=canvas.getContext('2d')!,video=document.querySelector('video')!,audio=new AudioContext(),tone=audio.createOscillator(),gain=audio.createGain(),destination=audio.createMediaStreamDestination()
  gain.gain.value=.03;tone.connect(gain).connect(destination);tone.start();await audio.resume()
  let paint=0;const redraw=()=>{painter.fillStyle='#ff0000';painter.fillRect(0,0,180,320);painter.fillStyle='#00ff00';painter.fillRect(45,80,90,160);painter.fillStyle='#0000ff';painter.fillRect(60,107,60,106);painter.fillStyle='#ffffff';painter.fillRect(85,150,++paint%10+1,4)}
  redraw();const timer=setInterval(redraw,1000/30),source=canvas.captureStream(30);source.addTrack(destination.stream.getAudioTracks()[0])
  const controller=new AbortController(),urls:string[]=[]
  try{
    video.srcObject=source;await video.play();await new Promise<void>(resolve=>video.requestVideoFrameCallback(()=>resolve()))
    for(const zoom of [1,2,3] as const){
      const output=await createCaptureOutput(source,video,{...defaultCapture,fps:30,zoom},controller.signal)
      const clip=await recordCalibration(output.stream,controller.signal,1_000_000),timing=await inspectMp4(clip),dimensions=await inspectMp4Dimensions(clip)
      output.dispose()
      const playback=document.createElement('video');playback.muted=true;playback.playsInline=true;const url=URL.createObjectURL(clip);urls.push(url)
      await new Promise<void>((resolve,reject)=>{playback.onloadeddata=()=>resolve();playback.onerror=()=>reject(new Error('成片无法解码'));playback.src=url})
      await new Promise<void>(resolve=>{playback.onseeked=()=>resolve();playback.currentTime=.2});await playback.play();await new Promise<void>(resolve=>playback.requestVideoFrameCallback(()=>resolve()));playback.pause()
      const sample=document.createElement('canvas');sample.width=180;sample.height=320;const context=sample.getContext('2d')!;context.drawImage(playback,0,0,180,320)
      const pixel=[...context.getImageData(10,160,1,1).data],expected=zoom===1?0:zoom===2?1:2
      const decoded=await audio.decodeAudioData(await clip.arrayBuffer()),hasAudio=decoded.getChannelData(0).some(value=>Math.abs(value)>.001)
      log({zoom,method:output.method,pixel,timing,dimensions,hasAudio,sourceLive:source.getTracks().every(t=>t.readyState==='live')})
      playback.removeAttribute('src');playback.load()
      if(pixel[expected]<180||!hasAudio||dimensions?.width!==180||dimensions.height!==320||!timing||timing.fps<27||timing.fps>31)throw new Error(`${zoom}× 成片的画面、音频、尺寸或帧率检查失败`)
      if(!source.getTracks().every(t=>t.readyState==='live'))throw new Error('关闭变焦输出错误地停止了源轨道')
    }
    const output=await createCaptureOutput(source,video,{...defaultCapture,zoom:2},controller.signal);controller.abort()
    if(output.stream.getVideoTracks()[0].readyState!=='ended'||source.getTracks().some(t=>t.readyState!=='live'))throw new Error('取消检查未释放独立画布轨道，或错误停止音频源')
    log({result:'PASS: 1×原始流、2×/3×成片真实裁切，声音/尺寸/帧率与取消释放检查通过'})
  }catch(error){log({result:'FAIL',error:String(error)})}
  finally{clearInterval(timer);controller.abort();source.getTracks().forEach(t=>t.stop());tone.stop();await audio.close();video.srcObject=null;urls.forEach(url=>URL.revokeObjectURL(url));button.disabled=false}
})()}
