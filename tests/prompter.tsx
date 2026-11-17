// Dev-only: exercise the production Prompter with known partial recognition results.
import {useRef,useState,type CSSProperties} from 'react'
import {createRoot} from 'react-dom/client'
import Prompter from '../src/Prompter'
import {locateSpeech,splitCues} from '../src/alignment'
import '../src/styles.css'
const script='今天我们来聊一个让口播更自然的小方法先把想说的话写下来再按自己的节奏读出来。停下来想一想，提词会在这里等你。'
function Check(){
  const [position,setPosition]=useState(0),[result,setResult]=useState('等待检查')
  const initialScroll=useRef(0)
  async function check(){
    setPosition(0);await new Promise(resolve=>setTimeout(resolve,400))
    const window=document.querySelector<HTMLElement>('.prompt-window')!;initialScroll.current=window.scrollTop
    let next=0
    for(const length of [2,5,10,15,20]){const match=locateSpeech(script,script.slice(0,length),next);if(!match.matched){setResult(`FAIL: ${length} 字未匹配`);return}next=match.position;setPosition(next);await new Promise(resolve=>setTimeout(resolve,450))}
    setResult('已推进到长句中间；待画面滚动后点「读取滚动结果」。')
  }
  function inspect(){
    const window=document.querySelector<HTMLElement>('.prompt-window')!,anchor=window.querySelector<HTMLElement>('[data-reading-anchor]')!,distance=anchor.getBoundingClientRect().top-window.getBoundingClientRect().top
    const checks={position,firstCueEnd:splitCues(script)[0].end,before:initialScroll.current,after:window.scrollTop,readingLineTop:distance}
    setResult(JSON.stringify({result:position<splitCues(script)[0].end&&window.scrollTop>initialScroll.current+20&&Math.abs(distance-12)<12?'PASS':'FAIL',...checks}))
  }
  return <div className="camera-stage" style={{height:'100svh','--font':'36px','--prompt-width':'94%','--prompt-top':'0%','--prompt-alpha':.48} as CSSProperties}>
    <Prompter text={script} position={position} fontSize={36} width={94} active onLocate={setPosition} onEdit={()=>{}}/>
    <div style={{position:'absolute',top:'45%',left:20,right:20,color:'white',zIndex:5}}><button onClick={()=>void check()}>检查句内按行滚动</button><button onClick={inspect}>读取滚动结果</button><button onClick={()=>setPosition(0)}>回读首句</button><p role="status">{result}</p></div>
  </div>
}
createRoot(document.querySelector('#root')!).render(<Check/> )
