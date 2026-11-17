import {test} from 'node:test'
import assert from 'node:assert/strict'
import {defaultSpeechModel,restoreSpeechModel,speechModels} from '../src/speech-model.ts'

test('保留三个本地免费流式模型，旧设置和非法值回退到当前默认',()=>{
  assert.equal(defaultSpeechModel,'zipformer')
  for(const model of Object.keys(speechModels))assert.equal(restoreSpeechModel(model),model)
  assert.equal(restoreSpeechModel('unknown'),defaultSpeechModel)
  assert.equal(restoreSpeechModel(null),defaultSpeechModel)
})
