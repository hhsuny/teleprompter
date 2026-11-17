import {memo,useLayoutEffect,useMemo,useRef} from 'react'
import {splitCues} from './alignment'

/** At a sentence boundary the next sentence is ready to read. Ignore trailing whitespace. */
export function readingCue(cues:ReturnType<typeof splitCues>,position:number){
  const next=cues.findIndex(cue=>cue.end>position)
  return next<0?Math.max(0,cues.length-1):next
}
const CueLine=memo(function CueLine({text,start,end,current,next,past,position,onLocate}:{text:string;start:number;end:number;current:boolean;next:boolean;past:boolean;position:number;onLocate:(position:number)=>void}){
  const read=Math.max(0,Math.min(end-start,position-start))
  return <button data-current={current} data-next={next} className={`cue ${current?'current':next?'next':past?'past':''}`} onClick={()=>onLocate(start)} aria-label={`从这句读：${text}`}>
    {current?<><span className="read">{text.slice(0,read)}</span><span className="reading-anchor" data-reading-anchor>{text.slice(read,read+1)||'\u200b'}</span><span>{text.slice(read+1)}</span></>:text}
  </button>
})
// Timer, microphone status and latency updates must not rerender the whole
// manuscript when its text, reading position and display settings are unchanged.
export default memo(function Prompter({text,position,fontSize,width,active,onLocate,onEdit,notice}:{text:string;position:number;fontSize:number;width:number;active:boolean;onLocate:(position:number)=>void;onEdit:()=>void;notice?:string}){
  const cues=useMemo(()=>splitCues(text),[text]),current=readingCue(cues,position),window=useRef<HTMLDivElement>(null),lastTarget=useRef(-1),realign=useRef<()=>void>(()=>{})
  useLayoutEffect(()=>{
    realign.current=()=>{
      const element=window.current,anchor=element?.querySelector<HTMLElement>('[data-reading-anchor]')
      if(!element||!anchor)return
      const top=anchor.getBoundingClientRect().top-element.getBoundingClientRect().top+element.scrollTop-12
      const target=Math.max(0,Math.min(element.scrollHeight-element.clientHeight,top))
      // Partial words on the same line must not restart Safari's animation.
      if(Math.abs(lastTarget.current-target)>3){lastTarget.current=target;element.scrollTo({top:target,behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'})}
    }
    realign.current()
  },[position,current,fontSize,width,text,active])
  useLayoutEffect(()=>{
    if(!window.current)return
    // Entering fullscreen can reflow lines even when the saved font/width stay the same.
    const observer=new ResizeObserver(()=>realign.current());observer.observe(window.current)
    return()=>observer.disconnect()
  },[])
  return <div className="prompt-area" aria-label="提词稿件"><div className="lens-guide"><span/> 靠近镜头，自然说</div><div className="prompt-window" ref={window}>
    {cues.length?cues.map((cue,index)=><CueLine key={`${index}-${cue.start}`} text={text.slice(cue.start,cue.end)} start={cue.start} end={cue.end} current={index===current} next={index===current+1} past={index<current} position={index===current?position:cue.start} onLocate={onLocate}/>):<button className="empty-script" onClick={onEdit}>写下第一句想说的话</button>}
  </div>{notice&&<span className="prompt-notice" role="status">{notice}</span>}</div>
})
