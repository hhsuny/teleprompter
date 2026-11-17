import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {inspectMp4,inspectMp4Dimensions,inspectMp4Format,mirrorMp4,normalizePortraitMp4} from '../src/mp4.ts'
test('从文件时间表读出真实60帧，而非使用相机请求值',async()=>{const file=await readFile(new URL('./fixtures/60fps.mp4',import.meta.url));assert.deepEqual(await inspectMp4(new Blob([file])),{fps:60,frames:60,duration:1})})
test('支持Safari常见的分片MP4，并识别低于目标的30帧文件',async()=>{const file=await readFile(new URL('./fixtures/30fps-fragmented.mp4',import.meta.url));assert.deepEqual(await inspectMp4(new Blob([file])),{fps:30,frames:30,duration:1})})
test('按指定方向导出时不会把已经镜像的矩阵再翻一次',async()=>{
  const original=new Blob([await readFile(new URL('./fixtures/60fps.mp4',import.meta.url))])
  assert.equal(await mirrorMp4(original,false),original)
  const mirrored=await mirrorMp4(original,true)
  assert.equal(await mirrorMp4(mirrored,true),mirrored)
  assert.deepEqual(Buffer.from(await (await mirrorMp4(mirrored,false)).arrayBuffer()),Buffer.from(await original.arrayBuffer()))
})
test('处理浏览器生成画面中缺少最后一项的单位显示矩阵，导出时补齐',async()=>{
  const file=await readFile(new URL('./fixtures/60fps.mp4',import.meta.url))
  const header=file.indexOf('tkhd')+4,matrix=header+(file[header]===1?52:40)
  file.writeInt32BE(0,matrix+32)
  const clip=new Blob([file]),fixed=await mirrorMp4(clip,false)
  assert.deepEqual(await inspectMp4Dimensions(clip,'display'),{width:1080,height:1920})
  assert.equal(Buffer.from(await fixed.arrayBuffer()).readInt32BE(matrix+32),0x40000000)
  assert.deepEqual(await inspectMp4(clip),await inspectMp4(fixed))
})
test('录制的 MP4 轨道头未写尺寸时，沿用实际编码宽度写入镜像',async()=>{
  const file=await readFile(new URL('./fixtures/30fps-fragmented.mp4',import.meta.url))
  const matrix=file.indexOf('tkhd')+4+40
  file.writeUInt32BE(0,matrix+36);file.writeUInt32BE(0,matrix+40)
  const input=new Blob([file]),mirrored=await mirrorMp4(input,true)
  const bytes=Buffer.from(await mirrored.arrayBuffer())
  assert.equal(bytes.readInt32BE(matrix+24),1080*65536)
  assert.deepEqual(await inspectMp4(mirrored),await inspectMp4(input))
  assert.deepEqual(bytes.subarray(matrix+44),file.subarray(matrix+44))
})
test('损坏或不支持的视频不伪造帧率',async()=>{assert.equal(await inspectMp4(new Blob(['not an mp4'])),null)})

