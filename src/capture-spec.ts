export type CaptureSpec={resolution:'1080p'|'4k';fps:30|60;facing:'user'|'environment';zoom:1|2|3}
export const defaultCapture:CaptureSpec={resolution:'1080p',fps:60,facing:'user',zoom:1}
export const captureDimensions=(spec:CaptureSpec)=>spec.resolution==='4k'?[3840,2160]:[1920,1080]
export const specLabel=(spec:CaptureSpec)=>`${spec.facing==='user'?'前置':'后置'} · ${spec.resolution==='4k'?'4K':'1080P'} / ${spec.fps} 帧 · ${spec.zoom}×`
export const minimumFps=(fps:number)=>fps===60?59:29
export function matchesDimensions(settings:{width?:number;height?:number},spec:CaptureSpec){const [long,short]=captureDimensions(spec);return Math.max(settings.width??0,settings.height??0)===long&&Math.min(settings.width??0,settings.height??0)===short}
export function matchesRate(rate:number|undefined,target:number){return Number.isFinite(rate)&&rate!>=minimumFps(target)&&rate!<=target+1}
/** Crop source pixels, then scale to the negotiated output size. No UI is drawn. */
export function cropRectangle(width:number,height:number,zoom:number){return {x:width*(1-1/zoom)/2,y:height*(1-1/zoom)/2,width:width/zoom,height:height/zoom}}
