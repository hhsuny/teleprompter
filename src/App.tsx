import {useCallback,useEffect,useRef,useState,type CSSProperties} from 'react'
import {locateSpeech} from './alignment'
import {allDrafts,saveDraft,deleteDraft,readSettings,saveSettings,readCameraPreferences,saveCameraPreferences,allTakes,deleteTake,patchTake,takeBlob,storageError,type Draft,type Settings,type Take} from './storage'
import {CameraRecorder,exportTake,recordingResult} from './recorder'
import {DraftWriter,draftToUse} from './draft-writer'
import {openCameraCapture,recordCalibration,verifyCaptureOutput,isVerifiedCapture,canUseMeasuredCapture,suggestedCapture,type CameraReport} from './camera'
import {AudioCapture,SpeechFollower,type SpeechState} from './speech'
import {inspectMp4,inspectMp4Format} from './mp4'
import CaptureFileCheck from './CaptureFileCheck'
import CaptureMatrix from './CaptureMatrix'
import {runCaptureMatrix,type CaptureCheck} from './capture-matrix'
import {checkRecordedAudio,type RecordedAudio} from './recorded-audio'
import Prompter from './Prompter'
import {defaultSettings as defaults,restoreDisplay} from './display'
import {cameraDefaults,restoreCamera,type CameraPreferences} from './preferences'
import {StudioNav,MediaLibrary,ScriptLibrary,StudioSettings,CaptureOptions,Icon,type StudioPage} from './Studio'

import {specLabel,matchesRate,type CaptureSpec} from './capture-spec'
import {previewFrame} from './preview-fit'
import {createCaptureOutput,type CaptureOutput} from './zoom'
import {useCameraScreen} from './useCameraScreen'
import {defaultSpeechModel,restoreSpeechModel,speechModels,type SpeechModel} from './speech-model'

const sample='今天，想和你分享一个让口播更自然的小方法。\n先把想说的话写下来，再用自己的节奏读出来。\n不需要着急，也不用一口气说完。\n停下来想一想，提词会在这里等你。\n如果说错了，就从刚才那一句重新开始。\n把注意力放在镜头上，就像在和朋友聊天一样。'
const time=(seconds:number)=>`${Math.floor(seconds/60).toString().padStart(2,'0')}:${Math.floor(seconds%60).toString().padStart(2,'0')}`
const bytes=(n:number)=>`${(n/1024/1024).toFixed(1)} MB`
function screenMetrics(root:HTMLElement|null){
  const viewport=window.visualViewport
  const viewportTop=viewport?.offsetTop??0,viewportHeight=viewport?.height??window.innerHeight
  const bottom=viewportTop+viewportHeight
  const pageBottom=root?.getBoundingClientRect().bottom
  const nav=root?.querySelector('.studio-nav')
  const navBottom=nav?.getClientRects().length?nav.getBoundingClientRect().bottom:undefined
  const style=root?getComputedStyle(root):null
  return {viewportHeight:Math.round(viewportHeight),viewportTop:Math.round(viewportTop),screenHeight:window.screen.height,
    layoutHeight:document.documentElement.clientHeight,windowHeight:window.innerHeight,
    pageBottom:pageBottom===undefined?undefined:Math.round(pageBottom),navBottom:navBottom===undefined?undefined:Math.round(navBottom),
    pageBottomGap:pageBottom===undefined?undefined:Math.max(0,Math.round(bottom-pageBottom)),
    bottomSafeArea:style?Number.parseFloat(style.getPropertyValue('--device-safe-bottom'))||0:undefined,
    reservedSystemStrip:root?.dataset.reservedBottom==='true'}
}
type Phase='idle'|'opening'|'countdown'|'recording'|'saving'
type Preview={take:Take;url:string;file:File;fps:number|null;dimensions:{width:number;height:number}|null;duration:number|null;original:boolean;audio?:RecordedAudio|'missing'}

