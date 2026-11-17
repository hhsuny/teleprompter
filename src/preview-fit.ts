/** The clipping window follows the full encoded frame before CSS zoom. Keeping
 * the source video visible also avoids occluded-video frame callback throttling. */
export function previewFrame(width:number,height:number,sourceWidth:number,sourceHeight:number,fit:'contain'|'cover'){
  if(!width||!height||!sourceWidth||!sourceHeight)return null
  const scale=Math.min(width/sourceWidth,height/sourceHeight)
  return fit==='cover'?{width,height}:{width:sourceWidth*scale,height:sourceHeight*scale}
}
