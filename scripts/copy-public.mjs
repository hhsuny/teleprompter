import {cp} from 'node:fs/promises'
import {resolve,relative,sep} from 'node:path'

const source=resolve(import.meta.dirname,'../public'),target=resolve(import.meta.dirname,'../.cache/web')
// Ship the three selectable models. Keep the original bilingual model for benchmarks.
await cp(source,target,{recursive:true,filter:path=>{
  const parts=relative(source,path).split(sep)
  return parts[0]!=='models'||parts.length===1||['paraformer','mandarin','zipformer'].includes(parts[1])
}})