export type CameraDriver={open:typeof openCameraCapture;output:typeof createCaptureOutput;verify:typeof verifyCaptureOutput}
const cameraDriver:CameraDriver={open:openCameraCapture,output:createCaptureOutput,verify:verifyCaptureOutput}
export default function App({driver=cameraDriver,initialMode='voice',initialPreferences}:{driver?:CameraDriver;initialMode?:'voice'|'manual'|'pace';initialPreferences?:CameraPreferences}={}){
  const [drafts,setDrafts]=useState<Draft[]>([]),[selected,setSelected]=useState(''),[text,setText]=useState(sample),[title,setTitle]=useState('第一次自然口播')
  const [draftBusy,setDraftBusy]=useState(false),draftLock=useRef(false)
  const [settings,setSettings]=useState(defaults),[booted,setBooted]=useState(false),[saved,setSaved]=useState('正在读取本机稿件…')
  const [preferences,setPreferences]=useState(initialPreferences??cameraDefaults),[page,setPage]=useState<StudioPage>('camera'),[previewBusy,setPreviewBusy]=useState(false)
  const [phase,setPhase]=useState<Phase>('idle'),[cameraOn,setCameraOn]=useState(false),[captureLabel,setCaptureLabel]=useState('前置 · 1080P / 60 帧 · 1× 待检查')
  const [recordPending,setRecordPending]=useState(false),recordLock=useRef(false),followThisTake=useRef(false)
  const [message,setMessage]=useState(''),[speechState,setSpeechState]=useState<SpeechState>('idle'),[speechMessage,setSpeechMessage]=useState('相机就绪后会自动准备普通话跟随')
  const [progress,setProgress]=useState(0),[heard,setHeard]=useState(''),[position,setPosition]=useState(0),[latency,setLatency]=useState(0),[followLatency,setFollowLatency]=useState(0)
  const [modelCached,setModelCached]=useState<boolean|null>(null),[installFeedback,setInstallFeedback]=useState('')
  const [speechModel,setSpeechModel]=useState<SpeechModel>(()=>{
    try{return restoreSpeechModel(localStorage.getItem('jtq-speech-model'))}catch{return defaultSpeechModel}
  })
  const speechModelRef=useRef(speechModel)
  const [recordingNotice,setRecordingNotice]=useState('')
  const [countdown,setCountdown]=useState(3),[takes,setTakes]=useState<Take[]>([]),[preview,setPreview]=useState<Preview|null>(null)
  const [trialMatched,setTrialMatched]=useState(false)
  const [panel,setPanel]=useState<'script'|'settings'|'check'|'voice'|'capture'|'screen'|'record'|null>(null),[mode,setMode]=useState<'voice'|'manual'|'pace'>(initialMode),[pacing,setPacing]=useState(false)
  const [voiceRecordIssue,setVoiceRecordIssue]=useState('')
  const [playbackFailed,setPlaybackFailed]=useState(false)
  const [recordIssue,setRecordIssue]=useState('')
  const [checkingSound,setCheckingSound]=useState(false),[soundStatus,setSoundStatus]=useState(''),[hasMicSignal,setHasMicSignal]=useState(false)
  const soundCheck=useRef<AbortController|null>(null),takeAudio=useRef<(()=>void)|undefined>(undefined)
  const takeLevels=useRef({sampled:false,heard:false}),lastMicSignal=useRef(0)
  const [speechTakeNotice,setSpeechTakeNotice]=useState('')
  const [audioReady,setAudioReady]=useState(false),[outputMethod,setOutputMethod]=useState<CaptureOutput['method']>('original'),[foreground,setForeground]=useState(0)
  const [micStatus,setMicStatus]=useState('麦克风未开启'),[previewFps,setPreviewFps]=useState<number|null>(null)
  const [previewPixels,setPreviewPixels]=useState<{width:number;height:number;frameWidth?:number;frameHeight?:number}>({width:0,height:0})
  const actualPreview=useRef<{frameWidth:number;frameHeight:number}|undefined>(undefined)
  const [cameraReport,setCameraReport]=useState<CameraReport|null>(null),[cameraProgress,setCameraProgress]=useState('')
  const [matrixResults,setMatrixResults]=useState<CaptureCheck[]>([]),[matrixProgress,setMatrixProgress]=useState(''),[matrixRunning,setMatrixRunning]=useState(false)
  const matrixVideo=useRef<HTMLVideoElement>(null),matrixAbort=useRef<AbortController|null>(null)
  const [checks,setChecks]=useState<Record<string,boolean>>({}),[downloadReady,setDownloadReady]=useState(false)
  const sourceWindow=useRef<HTMLDivElement>(null)
  const appRoot=useRef<HTMLElement>(null),screen=useCameraScreen(appRoot)
  const video=useRef<HTMLVideoElement>(null)
  const stream=useRef<MediaStream|null>(null),phaseRef=useRef<Phase>('idle'),textRef=useRef(text),positionRef=useRef(0),modeRef=useRef(mode)
  const audio=useRef(new AudioCapture()),follower=useRef<SpeechFollower|null>(null),recorder=useRef<CameraRecorder|null>(null)
  const captureOutput=useRef<CaptureOutput|null>(null)
  const activeMirror=useRef(false)
  const cameraAbort=useRef<AbortController|null>(null),zoomAbort=useRef<AbortController|null>(null)
  const automaticCamera=useRef(true),trialRequested=useRef(false),activeSpec=useRef<CaptureSpec|null>(null),activeBitrate=useRef(0),watchedTracks=useRef(new WeakSet<MediaStreamTrack>()),audioPending=useRef<Promise<boolean>|null>(null),audioGeneration=useRef(0)
  const countTimer=useRef<ReturnType<typeof setTimeout>|undefined>(undefined),epoch=useRef(0),mounted=useRef(true)
  const currentDraft=useRef({id:selected,title,text})
  currentDraft.current={id:selected,title,text}
  const draftWriter=useRef(new DraftWriter(async draft=>{
    await saveDraft(draft)
    if(!mounted.current)return
    const current=currentDraft.current
    if(current.id===draft.id&&current.title===draft.title&&current.text===draft.text)setSaved('已保存在本机')
    setDrafts(list=>[draft,...list.filter(d=>d.id!==draft.id)])
  }))
  const previousText=useRef(''),lastAudio=useRef(0),previewUrl=useRef<string|null>(null),stopFn=useRef<(interrupted?:boolean)=>Promise<void>>(async()=>{})
  const previewRequest=useRef(0)
  const navigationRequest=useRef(0)
  const selectedSpec:CaptureSpec={resolution:preferences.resolution,fps:preferences.fps,facing:preferences.facing,zoom:preferences.zoom}
  const specText=specLabel(selectedSpec)
  const busy=draftBusy||recordPending||checkingSound||phase==='recording'||phase==='countdown'||phase==='saving'
  const cleanScreen=page==='camera'&&(screen.immersive||phase==='recording'||phase==='countdown'||phase==='saving')
  const hasLivePreview=cameraOn&&previewPixels.width>0&&previewPixels.height>0
  const verified=isVerifiedCapture(cameraReport,selectedSpec)
  const alternative=hasLivePreview?suggestedCapture(cameraReport,selectedSpec):null
  const measured=hasLivePreview&&canUseMeasuredCapture(cameraReport,selectedSpec)?cameraReport:null
  const readyToRecord=verified&&hasLivePreview
  const retryHighRate=hasLivePreview&&selectedSpec.fps===60&&!verified&&cameraReport?.frameRateConstraint===true
  const alternativeLabel=alternative?`改用 ${alternative.resolution==='1080p'?'1080P':'4K'}／${alternative.fps} 帧${alternative.zoom!==selectedSpec.zoom?` · ${alternative.zoom}×`:''}`:''
  const previewFit=cleanScreen?'cover':preferences.facing==='environment'&&previewPixels.width>previewPixels.height?'contain':preferences.previewFit
  const previewZoom=cameraOn&&outputMethod==='digital'?preferences.zoom:1
  const previewMirror=preferences.facing==='user'&&preferences.previewMirror
  const videoTransform=previewZoom===1?(previewMirror?'scaleX(-1)':'none'):`scale(${previewMirror?-previewZoom:previewZoom}, ${previewZoom})`
  const frameWidth=previewPixels.frameWidth??previewPixels.width,frameHeight=previewPixels.frameHeight??previewPixels.height
  const sameOrientation=(previewPixels.width>previewPixels.height)===(frameWidth>frameHeight)
  const [visibleWidth,visibleHeight]=sameOrientation?[frameWidth,frameHeight]:[frameHeight,frameWidth]
  const previewSize=visibleWidth&&visibleHeight?`${Math.floor(visibleWidth/previewZoom)} × ${Math.floor(visibleHeight/previewZoom)}`:null
  function syncPreviewPixels(element:HTMLVideoElement){
    const width=element.videoWidth,height=element.videoHeight
    const frame=actualPreview.current
    setPreviewPixels(current=>current.width===width&&current.height===height&&current.frameWidth===frame?.frameWidth&&current.frameHeight===frame?.frameHeight?current:{width,height,...frame})
  }
  function changePhase(next:Phase){phaseRef.current=next;setPhase(next)}
  function move(next:number){positionRef.current=next;setPosition(next)}
  function report(error:unknown){setMessage(storageError(error))}
  const refreshTakes=async()=>{
    try{
      setTakes((await allTakes()).filter(take=>take.bytes>0).map(take=>take.status==='recording'?{...take,status:'interrupted' as const}:take).sort((a,b)=>b.createdAt-a.createdAt))
    }catch(error){report(error)}
  }

  useEffect(()=>{
    mounted.current=true
    let disposed=false
    follower.current=new SpeechFollower((state,msg)=>{
      setSpeechState(state);setSpeechMessage(msg)
      if(phaseRef.current==='recording'&&followThisTake.current){
        if(state==='paused'||state==='error')setSpeechTakeNotice(state==='error'?'语音跟随中断，点文字可定位':'跟随暂停，点当前句恢复')
        else if(state==='listening')setSpeechTakeNotice('')
      }
    },result=>{
      const key=`${result.segment}:${result.text}`
      if(modeRef.current!=='voice'||phaseRef.current==='recording'&&!followThisTake.current||key===previousText.current)return
      previousText.current=key;setHeard(result.text)
      const match=locateSpeech(textRef.current,result.text,positionRef.current,true)
      if(match.matched){
        if(match.position!==positionRef.current)setFollowLatency(performance.now()-result.capturedAt)
        move(match.position);setTrialMatched(true);setSpeechMessage('正在跟随你的口播')
      }
      else if(result.text.length>=4)setSpeechMessage('暂未对上原稿，点选当前句可重新定位')
    },setProgress,setLatency,setModelCached)
    recorder.current=new CameraRecorder(e=>{if(phaseRef.current==='recording')void stopFn.current(true);else if(phaseRef.current!=='saving')report(e)})
    void (async()=>{
      try{
        const [items,prefs,cameraPrefs]=await Promise.all([allDrafts(),readSettings(),readCameraPreferences()])
        if(disposed)return
        const sorted=items.sort((a,b)=>b.updatedAt-a.updatedAt)
        if(sorted.length){setDrafts(sorted);setSelected(sorted[0].id);setTitle(sorted[0].title);setText(sorted[0].text)}
        else{const draft={id:crypto.randomUUID(),title:'第一次自然口播',text:sample,updatedAt:Date.now()};await saveDraft(draft);if(disposed)return;setDrafts([draft]);setSelected(draft.id)}
        setSettings(restoreDisplay(prefs));setSaved('已保存在本机')
        setPreferences(restoreCamera(initialPreferences??cameraPrefs))
        await refreshTakes()
      }catch(e){if(!disposed){report(e);setSaved('本机保存不可用，请先导出稿件')}}
      finally{if(!disposed)setBooted(true)}
    })()
    const hidden=(event:Event)=>{
      if((document.visibilityState==='hidden'||event.type==='pagehide')&&(stream.current||phaseRef.current==='opening'||phaseRef.current==='countdown')){
        automaticCamera.current=true;interrupt('页面切到后台，取景已暂停。返回后会自动恢复取景。')
      }else if(document.visibilityState==='visible'&&event.type!=='pagehide')setForeground(value=>value+1)
    }
    const leaving=(e:BeforeUnloadEvent)=>{if(phaseRef.current==='recording'||phaseRef.current==='saving'){e.preventDefault();e.returnValue=''}}
    document.addEventListener('visibilitychange',hidden);window.addEventListener('pagehide',hidden);window.addEventListener('pageshow',hidden);window.addEventListener('beforeunload',leaving)
    // Worklet delivery is only the recognition branch. A stalled/suspended
    // AudioContext does not prove that MediaRecorder lost its live audio track.
    // Actual track mute/ended events are handled by installOutput instead.
    const meterTimer=setInterval(()=>{if(stream.current){if(audioPending.current||!lastAudio.current)return;if(performance.now()-lastAudio.current>2500){lastAudio.current=0;setAudioReady(false);setHasMicSignal(false);setMicStatus('语音采集已暂停');follower.current?.pause('语音采集未传回音频，跟随暂停；录像继续。可重新启用语音。')}else{const signal=performance.now()-lastMicSignal.current<1700&&lastMicSignal.current>0;setHasMicSignal(signal);setMicStatus(signal?'已检测到麦克风声音':'麦克风已连接，等待读音')}}},500)
    return()=>{disposed=true;mounted.current=false;epoch.current++;cameraAbort.current?.abort();zoomAbort.current?.abort();soundCheck.current?.abort();takeAudio.current?.();clearTimeout(countTimer.current);clearInterval(meterTimer);document.removeEventListener('visibilitychange',hidden);window.removeEventListener('pagehide',hidden);window.removeEventListener('pageshow',hidden);window.removeEventListener('beforeunload',leaving);follower.current?.dispose();captureOutput.current?.dispose();void audio.current.stop();stream.current?.getTracks().forEach(t=>t.stop());if(previewUrl.current)URL.revokeObjectURL(previewUrl.current)}
  },[])
  useEffect(()=>{
    const window=sourceWindow.current,v=video.current,stage=window?.parentElement
    if(!window||!v||!stage)return
    if(previewFit==='cover'){
      window.style.removeProperty('width')
      window.style.removeProperty('height')
      return
    }
    const resize=()=>{const frame=previewFrame(stage.clientWidth,stage.clientHeight,v.videoWidth||1080,v.videoHeight||1920,previewFit);if(frame){window.style.width=`${frame.width}px`;window.style.height=`${frame.height}px`}}
    const observer=new ResizeObserver(resize);observer.observe(stage);v.addEventListener('resize',resize);resize()
    return()=>{observer.disconnect();v.removeEventListener('resize',resize)}
  },[previewFit,cameraOn])
  useEffect(()=>{textRef.current=text},[text])
  useEffect(()=>{modeRef.current=mode},[mode])
  useEffect(()=>{
    if(trialRequested.current&&hasLivePreview&&page==='camera'&&!preview&&audioReady&&mode==='voice'
      &&phase==='idle'&&['ready','paused'].includes(speechState))startFollowing()
  },[hasLivePreview,mode,speechState,audioReady,page,!!preview,phase])
  useEffect(()=>{
    if(page==='camera'&&cameraOn&&phase==='idle'&&mode==='voice'&&speechState==='idle'&&speechModel===defaultSpeechModel){
      setProgress(0);follower.current?.load(speechModel)
    }
  },[page,cameraOn,phase,mode,speechState,speechModel])
  useEffect(()=>{if(booted&&phase==='idle'&&document.visibilityState==='visible'&&automaticCamera.current){automaticCamera.current=false;void openCamera()}},[booted,phase,foreground])
  useEffect(()=>{if(!booted||page!=='camera'||phase!=='idle'||!stream.current||!activeSpec.current)return;const changed=(['resolution','fps','facing','zoom'] as const).some(key=>activeSpec.current![key]!==preferences[key]);if(changed||activeBitrate.current!==preferences.bitrate||activeMirror.current!==(preferences.facing==='user'&&preferences.recordMirror))void configureCamera(preferences)},[booted,page,phase,preferences.resolution,preferences.fps,preferences.facing,preferences.zoom,preferences.bitrate,preferences.recordMirror])
  useEffect(()=>{if(panel==='check')return()=>matrixAbort.current?.abort()},[panel])
  useEffect(()=>{
    const theme=document.querySelector<HTMLMetaElement>('meta[name=theme-color]')
    if(!theme||!cleanScreen)return
    const color=theme.content;theme.content='#141310'
    return()=>{theme.content=color}
  },[cleanScreen])
  useEffect(()=>{
    if(!panel&&!preview)return
    const previous=document.activeElement as HTMLElement|null,oldOverflow=document.body.style.overflow
    const root=appRoot.current,viewport=window.visualViewport
    const sizeDialog=()=>{
      if(!viewport)return
      root?.style.setProperty('--dialog-top',`${viewport.offsetTop}px`)
      root?.style.setProperty('--dialog-height',`${viewport.height}px`)
    }
    sizeDialog()
    viewport?.addEventListener('resize',sizeDialog)
    viewport?.addEventListener('scroll',sizeDialog)
    document.body.style.overflow='hidden'
    const dialog=document.querySelector<HTMLElement>('[role="dialog"]')
    dialog?.querySelector<HTMLElement>('button,input,select,textarea')?.focus()
    const onKey=(event:KeyboardEvent)=>{
      if(event.key==='Escape'){setPanel(null);closePreview()}
      if(event.key==='Tab'&&dialog){const items=[...dialog.querySelectorAll<HTMLElement>('button:not([disabled]),input,select,textarea,a[href]')];const first=items[0],last=items.at(-1);if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus()}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus()}}
    }
    document.addEventListener('keydown',onKey)
    return()=>{
      document.body.style.overflow=oldOverflow
      viewport?.removeEventListener('resize',sizeDialog)
      viewport?.removeEventListener('scroll',sizeDialog)
      root?.style.removeProperty('--dialog-top')
      root?.style.removeProperty('--dialog-height')
      document.removeEventListener('keydown',onKey)
      previous?.focus({preventScroll:true})
    }
  },[panel,!!preview])
  useEffect(()=>{
    if(!booted||!selected)return
    setSaved('正在保存…')
    const draft={id:selected,title,text,updatedAt:Date.now()}
    draftWriter.current.schedule(draft,e=>{report(e);setSaved('保存失败，请导出稿件')})
    return()=>draftWriter.current.cancel()
  },[text,title,selected,booted])
  useEffect(()=>{if(!booted)return;const timer=setTimeout(()=>void saveSettings(settings).catch(report),300);return()=>clearTimeout(timer)},[settings,booted])
  useEffect(()=>{document.documentElement.dataset.theme=preferences.theme;if(!booted)return;const timer=setTimeout(()=>void saveCameraPreferences(preferences).catch(report),250);return()=>clearTimeout(timer)},[preferences,booted])
  useEffect(()=>{
    if(!pacing||mode!=='pace'||!cameraOn)return
    const timer=setInterval(()=>move(Math.min(textRef.current.length,positionRef.current+1)),1000/settings.speed)
    return()=>clearInterval(timer)
  },[pacing,mode,cameraOn,settings.speed])
  useEffect(()=>{
    if(!cameraOn||!video.current)return
    const v=video.current;let stopped=false,request=0,initialTime=0,initialFrames=0
    const sampleFrame=(now:number,metadata:VideoFrameCallbackMetadata)=>{
      if(stopped)return
      const previous=actualPreview.current
      if(metadata.width&&metadata.height&&(previous?.frameWidth!==metadata.width||previous.frameHeight!==metadata.height)){
        actualPreview.current={frameWidth:metadata.width,frameHeight:metadata.height};syncPreviewPixels(v)
      }
      if(!initialTime){initialTime=now;initialFrames=metadata.presentedFrames}
      else if(now-initialTime>=2000){setPreviewFps((metadata.presentedFrames-initialFrames)*1000/(now-initialTime));initialTime=now;initialFrames=metadata.presentedFrames}
      request=v.requestVideoFrameCallback(sampleFrame)
    }
    if(v.requestVideoFrameCallback)request=v.requestVideoFrameCallback(sampleFrame)
    return()=>{stopped=true;if(v.cancelVideoFrameCallback)v.cancelVideoFrameCallback(request)}
  },[cameraOn])

  function releaseCamera(keepAudio=true){
    epoch.current++;cameraAbort.current?.abort();zoomAbort.current?.abort();audioGeneration.current++;audioPending.current=null
    soundCheck.current?.abort();lastMicSignal.current=0;setHasMicSignal(false)
    clearTimeout(countTimer.current);follower.current?.pause('正在切换取景');setPacing(false)
    captureOutput.current?.dispose();captureOutput.current=null
    const old=stream.current;stream.current=null;old?.getTracks().forEach(track=>track.stop())
    audio.current.detach();if(!keepAudio)void audio.current.stop()
    setAudioReady(false);lastAudio.current=0;setCameraOn(false);setPreviewFps(null);setMicStatus('正在准备收音')
    if(video.current)video.current.srcObject=null
    actualPreview.current=undefined;setPreviewPixels({width:0,height:0})
  }
  function interrupt(reason:string){
    if(phaseRef.current==='recording')void stopFn.current(true)
    else if(phaseRef.current!=='saving'){
      if(phaseRef.current==='countdown'||phaseRef.current==='opening')changePhase('idle')
      setMessage(reason)
    }
    releaseCamera(false);setCameraProgress('')
  }
  function installOutput(media:MediaStream,output:CaptureOutput){
    stream.current=media;captureOutput.current=output;setOutputMethod(output.method);setCameraOn(true)
    if(video.current)syncPreviewPixels(video.current)
    for(const track of new Set([...media.getTracks(),...output.stream.getTracks()])){
      if(watchedTracks.current.has(track))continue
      watchedTracks.current.add(track)
      const interrupted=()=>{if(stream.current===media&&(media.getTracks().includes(track)||captureOutput.current?.stream.getTracks().includes(track)))interrupt('相机或麦克风被系统中断，可以点「重试相机」恢复。')}
      track.addEventListener('ended',interrupted);track.addEventListener('mute',interrupted)
    }
  }
  function updateCaptureLabel(spec:CaptureSpec,result:CameraReport){
    const dimensions=result.fileDimensions
    setCaptureLabel(`${specLabel(spec)} · ${dimensions?.width} × ${dimensions?.height} · 测试 ${result.fileFps?.toFixed(2)} 帧${result.zoomMethod==='digital'?' · 数字裁切':''}`)
  }
  async function enableAudio(){
    if(!stream.current)return false
    if(audioPending.current)return audioPending.current
    const media=stream.current,generation=audioGeneration.current
    const pending=(async()=>{
      try{
        await audio.current.start(media,samples=>{if(stream.current!==media)return;lastAudio.current=performance.now();follower.current?.feed(samples)},level=>{
          if(stream.current!==media)return
          if(level>=0.001)lastMicSignal.current=performance.now()
          if(phaseRef.current==='recording'){takeLevels.current.sampled=true;takeLevels.current.heard||=level>=0.001}
        },()=>{lastAudio.current=0;setAudioReady(false);setHasMicSignal(false);follower.current?.pause('语音收音已暂停，轻点启用语音即可恢复');setMicStatus('轻点启用语音')})
        if(generation!==audioGeneration.current||stream.current!==media)return false
        lastAudio.current=performance.now();setAudioReady(true);setMicStatus('麦克风已开启');return true
      }catch(error){if(generation===audioGeneration.current&&stream.current===media){lastAudio.current=0;setAudioReady(false);setMicStatus('轻点启用语音');follower.current?.pause('浏览器等待点击启用语音；相机取景保持开启')}return false}
      finally{if(generation===audioGeneration.current)audioPending.current=null}
    })()
    audioPending.current=pending;return pending
  }
  const useCompatibleMic=preferences.microphone==='compatible'||(!preferences.microphone&&screen.ios)
  function recordingSource(output:CaptureOutput){
    if(useCompatibleMic){
      const source=audio.current.recordingAudio()
      if(source)return {stream:new MediaStream([...output.stream.getVideoTracks(),source.track]),dispose:source.dispose}
      if(preferences.microphone==='compatible')throw new Error('兼容收音未能启动，请重试麦克风，或切换为直接收音。')
    }
    return {stream:output.stream,dispose:undefined}
  }
  async function checkMicrophone(){
    const output=captureOutput.current
    if(!output||phaseRef.current!=='idle'||recordLock.current||soundCheck.current)return
    const controller=new AbortController();soundCheck.current=controller;setCheckingSound(true);setSoundStatus('正在打开麦克风…')
    let dispose:(()=>void)|undefined
    try{
      if(!audioReady)await enableAudio()
      if(controller.signal.aborted)return
      const source=recordingSource(output);dispose=source.dispose
      setSoundStatus('请现在说一句话，正在录制 3 秒测试片段。')
      const clip=await recordCalibration(source.stream,controller.signal,preferences.bitrate,cameraReport?.preferredMime)
      const decoded=await checkRecordedAudio(clip)
      if(controller.signal.aborted)return
      const format=await inspectMp4Format(clip)
      if(controller.signal.aborted)return
      setSoundStatus(decoded==='audible'?'测试通过，录下的文件里听得到声音。':format?.hasAudio===false?'测试文件没有音轨，请切换收音方式后重试。':decoded==='silent'?'测试文件没有检测到声音，请换收音方式，再说一句测试。':'浏览器未能测量文件音量，可拍一条短片回听。')
    }catch(error){if(!controller.signal.aborted)setSoundStatus(storageError(error))}
    finally{dispose?.();if(soundCheck.current===controller){soundCheck.current=null;setCheckingSound(false)}}
  }
  async function openCamera(next:CameraPreferences=preferences,retry60=false,measureInput=retry60){
    releaseCamera();const token=++epoch.current,controller=new AbortController();cameraAbort.current=controller
    const spec:CaptureSpec={resolution:next.resolution,fps:next.fps,facing:next.facing,zoom:next.zoom}
    activeSpec.current=spec;activeBitrate.current=next.bitrate;activeMirror.current=spec.facing==='user'&&next.recordMirror
    changePhase('opening');setMessage('');setCameraReport(null);setCaptureLabel(`正在检查 ${specLabel(spec)}…`)
    try{
      if(!video.current)throw new Error('取景画面尚未准备好，请重试。')
      const {stream:media,output,report:result}=await driver.open(video.current,spec,{signal:controller.signal,bitrate:next.bitrate,retry60,measureInput,preferHighRateHd:next.highRateHdSource,pixelMirror:activeMirror.current,onLive:(media,output)=>{if(token===epoch.current)installOutput(media,output)},onInterrupted:reason=>{if(cameraAbort.current===controller&&!controller.signal.aborted)interrupt(reason)},onProgress:msg=>{if(token===epoch.current)setCameraProgress(msg)},onReport:result=>{if(token===epoch.current)setCameraReport(result)}})
      if(token!==epoch.current){output.dispose();media.getTracks().forEach(track=>track.stop());return}
      if(stream.current!==media)installOutput(media,output)
      if(result.verified){
        updateCaptureLabel(spec,result)
        if(result.hd60Alternative&&!next.highRateHdSource)setPreferences(current=>({...current,highRateHdSource:true}))
      }
      else{setCaptureLabel(`${specLabel(spec)} · 可取景`);setMessage(result.reason??'请查看拍摄规格。')}
      setCameraProgress('');changePhase('idle');void enableAudio()
    }catch(error){if(token===epoch.current){releaseCamera();setCameraProgress('');setCaptureLabel(`${specLabel(spec)} 未通过`);report(error);changePhase('idle')}}
  }
  async function checkAllFormats(){
    const element=matrixVideo.current
    if(!element||!booted||phaseRef.current!=='idle'||recordLock.current||draftLock.current||soundCheck.current)return
    const restorePreview=!!stream.current
    releaseCamera(false);trialRequested.current=false
    const token=++epoch.current,controller=new AbortController()
    matrixAbort.current=controller;cameraAbort.current=controller
    changePhase('opening');setMatrixResults([]);setMatrixProgress('正在准备相机规格测试…');setMatrixRunning(true)
    let completed=0
    try{
      await runCaptureMatrix(element,preferences.facing,preferences.bitrate,controller.signal,setMatrixProgress,result=>{
        completed++;setMatrixResults(rows=>[...rows,result])
      },driver.open,preferences.facing==='user'&&preferences.recordMirror)
    }finally{
      if(matrixAbort.current===controller)matrixAbort.current=null
      if(mounted.current){
        setMatrixRunning(false)
        setMatrixProgress(controller.signal.aborted?'测试已停止。':completed===4?'四档试录已完成。':'测试已结束，可查看相机权限和下方结果。')
        if(token===epoch.current){
          if(restorePreview&&page==='camera'&&document.visibilityState==='visible')void openCamera(preferences)
          else changePhase('idle')
        }
      }
    }
  }
  function useTestedFormat(spec:CaptureSpec){
    if(phaseRef.current!=='idle'||recordLock.current||soundCheck.current)return
    const next={...preferences,...spec}
    setPreferences(next);setPanel(null);setPage('camera')
    void openCamera(next,spec.fps===60,true)
  }
  async function configureCamera(next:CameraPreferences){
    if(phaseRef.current!=='idle')return
    const previous=activeSpec.current
    const spec:CaptureSpec={resolution:next.resolution,fps:next.fps,facing:next.facing,zoom:next.zoom}
    const mirrored=spec.facing==='user'&&next.recordMirror
    if(previous&&(['resolution','fps','facing','zoom'] as const).every(key=>spec[key]===previous[key])&&activeBitrate.current===next.bitrate&&activeMirror.current===mirrored)return
    if(modeRef.current==='voice'&&stream.current&&!audioReady)void enableAudio()
    setPreferences(next);setCameraReport(null);setMessage('')
    if(!stream.current||!previous||captureOutput.current?.method==='downscale'||(['resolution','fps','facing'] as const).some(key=>previous[key]!==spec[key])){await openCamera(next);return}
    // Keep the existing camera/microphone and activated AudioContext when only
    // changing zoom or bitrate. Only replace the independently owned video output.
    const media=stream.current,token=++epoch.current,controller=new AbortController()
    zoomAbort.current?.abort();zoomAbort.current=controller;activeSpec.current=spec;activeBitrate.current=next.bitrate;activeMirror.current=mirrored
    changePhase('opening');setCameraProgress('正在切换并检查取景…');captureOutput.current?.dispose()
    const result:CameraReport={version:2,userAgent:navigator.userAgent,frameRateConstraint:true,attempts:[],verified:false,target:spec,bitrate:next.bitrate}
    try{
      const output=await driver.output(media,video.current!,spec,controller.signal,reason=>{if(zoomAbort.current===controller&&!controller.signal.aborted)interrupt(reason)},mirrored)
      if(token!==epoch.current){output.dispose();return}
      installOutput(media,output)
      result.preferredMime=cameraReport?.preferredMime
      await driver.verify(media,output,spec,result,controller.signal)
      if(token!==epoch.current)return
      setCameraReport(result);updateCaptureLabel(spec,result);setCameraProgress('');changePhase('idle')
    }catch(error){if(token===epoch.current){
      // A failed crop/encoder check must not tear down a healthy camera. Keep
      // previewing so selecting 1× or another combination can recover directly.
      captureOutput.current?.dispose();captureOutput.current=null
      setCameraReport({...result,verified:false,reason:storageError(error)})
      setMessage(`${storageError(error)} 相机仍开着，请直接选择 1× 或其他规格。`);setCameraProgress('');changePhase('idle')
    }}
  }
  function startFollowing(){
    if(!stream.current||!lastAudio.current){
      if(phaseRef.current==='recording')setSpeechTakeNotice('语音跟随未启动，点文字可定位')
      else setMessage('相机就绪后，轻点启用语音即可开始试读。')
      return
    }
    try{previousText.current='';setHeard('');setTrialMatched(false);follower.current?.start();trialRequested.current=false;setVoiceRecordIssue('')}catch(e){report(e)}
  }
  const chooseCue=useCallback((start:number)=>{
    move(start);previousText.current=''
    const resume=()=>{setHeard('');try{follower.current?.start()}catch(error){report(error)}}
    if(speechState==='listening'&&audioReady)resume()
    else if(phaseRef.current==='recording'&&followThisTake.current&&modeRef.current==='voice'&&speechState==='paused'){
      // In the clean recording view the manuscript is the recovery control.
      // A user tap can also resume Safari's suspended recognition AudioContext.
      if(audioReady)resume()
      else{const token=epoch.current,media=stream.current;void enableAudio().then(ready=>{if(ready&&mounted.current&&epoch.current===token&&stream.current===media&&phaseRef.current==='recording'&&modeRef.current==='voice')resume()})}
    }
  },[speechState,audioReady])
  const editScript=useCallback(()=>{if(phaseRef.current==='idle'&&!draftLock.current)setPanel('script')},[])
  function selectMode(next:'voice'|'manual'|'pace'){
    if(next===modeRef.current)return
    trialRequested.current=false
    follower.current?.pause('点选文字可定位')
    setPacing(false)
    modeRef.current=next
    setMode(next)
  }
  function prepareSpeech(){
    setProgress(0)
    follower.current?.load(speechModelRef.current)
  }
  function chooseSpeechModel(next:SpeechModel){
    if(next===speechModelRef.current||phaseRef.current==='recording'||phaseRef.current==='countdown')return
    trialRequested.current=false
    follower.current?.dispose()
    speechModelRef.current=next
    setSpeechModel(next)
    setSpeechState('idle')
    setSpeechMessage(next===defaultSpeechModel?'相机就绪后会自动准备普通话跟随':`${speechModels[next].label}约需 ${speechModels[next].size} MB，点试读后开始准备`)
    setModelCached(null);setProgress(0);setHeard('');setTrialMatched(false);setLatency(0);setFollowLatency(0)
    try{localStorage.setItem('jtq-speech-model',next)}catch{/* The selection still works this session. */}
  }
  async function toggleTrial(){
    if(busy||phase==='opening'||!hasLivePreview)return
    if(!text.trim()){setPanel('script');return}
    if(mode==='voice'&&speechState==='listening'&&audioReady){
      trialRequested.current=false
      follower.current?.pause('试读已暂停')
      return
    }
    const needsModel=speechState==='idle'||speechState==='error'
    if(!preferences.showPrompt)setPreferences(current=>({...current,showPrompt:true}))
    selectMode('voice')
    trialRequested.current=true
    setMessage('')
    if(needsModel)prepareSpeech()
    if(!audioReady){
      if(!await enableAudio()){trialRequested.current=false;return}
      // The audio state update starts trial once the speech engine is ready.
      return
    }
    if(['ready','paused','listening'].includes(speechState))startFollowing()
  }
  async function startRecording(acceptMeasured=false,withoutVoice=false){
    if(phaseRef.current!=='idle'||recordLock.current||draftLock.current||soundCheck.current)return
    if(!booted)return
    if(!stream.current){setPanel(null);await openCamera();return}
    const output=captureOutput.current
    if(!hasLivePreview||!output||!cameraReport||(!verified&&!(acceptMeasured&&measured))){
      setVoiceRecordIssue('');setRecordIssue('');setPanel('record');return
    }
    if(cameraReport.previewDimensions&&video.current&&
      (video.current.videoWidth!==cameraReport.previewDimensions.width||video.current.videoHeight!==cameraReport.previewDimensions.height)){
      setMessage('取景方向或尺寸已改变，正在重新检查录制。');setPanel(null);await openCamera();return
    }
    const hasScript=!!text.trim()
    const follow=hasScript&&preferences.showPrompt&&!withoutVoice&&modeRef.current==='voice'
    const preparedEpoch=epoch.current,preparedStream=stream.current,preparedNavigation=navigationRequest.current
    const preparedDraft=currentDraft.current,preparedMode=modeRef.current
    const preparedGeometry=video.current?`${video.current.videoWidth}×${video.current.videoHeight}`:''
    const currentOutput=()=>epoch.current===preparedEpoch&&stream.current===preparedStream&&captureOutput.current===output&&navigationRequest.current===preparedNavigation
    const stillReady=()=>{
      const draft=currentDraft.current
      return currentOutput()&&phaseRef.current==='idle'&&modeRef.current===preparedMode&&!draftLock.current&&
        draft.id===preparedDraft.id&&draft.title===preparedDraft.title&&draft.text===preparedDraft.text
    }
    recordLock.current=true;setRecordPending(true)
    try{
      if(follow){
        if(!['ready','paused','listening'].includes(speechState)){
          setVoiceRecordIssue(speechState==='error'?'语音跟随暂不可用。':'语音跟随还在准备。');setPanel('record')
          if(speechState==='idle')prepareSpeech()
          return
        }
        if(!audioReady&&!(await enableAudio())){
          if(stillReady()){setVoiceRecordIssue('语音跟随暂时无法读取麦克风。');setPanel('record')}
          return
        }
      }
      if(!follow&&useCompatibleMic&&!audioReady)await enableAudio()
      if(!stillReady())return
      if(!output.stream.getAudioTracks().some(track=>track.readyState==='live'&&!track.muted&&track.enabled)){
        setVoiceRecordIssue('');setPanel('record');setRecordIssue('录制麦克风当前不可用，请重试相机与麦克风。');return
      }
      const estimate=await navigator.storage?.estimate?.().catch(()=>undefined)
      if(!stillReady())return
      const available=estimate?.quota?Math.max(0,estimate.quota-(estimate.usage||0)):undefined
      const bytesPerSecond=(preferences.bitrate+128_000)/8*1.15
      if(available!==undefined&&available<bytesPerSecond*3){
        setVoiceRecordIssue('');setPanel('record');setRecordIssue('本机可用空间太少，请到媒体库导出并删除旧录像，或降低码率。');return
      }
      if(selected)await draftWriter.current.flush({id:selected,title,text,updatedAt:Date.now()})
      else await readCameraPreferences()
      if(!stillReady())return
      trialRequested.current=false;followThisTake.current=follow
      if(!follow)follower.current?.pause('本条使用手动提词')
      setPanel(null);setVoiceRecordIssue('');setRecordIssue('');setMessage('');setRecordingNotice('');setSpeechTakeNotice('');setCountdown(preferences.countdown);changePhase('countdown')
      // This token also covers changes while the recorder is starting after the countdown.
      const token=++epoch.current
      const tick=(left:number)=>{
        if(token!==epoch.current)return
        setCountdown(left)
        if(left>0){countTimer.current=setTimeout(()=>tick(left-1),1000);return}
        const canStart=()=>token===epoch.current&&phaseRef.current==='countdown'&&captureOutput.current===output
        void (async()=>{
          try{
            const element=video.current
            if(!element||!element.videoWidth||!element.videoHeight||`${element.videoWidth}×${element.videoHeight}`!==preparedGeometry){
              throw new Error('倒计时期间画面尺寸改变，请点拍摄键重试。')
            }
            const source=recordingSource(output)
            takeLevels.current={sampled:false,heard:false};takeAudio.current=source.dispose
            await recorder.current!.start(source.stream,title||'未命名口播',{mirrored:preferences.facing==='user'&&preferences.recordMirror,pixelsMirrored:output.pixelsMirrored,portraitCorrection:cameraReport.portraitCorrection,bitrate:preferences.bitrate,targetFps:preferences.fps,calibrationFps:cameraReport.fileFps,preferredMime:cameraReport.preferredMime,zoom:preferences.zoom,zoomMethod:cameraReport.zoomMethod},canStart)
            if(!canStart()){
              try{setRecordingNotice(recordingResult(await recorder.current!.stop(true),!!stream.current));await refreshTakes()}
              finally{source.dispose?.();takeAudio.current=undefined}
              return
            }
            changePhase('recording')
            if(followThisTake.current)startFollowing()
            if(hasScript&&preferences.showPrompt&&preparedMode==='pace'&&!withoutVoice)setPacing(true)
            if('wakeLock' in navigator)void navigator.wakeLock.request('screen').then(lock=>{const release=()=>{if(token!==epoch.current||phaseRef.current!=='recording'){void lock.release();clearInterval(timer)}};const timer=setInterval(release,1000);release()}).catch(()=>{})
          }catch(error){
            takeAudio.current?.();takeAudio.current=undefined
            if(token===epoch.current){
              followThisTake.current=false;setVoiceRecordIssue('');setRecordIssue(storageError(error));changePhase('idle');setPanel('record')
            }
          }
        })()
      };tick(preferences.countdown)
    }catch(error){if(stillReady()){setVoiceRecordIssue('');setRecordIssue(storageError(error));setPanel('record')}}
    finally{recordLock.current=false;if(mounted.current)setRecordPending(false)}
  }
  async function stopRecording(interrupted=false){
    if(phaseRef.current!=='recording')return
    changePhase('saving');setPacing(false);follower.current?.pause('本次跟随已结束')
    setRecordingNotice('正在保存录像，请稍候…')
    try{
      const take=await recorder.current!.stop(interrupted)
      const levels=takeLevels.current
      let note=recordingResult(take,!!stream.current)
      if(take.status==='ready'){
        const short=take.duration<=9&&take.bytes<=16*1024*1024
        const fileAudio=short?await checkRecordedAudio(await takeBlob(take).catch(()=>new Blob())):'unknown'
        if(fileAudio==='silent'||fileAudio==='unknown'&&levels.sampled&&!levels.heard){
          note='视频已保存，但这条没有检测到明显声音。可在「麦克风」里试录检查。'
        }
      }
      setRecordingNotice(note);await refreshTakes()
    }catch(e){setRecordingNotice(storageError(e))}
    finally{
      takeAudio.current?.();takeAudio.current=undefined
      if(recorder.current?.active){
        releaseCamera(false)
        setRecordingNotice('录像未能正常结束。已释放相机，请到媒体库检查已保存的片段。')
        await refreshTakes()
      }
      followThisTake.current=false;changePhase('idle')
    }
  }
  stopFn.current=stopRecording
  async function showTake(take:Take){
    const request=++previewRequest.current;setPreviewBusy(true);setPlaybackFailed(false)
    trialRequested.current=false
    if(speechState==='listening')follower.current?.pause('回看结束后可继续试读')
    setPacing(false)
    try{
      setMessage('正在准备回看…');let file:File,original=false,warning=''
      try{file=await exportTake(take)}catch(error){if(take.mirrored===undefined&&!take.portraitCorrection)throw error;file=await exportTake(take,true);original=true;warning='方向处理失败，当前提供原始录像。'}
      if(request!==previewRequest.current)return
      if(previewUrl.current)URL.revokeObjectURL(previewUrl.current)
      const url=URL.createObjectURL(file);previewUrl.current=url
      const [inspection,format]=take.mime.includes('mp4')?await Promise.all([inspectMp4(file),inspectMp4Format(file)]):[null,null]
      const dimensions=format?.display??null
      if(request!==previewRequest.current){URL.revokeObjectURL(url);return}
      setPreview({take,file,url,fps:inspection?.fps??null,dimensions,duration:inspection?.duration??null,original,audio:format&&!format.hasAudio?'missing':undefined});setPanel(null);setMessage(warning)
      if((inspection?.duration??take.duration)<=9&&file.size<=16*1024*1024&&(!format||format.hasAudio)){
        void checkRecordedAudio(file).then(audio=>{if(request===previewRequest.current)setPreview(current=>current?.url===url?{...current,audio}:current)})
      }
      if(inspection&&dimensions&&!original&&(!take.measured||take.width!==dimensions.width||take.height!==dimensions.height||take.fps!==inspection.fps)){
        void patchTake(take.id,{width:dimensions.width,height:dimensions.height,fps:inspection.fps,measured:true}).then(()=>setTakes(current=>current.map(item=>item.id===take.id?{...item,width:dimensions.width,height:dimensions.height,fps:inspection.fps,measured:true}:item))).catch(()=>{})
      }
    }catch(e){if(request===previewRequest.current)report(e)}finally{if(request===previewRequest.current)setPreviewBusy(false)}
  }
  async function changeTakeMirror(take:Take,mirrored:boolean){
    if(previewBusy)return
    const request=previewRequest.current
    setPreviewBusy(true)
    try{const updated={...take,mirrored,thumbnail:undefined};await exportTake(updated);if(request!==previewRequest.current)return;await patchTake(take.id,{mirrored,thumbnail:undefined});await refreshTakes();if(request===previewRequest.current)await showTake(updated)}catch(error){report(error)}finally{setPreviewBusy(false)}
  }
  function closePreview(){previewRequest.current++;setPreview(null);setPreviewBusy(false);if(previewUrl.current){URL.revokeObjectURL(previewUrl.current);previewUrl.current=null}}
  async function renameTake(take:Take){const next=prompt('视频名称',take.title);if(next===null||!next.trim())return;try{await patchTake(take.id,{title:next.trim().slice(0,80)});setPreview(current=>current?{...current,take:{...current.take,title:next.trim().slice(0,80)}}:current);await refreshTakes()}catch(error){report(error)}}
  async function navigate(next:StudioPage){
    if(busy||phaseRef.current==='opening'||next===page)return
    navigationRequest.current++
    if(page==='camera'){
      trialRequested.current=false
      if(speechState==='listening')follower.current?.pause('返回相机后可试读')
      setPacing(false)
    }
    setPanel(null)
    setPage(next)
    if(next==='camera'){
      if(stream.current)void video.current?.play().catch(()=>{})
      else if(booted){automaticCamera.current=false;void openCamera()}
    }
    if(next==='media')await refreshTakes()
  }
  async function importDraft(file:File){
    if(busy||draftLock.current)return
    draftLock.current=true;setDraftBusy(true)
    try{if(file.size>500_000)throw new Error('稿件超过 500 KB，请精简后再导入。');const imported=(await file.text()).replace(/^\uFEFF/,'');if(selected)await draftWriter.current.flush({id:selected,title,text,updatedAt:Date.now()});const draft={id:crypto.randomUUID(),title:file.name.replace(/\.txt$/i,'').slice(0,80),text:imported,updatedAt:Date.now()};await draftWriter.current.flush(draft);setSelected(draft.id);setTitle(draft.title);setText(draft.text);move(0);setPanel('script')}catch(error){report(error)}finally{draftLock.current=false;setDraftBusy(false)}
  }
  async function sharePreview(){
    if(!preview)return
    try{if(navigator.canShare?.({files:[preview.file]}))await navigator.share({files:[preview.file],title:preview.take.title});else download(preview.file,preview.file.name)}
    catch(e){if(!(e instanceof DOMException&&e.name==='AbortError'))setMessage('系统分享没有打开，请点「下载到文件」保存。')}
  }
  function download(blob:Blob,name:string){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60_000)}
  async function switchDraft(d:Draft){
    if(busy||draftLock.current)return false
    draftLock.current=true;setDraftBusy(true)
    try{
      const current={id:selected,title,text,updatedAt:Date.now()},target=draftToUse(current,d)
      if(selected)await draftWriter.current.flush(current)
      if(target.id!==selected){await draftWriter.current.flush(target);setSelected(target.id);setTitle(target.title);setText(target.text)}
      trialRequested.current=false;move(0);follower.current?.pause('稿件已切换，请重新试读');return true
    }catch(e){report(e);return false}finally{draftLock.current=false;setDraftBusy(false)}
  }
  async function newDraft(){return switchDraft({id:crypto.randomUUID(),title:'新的口播',text:'',updatedAt:Date.now()})}
  async function removeDraft(){
    if(!selected||busy||draftLock.current||!confirm('删除这篇本机稿件？'))return
    draftLock.current=true;setDraftBusy(true)
    try{
      const rest=drafts.filter(d=>d.id!==selected),next=rest[0]??{id:crypto.randomUUID(),title:'新的口播',text:'',updatedAt:Date.now()}
      await draftWriter.current.remove(selected,deleteDraft)
      setSelected(next.id);setTitle(next.title);setText(next.text);setDrafts(rest.length?rest:[next]);move(0)
    }catch(e){report(e)}finally{draftLock.current=false;setDraftBusy(false)}
  }
  const followControls=<><div className="segmented" aria-label="提词模式">{([['voice','语音跟随'],['manual','手动'],['pace','匀速']] as const).map(([value,label])=><button key={value} className={mode===value?'selected':''} disabled={phase==='countdown'} onClick={()=>selectMode(value)}>{label}</button>)}</div>
          {mode==='voice'?<><p className="follow-description">{modelCached===true?'语音文件已保存在这台手机，下次从本机读取。':modelCached===false?'这次可以跟稿。手机未能完整保存语音文件，下次会补齐缺少的部分。':'首次准备约 '+speechModels[speechModel].size+' MiB 的模型，之后复用本机文件。'}</p><div className={`speech-status ${speechState==='error'?'error':''}`} role="status">{speechMessage}</div>
          {speechState==='idle'||speechState==='error'?<button className="primary-wide" onClick={prepareSpeech}>{speechState==='error'?'重试语音':'准备中文语音'}</button>:speechState==='loading'?<div className="model-progress"><span style={{width:`${progress}%`}}/><b>语音文件已读取 {progress}%</b></div>:<button className="primary-wide" disabled={page==='camera'&&(!hasLivePreview||phase==='opening')} onClick={()=>{if(page==='camera'){setPanel(null);void toggleTrial()}else void navigate('camera')}}>{page!=='camera'?'到相机页试读':speechState==='listening'?'暂停试读':'开始试读'}<span>{cameraOn?'拍摄时将使用相同的麦克风':'打开相机后可以试读'}</span></button>}
          <div className="heard"><span>刚刚听到</span><p>{heard||'试读一句，看看文字能否跟上。'}</p>{latency>0&&<small>音频处理往返 {Math.round(latency)} ms</small>}{followLatency>0&&<small>最近实际推进 {Math.round(followLatency)} ms · 含模型识别与对齐</small>}</div></>:mode==='manual'?<p className="follow-description">点选屏幕上的句子定位。拍摄时可以继续点选，录音和录像保持进行。</p>:<><p className="follow-description">以固定速度推进；需要时手动暂停。</p><label className="slider-label">速度 <span>{settings.speed} 字 / 秒</span><input type="range" min="1" max="10" step="0.5" value={settings.speed} onChange={e=>setSettings({...settings,speed:+e.target.value})}/></label><button className="primary-wide" disabled={!cameraOn} onClick={()=>setPacing(!pacing)}>{pacing?'暂停滚动':'开始滚动'}</button></>}</>
  const displayControls=<>
    {([['fontSize','字号',22,64,''],['width','行宽',60,98,'%'],['opacity','背景深度',0,95,'%'],['top','距镜头下方',0,30,'%']] as const).map(([key,label,min,max,unit])=><label key={key} className="slider-label">{label}<span>{settings[key]}{unit}</span><input type="range" min={min} max={max} value={settings[key]} onChange={e=>setSettings({...settings,[key]:+e.target.value})}/></label>)}
    <button type="button" className="secondary" onClick={()=>setSettings(defaults)}>恢复默认显示</button>
  </>
  const lastTake=takes.find(take=>take.bytes>0&&take.status!=='recording')
  const following=mode==='voice'&&speechState==='listening'&&audioReady
  const trialLabel=following?'暂停':mode==='voice'&&speechState==='error'?'重试':'试读'
  const trialStatus=mode==='manual'?'手动提词':mode==='pace'?'匀速提词':following
    ?(speechMessage.startsWith('暂未对上')?'请点句子定位':trialMatched?'正在跟稿':'请读一句')
    :speechState==='loading'?'语音准备中':speechState==='error'?'语音未就绪':speechState==='idle'?'点试读启用':audioReady?'语音可试读':'点试读启用'
  const cameraStatus=recordPending?'正在准备拍摄':phase==='saving'?'正在保存录像':phase==='opening'
    ?(hasLivePreview?'正在检查成片规格':'正在打开相机')
    :!hasLivePreview?'相机未就绪':!verified?'当前规格未通过'
    :outputMethod==='digital'?'数字变焦 · 1× 更清晰':outputMethod==='downscale'?'高清取流 · 1080P／60 已试录':'可以拍摄'
  const recordLabel=readyToRecord?'开始拍摄':hasLivePreview?'查看拍摄选项':'重试相机'
  const chooseAlternative=()=>{if(alternative&&!recordLock.current){setVoiceRecordIssue('');setPanel(null);void configureCamera({...preferences,...alternative})}}
  const trySixty=()=>{if(phaseRef.current==='idle'&&!busy){setPanel(null);void openCamera(preferences,true)}}
  const displayStyle={'--font':`${settings.fontSize}px`,'--prompt-width':`${settings.width}%`,'--prompt-alpha':settings.opacity/100,'--prompt-top':`${settings.top}%`} as CSSProperties
  async function enterCameraScreen(){
    if(appRoot.current&&await screen.enter(appRoot.current))return
    screen.useWindow()
  }
  function showInstallGuide(){setInstallFeedback('');setPanel('screen')}
  async function copyInstallLink(){
    try{await navigator.clipboard.writeText(new URL(import.meta.env.BASE_URL,document.baseURI).href);setInstallFeedback('已复制，在 Safari 粘贴打开。')}
    catch{setInstallFeedback('请从浏览器的分享菜单复制当前链接，再到 Safari 打开。')}
  }

  return <main ref={appRoot} className={`app studio-app ${page==='camera'?'camera-page':'content-page'} ${screen.standalone?'installed-app':''} ${busy?'is-shooting':''} ${cleanScreen?'clean-recording':''}`}>
    <div className="workspace" hidden={page!=='camera'}>
      <section className="shoot-column" aria-label="拍摄和提词">
        <div className={`camera-stage ${hasLivePreview?'camera-live':''}`} style={displayStyle}>
          <div ref={sourceWindow} className="camera-source-window">
            <video ref={video} autoPlay playsInline muted className="camera-video"
              aria-label={preferences.facing==='user'?'前置相机取景':'后置相机取景'}
              onResize={event=>syncPreviewPixels(event.currentTarget)} style={{transform:videoTransform,objectFit:previewFit}}/>
          </div>
          {!hasLivePreview&&phase!=='recording'&&<div className="camera-empty" role="status">
            <Icon name="camera"/>
            <p>{phase==='opening'?'正在打开相机':cameraOn?'预览分辨率已变化':'相机未就绪'}</p>
            <span>{phase==='opening'?cameraProgress:cameraOn?'重试相机可恢复取景':message||'允许相机和麦克风后即可拍摄'}</span>
            {phase==='idle'&&<><button className="secondary" onClick={()=>void openCamera()}>重试相机</button><button className="text-button" onClick={()=>setPanel('capture')}>调整拍摄选项</button></>}
          </div>}
          <header className="camera-shell-header" hidden={cleanScreen}>
            <button type="button" className="camera-format" disabled={busy} onClick={()=>setPanel('capture')} aria-label="拍摄选项">
              <strong>{preferences.resolution==='4k'?'4K':'1080P'}</strong><b>{preferences.fps}</b><span aria-hidden="true">⌄</span>
            </button>
            <button type="button" className="camera-screen-action" aria-label="全屏取景" onClick={()=>void enterCameraScreen()}><Icon name="fullscreen"/></button>
          </header>
          {preferences.grid&&!cleanScreen&&<div className="composition-grid" aria-hidden="true"/>}
          {preferences.showPrompt&&((phase!=='countdown'&&phase!=='recording'&&phase!=='saving')||text.trim())&&(hasLivePreview||cleanScreen)&&<Prompter text={text} position={position} fontSize={settings.fontSize} width={settings.width} active={cameraOn} onLocate={chooseCue} onEdit={editScript} notice={phase==='recording'?speechTakeNotice:undefined}/>}
          {phase==='countdown'&&countdown>0&&<div className="countdown" aria-live="assertive">{countdown}</div>}
        </div>
        {!cleanScreen&&<div className="camera-dock">
          {(recordingNotice||(message&&hasLivePreview&&(verified||message!==cameraReport?.reason)))&&<div className="camera-feedback" role="status">
            <span>{recordingNotice||message}</span><button type="button" onClick={()=>{setRecordingNotice('');setMessage('')}} aria-label="关闭提示">×</button>
          </div>}
          <div className="camera-script-row" aria-label="稿件与试读">
            <button type="button" className="camera-draft" disabled={busy} onClick={()=>setPanel('script')}>
              <Icon name="scripts"/><span><small>当前稿件</small><strong>{title||'选择口播稿'}</strong></span><span aria-hidden="true">⌄</span>
            </button>
            <div className="camera-voice">
              <button type="button" className="camera-trial" aria-pressed={following} disabled={busy||phase==='opening'||!hasLivePreview} onClick={()=>void toggleTrial()}>
                <Icon name={following?'pause':'waveform'}/>{trialLabel}
              </button>
              <button type="button" className="camera-voice-status" data-error={mode==='voice'&&speechState==='error'} title={mode==='voice'?speechMessage:undefined} aria-label={`${trialStatus}，打开提词模式`} onClick={()=>setPanel('voice')}>
                <span className={`signal ${following?'on':''}`}/><span role="status">{speechState==='loading'&&progress>0?`${trialStatus} ${progress}%`:trialStatus}</span>
              </button>
            </div>
          </div>
          <div className="camera-capture-row">
            <button type="button" className="camera-shortcut recent-take" aria-label={lastTake?'回看最近录像':'打开媒体库'} disabled={busy||phase==='opening'||previewBusy} onClick={()=>lastTake?void showTake(lastTake):void navigate('media')}>
              <span className="camera-shortcut-icon">{lastTake?.thumbnail?<img src={lastTake.thumbnail} alt=""/>:<Icon name="film"/>}</span><span>{lastTake?'最近录像':'媒体'}</span>
            </button>
            <button type="button" className="record-button" data-ready={readyToRecord} aria-label={recordLabel} disabled={!booted||busy||phase==='opening'} onClick={()=>void startRecording()}>
              <span className="record-shape" aria-hidden="true"/>
            </button>
            <button type="button" className="camera-shortcut" disabled={busy||phase==='opening'} aria-label="翻转前后镜头" onClick={()=>void configureCamera({...preferences,facing:preferences.facing==='user'?'environment':'user'})}>
              <span className="camera-shortcut-icon"><Icon name="flip"/></span><span>翻转</span>
            </button>
          </div>
          <div className="camera-statusline" role="status">
            {hasLivePreview&&!verified&&phase==='idle'&&!recordPending
              ?alternative?<button type="button" title={cameraReport?.reason} onClick={chooseAlternative}>{alternativeLabel}</button>
                :<button type="button" onClick={()=>{setVoiceRecordIssue('');setRecordIssue('');setPanel('record')}}>查看可用拍摄规格</button>
              :<span>{cameraStatus}</span>}
            {previewSize&&<span className="camera-preview-size" title={outputMethod==='digital'?'数字裁切后的源画面像素':'取景当前收到的画面像素'}>取景 {previewSize}</span>}
            {hasLivePreview&&phase==='idle'&&<button type="button" className="camera-mic" disabled={busy} aria-label="检查麦克风" onClick={()=>setPanel('voice')}><Icon name="mic"/>{hasMicSignal?'有声音':'麦克风'}</button>}
          </div>
        </div>}
      </section>
    </div>
    {page!=='camera'&&<div className="studio-scroll" key={page}>
    {page==='media'&&<MediaLibrary takes={takes} onOpen={take=>void showTake(take)} onChange={refreshTakes} onError={report}/>}
    {page==='scripts'&&<ScriptLibrary drafts={drafts} selected={selected} onNew={()=>void newDraft().then(ok=>{if(ok)setPanel('script')})} onEdit={draft=>void switchDraft(draft).then(ok=>{if(ok)setPanel('script')})} onUse={draft=>void switchDraft(draft).then(ok=>{if(ok)void navigate('camera')})} onImport={file=>void importDraft(file)}/>}
    {page==='settings'&&<StudioSettings preferences={preferences} setPreferences={setPreferences} installed={screen.standalone} onInstall={showInstallGuide} onDisplay={()=>setPanel('settings')} onVoice={()=>setPanel('voice')} onCheck={()=>setPanel('check')}/>}
    </div>}
    {cleanScreen&&<div className="camera-bottom-actions" role="group" aria-label="拍摄控制">
      {phase==='recording'||phase==='countdown'?<>
        <button className="minimal-stop" aria-label={phase==='recording'?'停止录制':'取消倒计时'} onClick={()=>{if(phaseRef.current==='recording')void stopRecording();else if(phaseRef.current==='countdown'){epoch.current++;clearTimeout(countTimer.current);changePhase('idle')}}}><span aria-hidden="true"/></button>
      </>:phase!=='saving'&&<>
        <button className="camera-exit-focus" onClick={()=>void screen.exit()} aria-label="返回拍摄设置">‹ 返回</button>
        {phase==='idle'&&<button className="focus-record-button" data-ready={readyToRecord} disabled={!booted||busy} aria-label={recordLabel} onClick={()=>void startRecording()}><span/></button>}
        {phase==='idle'&&lastTake&&<button className="focus-recent" disabled={busy||previewBusy} onClick={()=>void showTake(lastTake)} aria-label="回看最近录像"><Icon name="film"/></button>}
      </>}
    </div>}
    {cleanScreen&&phase!=='countdown'&&phase!=='recording'&&<div className="focus-camera-status" role="status">
      {phase==='saving'?'正在保存录像…':phase==='opening'?cameraProgress:alternative?<button type="button" onClick={chooseAlternative}>{alternativeLabel}</button>:recordingNotice||message||(!hasLivePreview?'点拍摄键可重试相机':!verified?'点拍摄键查看可用规格':'')}
      {phase==='idle'&&screen.ios&&!screen.standalone&&!screen.fullscreen&&<button type="button" onClick={showInstallGuide}>Safari 全屏说明</button>}
    </div>}
    {!cleanScreen&&<StudioNav page={page} onNavigate={next=>void navigate(next)} disabled={busy||phase==='opening'}/>}
    {(page!=='camera'||preview)&&message&&<div className="notice global-notice" role="status"><span>{message}</span><button aria-label="关闭提示" onClick={()=>setMessage('')}>×</button></div>}
    {panel&&<div className="modal-backdrop" onClick={()=>setPanel(null)}><section className={`sheet ${panel==='script'?'editor-sheet':''}`} role="dialog" aria-modal="true" aria-labelledby="sheet-title" onClick={e=>e.stopPropagation()}><div className="sheet-header"><h2 id="sheet-title">{panel==='script'?'你的口播稿':panel==='settings'?'提词显示':panel==='voice'?'提词模式与跟随':panel==='capture'?'拍摄选项':panel==='screen'?'添加到主屏幕':panel==='record'?'准备拍摄':'iPhone 实机检查'}</h2><button className="close" aria-label="关闭" onClick={()=>setPanel(null)}>×</button></div>
      {panel==='record'&&<div className="record-recovery">
        {voiceRecordIssue?<><p>{voiceRecordIssue} 临时手动拍摄仍会录下麦克风声音。</p>
          <button className="primary-wide" disabled={busy} onClick={()=>void startRecording(!verified,true)}>这条先用手动提词拍</button>
          <button className="secondary" disabled={busy} onClick={()=>void startRecording(!verified)}>重试语音后拍摄</button>
          <button className="text-button" onClick={()=>setPanel('voice')}>查看语音状态</button>
        </>:<>
          <p>{recordIssue||(!verified&&cameraReport?.reason)||'需要检查相机和麦克风后才能拍摄。'}</p>
          {measured&&!verified&&<p className="record-measured">测试成片 {measured.fileDimensions?.width} × {measured.fileDimensions?.height} · {measured.fileFps?.toFixed(2)} 帧 / 秒</p>}
          {retryHighRate&&<p className="record-measured">相机报告 {cameraReport?.trackFps?.toFixed(1)??'—'} 帧 · 实测取景 {cameraReport?.observedFps?.toFixed(1)??'—'} 帧</p>}
          {cameraReport?.input&&<p className="record-measured">相机原始输入 {cameraReport.input.fps.toFixed(1)} 帧</p>}
          {retryHighRate&&<button className="secondary" disabled={busy} onClick={trySixty}>尝试其他相机模式录 60 帧</button>}
          {retryHighRate&&<details className="rate-comparison">
            <summary>查看试录结果或检查以前拍的片段</summary>
            {cameraReport?.attempts.filter(attempt=>attempt.step.endsWith(' · 结果')||attempt.step.endsWith(' · 成片通过')).map((attempt,index)=><p key={index}>{attempt.step}{attempt.input&&` · 输入 ${attempt.input.fps.toFixed(1)} 帧`}{attempt.fileDimensions&&` · 成片 ${attempt.fileDimensions.width} × ${attempt.fileDimensions.height}`}{attempt.fileFps!==undefined&&`／${attempt.fileFps.toFixed(2)} 帧`}{attempt.error&&<><br/>{attempt.error.replace(/^(Error|OverconstrainedError): /,'')}</>}</p>)}
            <CaptureFileCheck/>
          </details>}
          {alternative&&<button className="primary-wide" disabled={busy||phase==='opening'} onClick={chooseAlternative}>{alternativeLabel}</button>}
          {measured&&!verified&&<button className={alternative?'secondary':'primary-wide'} disabled={busy} onClick={()=>void startRecording(true)}>按实测规格拍摄</button>}
          <button className="secondary" disabled={busy||phase==='opening'} onClick={()=>{setPanel(null);void openCamera()}}>重新检查相机</button>
          {recordIssue.startsWith('本机可用空间')&&<button className="text-button" onClick={()=>void navigate('media')}>打开媒体库</button>}
          <button className="text-button" onClick={()=>setPanel('capture')}>调整拍摄选项</button>
          <button className="text-button" onClick={()=>setPanel('check')}>测试四种画质与帧率</button>
        </>}
      </div>}
      {panel==='screen'&&<div className="fullscreen-guide">
        {page==='camera'&&!screen.immersive&&<button className="primary-wide" onClick={()=>{setPanel(null);void enterCameraScreen()}}>立即铺满取景</button>}
        {screen.standalone?<p>你已从主屏幕打开。相机页右上角可直接进入全屏取景。</p>:<>
          <p>在 Safari 里，点地址栏旁的页面菜单 → 更多 → 隐藏工具栏。也可以从主屏幕打开提词器，让 Safari 工具栏不再显示。</p>
          <ol><li><b>用 iPhone 的 Safari 打开提词器</b><span>在微信或 ChatGPT 中打开时，可以先复制链接。</span></li><li><b>点分享，再点「添加到主屏幕」</b><span>如果没看到分享按钮，先打开 Safari 的页面菜单。</span></li><li><b>开启「以网页 App 打开」，点添加</b><span>回到主屏幕，点「提词器」图标，进入没有 Safari 工具栏的窗口。</span></li></ol>
          <button className="secondary full-width" onClick={()=>void copyInstallLink()}>复制 Safari 打开链接</button>
          {installFeedback&&<p role="status">{installFeedback}</p>}
          <p className="fullscreen-fineprint">首次从主屏幕打开时，可能要重新允许相机和麦克风、准备语音。请先导出 Safari 里的重要稿件和录像。</p>
        </>}
        <p className="fullscreen-fineprint">当前网页可用高度 {screenMetrics(appRoot.current).viewportHeight}，屏幕高度 {screenMetrics(appRoot.current).screenHeight}（CSS 像素）。</p>
      </div>}
      {panel==='script'&&<><div className="draft-toolbar"><select aria-label="选择稿件" disabled={draftBusy} value={selected} onChange={e=>{const d=drafts.find(d=>d.id===e.target.value);if(d)void switchDraft(d)}}>{drafts.map(d=><option key={d.id} value={d.id}>{d.title||'未命名口播'}</option>)}</select><button className="secondary" disabled={draftBusy} onClick={()=>void newDraft()}>新建</button></div><label className="field">标题<input disabled={draftBusy} value={title} maxLength={80} onChange={e=>setTitle(e.target.value)}/></label><label className="field">稿件<textarea disabled={draftBusy} value={text} onChange={e=>{setText(e.target.value);trialRequested.current=false;setPacing(false);move(0);follower.current?.pause('稿件已修改，请重新试读')}} placeholder="粘贴你的口播稿，按自己的节奏说。"/></label><div className="editor-actions"><span>{saved}</span><button className="text-button" onClick={()=>download(new Blob([`${title}\n\n${text}`],{type:'text/plain;charset=utf-8'}),`${title||'口播稿'}.txt`)}>导出文本</button><button className="danger-text" disabled={draftBusy} onClick={()=>void removeDraft()}>删除稿件</button></div><button className="primary-wide" onClick={()=>setPanel(null)}>回到拍摄</button></>}
      {panel==='capture'&&<div className="camera-options">
        <h3>相机</h3>
        <div className="settings-group">
          <CaptureOptions preferences={preferences} onChange={next=>void configureCamera(next)} disabled={busy||phase==='opening'}/>
          <label className="setting-row">
            <span><strong>前置预览镜像</strong><small>像照镜子一样看自己。</small></span>
            <input className="switch-input" type="checkbox" checked={preferences.previewMirror} disabled={busy||preferences.facing!=='user'} onChange={event=>setPreferences(current=>({...current,previewMirror:event.target.checked}))}/>
            <span className="switch-track" aria-hidden="true"/>
          </label>
        </div>
        <h3>提词显示</h3>
        <label className="setting-row">
          <span><strong>显示提词</strong></span>
          <input className="switch-input" type="checkbox" checked={preferences.showPrompt} onChange={event=>setPreferences(current=>({...current,showPrompt:event.target.checked}))}/>
          <span className="switch-track" aria-hidden="true"/>
        </label>
        {displayControls}
        <button type="button" className="text-button" onClick={()=>setPanel('check')}>测试画质和帧率</button>
      </div>}
      {panel==='settings'&&displayControls}
      {panel==='voice'&&<>
        <div className="record-recovery mic-check">
          <label className="setting-row">
            <span><strong>录像麦克风</strong><small>{micStatus}</small></span>
            <select aria-label="录像麦克风" disabled={busy} value={preferences.microphone??'auto'} onChange={event=>{
              const value=event.target.value
              setPreferences(current=>({...current,microphone:value==='direct'||value==='compatible'?value:undefined}));setSoundStatus('')
            }}><option value="auto">自动</option><option value="direct">直接收音</option><option value="compatible">兼容收音</option></select>
          </label>
          <button className="secondary" disabled={busy||!hasLivePreview||phase!=='idle'} onClick={()=>void checkMicrophone()}>{checkingSound?'正在试录…':'试录 3 秒检查声音'}</button>
          {soundStatus&&<p role="status">{soundStatus}</p>}
        </div>
        <label className="setting-row">
          <span><strong>中文语音模型</strong><small>轻量普通话会自动准备；其他免费流式模型可下载后同稿对比，均在本机运行。</small></span>
          <select aria-label="中文语音模型" value={speechModel} onChange={event=>chooseSpeechModel(restoreSpeechModel(event.target.value))}>
            {(Object.keys(speechModels) as SpeechModel[]).map(model=><option key={model} value={model}>{speechModels[model].label}</option>)}
          </select>
        </label>
        {followControls}
        <div className="voice-recovery">
          {mode!=='manual'&&<button type="button" className="secondary" onClick={()=>{selectMode('manual');setPanel(null);setMessage('')}}>使用手动提词</button>}
          <button type="button" className="text-button" onClick={()=>setPanel('check')}>查看相机与语音检查</button>
        </div>
      </>}
      {panel==='check'&&<><CaptureMatrix facing={preferences.facing} results={matrixResults} progress={matrixProgress} running={matrixRunning} disabled={!booted||busy||phase!=='idle'} videoRef={matrixVideo} onStart={()=>void checkAllFormats()} onCancel={()=>matrixAbort.current?.abort()} onUse={useTestedFormat}/><p>相机打开时会录制几秒测试片段，分析后丢弃。短片通过后，仍需检查语音同时运行的长片效果。</p><div className="diagnostic">{cameraReport?captureLabel:`${specText} · 待检查`}<br/>当前取景：{previewSize??'尚未测量'}<br/>麦克风：{micStatus}<br/>预览回调：{previewFps===null?'尚未测量':`${previewFps.toFixed(1)} 帧 / 秒`}<br/>语音模型：{speechModels[speechModel].label}（本地免费）<br/>语音音频处理：{latency?`${Math.round(latency)} ms`:'尚未测量'}<br/>最近实际推进：{followLatency?`${Math.round(followLatency)} ms（含识别与对齐）`:'尚未测量'}<br/>系统：{navigator.userAgent}</div>{cameraReport&&<div className="diagnostic"><strong>{isVerifiedCapture(cameraReport,selectedSpec)?'所选规格短片检查通过':'所选规格检查未通过'}</strong><p>{cameraReport.reason}</p><p>测试文件：{cameraReport.fileFps===undefined?'尚未取得':`${cameraReport.fileFps.toFixed(2)} 帧 / 秒`}<br/>浏览器上报可用帧率：{cameraReport.capabilities?.frameRate?`${cameraReport.capabilities.frameRate.min ?? '?'}～${cameraReport.capabilities.frameRate.max ?? '?'}`:'未提供能力范围'}</p><details><summary>查看每一步相机结果</summary>{cameraReport.attempts.map((attempt,index)=><p key={index}>{attempt.step}<br/>{attempt.settings&&`${attempt.settings.width ?? '?'} × ${attempt.settings.height ?? '?'} / ${attempt.settings.frameRate ?? '?'} 帧`}{attempt.preview&&<><br/>预览 {attempt.preview.width} × {attempt.preview.height}，回调 {attempt.preview.fps?.toFixed(1) ?? '?'} 帧 / 秒</>}{attempt.error&&<span className="error">{attempt.error}</span>}</p>)}</details></div>}{['连续拍摄 5 分钟，画面流畅、没有明显发热卡顿','导出分辨率与平均帧率满足所选规格，声音完整、音画同步','正常照读通常 1.5 秒内跟上，延迟不累积','停顿 10 秒、重读、少量漏字后仍能定位','连续录制、回看和导出三次，声音和跟随正常','切后台或来电后明确中断，已有片段可检查'].map((label,i)=><label className="check-row" key={i}><input type="checkbox" checked={!!checks[i]} onChange={e=>setChecks({...checks,[i]:e.target.checked})}/>{label}</label>)}<button className="secondary" onClick={()=>{download(new Blob([JSON.stringify({date:new Date().toISOString(),camera:captureLabel,cameraNegotiation:cameraReport,captureMatrix:matrixResults,display:{...screenMetrics(appRoot.current),standalone:screen.standalone},previewFps,audioRoundTripMs:latency,followMatchMs:followLatency,speechModel,userAgent:navigator.userAgent,checks},null,2)],{type:'application/json'}),'iPhone-实机检查.json');setDownloadReady(true)}}>导出检查记录</button>{downloadReady&&<p>检查记录已准备下载，不包含稿件、录音或视频。</p>}</>}
    </section></div>}
    {preview&&<div className="modal-backdrop playback-backdrop" onClick={closePreview}>
      <section className="sheet preview-sheet" role="dialog" aria-modal="true" aria-labelledby="preview-title" onClick={e=>e.stopPropagation()}>
        <div className="sheet-header"><h2 id="preview-title">这一次的表达</h2><button className="close" aria-label="关闭回看" onClick={closePreview}>×</button></div>
        <video src={preview.url} controls playsInline preload="metadata" muted={false} onError={()=>setPlaybackFailed(true)} onLoadedData={()=>setPlaybackFailed(false)}/>
        <div className="preview-details">
          <strong>{preview.take.title}</strong><button className="text-button rename-take" onClick={()=>void renameTake(preview.take)}>重命名</button>
          <p>{bytes(preview.file.size)} · {time(preview.duration??preview.take.duration)} · {preview.original||preview.take.mirrored===undefined?'原始方向':preview.take.mirrored?'镜像成片':'正常方向'}<br/>
          {preview.dimensions?`成片 ${preview.dimensions.width} × ${preview.dimensions.height}`:'成片尺寸尚未确认'}<br/>
          {preview.fps===null?'文件帧率尚未确认。':`文件平均帧率 ${preview.fps.toFixed(2)} 帧 / 秒${preview.take.targetFps&&!matchesRate(preview.fps,preview.take.targetFps)?`（目标 ${preview.take.targetFps} 帧）`:''}`}</p>
          {preview.take.status!=='ready'&&<p className="error">这是中断片段，请先确认能完整播放。</p>}
          {playbackFailed&&<p className="error">浏览器无法播放这个片段，可以先下载到「文件」。</p>}
          {preview.audio==='missing'&&<p className="error">这个文件没有音轨。重新拍摄前可先检查麦克风。</p>}
          {preview.audio==='silent'&&<p className="error">文件有音轨，但没有检测到明显声音。可换一种收音方式试录。</p>}
          {preview.audio==='audible'&&<p>已从成片检测到声音。</p>}
        </div>
        {preview.take.mime.includes('mp4')&&<label className="mirror-take-option"><span>镜像这段视频<small>只影响这段视频的回看与导出，原始录像保留。</small></span><input type="checkbox" checked={!!preview.take.mirrored} disabled={previewBusy} onChange={event=>void changeTakeMirror(preview.take,event.target.checked)}/></label>}
        <button className="primary-wide" disabled={previewBusy} onClick={()=>void sharePreview()}>{previewBusy?'正在更新方向…':navigator.canShare?.({files:[preview.file]})?'分享 / 保存到手机':'保存到手机'}</button>
        <button className="secondary full-width" disabled={previewBusy} onClick={()=>download(preview.file,preview.file.name)}>下载到「文件」</button>
      </section>
    </div>}
  </main>
}
