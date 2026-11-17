import {useRef,useState} from 'react'
import {inspectMp4,inspectMp4Format} from './mp4'

export default function CaptureFileCheck(){
  const input=useRef<HTMLInputElement>(null),request=useRef(0)
  const [result,setResult]=useState('')

  async function check(file:File){
    const token=++request.current
    setResult('正在读取视频帧率…')
    const [timing,format]=await Promise.all([inspectMp4(file),inspectMp4Format(file)])
    if(request.current!==token)return
    const size=format?.display??format?.encoded
    setResult(timing?`${size?`${size.width} × ${size.height} · `:''}文件平均 ${timing.fps.toFixed(2)} 帧 / 秒`:'读不出这段视频的帧率，请选择原始 MP4 或 MOV 文件。')
  }

  return <div className="file-rate-check">
    <input ref={input} type="file" hidden accept="video/mp4,video/quicktime,.mp4,.mov" onChange={event=>{
      const file=event.currentTarget.files?.[0]
      event.currentTarget.value=''
      if(file)void check(file)
    }}/>
    <button type="button" className="secondary" onClick={()=>input.current?.click()}>检查以前拍的视频帧率</button>
    {result&&<p role="status">{result}</p>}
  </div>
}
