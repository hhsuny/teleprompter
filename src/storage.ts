import type {CameraPreferences} from './preferences'
export type Draft={id:string;title:string;text:string;updatedAt:number}
export type Settings={fontSize:number;width:number;opacity:number;top:number;speed:number;layoutVersion?:number}
export type Take={id:string;title:string;createdAt:number;mime:string;status:'recording'|'ready'|'interrupted';duration:number;bytes:number;width?:number;height?:number;fps?:number;targetFps?:number;measured?:boolean;zoom?:number;zoomMethod?:'original'|'hardware'|'digital'|'downscale';mirrored?:boolean;pixelsMirrored?:boolean;portraitCorrection?:boolean;bitrate?:number;favorite?:boolean;thumbnail?:string;saveError?:string}
let database:Promise<IDBDatabase>|undefined
function db(){
  if(database)return database
  database=new Promise<IDBDatabase>((resolve,reject)=>{
    const request=indexedDB.open('jing-tou-qian',1)
    request.onupgradeneeded=()=>{const d=request.result;d.createObjectStore('drafts',{keyPath:'id'});d.createObjectStore('settings');d.createObjectStore('takes',{keyPath:'id'});d.createObjectStore('chunks',{keyPath:['takeId','index']})}
    request.onsuccess=()=>{const connection=request.result;connection.onclose=()=>{database=undefined};resolve(connection)}
    request.onerror=()=>reject(request.error)
  }).catch(error=>{database=undefined;throw error})
  return database
}
async function run<T>(store:string,mode:IDBTransactionMode,action:(s:IDBObjectStore)=>IDBRequest<T>):Promise<T>{
  const d=await db()
  return new Promise((resolve,reject)=>{const t=d.transaction(store,mode);let result:T;const req=action(t.objectStore(store));req.onsuccess=()=>{result=req.result};t.oncomplete=()=>resolve(result);t.onerror=()=>reject(t.error||req.error);t.onabort=()=>reject(t.error||new Error('本机存储写入被中断'))})
}
export const allDrafts=()=>run<Draft[]>('drafts','readonly',s=>s.getAll())
export const saveDraft=(draft:Draft)=>run('drafts','readwrite',s=>s.put(draft))
export const deleteDraft=(id:string)=>run('drafts','readwrite',s=>s.delete(id))
export const readSettings=()=>run<Settings|undefined>('settings','readonly',s=>s.get('display'))
export const saveSettings=(settings:Settings)=>run('settings','readwrite',s=>s.put(settings,'display'))
export const readCameraPreferences=()=>run<Partial<CameraPreferences>|undefined>('settings','readonly',s=>s.get('camera'))
export const saveCameraPreferences=(settings:CameraPreferences)=>run('settings','readwrite',s=>s.put(settings,'camera'))
export const allTakes=()=>run<Take[]>('takes','readonly',s=>s.getAll())
export const saveTake=(take:Take)=>run('takes','readwrite',s=>s.put(take))
// Read and patch in one transaction so a late thumbnail cannot undo a favorite.
export async function patchTake(id:string,patch:Partial<Pick<Take,'title'|'favorite'|'thumbnail'|'mirrored'|'width'|'height'|'fps'|'measured'>>){
  const d=await db()
  return new Promise<void>((resolve,reject)=>{
    const t=d.transaction('takes','readwrite'),store=t.objectStore('takes'),request=store.get(id)
    request.onsuccess=()=>{if(request.result)store.put({...request.result,...patch})}
    t.oncomplete=()=>resolve();t.onerror=()=>reject(t.error);t.onabort=()=>reject(t.error)
  })
}
export async function saveChunk(takeId:string,index:number,data:Blob,progress:Take){
  const d=await db()
  return new Promise<number>((resolve,reject)=>{
    const t=d.transaction(['chunks','takes'],'readwrite')
    t.objectStore('chunks').put({takeId,index,data})
    t.objectStore('takes').put(progress)
    t.oncomplete=()=>resolve(index);t.onabort=()=>reject(t.error??new Error('本机存储写入被中断'))
  })
}
export async function takeBlob(take:Take){
  const chunks=await run<{takeId:string;index:number;data:Blob}[]>('chunks','readonly',s=>s.getAll(IDBKeyRange.bound([take.id,0],[take.id,Number.MAX_SAFE_INTEGER])))
  if(!chunks.length)throw new Error('没有可导出的片段；中断的录制可能无法恢复。')
  return new Blob(chunks.map(x=>x.data),{type:take.mime})
}
export async function deleteTake(id:string){
  const d=await db()
  return new Promise<void>((resolve,reject)=>{
    const t=d.transaction(['chunks','takes'],'readwrite')
    t.objectStore('chunks').delete(IDBKeyRange.bound([id,0],[id,Number.MAX_SAFE_INTEGER]))
    t.objectStore('takes').delete(id)
    t.oncomplete=()=>resolve();t.onabort=()=>reject(t.error??new Error('本机删除被中断'))
  })
}
export function storageError(e:unknown){return e instanceof DOMException&&e.name==='QuotaExceededError'?'手机存储空间不足，请先导出并删除旧录像。':e instanceof Error?e.message:'本机存储不可用，请退出无痕浏览后重试。'}
