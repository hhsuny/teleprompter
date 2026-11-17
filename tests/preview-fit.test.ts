import {test} from 'node:test'
import assert from 'node:assert/strict'
import {previewFrame} from '../src/preview-fit.ts'
test('竖屏完整取景先保留9比16裁切窗口，变焦不会吃掉上下不同范围',()=>{
  const frame=previewFrame(393,852,1080,1920,'contain')!
  assert.equal(frame.width,393);assert.ok(Math.abs(frame.height-698.6666667)<.001)
  const wide=previewFrame(852,393,1080,1920,'contain')!
  assert.equal(wide.height,393);assert.ok(Math.abs(wide.width-221.0625)<.001)
})
test('填满屏幕与暂时隐藏的预览按明确规则处理',()=>{
  assert.deepEqual(previewFrame(393,852,2160,3840,'cover'),{width:393,height:852})
  assert.equal(previewFrame(0,0,1080,1920,'contain'),null)
})
