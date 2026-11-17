export type RecordedAudio='audible'|'silent'|'unknown'

export function hasAudibleSamples(pcm:Pick<AudioBuffer,'numberOfChannels'|'getChannelData'>){
  for(let channel=0;channel<pcm.numberOfChannels;channel++){
    const samples=pcm.getChannelData(channel)
    let hits=0
    // Ignore isolated encoder noise, but keep quiet speech above about -60 dBFS.
    for(let offset=0;offset<samples.length;offset+=4){
      if(Math.abs(samples[offset])>=0.001&&++hits>=24)return true
    }
  }
  return false
}

/** Decode short recordings only. Unsupported containers or a stalled decoder remain unknown. */
export async function checkRecordedAudio(blob:Blob):Promise<RecordedAudio>{
  if(!globalThis.OfflineAudioContext||blob.size>16*1024*1024)return 'unknown'
  let timer:ReturnType<typeof setTimeout>|undefined
  try{
    const context=new OfflineAudioContext(1,1,16_000)
    const decoded=await Promise.race([
      blob.arrayBuffer().then(buffer=>context.decodeAudioData(buffer)),
      new Promise<null>(resolve=>{timer=setTimeout(()=>resolve(null),2500)}),
    ])
    return decoded?hasAudibleSamples(decoded)?'audible':'silent':'unknown'
  }catch{return 'unknown'}
  finally{clearTimeout(timer)}
}
