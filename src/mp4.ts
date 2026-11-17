/** Read video sample timing, not the camera's requested frame rate. Unsupported files return null. */
type Box={type:string;start:number;data:number;end:number}
function boxes(view:DataView,start=0,end=view.byteLength):Box[]{
  const out:Box[]=[]
  for(let p=start;p+8<=end;){
    let size=view.getUint32(p),header=8
    const type=String.fromCharCode(...new Uint8Array(view.buffer,view.byteOffset+p+4,4))
    if(size===1){if(p+16>end)break;size=Number(view.getBigUint64(p+8));header=16}
    if(size===0)size=end-p
    if(size<header||p+size>end||!Number.isSafeInteger(size))break
    out.push({type,start:p,data:p+header,end:p+size});p+=size
  }
  return out
}
const children=(v:DataView,b:Box)=>boxes(v,b.data,b.end)
type Dimensions={width:number;height:number}
export type Mp4Format={encoded:Dimensions;display:Dimensions|null;hasAudio:boolean}

function trackKind(v:DataView,track:Box){
  const media=children(v,track).find(box=>box.type==='mdia')
  const handler=media&&children(v,media).find(box=>box.type==='hdlr')
  return handler&&handler.data+12<=handler.end
    ?String.fromCharCode(...new Uint8Array(v.buffer,v.byteOffset+handler.data+8,4))
    :null
}

function trackMatrix(v:DataView,track:Box){
  const header=children(v,track).find(box=>box.type==='tkhd')
  if(!header||header.data>=header.end)return null
  const version=v.getUint8(header.data),offset=header.data+(version===1?52:40)
  if(version>1||offset+44>header.end)return null
  if(v.getInt32(offset+8)!==0||v.getInt32(offset+20)!==0)return null
  const w=v.getInt32(offset+32)
  // MediaRecorder can omit the homogeneous coefficient of a generated, unrotated track.
  const identityWithoutW=w===0&&v.getInt32(offset)===65536&&v.getInt32(offset+16)===65536&&
    [4,12,24,28].every(position=>v.getInt32(offset+position)===0)
  if(w!==0x40000000&&!identityWithoutW)return null
  return offset
}

function displayDimensions(v:DataView,offset:number,encoded:Dimensions):Dimensions|null{
  const a=v.getInt32(offset),b=v.getInt32(offset+4),c=v.getInt32(offset+12),d=v.getInt32(offset+16)
  if(a&&d&&!b&&!c)return encoded
  if(!a&&!d&&b&&c)return {width:encoded.height,height:encoded.width}
  return null
}

function encodedDimensions(v:DataView,track:Box):Dimensions|null{
  const mdia=children(v,track).find(box=>box.type==='mdia')
  const minf=mdia&&children(v,mdia).find(box=>box.type==='minf')
  const stbl=minf&&children(v,minf).find(box=>box.type==='stbl')
  const stsd=stbl&&children(v,stbl).find(box=>box.type==='stsd')
  const entry=stsd&&boxes(v,stsd.data+8,stsd.end)[0]
  if(!entry||entry.start+36>entry.end)return null
  const width=v.getUint16(entry.start+32),height=v.getUint16(entry.start+34)
  return width&&height?{width,height}:null
}

/** Read encoded dimensions, file display direction and whether there is an audio track. */
export async function inspectMp4Format(blob:Blob):Promise<Mp4Format|null>{
  try{
    for(let p=0;p+8<=blob.size;){
      const header=new DataView(await blob.slice(p,p+16).arrayBuffer());let size=header.getUint32(0),head=8
      if(size===1){size=Number(header.getBigUint64(8));head=16}if(!size)size=blob.size-p
      if(size<head||p+size>blob.size||!Number.isSafeInteger(size))return null
      if(String.fromCharCode(...new Uint8Array(header.buffer,4,4))==='moov'&&size<=16*1024*1024){
        const v=new DataView(await blob.slice(p+head,p+size).arrayBuffer())
        const tracks=boxes(v).filter(b=>b.type==='trak')
        const hasAudio=tracks.some(track=>trackKind(v,track)==='soun')
        for(const trak of tracks){
          if(trackKind(v,trak)!=='vide')continue
          const encoded=encodedDimensions(v,trak)
          if(!encoded)continue
          const matrix=trackMatrix(v,trak)
          return {encoded,display:matrix===null?null:displayDimensions(v,matrix,encoded),hasAudio}
        }
        return null
      }
      p+=size
    }
  }catch{/* Unsupported header: do not infer dimensions from requested values. */}
  return null
}
export async function inspectMp4Dimensions(blob:Blob,orientation:'encoded'|'display'='encoded'):Promise<Dimensions|null>{
  const format=await inspectMp4Format(blob)
  return format?.[orientation]??null
}

