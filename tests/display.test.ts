import {test} from 'node:test'
import assert from 'node:assert/strict'
import {defaultSettings,restoreDisplay} from '../src/display.ts'

test('旧版默认显示迁移到镜头附近，保留用户的速度偏好',()=>{const result=restoreDisplay({fontSize:32,width:90,opacity:65,top:7,speed:5});assert.equal(result.top,0);assert.equal(result.fontSize,36);assert.equal(result.width,94);assert.equal(result.speed,5);assert.equal(result.layoutVersion,2)})
test('自定义位置与字号不会在刷新后被强制覆盖',()=>{const custom={fontSize:44,width:80,opacity:35,top:12,speed:3};assert.deepEqual(restoreDisplay(custom),{...custom,layoutVersion:2});const updated={...defaultSettings,fontSize:32,top:7};assert.deepEqual(restoreDisplay(updated),updated)})
