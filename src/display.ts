import type {Settings} from './storage'

export const defaultSettings:Settings={fontSize:36,width:94,opacity:48,top:0,speed:4,layoutVersion:2}
export function restoreDisplay(saved?:Settings):Settings{
  if(!saved)return {...defaultSettings}
  if(saved.layoutVersion===2)return {...defaultSettings,...saved}
  // Migrate only former defaults; keep a user's deliberate display adjustments.
  return {...defaultSettings,...saved,fontSize:saved.fontSize===32?36:saved.fontSize,width:saved.width===90?94:saved.width,opacity:saved.opacity===65?48:saved.opacity,top:saved.top===7?0:saved.top,layoutVersion:2}
}