/** Only the moov header changes. Encoded frames, offsets, timing and audio stay intact. */
async function updateVideoMatrix(blob:Blob,rewrite:(v:DataView,offset:number,width:number,height:number)=>void|false,message:string):Promise<Blob>{
  const invalid=()=>new Error(message)
  for(let p=0;p+8<=blob.size;){
    const header=new DataView(await blob.slice(p,p+16).arrayBuffer());let size=header.getUint32(0),head=8
    if(size===1){if(header.byteLength<16)throw invalid();size=Number(header.getBigUint64(8));head=16}
    if(size===0)size=blob.size-p
    if(size<head||p+size>blob.size||!Number.isSafeInteger(size))throw invalid()
    const type=String.fromCharCode(...new Uint8Array(header.buffer,4,4))
    if(type==='moov'){
      if(size>16*1024*1024)throw invalid()
      const data=await blob.slice(p+head,p+size).arrayBuffer(),v=new DataView(data);let found=false,changed=false
      for(const trak of boxes(v).filter(b=>b.type==='trak')){
        if(trackKind(v,trak)!=='vide')continue
        const m=trackMatrix(v,trak);if(m===null)throw invalid()
        const width=v.getUint32(m+36)/65536,height=v.getUint32(m+40)/65536
        const encoded=width&&height?null:encodedDimensions(v,trak)
        found=true
        if(rewrite(v,m,width||encoded?.width||0,height||encoded?.height||0)!==false)changed=true
      }
      if(!found)throw invalid()
      if(!changed)return blob
      return new Blob([blob.slice(0,p+head),data,blob.slice(p+size)],{type:blob.type})
    }
    p+=size
  }
  throw invalid()
}

/** Reflect after camera rotation, or apply a specific orientation if given. */
export function mirrorMp4(blob:Blob,mirrored?:boolean):Promise<Blob>{
  const message='这段视频的镜像信息无法处理，原始录像仍保留，可选择「原始方向」导出。'
  return updateVideoMatrix(blob,(v,m,width,height)=>{
    const a=v.getInt32(m),b=v.getInt32(m+4),c=v.getInt32(m+12),d=v.getInt32(m+16)
    const determinant=a*d-b*c
    if(determinant===0)throw new Error(message)
    const incomplete=v.getInt32(m+32)===0
    if(incomplete)v.setInt32(m+32,0x40000000)
    if(mirrored!==undefined&&(determinant<0)===mirrored)return incomplete?undefined:false
    if(!width||!height)throw new Error(message)
    const x=Math.round(v.getInt32(m+24)+a*width+c*height)
    if([x,-a,-c].some(value=>value< -2147483648||value>2147483647))throw new Error(message)
    v.setInt32(m,-a);v.setInt32(m+12,-c);v.setInt32(m+24,x)
  },message)
}

