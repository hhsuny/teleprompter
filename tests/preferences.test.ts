import {test} from 'node:test'
import assert from 'node:assert/strict'
import {cameraDefaults,restoreCamera} from '../src/preferences.ts'

test('旧版预览切到填满屏幕，允许用户再次选择完整构图',()=>{
  assert.deepEqual(restoreCamera(),cameraDefaults)
  assert.equal(restoreCamera().recordMirror,true)
  assert.equal(restoreCamera({recordMirror:false}).recordMirror,true)
  assert.equal(restoreCamera({previewFit:'contain'}).previewFit,'cover')
  assert.equal(restoreCamera({...cameraDefaults,previewFit:'contain'}).previewFit,'contain')
})
test('保留明确选择，恢复无效码率、倒计时与外观',()=>{const valid={...cameraDefaults,previewMirror:false,recordMirror:false,bitrate:27_000_000,countdown:0,theme:'dark' as const};assert.deepEqual(restoreCamera(valid),valid);const invalid=restoreCamera({bitrate:-1,countdown:99,previewFit:'unknown',theme:'unknown'} as never);assert.equal(invalid.bitrate,16_000_000);assert.equal(invalid.countdown,3);assert.equal(invalid.previewFit,'cover');assert.equal(invalid.theme,'light')})


test('拍摄规格持久化并兼容旧设置，非法倍率和帧率恢复为原画默认',()=>{
  const valid={...cameraDefaults,resolution:'4k' as const,fps:30 as const,facing:'environment' as const,zoom:3 as const,grid:true}
  assert.deepEqual(restoreCamera(valid),valid)
  const invalid=restoreCamera({resolution:'8k',fps:120,facing:'unknown',zoom:0,grid:'true'} as never)
  assert.equal(invalid.resolution,'1080p');assert.equal(invalid.fps,60);assert.equal(invalid.facing,'user');assert.equal(invalid.zoom,1);assert.equal(invalid.grid,false)
})
