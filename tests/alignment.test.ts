import {test} from 'node:test'
import assert from 'node:assert/strict'
import {locateSpeech,normalize,splitCues} from '../src/alignment.ts'
const script='今天想和你分享一个自然口播的小方法。先把想说的话写下来，再用自己的节奏读出来。停下来想一想，提词会在这里等你。如果说错了，就从刚才那一句重新开始。'
test('正常照读推进到对应原文位置',()=>{const result=locateSpeech(script,'今天想和你分享一个自然口播的小方法',0);assert.ok(result.matched);assert.equal(result.position,17)})
test('标点、空格、大小写、数字常见读法归一化',()=>{assert.equal(normalize('iPhone 15，拍摄60帧。').text,normalize('IPHONE十五拍摄六十帧').text);assert.equal(normalize('两个人').text,normalize('二个人').text)})
test('少量漏字仍能找到附近原稿',()=>{const result=locateSpeech(script,'先把想说的话下来再用自己节奏读出来',20);assert.ok(result.matched);assert.ok(result.position>35)})
test('少量口头语不会导致全文跳转',()=>{const result=locateSpeech(script,'先把想说的话嗯写下来',20);assert.ok(result.matched);assert.equal(result.position,script.indexOf('写下来')+3)})
test('停顿和无关内容保持当前位置',()=>{for(const text of ['', '嗯', '附近餐厅今天晚上几点关门营业'])assert.equal(locateSpeech(script,text,30).position,30)})
test('允许回读附近上一句',()=>{const result=locateSpeech(script,'先把想说的话写下来',44);assert.ok(result.matched);assert.ok(result.position<44)})
test('连续识别保留旧文字时也能回读定位',()=>{const result=locateSpeech(script,'再用自己的节奏读出来先把想说的话写下来',44);assert.ok(result.matched);assert.equal(result.position,script.indexOf('写下来')+3)})
test('重复短句优先当前附近，不跳远处',()=>{const repeated='今天我们一起试试。这里有一些内容。今天我们一起试试。';const result=locateSpeech(repeated,'今天我们一起试试',0);assert.equal(result.position,8)})
test('跨多段不自动追到稿件远处',()=>{const long=script+'中间有很多不一样的内容。'.repeat(20)+'最后我们来聊一聊如何制作视频。';assert.equal(locateSpeech(long,'最后我们来聊一聊如何制作视频',0).matched,false)})
test('中文句段保留可映射的源文字位置',()=>{const source='  第一段。\n第二段！';for(const cue of splitCues(source))assert.equal(source.slice(cue.start,cue.end).trim(),cue.text)})

test('首批两三个字即可推进，不必等待整句',()=>{assert.equal(locateSpeech(script,'今天',0).position,2);assert.equal(locateSpeech(script,'今天想',2).position,3)})
test('开头口头语不阻塞短句起步，仍不改写原始转写',()=>{const heard='嗯今天';assert.equal(locateSpeech(script,heard,0).position,2);assert.equal(heard,'嗯今天')})
test('短词不会回退，也不追到远处或重复推进相同内容',()=>{
  assert.equal(locateSpeech('今天我们今天再试一次。','今天',2).position,2)
  assert.equal(locateSpeech(script,'今天',30).position,30)
  assert.equal(locateSpeech(script,'嗯啊',0).matched,false)
  assert.equal(locateSpeech(script,'读出来',0).matched,false)
})
test('连续部分结果在同一句内持续推进',()=>{let position=0;for(const heard of ['今天','今天想和你','今天想和你分享一个','今天想和你分享一个自然口播','今天想和你分享一个自然口播的小方法']){const match=locateSpeech(script,heard,position);assert.ok(match.matched);assert.ok(match.position>position);position=match.position}assert.equal(position,17)})
test('累积识别文本跨句时，下一句首字和前两字都能就近交接',()=>{
  const first='今天想和你分享一个自然口播的小方法'
  let position=16
  for(const tail of ['先','先把','先把想']){
    const match=locateSpeech(script,first+tail,position,true)
    assert.ok(match.matched)
    assert.ok(match.position>position,`${tail} 到来后应立即向前`)
    position=match.position
  }
  assert.ok(position>=script.indexOf('先把想')+3)
})
test('较长识别结果尾部只有四字可靠时仍能找回附近原稿',()=>{const source='现在我们开始测试，请保持自然的节奏，把想说的内容清楚表达出来。';const position=source.indexOf('把想');const result=locateSpeech(source,'无法辨认的声音内容清楚表达',position);assert.equal(result.matched,true);assert.equal(result.position,source.indexOf('清楚表达')+4)})
test('无关话语仅以同样四个字结尾时，不越过两句稿件',()=>{
  const source='各位好。'+'接着讲拍摄步骤，把相机固定在桌面，打开收音，然后选择合适的光线。'.repeat(2)+'大家注意，接下来开始录制。'
  assert.equal(locateSpeech(source,'旁边的人正在问今天下午是否还要开会大家注意',0).position,0)
})
test('模拟识别漏掉助词并插入两个字后，结尾仍能推进',()=>{const source='第一句是加了一般现在时。',result=locateSpeech(source,'第一句加了一般现在后半时',10);assert.ok(result.matched);assert.equal(result.position,source.indexOf('时')+1)})
test('有至少三个原字作锚点时，附近同音字也能跟到正确行尾',()=>{
  const source='今天讲清楚。现在开始。'
  const start=source.indexOf('现在')
  assert.equal(locateSpeech(source,'现再开始',start).matched,false)
  assert.equal(locateSpeech(source,'现再开始',start,true).position,source.indexOf('。',start))
})
test('拼音接近但声调不同、字太少或匹配位置太远时不会误跳',()=>{
  const source='开场。'+'请把相机放稳之后看向镜头。'.repeat(3)+'现在开始。'
  assert.equal(locateSpeech(source,'现再开始',0,true).position,0)
  assert.equal(locateSpeech('现在开始。','现再开',0,true).position,0)
  assert.equal(locateSpeech('现在开始。','现灾开始',0,true).position,0)
})