/** Apply only when calibration has identified a portrait front-camera file with a duplicate rotation. */
export async function normalizePortraitMp4(blob:Blob):Promise<Blob>{
  const format=await inspectMp4Format(blob)
  if(!format?.display||format.display.height>=format.display.width||format.encoded.height<=format.encoded.width)return blob
  const {width,height}=format.encoded
  return updateVideoMatrix(blob,(v,m)=>{
    v.setInt32(m,65536);v.setInt32(m+4,0);v.setInt32(m+12,0);v.setInt32(m+16,65536)
    v.setInt32(m+24,0);v.setInt32(m+28,0)
    v.setUint32(m+36,width*65536);v.setUint32(m+40,height*65536)
  },'无法修正这段视频的显示方向，原始录像仍保留。')
}
export async function inspectMp4(blob:Blob):Promise<{fps:number;frames:number;duration:number}|null>{
  try{
    let videoId=0,timescale=0,count=0,ticks=0,defaultDuration=0,minDts=Infinity,maxDts=0
    const fragments:DataView[]=[]
    for(let p=0;p+8<=blob.size;){
      const header=new DataView(await blob.slice(p,p+16).arrayBuffer())
      let size=header.getUint32(0),head=8
      if(size===1){size=Number(header.getBigUint64(8));head=16}
      if(!size)size=blob.size-p
      if(size<head||p+size>blob.size||!Number.isSafeInteger(size))return null
      const type=String.fromCharCode(...new Uint8Array(header.buffer,4,4))
      if((type==='moov'||type==='moof')&&size<=16*1024*1024){
        const v=new DataView(await blob.slice(p+head,p+size).arrayBuffer())
        if(type==='moof')fragments.push(v)
        else{
          for(const trak of boxes(v).filter(b=>b.type==='trak')){
            const mdia=children(v,trak).find(b=>b.type==='mdia');if(!mdia)continue
            const hdlr=children(v,mdia).find(b=>b.type==='hdlr')
            if(!hdlr||String.fromCharCode(...new Uint8Array(v.buffer,hdlr.data+8,4))!=='vide')continue
            const tkhd=children(v,trak).find(b=>b.type==='tkhd'),mdhd=children(v,mdia).find(b=>b.type==='mdhd')
            if(!tkhd||!mdhd)continue
            videoId=v.getUint32(tkhd.data+(v.getUint8(tkhd.data)===1?20:12))
            timescale=v.getUint32(mdhd.data+(v.getUint8(mdhd.data)===1?20:12))
            const minf=children(v,mdia).find(b=>b.type==='minf'),stbl=minf&&children(v,minf).find(b=>b.type==='stbl'),stts=stbl&&children(v,stbl).find(b=>b.type==='stts')
            if(stts){const entries=v.getUint32(stts.data+4);for(let i=0;i<entries;i++){const n=v.getUint32(stts.data+8+i*8),duration=v.getUint32(stts.data+12+i*8);count+=n;ticks+=n*duration}}
          }
          const mvex=boxes(v).find(b=>b.type==='mvex')
          if(mvex)for(const trex of children(v,mvex).filter(b=>b.type==='trex'))if(v.getUint32(trex.data+4)===videoId)defaultDuration=v.getUint32(trex.data+12)
        }
      }
      p+=size
    }
    for(const v of fragments)for(const traf of boxes(v).filter(b=>b.type==='traf')){
      const tfhd=children(v,traf).find(b=>b.type==='tfhd');if(!tfhd||v.getUint32(tfhd.data+4)!==videoId)continue
      const flags=v.getUint32(tfhd.data)&0xffffff
      let offset=tfhd.data+8;if(flags&1)offset+=8;if(flags&2)offset+=4
      const duration=flags&8?v.getUint32(offset):defaultDuration
      const tfdt=children(v,traf).find(b=>b.type==='tfdt'),before=ticks
      const base=tfdt?(v.getUint8(tfdt.data)===1?Number(v.getBigUint64(tfdt.data+4)):v.getUint32(tfdt.data+4)):null
      for(const trun of children(v,traf).filter(b=>b.type==='trun')){
        const f=v.getUint32(trun.data)&0xffffff,n=v.getUint32(trun.data+4);let cursor=trun.data+8
        if(f&1)cursor+=4;if(f&4)cursor+=4
        for(let i=0;i<n;i++){
          const d=f&0x100?v.getUint32(cursor):duration
          if(!d)return null
          ticks+=d;count++
          if(f&0x100)cursor+=4;if(f&0x200)cursor+=4;if(f&0x400)cursor+=4;if(f&0x800)cursor+=4
        }
      }
      if(base!==null){minDts=Math.min(minDts,base);maxDts=Math.max(maxDts,base+ticks-before)}
    }
    if(Number.isFinite(minDts))ticks=Math.max(ticks,maxDts-minDts)
    if(!count||!timescale||!ticks)return null
    return {fps:count/(ticks/timescale),frames:count,duration:ticks/timescale}
  }catch{return null}
}
