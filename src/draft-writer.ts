import type {Draft} from './storage.ts'

/** Serialize autosaves and explicit saves; a flush cancels the pending debounce. */
export class DraftWriter {
  private queue:Promise<unknown>=Promise.resolve()
  private timer:ReturnType<typeof setTimeout>|undefined
  private write:(draft:Draft)=>Promise<unknown>
  constructor(write:(draft:Draft)=>Promise<unknown>){this.write=write}
  cancel(){clearTimeout(this.timer);this.timer=undefined}
  schedule(draft:Draft,onError:(error:unknown)=>void,delay=350){
    this.cancel()
    this.timer=setTimeout(()=>{this.timer=undefined;void this.flush(draft).catch(onError)},delay)
  }
  flush(draft:Draft){
    this.cancel()
    const result=this.queue.then(()=>this.write(draft))
    this.queue=result.catch(()=>{})
    return result
  }
  async remove(id:string,remove:(id:string)=>Promise<unknown>){
    this.cancel()
    const result=this.queue.then(()=>remove(id))
    this.queue=result.catch(()=>{})
    await result
  }
}

export function draftToUse(current:Draft,target:Draft){return current.id===target.id?current:target}
