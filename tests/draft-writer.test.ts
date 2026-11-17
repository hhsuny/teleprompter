import {test} from 'node:test'
import assert from 'node:assert/strict'
import {DraftWriter,draftToUse} from '../src/draft-writer.ts'

test('改完立即使用同一份稿件时，用编辑器内容覆盖排队中的旧保存',async t=>{
  t.mock.timers.enable({apis:['setTimeout']})
  const old={id:'script',title:'旧标题',text:'旧稿',updatedAt:1}
  const current={...old,title:'新标题',text:'刚粘贴的新稿',updatedAt:2}
  let saved=old
  const writer=new DraftWriter(async value=>{saved=value})
  writer.schedule(old,error=>{throw error})
  await writer.flush(draftToUse(current,old))
  t.mock.timers.tick(500)
  assert.deepEqual(saved,current)
})
