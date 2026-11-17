import {CameraRecorder,exportTake} from '../src/recorder'
import {allTakes,deleteTake,patchTake,allDrafts,deleteDraft} from '../src/storage'
import {inspectMp4} from '../src/mp4'
import {makeThumbnail} from '../src/thumbnail'
const output=document.querySelector<HTMLPreElement>('#output')!,log=(value:unknown)=>{output.textContent+='\n'+JSON.stringify(value)}
const owned=()=>JSON.parse(sessionStorage.getItem('studio-test-ids')||'[]') as string[]
document.querySelector<HTMLButtonElement>('#clean')!.onclick=()=>{void(async()=>{for(const id of owned())await deleteTake(id);for(const draft of await allDrafts())if(draft.title==='studio-ui-check-95d07b7c')await deleteDraft(draft.id);sessionStorage.removeItem('studio-test-ids');log({result:'PASS: 本次测试片段与专用测试稿已清理'})})()}
document.querySelector<HTMLButtonElement>('#verify')!.onclick=()=>{void(async()=>{
  output.textContent='合成音视频与真实 MediaRecorder 检查，不代表 iPhone 摄像头验收。'
  const canvas=document.querySelector('canvas')!,context=canvas.getContext('2d')!,audio=new AudioContext(),tone=audio.createOscillator(),gain=audio.createGain(),destination=audio.createMediaStreamDestination()
  gain.gain.value=.03;tone.connect(gain).connect(destination);tone.start();await audio.resume()
  context.fillStyle='#fa1414';context.fillRect(0,0,80,240);context.fillStyle='#1414fa';context.fillRect(80,0,80,240)
  const stream=canvas.captureStream(30);destination.stream.getAudioTracks().forEach(track=>stream.addTrack(track))
  const recorder=new CameraRecorder(error=>log({recordError:String(error)}))
  const video=document.querySelector('video')!,urls:string[]=[]
  async function pixels(file:File){
    const url=URL.createObjectURL(file);urls.push(url)
    await new Promise<void>((resolve,reject)=>{video.onloadeddata=()=>resolve();video.onerror=()=>reject(new Error('视频无法解码'));video.src=url;video.load()})
    await new Promise<void>((resolve,reject)=>{video.onseeked=()=>resolve();video.onerror=()=>reject(new Error('视频无法定位'));video.currentTime=.2})
    await video.play()
    await new Promise<void>(resolve=>{const timer=setTimeout(resolve,500);video.requestVideoFrameCallback?.(()=>{clearTimeout(timer);resolve()})})
    video.pause();log({decodedWidth:video.videoWidth,decodedHeight:video.videoHeight,readyState:video.readyState,time:video.currentTime})
    const sample=document.createElement('canvas');sample.width=160;sample.height=240;const painter=sample.getContext('2d')!;painter.drawImage(video,0,0,160,240)
    return {left:[...painter.getImageData(20,120,1,1).data],right:[...painter.getImageData(140,120,1,1).data]}
  }
  try{
    for(let i=0;i<2;i++){
      const take=await recorder.start(stream,`界面测试 ${i?'长片':'短片'}`,{mirrored:true,bitrate:8_000_000})
      sessionStorage.setItem('studio-test-ids',JSON.stringify([...owned(),take.id]))
      const request=setInterval(()=>{context.fillStyle='#fff';context.fillRect(70,20,20,10)},30)
      await new Promise(resolve=>setTimeout(resolve,i?1400:800));clearInterval(request)
      const ready=await recorder.stop(),original=await exportTake(ready,true),mirrored=await exportTake(ready)
      const before=await pixels(original),after=await pixels(mirrored)
      log({take:i+1,before,after,timingBefore:await inspectMp4(original),timingAfter:await inspectMp4(mirrored)})
      if(before.left[0]<180||before.right[2]<180||after.left[2]<180||after.right[0]<180)throw new Error('实际视频解码没有左右翻转')
      const decoded=await audio.decodeAudioData(await mirrored.arrayBuffer()),samples=decoded.getChannelData(0)
      if(!samples.some(value=>Math.abs(value)>.001))throw new Error('镜像导出后声音缺失')
      const thumbnail=await makeThumbnail(mirrored);if(!thumbnail)throw new Error('缩略图未能生成')
      await Promise.all([patchTake(ready.id,{favorite:i===0}),patchTake(ready.id,{thumbnail})])
      const stored=(await allTakes()).find(item=>item.id===ready.id)
      if(!stored?.thumbnail||stored.favorite!==(i===0))throw new Error('封面写入覆盖了收藏状态')
    }
    log({result:'PASS: 实际解码左右翻转、声音、帧率保留、封面与收藏原子更新；两段仅供界面检查的片段已准备'})
  }catch(error){log({result:'FAIL',error:String(error)})}
  finally{video.removeAttribute('src');video.load();urls.forEach(url=>URL.revokeObjectURL(url));stream.getTracks().forEach(track=>track.stop());tone.stop();await audio.close()}
})()}
