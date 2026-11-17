import React from 'react'
import {createRoot} from 'react-dom/client'
import App,{type CameraDriver} from '../src/App'
import {cameraDefaults} from '../src/preferences'
import {createCaptureOutput} from '../src/zoom'
import {verifyCaptureOutput,type CameraReport} from '../src/camera'
import {deleteTake,allTakes} from '../src/storage'
import {AudioCapture} from '../src/speech'
import '../src/styles.css'
import '../src/studio.css'
import '../src/camera-screen.css'

// Development-only UI driver: real MediaStream/MediaRecorder and synthetic pixels
// and tone, no access to the device camera/microphone. Never part of dist.
let requests=0,zoomChanges=0,failNext=false,audioPacketsPaused=false
const nativeAudioStart=AudioCapture.prototype.start
AudioCapture.prototype.start=function(media,onAudio,onLevel,onInterrupted){return nativeAudioStart.call(this,media,samples=>{if(!audioPacketsPaused)onAudio(samples)},onLevel,onInterrupted)}
const status=document.createElement('aside');status.className='test-tools';status.style.cssText='position:fixed;top:280px;left:8px;z-index:19;background:#fff;color:#222;padding:6px;font-size:10px;max-width:210px'
const text=document.createElement('p'),fail=document.createElement('button'),clean=document.createElement('button');fail.textContent='下次镜头切换失败';clean.textContent='清理测试录像'
const stall=document.createElement('button');stall.textContent='5 秒后暂停识别音频包'
stall.onclick=()=>{stall.disabled=true;setTimeout(()=>{audioPacketsPaused=true;stall.textContent='识别包已暂停，原始音轨继续';update()},5000)}
fail.onclick=()=>{failNext=true;update()};clean.onclick=()=>{void(async()=>{for(const take of await allTakes())await deleteTake(take.id);text.textContent='已清理本地测试录像'})()}
status.append(text,fail,stall,clean);document.body.append(status)
const style=document.createElement('style');style.textContent='body:has(.clean-recording) .test-tools{display:none}';document.head.append(style)
function update(){text.textContent=`合成源（非真机） · 相机请求 ${requests} · 变焦 ${zoomChanges}${failNext?' · 已准备模拟失败':''}`}
const driver:CameraDriver={
  output:async(...args)=>{zoomChanges++;update();return createCaptureOutput(...args)},
  verify:verifyCaptureOutput,
  open:async(video,spec,options)=>{
    requests++;update()
    if(failNext){failNext=false;update();throw new Error('模拟镜头切换失败，请点重试相机')}
    const canvas=document.createElement('canvas');canvas.width=spec.resolution==='4k'?2160:1080;canvas.height=spec.resolution==='4k'?3840:1920
    const context=canvas.getContext('2d')!,audio=new AudioContext(),tone=audio.createOscillator(),gain=audio.createGain(),destination=audio.createMediaStreamDestination()
    const resume=()=>void audio.resume();document.addEventListener('click',resume,true);
    gain.gain.value=.025;tone.connect(gain).connect(destination);tone.start();void audio.resume()
    context.fillStyle='#7d9b9e';context.fillRect(0,0,canvas.width,canvas.height);context.fillStyle='#b8c7b8';context.beginPath();context.ellipse(canvas.width/2,canvas.height*.50,canvas.width*.27,canvas.height*.2,0,0,7);context.fill();
    if(new URLSearchParams(location.search).has('portrait')){const portrait=new Image();portrait.src='/design-demo/preview.png';await portrait.decode();context.drawImage(portrait,0,0,canvas.width,canvas.height)}
    let n=0;const draw=()=>{context.fillStyle=++n%2?'#f2e6c8':'#e2d6b8';context.fillRect(canvas.width*.49,canvas.height*.73,n%30+2,10)}
    draw();const timer=setInterval(draw,1000/60),media=canvas.captureStream(spec.fps);media.addTrack(destination.stream.getAudioTracks()[0])
    let disposed=false;const dispose=()=>{if(disposed)return;disposed=true;document.removeEventListener('click',resume,true);clearInterval(timer);media.getTracks().forEach(track=>track.stop());tone.stop();void audio.close().catch(()=>{})}
    options.signal.addEventListener('abort',dispose,{once:true})
    try{
      video.srcObject=media;await video.play();await new Promise<void>((resolve,reject)=>{const timeout=setTimeout(()=>reject(new Error('合成预览没有帧')),4000);video.requestVideoFrameCallback(()=>{clearTimeout(timeout);resolve()})})
      const output=await createCaptureOutput(media,video,spec,options.signal,options.onInterrupted)
      options.onLive?.(media,output)
      const report:CameraReport={version:2,userAgent:'synthetic UI driver',frameRateConstraint:true,attempts:[],verified:false,target:spec,bitrate:options.bitrate}
      await verifyCaptureOutput(media,output,spec,report,options.signal);options.onReport(report)
      return {stream:media,output,report}
    }catch(error){dispose();throw error}
  }
}
update();createRoot(document.querySelector('#root')!).render(<React.StrictMode><App driver={driver} initialMode="manual" initialPreferences={{...cameraDefaults,fps:30,countdown:0,recordMirror:false}}/></React.StrictMode>)
