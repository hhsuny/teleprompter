export type SpeechModel='paraformer'|'mandarin'|'zipformer'
export const defaultSpeechModel:SpeechModel='zipformer'

export const speechModels={
  paraformer:{label:'中文增强（适合中英混读）',size:226},
  mandarin:{label:'轻量普通话',size:25},
  zipformer:{label:'中文流式 Transducer（默认）',size:30},
} as const

export function restoreSpeechModel(value:unknown):SpeechModel{
  return value==='paraformer'||value==='mandarin'||value==='zipformer'?value:defaultSpeechModel
}
