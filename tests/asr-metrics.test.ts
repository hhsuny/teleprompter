import {test} from 'node:test'
import assert from 'node:assert/strict'
import {transcriptionErrors} from '../scripts/asr-metrics.mjs'
test('字错误率统计插入漏字和替换，不以稿件定位成功冒充准确率',()=>{assert.equal(transcriptionErrors('今天开始拍摄','今天开始拍色').errors,1);assert.equal(transcriptionErrors('今天开始拍摄','今天就开始拍摄').errors,1);assert.equal(transcriptionErrors('今天开始拍摄','今天拍摄').errors,2)})
test('字错误率忽略标点空白但不偷偷改词，空参考不生成虚假准确率',()=>{assert.equal(transcriptionErrors('iPhone，提词器。','IPHONE 提词器').cer,0);assert.equal(transcriptionErrors('提词器','题词器').errors,1);assert.equal(transcriptionErrors('','文字').cer,null)})
