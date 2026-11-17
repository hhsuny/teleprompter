export async function makeThumbnail(file:Blob):Promise<string|undefined>{
  const video=document.createElement('video'),url=URL.createObjectURL(file)
  video.muted=true;video.playsInline=true;video.preload='auto'
  try{
    await new Promise<void>((resolve,reject)=>{
      const timer=setTimeout(()=>finish(new Error('封面读取超时')),4000)
      const finish=(error?:Error)=>{clearTimeout(timer);video.onloadeddata=null;video.onseeked=null;video.onerror=null;error?reject(error):resolve()}
      video.onerror=()=>finish(new Error('无法读取封面'))
      video.onloadeddata=()=>{if(video.duration>.2){video.onseeked=()=>finish();video.currentTime=.1}else finish()}
      video.src=url;video.load()
    })
    const height=Math.round(180*video.videoHeight/video.videoWidth);if(!Number.isFinite(height)||height<1||height>400)return
    const canvas=document.createElement('canvas');canvas.width=180;canvas.height=height
    const context=canvas.getContext('2d');if(!context)return
    context.drawImage(video,0,0,canvas.width,canvas.height)
    if(context.getImageData(0,0,1,1).data[3]===0)return
    return canvas.toDataURL('image/jpeg',.65)
  }catch{return undefined}
  finally{video.removeAttribute('src');video.load();URL.revokeObjectURL(url)}
}
