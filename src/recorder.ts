import {saveTake,saveChunk,takeBlob,storageError,type Take} from './storage.ts'
import {recordingOptions} from './capture-format.ts'
import {mirrorMp4,normalizePortraitMp4} from './mp4.ts'
const stopped=(recorder:MediaRecorder)=>recorder.state==='inactive'
export function recordingMime(){
  return recordingOptions().mimeType||''
}
export class CameraRecorder {
  private recorder?:MediaRecorder
  private started=0
  private current?:Take
  private queue=Promise.resolve()
  private index=0
  private failed=false
  private completion?:Promise<Take>
  private stoppedAt?:number
  private requestStop?:()=>void
  private error:(error:unknown)=>void
  private storage:{saveTake:typeof saveTake;saveChunk:typeof saveChunk}
  constructor(error:(error:unknown)=>void,storage={saveTake,saveChunk}){this.error=error;this.storage=storage}
  get active(){return !!this.recorder&&this.recorder.state!=='inactive'}
  async start(stream:MediaStream,title:string,preferences:{mirrored?:boolean;pixelsMirrored?:boolean;portraitCorrection?:boolean;bitrate?:number;targetFps?:number;calibrationFps?:number;preferredMime?:string;zoom?:number;zoomMethod?:Take['zoomMethod']}={},canStart=()=>true){
    if(this.active)throw new Error('正在录制中')
    if(stream.getTracks().some(t=>t.readyState!=='live'||t.muted))throw new Error('相机或麦克风已中断，请重新打开相机。')
    const options=recordingOptions(!!preferences.mirrored||!!preferences.portraitCorrection,preferences.bitrate,preferences.preferredMime),mime=options.mimeType||''
    const r=new MediaRecorder(stream,options)
    const settings=stream.getVideoTracks()[0].getSettings()
    this.current={id:crypto.randomUUID(),title,createdAt:Date.now(),mime:r.mimeType||mime,status:'recording',duration:0,bytes:0,width:settings.width,height:settings.height,fps:preferences.calibrationFps??settings.frameRate,targetFps:preferences.targetFps,zoom:preferences.zoom,zoomMethod:preferences.zoomMethod,mirrored:!!preferences.mirrored,pixelsMirrored:preferences.pixelsMirrored,portraitCorrection:!!preferences.portraitCorrection,bitrate:r.videoBitsPerSecond||options.videoBitsPerSecond}
    if(!canStart())throw new DOMException('已取消拍摄','AbortError')
    this.started=performance.now();this.stoppedAt=undefined;this.index=0;this.failed=false;this.queue=Promise.resolve();this.recorder=r
    const take=this.current
    let stopDeadline:ReturnType<typeof setTimeout>|undefined
    this.completion=new Promise<Take>((resolve,reject)=>{
      let finishing=false
      const finish=async()=>{
        if(finishing)return
        finishing=true;clearTimeout(stopDeadline)
        this.stoppedAt??=performance.now()
        try{
          await this.queue
          take.duration=(this.stoppedAt-this.started)/1000
          if(this.failed||take.status==='interrupted')take.status='interrupted';else take.status='ready'
          if(!take.bytes){
            reject(new Error(`${take.saveError||'没有录到有效视频。'}本次没有保存有效片段。`))
            return
          }
          await this.storage.saveTake(take);resolve({...take})
        }catch(e){reject(new Error(`${take.saveError||storageError(e)}${take.bytes?'已有部分视频块，但未能确认完整保存，请在媒体库检查并尽快导出。':'没有确认保存到有效视频，请检查本机空间。'}`))}
      }
      const requestStop=()=>{
        if(finishing)return
        stopDeadline??=setTimeout(()=>{
          take.status='interrupted';take.saveError??='浏览器未完成录像保存。';void finish()
        },8000)
        if(stopped(r))return
        try{r.stop()}catch(error){take.status='interrupted';take.saveError??=storageError(error)}
      }
      this.requestStop=requestStop
      r.ondataavailable=event=>{
        if(finishing||!event.data.size)return
        const index=this.index++
        this.queue=this.queue.then(async()=>{
          if(this.failed)return
          const bytes=take.bytes+event.data.size
          const duration=Math.max(0,((this.stoppedAt??performance.now())-this.started)/1000)
          await this.storage.saveChunk(take.id,index,event.data,{...take,bytes,duration})
          take.bytes=bytes
        }).catch(e=>{
          if(this.failed)return
          this.failed=true;take.saveError=storageError(e);this.stoppedAt??=performance.now();this.error(e);requestStop()
        })
      }
      r.onerror=()=>{take.status='interrupted';take.saveError??='录像编码发生错误。';this.stoppedAt??=performance.now();this.error(new Error(take.saveError));requestStop()}
      r.onstop=()=>void finish()
    })
    // An automatic stop can happen before the caller awaits stop().
    void this.completion.catch(()=>{})
    try{r.start(1000)}catch(e){
      r.ondataavailable=null;r.onerror=null;r.onstop=null
      this.recorder=undefined;this.current=undefined;this.completion=undefined;this.requestStop=undefined
      throw e
    }
    return take
  }
  async stop(interrupted=false){
    if(!this.recorder||!this.completion)throw new Error('当前没有录像')
    if(interrupted&&this.current)this.current.status='interrupted'
    this.stoppedAt??=performance.now()
    this.requestStop?.()
    return this.completion
  }
}
export function recordingResult(take:Take,cameraOn:boolean){
  if(take.status!=='ready')return `${take.saveError||'拍摄被中断。'}仅保留了部分片段，请到媒体库检查播放并导出。`
  return `录像已保存在本机。${cameraOn?'相机保持开启，可以继续拍下一条。':'请到媒体库回看或导出。'}`
}
export async function exportTake(take:Take,original=false){
  let blob=await takeBlob(take)
  if(take.portraitCorrection&&!original)blob=await normalizePortraitMp4(blob)
  if(!original&&take.mime.includes('mp4')&&take.mirrored!==undefined)blob=await mirrorMp4(blob,take.mirrored!==!!take.pixelsMirrored)
  const extension=take.mime.includes('mp4')?'mp4':'webm'
  return new File([blob],`口播-${new Date(take.createdAt).toISOString().replace(/[:.]/g,'-')}.${extension}`,{type:take.mime})
}
