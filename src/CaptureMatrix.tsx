import type {RefObject} from 'react'
import {isVerifiedCapture} from './camera'
import {captureModeLabel,captureModes,type CaptureCheck} from './capture-matrix'
import {matchesDimensions,matchesRate,type CaptureSpec} from './capture-spec'
import CaptureFileCheck from './CaptureFileCheck'
import {canScaleToFullHd} from './zoom'

export default function CaptureMatrix({facing,results,progress,running,disabled,videoRef,onStart,onCancel,onUse}:{
  facing:CaptureSpec['facing'];results:CaptureCheck[];progress:string;running:boolean;disabled:boolean;
  videoRef:RefObject<HTMLVideoElement|null>;onStart:()=>void;onCancel:()=>void;onUse:(spec:CaptureSpec)=>void
}){
  return <section className="capture-matrix" aria-label="四档录像测试">
    <h3>四档录像测试</h3>
    <p>{facing==='user'?'前置':'后置'} 1× · 每档试录几秒，语音跟随暂时暂停。保持竖屏，测试片段仅在本机分析。</p>
    {running?<button type="button" className="secondary" onClick={onCancel}>停止测试</button>:<button type="button" className="primary-wide" disabled={disabled} onClick={onStart}>测试四种画质与帧率</button>}
    {progress&&<p role="status" className="capture-matrix-progress">{progress}</p>}
    <video className="capture-test-preview" ref={videoRef} hidden={!running} autoPlay playsInline muted aria-label="测试取景"/>
    <ul>{captureModes.map(mode=>{
      const result=results.find(row=>row.spec.facing===facing&&row.spec.resolution===mode.resolution&&row.spec.fps===mode.fps)
      const report=result?.report,dimensions=report?.fileDimensions,input=report?.input
      const filePassed=!!result&&isVerifiedCapture(report??null,result.spec)
      const inputBelow=!!result&&!!input&&(input.fps<mode.fps-1||!(report?.zoomMethod==='downscale'?canScaleToFullHd(input):matchesDimensions(input,result.spec)))
      const passed=filePassed&&!inputBelow
      const fileBelow=!!result&&!!input&&!inputBelow&&report?.fileFps!==undefined&&!matchesRate(report.fileFps,mode.fps)
      const status=!result?'待测试':passed?(input?'输入和试录通过':'试录通过，输入未测'):
        inputBelow?(filePassed?'试录达标，输入偏低':'相机输入低于目标'):fileBelow?'输入达标，成片帧率不符':report?.fileFps!==undefined?'试录未达目标':'未取得可测成片'
      return <li key={captureModeLabel(mode)} data-result={passed?'pass':result?'unverified':'pending'}>
        <div><strong>{captureModeLabel(mode)}</strong><small>{status}</small></div>
        {result&&<><p>{input?`相机原始帧 ${input.width} × ${input.height} · ${input.fps.toFixed(1)} 帧`:'相机原始帧未测到'}
          {report?.trackFps!==undefined&&<span>浏览器报告 {report.trackFps.toFixed(1)} 帧</span>}</p>
          <p>{dimensions?`试录成片 ${dimensions.width} × ${dimensions.height}`:'试录成片尺寸未测到'}
            {report?.fileFps!==undefined&&` · ${report.fileFps.toFixed(2)} 帧`}{report?.fileHasAudio===true&&' · 有音轨'}{report?.fileHasAudio===false&&' · 缺少音轨'}</p>
          {(result.error||!passed&&report?.reason)&&<p>{result.error||report?.reason}</p>}
          {passed&&!running&&<button type="button" className="text-button" disabled={disabled} onClick={()=>onUse(result.spec)}>用此规格拍摄</button>}
        </>}
      </li>
    })}</ul>
    {!!results.length&&!running&&<p>要确认跟读时的帧率，用通过的规格开启语音跟随录一段，再到媒体页回看成片帧率。</p>}
    <CaptureFileCheck/>
  </section>
}