test('镜像真实MP4只修改显示矩阵，帧率、长度与压缩帧保持不变；镜像两次还原',async()=>{
  for(const name of ['60fps.mp4','30fps-fragmented.mp4']){
    const original=await readFile(new URL(`./fixtures/${name}`,import.meta.url)),blob=new Blob([original],{type:'video/mp4'}),mirrored=await mirrorMp4(blob),result=Buffer.from(await mirrored.arrayBuffer())
    assert.equal(mirrored.size,blob.size);assert.deepEqual(await inspectMp4(mirrored),await inspectMp4(blob))
    const matrix=original.indexOf('tkhd')+4+40,width=original.readUInt32BE(matrix+36)/65536
    assert.equal(result.readInt32BE(matrix),-65536);assert.equal(result.readInt32BE(matrix+24),width*65536)
    // All bytes outside the matrix are identical, including every mdat sample.
    assert.deepEqual(result.subarray(0,matrix),original.subarray(0,matrix));assert.deepEqual(result.subarray(matrix+36),original.subarray(matrix+36))
    assert.deepEqual(Buffer.from(await (await mirrorMp4(mirrored)).arrayBuffer()),original)
  }
})
test('已旋转的竖屏轨道在显示坐标中左右翻转，保留原本的旋转方向',async()=>{
  const source=await readFile(new URL('./fixtures/60fps.mp4',import.meta.url)),matrix=source.indexOf('tkhd')+4+40,width=source.readUInt32BE(matrix+36)/65536,height=source.readUInt32BE(matrix+40)/65536
  source.writeInt32BE(0,matrix);source.writeInt32BE(65536,matrix+4);source.writeInt32BE(-65536,matrix+12);source.writeInt32BE(0,matrix+16);source.writeInt32BE(height*65536,matrix+24)
  const result=Buffer.from(await (await mirrorMp4(new Blob([source],{type:'video/mp4'}))).arrayBuffer())
  assert.equal(result.readInt32BE(matrix+12),65536);assert.equal(result.readInt32BE(matrix+24),0)
  const point=(bytes:Buffer,x:number,y:number)=>[bytes.readInt32BE(matrix)/65536*x+bytes.readInt32BE(matrix+12)/65536*y+bytes.readInt32BE(matrix+24)/65536,bytes.readInt32BE(matrix+4)/65536*x+bytes.readInt32BE(matrix+16)/65536*y+bytes.readInt32BE(matrix+28)/65536]
  for(const [x,y] of [[0,0],[width,0],[0,height],[width,height],[width/3,height/4]]){const before=point(source,x,y),after=point(result,x,y);assert.equal(after[0],height-before[0]);assert.equal(after[1],before[1])}
})
test('不支持的视频明确报错，保留原始数据而非伪装成镜像',async()=>{await assert.rejects(()=>mirrorMp4(new Blob(['broken'])),/原始录像仍保留/)})
test('支持64位时间字段的version 1轨道头，音轨矩阵不变',async()=>{
  const box=(type:string,payload:Buffer)=>{const header=Buffer.alloc(8);header.writeUInt32BE(payload.length+8);header.write(type,4);return Buffer.concat([header,payload])}
  const track=(handler:string)=>{const tkhd=Buffer.alloc(96);tkhd[0]=1;tkhd.writeInt32BE(65536,52);tkhd.writeInt32BE(65536,68);tkhd.writeInt32BE(0x40000000,84);tkhd.writeUInt32BE(1080*65536,88);tkhd.writeUInt32BE(1920*65536,92);const hdlr=Buffer.alloc(12);hdlr.write(handler,8);return box('trak',Buffer.concat([box('tkhd',tkhd),box('mdia',box('hdlr',hdlr))]))}
  const video=track('vide'),audio=track('soun'),original=Buffer.concat([box('moov',Buffer.concat([video,audio])),box('mdat',Buffer.from('unchanged media'))]),result=Buffer.from(await (await mirrorMp4(new Blob([original],{type:'video/mp4'}))).arrayBuffer())
  const m=original.indexOf('tkhd')+4+52;assert.equal(result.readInt32BE(m),-65536);assert.equal(result.readInt32BE(m+24),1080*65536);assert.deepEqual(result.subarray(8+video.length),original.subarray(8+video.length))
})


test('从实际编码样本读取尺寸，不能用请求的分辨率替代文件分辨率',async()=>{
  for(const name of ['60fps.mp4','30fps-fragmented.mp4']){
    const file=await readFile(new URL('./fixtures/'+name,import.meta.url));const dimensions=await inspectMp4Dimensions(new Blob([file]))
    assert.deepEqual(dimensions,{width:1080,height:1920})
  }
  assert.equal(await inspectMp4Dimensions(new Blob(['not mp4'])),null)
})
test('竖屏成片用 MP4 显示矩阵判断，横向编码加 90 度旋转仍是竖屏',async()=>{
  const file=await readFile(new URL('./fixtures/60fps.mp4',import.meta.url))
  const sample=file.indexOf('avc1',file.indexOf('stsd'))-4,matrix=file.indexOf('tkhd')+4+40
  file.writeUInt16BE(1920,sample+32);file.writeUInt16BE(1080,sample+34)
  assert.deepEqual(await inspectMp4Dimensions(new Blob([file]),'display'),{width:1920,height:1080})
  file.writeInt32BE(0,matrix);file.writeInt32BE(65536,matrix+4);file.writeInt32BE(-65536,matrix+12);file.writeInt32BE(0,matrix+16)
  const rotated=new Blob([file],{type:'video/mp4'})
  assert.deepEqual(await inspectMp4Dimensions(rotated),{width:1920,height:1080})
  assert.deepEqual(await inspectMp4Dimensions(rotated,'display'),{width:1080,height:1920})
  assert.deepEqual(await inspectMp4Dimensions(await mirrorMp4(rotated),'display'),{width:1080,height:1920})
  assert.equal(await normalizePortraitMp4(rotated),rotated)
})
test('校正竖屏编码上的重复旋转，保持视频样本及帧率',async()=>{
  const file=await readFile(new URL('./fixtures/60fps.mp4',import.meta.url))
  const matrix=file.indexOf('tkhd')+4+40
  file.writeInt32BE(0,matrix);file.writeInt32BE(65536,matrix+4);file.writeInt32BE(-65536,matrix+12);file.writeInt32BE(0,matrix+16)
  const rotated=new Blob([file],{type:'video/mp4'})
  assert.deepEqual(await inspectMp4Format(rotated),{encoded:{width:1080,height:1920},display:{width:1920,height:1080},hasAudio:false})
  const upright=await normalizePortraitMp4(rotated),result=Buffer.from(await upright.arrayBuffer())
  assert.deepEqual(await inspectMp4Dimensions(upright,'display'),{width:1080,height:1920})
  assert.deepEqual(await inspectMp4(upright),await inspectMp4(rotated))
  assert.deepEqual(result.subarray(matrix+44),file.subarray(matrix+44))
})
