import {defaultCapture,type CaptureSpec} from './capture-spec.ts'
export type CameraPreferences=CaptureSpec&{previewMirror:boolean;recordMirror:boolean;mirrorRenderingVersion:1;highRateHdSource?:boolean;previewFit:'contain'|'cover';previewLayoutVersion:1;bitrate:number;countdown:number;theme:'light'|'dark'|'rose';showPrompt:boolean;grid:boolean;microphone?:'direct'|'compatible'}
export const cameraDefaults:CameraPreferences={...defaultCapture,previewMirror:true,recordMirror:true,mirrorRenderingVersion:1,previewFit:'cover',previewLayoutVersion:1,bitrate:16_000_000,countdown:3,theme:'light',showPrompt:true,grid:false}
export function restoreCamera(saved?:Partial<CameraPreferences>):CameraPreferences{
  return {
    resolution:saved?.resolution==='4k'?'4k':'1080p',
    fps:saved?.fps===30?30:60,
    facing:saved?.facing==='environment'?'environment':'user',
    zoom:saved?.zoom===2||saved?.zoom===3?saved.zoom:1,
    grid:saved?.grid===true,
    previewMirror:saved?.mirrorRenderingVersion!==1||saved.previewMirror!==false,
    recordMirror:saved?.mirrorRenderingVersion!==1||saved.recordMirror!==false,
    mirrorRenderingVersion:1,
    ...(saved?.highRateHdSource===true?{highRateHdSource:true}:{}),
    previewFit:saved?.previewLayoutVersion===1&&saved.previewFit==='contain'?'contain':'cover',
    previewLayoutVersion:1,
    bitrate:[8_000_000,16_000_000,27_000_000].includes(saved?.bitrate??0)?saved!.bitrate!:cameraDefaults.bitrate,
    countdown:[0,3,5,10].includes(saved?.countdown??-1)?saved!.countdown!:3,
    theme:saved?.theme==='dark'||saved?.theme==='rose'?saved.theme:'light',
    showPrompt:typeof saved?.showPrompt==='boolean'?saved.showPrompt:true,
    ...(saved?.microphone==='direct'||saved?.microphone==='compatible'?{microphone:saved.microphone}:{}),
  }
}
