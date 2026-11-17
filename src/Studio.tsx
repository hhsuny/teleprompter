import {useEffect,useRef,useState,type Dispatch,type SetStateAction} from 'react'
import {deleteTake,patchTake,type Draft,type Take} from './storage'
import {exportTake} from './recorder'
import {makeThumbnail} from './thumbnail'
import type {CameraPreferences} from './preferences'

export type StudioPage='camera'|'media'|'scripts'|'settings'
export const formatBytes=(n:number)=>n>=1024**3?`${(n/1024**3).toFixed(1)} GB`:n>=1024**2?`${(n/1024**2).toFixed(1)} MB`:n>=1024?`${Math.ceil(n/1024)} KB`:`${n} B`
const duration=(n:number)=>`${Math.floor(n/60).toString().padStart(2,'0')}:${Math.floor(n%60).toString().padStart(2,'0')}`
let coverQueue:Promise<unknown>=Promise.resolve()
export function Icon({name}:{name:StudioPage|'heart'|'mirror'|'eye'|'film'|'fullscreen'|'flip'|'mic'|'waveform'|'pause'}){
  const paths={camera:<><rect x="3" y="6" width="18" height="15" rx="3"/><path d="m8 6 2-3h4l2 3"/><circle cx="12" cy="13" r="4"/></>,media:<><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M7 3v18M17 3v18M3 8h4M3 16h4M17 8h4M17 16h4"/></>,scripts:<><path d="M6 3h8l4 4v14H6zM14 3v5h4M9 12h6M9 16h6"/></>,settings:<><path d="M3 6h18M3 12h18M3 18h18"/><circle cx="8" cy="6" r="2"/><circle cx="16" cy="12" r="2"/><circle cx="10" cy="18" r="2"/></>,heart:<path d="M12 21 3.8 13C-1 8.2 6 1.3 12 7c6-5.7 13 1.2 8.2 6Z"/>,mirror:<><path d="M12 2v20M9 7 3 18h6ZM15 7l6 11h-6Z"/></>,eye:<><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></>,film:<><rect x="3" y="3" width="18" height="18" rx="2"/><path d="m10 8 6 4-6 4Z"/></>}
  const extra={fullscreen:<path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"/>,flip:<path d="M3 8h14l-3-3m7 11H7l3 3M3 8v6m18 2v-6"/>}
  const audio={mic:<><rect x="9" y="3" width="6" height="12" rx="3"/><path d="M5 11v1a7 7 0 0 0 14 0v-1m-7 8v3m-3 0h6"/></>,waveform:<path d="M3 10v4m4-7v10m5-14v18m5-14v10m4-7v4"/>,pause:<path d="M9 5v14m6-14v14"/>}
  const icons={...paths,...extra,...audio}
  return <svg viewBox="0 0 24 24" width="25" height="25" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{icons[name]}</svg>
}
export function StudioNav({page,onNavigate,disabled}:{page:StudioPage;onNavigate:(page:StudioPage)=>void;disabled:boolean}){
  return <nav className="studio-nav" aria-label="主导航">{([['camera','相机'],['media','媒体'],['scripts','脚本'],['settings','设置']] as const).map(([value,label])=><button key={value} aria-current={page===value?'page':undefined} disabled={disabled&&value!=='camera'} onClick={()=>onNavigate(value)}><Icon name={value}/><span>{label}</span></button>)}</nav>
}
function TakeTile({take,onOpen,onError,selected,onSelect,selecting,onChange}:{take:Take;onOpen:(take:Take)=>void;onError:(error:unknown)=>void;selected:boolean;onSelect:()=>void;selecting:boolean;onChange:()=>Promise<void>}){
  const element=useRef<HTMLElement>(null),[visible,setVisible]=useState(!globalThis.IntersectionObserver)
  const [thumbnail,setThumbnail]=useState(take.thumbnail)
  useEffect(()=>setThumbnail(take.thumbnail),[take.thumbnail,take.mirrored])
  useEffect(()=>{
    if(visible||!element.current)return
    const observer=new IntersectionObserver(entries=>{if(entries.some(entry=>entry.isIntersecting)){setVisible(true);observer.disconnect()}},{rootMargin:'150px'})
    observer.observe(element.current);return()=>observer.disconnect()
  },[visible])
  useEffect(()=>{
    if(thumbnail||!visible)return
    let cancelled=false
    const generate=async()=>{if(cancelled)return;try{const image=await makeThumbnail(await exportTake(take));if(image&&!cancelled){setThumbnail(image);await patchTake(take.id,{thumbnail:image})}}catch{/* A missing cover never blocks access to the original take. */}}
    // Decode visible covers one at a time; avoid opening many video decoders on a phone.
    coverQueue=coverQueue.then(generate,generate)
    return()=>{cancelled=true}
  },[take.id,take.mirrored,thumbnail,visible])
  return <article className="media-tile" ref={element}>
    <button className={`media-cover ${selected?'selected':''}`} aria-label={selecting?`选择 ${take.title}`:`回看 ${take.title}`} aria-pressed={selecting?selected:undefined} onClick={()=>selecting?onSelect():onOpen(take)}>
      {thumbnail?<img src={thumbnail} alt="" loading="lazy"/>:<span className="cover-placeholder"><Icon name="film"/>点开回看</span>}
      {(take.measured||take.mirrored)&&<span className="clip-format">{take.measured&&take.width&&take.height?`${Math.min(take.width,take.height)}p`:''}{take.measured&&take.fps?` ${Math.round(take.fps)} 帧`:''}{take.mirrored?`${take.measured?' · ':''}镜像`:''}</span>}
      <span className="clip-duration">{duration(take.duration)}</span>{selecting&&<span className="clip-selected">{selected?'✓':'○'}</span>}
    </button>
    <div className="clip-caption"><div><h3>{take.title||'未命名口播'}</h3><p>{formatBytes(take.bytes)}{take.status!=='ready'?' · 中断片段':''}</p></div><button className={`favorite ${take.favorite?'marked':''}`} aria-label={take.favorite?`取消收藏 ${take.title}`:`收藏 ${take.title}`} aria-pressed={!!take.favorite} onClick={()=>void patchTake(take.id,{favorite:!take.favorite}).then(onChange).catch(onError)}><Icon name="heart"/></button></div>
  </article>
}
export function MediaLibrary({takes,onOpen,onChange,onError}:{takes:Take[];onOpen:(take:Take)=>void;onChange:()=>Promise<void>;onError:(error:unknown)=>void}){
  const [sort,setSort]=useState<'recent'|'size'|'duration'>('recent'),[favorites,setFavorites]=useState(false),[selecting,setSelecting]=useState(false),[selection,setSelection]=useState<string[]>([]),[deleting,setDeleting]=useState(false),[storage,setStorage]=useState<StorageEstimate>()
  useEffect(()=>{void navigator.storage?.estimate?.().then(setStorage).catch(()=>{})},[takes])
  const clips=takes.filter(take=>take.bytes>0&&(!favorites||take.favorite)).sort((a,b)=>sort==='size'?b.bytes-a.bytes:sort==='duration'?b.duration-a.duration:b.createdAt-a.createdAt)
  const visibleSelection=clips.filter(clip=>selection.includes(clip.id)).map(clip=>clip.id)
  const total=takes.reduce((n,take)=>n+take.bytes,0),available=storage?.quota===undefined?undefined:Math.max(0,storage.quota-(storage.usage??0))
  const shownBytes=clips.reduce((n,take)=>n+take.bytes,0)
  async function removeSelected(){
    if(!visibleSelection.length||!confirm(`删除选中的 ${visibleSelection.length} 段本机录像？请先确认重要片段已导出。`))return
    setDeleting(true)
    try{for(const id of visibleSelection)await deleteTake(id);setSelection([]);setSelecting(false);await onChange()}catch(error){await onChange();onError(error)}finally{setDeleting(false)}
  }
  return <section className="studio-page media-page">
    <header className="page-heading"><div><h1>{favorites?'收藏的视频':'所有视频'}</h1><p>{clips.length} 个视频 · {formatBytes(shownBytes)}</p></div><button className="pill-action" onClick={()=>{setSelecting(!selecting);setSelection([])}} disabled={deleting}>{selecting?'完成':'选择'}</button></header>
    <div className="storage-summary"><div><span>本机视频 {formatBytes(total)}</span><span>{available===undefined?'可用空间暂未提供':`浏览器可用 ${formatBytes(available)}`}</span></div><progress max={storage?.quota||1} value={storage?.usage||0}/><p>视频保存在当前浏览器，重要片段请导出到手机。</p></div>
    <div className="library-toolbar"><span>排序</span>{([['recent','最近'],['size','大小'],['duration','时长']] as const).map(([value,label])=><button key={value} className={sort===value?'selected':''} aria-pressed={sort===value} onClick={()=>setSort(value)}>{label}</button>)}<button className={`favorites-filter ${favorites?'selected':''}`} aria-label="只看收藏" aria-pressed={favorites} disabled={deleting} onClick={()=>{setFavorites(!favorites);setSelection([])}}><Icon name="heart"/></button></div>
    {selecting&&<div className="selection-bar"><button disabled={!clips.length||deleting} onClick={()=>setSelection(visibleSelection.length===clips.length?[]:clips.map(take=>take.id))}>{visibleSelection.length===clips.length&&clips.length?'取消全选':'全选'}</button><span>已选 {visibleSelection.length} 段</span><button className="danger-text" disabled={!visibleSelection.length||deleting} onClick={()=>void removeSelected()}>{deleting?'正在删除…':'删除所选'}</button></div>}
    {!clips.length?<div className="studio-empty"><Icon name="media"/><h2>{favorites?'还没有收藏的视频':'把第一条口播留在这里'}</h2><p>{favorites?'在视频旁点一下爱心，就能快速找到。':'回到相机拍摄，结束后会自动保存在本机。'}</p></div>:<div className="media-grid">{clips.map(take=><TakeTile key={take.id} take={take} onOpen={onOpen} onChange={onChange} onError={onError} selecting={selecting} selected={selection.includes(take.id)} onSelect={()=>setSelection(ids=>ids.includes(take.id)?ids.filter(id=>id!==take.id):[...ids,take.id])}/>)}</div>}
  </section>
}
export function ScriptLibrary({drafts,selected,onEdit,onUse,onNew,onImport}:{drafts:Draft[];selected:string;onEdit:(draft:Draft)=>void;onUse:(draft:Draft)=>void;onNew:()=>void;onImport:(file:File)=>void}){
  return <section className="studio-page scripts-page"><header className="page-heading"><div><h1>我的口播稿</h1><p>{drafts.length} 篇稿件 · 自动保存在本机</p></div><button className="pill-action accent" onClick={onNew}>＋ 新建</button></header>
    <label className="import-script">导入 TXT 文本<input type="file" accept=".txt,text/plain" onChange={event=>{const file=event.target.files?.[0];if(file)onImport(file);event.target.value=''}}/></label>
    <div className="draft-list">{drafts.map(draft=><article className="draft-card" key={draft.id}><div className="draft-card-heading"><span><Icon name="scripts"/></span>{draft.id===selected&&<b>当前使用</b>}<small>{draft.text.replace(/\s/g,'').length} 字</small></div><button className="draft-title" onClick={()=>onEdit(draft)}><h2>{draft.title||'未命名口播'}</h2><p>{draft.text.slice(0,95)||'写下想说的话，从第一句开始。'}</p></button><div className="draft-card-actions"><span>{new Date(draft.updatedAt).toLocaleDateString('zh-CN')}</span><button onClick={()=>onEdit(draft)}>编辑</button><button className="accent-text" onClick={()=>onUse(draft)}>使用并拍摄</button></div></article>)}</div>
  </section>
}
function ToggleRow({title,description,value,onChange}:{title:string;description:string;value:boolean;onChange:(value:boolean)=>void}){
  return <label className="setting-row"><span><strong>{title}</strong><small>{description}</small></span><input className="switch-input" type="checkbox" checked={value} onChange={event=>onChange(event.target.checked)}/><span className="switch-track" aria-hidden="true"/></label>
}
export function CaptureOptions({preferences,onChange,disabled=false}:{preferences:CameraPreferences;onChange:(next:CameraPreferences)=>void;disabled?:boolean}){
  const update=<K extends keyof CameraPreferences>(key:K,value:CameraPreferences[K])=>onChange({...preferences,[key]:value})
  return <div className="capture-options">
    <label className="setting-row"><span><strong>分辨率</strong><small>支持情况由当前镜头和浏览器决定。</small></span><select aria-label="视频分辨率" disabled={disabled} value={preferences.resolution} onChange={e=>update('resolution',e.target.value as CameraPreferences['resolution'])}><option value="1080p">1080P</option><option value="4k">4K</option></select></label>
    <label className="setting-row"><span><strong>目标帧率</strong><small>拍摄前检查成片。需要改规格时会让你选择。</small></span><select aria-label="视频帧率" disabled={disabled} value={preferences.fps} onChange={e=>update('fps',+e.target.value as 30|60)}><option value={30}>30 帧</option><option value={60}>60 帧</option></select></label>
    <label className="setting-row"><span><strong>拍摄镜头</strong><small>拍摄前切换，后置镜头保持自然方向。</small></span><select aria-label="拍摄镜头" disabled={disabled} value={preferences.facing} onChange={e=>update('facing',e.target.value as CameraPreferences['facing'])}><option value="user">前置</option><option value="environment">后置</option></select></label>
    <label className="setting-row"><span><strong>变焦倍率</strong><small>优先使用相机变焦，否则数字裁切；数字裁切会降低清晰度。</small></span><select aria-label="变焦倍率" disabled={disabled} value={preferences.zoom} onChange={e=>update('zoom',+e.target.value as 1|2|3)}>{[1,2,3].map(value=><option key={value} value={value}>{value}×</option>)}</select></label>
  </div>
}
export function StudioSettings({preferences,setPreferences,installed,onInstall,onDisplay,onVoice,onCheck}:{preferences:CameraPreferences;setPreferences:Dispatch<SetStateAction<CameraPreferences>>;installed:boolean;onInstall:()=>void;onDisplay:()=>void;onVoice:()=>void;onCheck:()=>void}){
  const update=<K extends keyof CameraPreferences>(key:K,value:CameraPreferences[K])=>setPreferences(current=>({...current,[key]:value}))
  return <section className="studio-page settings-page"><header className="page-heading"><div><h1>设置</h1><p>调到顺手，就专心表达。</p></div></header>
    <h2 className="group-title">前置镜头</h2><div className="settings-group">
      <ToggleRow title="预览镜像" description="像照镜子一样看自己，开关只改变取景方向。" value={preferences.previewMirror} onChange={value=>update('previewMirror',value)}/>
      <ToggleRow title="成片镜像" description="开启后，前置录像的画面和镜像取景方向一致。" value={preferences.recordMirror} onChange={value=>update('recordMirror',value)}/>
      <label className="setting-row"><span><strong>取景范围</strong><small>完整画面不裁切；填满屏幕会裁切边缘。</small></span><select aria-label="取景范围" value={preferences.previewFit} onChange={event=>update('previewFit',event.target.value as CameraPreferences['previewFit'])}><option value="contain">完整画面</option><option value="cover">填满屏幕</option></select></label>
    </div>
    <h2 className="group-title">拍摄</h2><div className="settings-group">
      <CaptureOptions preferences={preferences} onChange={setPreferences}/>
      <label className="setting-row"><span><strong>视频码率</strong><small>码率越高，文件越大。实际值由浏览器编码器决定。</small></span><select aria-label="视频码率" value={preferences.bitrate} onChange={event=>update('bitrate',+event.target.value)}><option value={8_000_000}>8 Mbps</option><option value={16_000_000}>16 Mbps</option><option value={27_000_000}>27 Mbps</option></select></label>
      <label className="setting-row"><span><strong>拍摄倒计时</strong><small>留一点时间，看回镜头。</small></span><select aria-label="拍摄倒计时" value={preferences.countdown} onChange={event=>update('countdown',+event.target.value)}>{[0,3,5,10].map(value=><option key={value} value={value}>{value?`${value} 秒`:'关闭'}</option>)}</select></label>
      <div className="setting-row"><span><strong>中断时保留片段</strong><small>切到后台或相机中断时，尽量保存已录内容。系统强制关闭时可能无法恢复。</small></span><span className="setting-value">自动</span></div>
    </div>
    <h2 className="group-title">提词</h2><div className="settings-group">
      <ToggleRow title="显示提词" description="需要先检查构图时，可临时隐藏文字。" value={preferences.showPrompt} onChange={value=>update('showPrompt',value)}/>
      <ToggleRow title="构图网格" description="三分线辅助构图，不会进入成片。" value={preferences.grid} onChange={value=>update('grid',value)}/>
      <button className="setting-row setting-link" onClick={onDisplay}><span><strong>字号与位置</strong><small>字号、行宽、透明度和距镜头的位置。</small></span><span>›</span></button>
      <button className="setting-row setting-link" onClick={onVoice}><span><strong>中文语音跟随</strong><small>本机免费识别，也可手动选择匀速或点选。</small></span><span>›</span></button>
    </div>
    <h2 className="group-title">外观</h2><div className="settings-group theme-group"><div className="theme-options" aria-label="界面主题">{([['light','浅色'],['dark','深色'],['rose','胭脂']] as const).map(([value,label])=><button key={value} data-theme-option={value} aria-pressed={preferences.theme===value} onClick={()=>update('theme',value)}>{label}</button>)}</div></div>
    <h2 className="group-title">手机使用</h2><div className="settings-group">
      <button className="setting-row setting-link" onClick={onInstall}><span><strong>{installed?'主屏幕模式已启用':'添加到主屏幕'}</strong><small>{installed?'正在独立窗口中使用提词器。':'从手机桌面打开，拍摄时去掉 Safari 工具栏。'}</small></span><span aria-hidden="true">›</span></button>
      <button className="setting-row setting-link" onClick={onCheck}><span><strong>相机与语音检查</strong><small>查看实际分辨率、帧率和语音状态。</small></span><span aria-hidden="true">›</span></button>
    </div>
    <div className="local-first-note"><Icon name="scripts"/><div><strong>稿件和视频保存在本机</strong><p>重要内容可以导出到手机的「文件」或「照片」。</p></div></div>
  </section>
}
