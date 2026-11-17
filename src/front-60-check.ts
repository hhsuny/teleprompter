import {compareFront60,scanCameraRates,scanFrontDeviceRates,type CameraRateCheck,type Front60Check} from './camera.ts'

const start=document.querySelector<HTMLButtonElement>('#start')!
const scan=document.querySelector<HTMLButtonElement>('#scan')!
const deviceScan=document.querySelector<HTMLButtonElement>('#device-scan')!
const stop=document.querySelector<HTMLButtonElement>('#stop')!
const copy=document.querySelector<HTMLButtonElement>('#copy')!
const status=document.querySelector<HTMLParagraphElement>('#status')!
const result=document.querySelector<HTMLPreElement>('#result')!
const preview=document.querySelector<HTMLVideoElement>('#preview')!
let active:AbortController|undefined

const rate=(fps:number|null|undefined)=>fps==null?'未测到':`${fps.toFixed(2)} 帧 / 秒`
const size=(width?:number,height?:number)=>width&&height?`${width} × ${height} · `:''
const clip=(file:Front60Check['raw'])=>file?.error??(file?.fps===undefined?'未取得':`${size(file.width,file.height)}${rate(file.fps)}${file.hasAudio?' · 有音轨':file.hasAudio===false?' · 缺少音轨':''}${file.frames===undefined?'':` · ${file.frames} 个视频样本`}`)

function formatResult(check:Front60Check){
  const {settings,input,raw,mirrored}=check
  const rows=[
    `第一版是否会放行  ${check.firstVersionAllowed===undefined?'未测到':check.firstVersionAllowed?'会':'不会'}`,
    `浏览器上报  ${size(settings?.width,settings?.height)}${rate(settings?.frameRate)}`,
    `相机原始帧  ${size(input?.width,input?.height)}${rate(input?.fps)}`,
    `预览回调  ${size(check.preview?.width,check.preview?.height)}${rate(check.preview?.fps)}`,
    `原流成片  ${clip(raw)}`,
    `镜像成片  ${clip(mirrored)}`,
  ]
  if(check.mirrorInFile)rows.push('镜像写入 MP4 方向信息，保留原视频帧和音轨。')
  if(check.error)rows.push(check.error)
  return rows.join('\n')
}

function formatMode({label,request,settings,maxFps,input,preview,raw,passed,error,deviceMatched,deviceCount}:CameraRateCheck){
  const rows=[`${label}（${request}）${passed?' · 输入与成片达标':''}`]
  if(deviceCount!==undefined)rows.push(`视频输入设备 ${deviceCount} 个 · ${deviceMatched===false?'实际打开的设备与请求 ID 不一致':'已核对当前前置设备 ID'}`)
  if(settings)rows.push(`浏览器上报  ${size(settings.width,settings.height)}${rate(settings.frameRate)}${maxFps===undefined?'':` · 能力上限 ${maxFps.toFixed(2)} 帧`}`)
  if(preview)rows.push(`预览回调  ${rate(preview.fps)}`)
  if(settings)rows.push(`相机原始帧  ${size(input?.width,input?.height)}${rate(input?.fps)}${input?` · ${input.frames} 帧／${(input.durationMs/1000).toFixed(1)} 秒`:''}`)
  if(raw)rows.push(`原流成片  ${clip(raw)}${raw.duration===undefined?'':` · ${raw.duration.toFixed(1)} 秒`}`)
  if(label.includes('60')&&!passed)rows.push(input?'60 帧验收未通过。':'缺少相机原始输入实测，不能判定 60 帧通过。')
  if(error)rows.push(error)
  return rows.join('\n')
}

async function run(check:(signal:AbortSignal,onProgress:(message:string)=>void)=>Promise<void>){
  if(active)return
  const controller=new AbortController()
  active=controller;start.disabled=true;scan.disabled=true;deviceScan.disabled=true;stop.hidden=false;preview.hidden=false;result.hidden=true;copy.hidden=true
  result.textContent=''
  try{
    await check(controller.signal,message=>{status.textContent=message})
    status.textContent='检查完成。可以把结果复制给我。'
  }catch(error){
    status.textContent=controller.signal.aborted?'检查已停止。':error instanceof Error?error.message:'检查中断，请保持页面打开后再试。'
  }finally{
    active=undefined;start.disabled=false;scan.disabled=false;deviceScan.disabled=false;stop.hidden=true;preview.hidden=true;copy.hidden=result.hidden
  }
}
start.onclick=()=>void run(async(signal,onProgress)=>{
  result.textContent=formatResult(await compareFront60(preview,signal,onProgress));result.hidden=false
})
scan.onclick=()=>void run(async(signal,onProgress)=>{
  await scanCameraRates(preview,signal,onProgress,mode=>{
    result.textContent+=(result.textContent?'\n\n':'')+formatMode(mode);result.hidden=false
  })
})
deviceScan.onclick=()=>void run(async(signal,onProgress)=>{
  await scanFrontDeviceRates(preview,signal,onProgress,mode=>{
    result.textContent+=(result.textContent?'\n\n':'')+formatMode(mode);result.hidden=false
  })
})
stop.onclick=()=>active?.abort()
document.addEventListener('visibilitychange',()=>{if(document.hidden)active?.abort()})
window.addEventListener('pagehide',()=>active?.abort())
copy.onclick=async()=>{
  try{await navigator.clipboard.writeText(result.textContent??'');status.textContent='已复制检查结果。'}
  catch{status.textContent='复制失败，可以截图或长按选择结果。'}
}
