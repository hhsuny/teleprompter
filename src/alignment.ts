export type Cue = { text: string; start: number; end: number }
export function splitCues(text: string): Cue[] {
  const cues: Cue[] = []
  const re = /[^。！？!?；;\n]{1,32}[。！？!?；;\n]?|[。！？!?；;\n]/gu
  for (const m of text.matchAll(re)) if (m[0].trim()) cues.push({text:m[0].trim(), start:m.index!, end:m.index!+m[0].length})
  return cues
}
function spokenNumber(input: string) {
  if (input.length > 4 || (input.length > 1 && input[0] === '0')) return [...input].map(x=>'零一二三四五六七八九'[+x]).join('')
  const n = +input
  if (!n) return '零'
  const units = ['', '十', '百', '千']; let result = ''; let zero = false
  for (let i=input.length-1;i>=0;i--) {
    const digit = +input[input.length-1-i]
    if (digit) { if (zero) result+='零'; result+='零一二三四五六七八九'[digit]+units[i]; zero=false }
    else if (result) zero=true
  }
  return result.replace(/^一十/,'十')
}
export function normalize(text: string): {text:string; offsets:number[]} {
  let out=''; const offsets:number[]=[]
  for (const m of text.matchAll(/[0-9０-９]+|./gu)) {
    const value=m[0].normalize('NFKC').toLowerCase()
    const normalized=/^\d+$/.test(value)?spokenNumber(value):value.replace(/两/g,'二').replace(/〇/g,'零').replace(/[^\p{L}\p{N}]/gu,'')
    out+=normalized
    for(let i=0;i<normalized.length;i++) offsets.push(m.index!+m[0].length)
  }
  return {text:out,offsets}
}
export type Match = {position:number; confidence:number; matched:boolean}
/** Semi-global edit distance in a bounded neighborhood; ambiguous/unrelated speech stays put. */
export function locateSpeech(script:string, heard:string, position:number, soundMatch=false):Match {
  // Ignore leading spoken fillers for positioning only. The raw transcript is
  // still displayed and scored unchanged in recognition accuracy checks.
  const manuscript=normalize(script), recent=normalize(heard).text.replace(/^[嗯啊呃哦]+/u,'').slice(-24)
  const unchanged={position,confidence:0,matched:false}
  if(recent.length<2 || !manuscript.text) return unchanged
  const p=manuscript.offsets.findIndex(x=>x>=position)
  const center=p<0?manuscript.text.length:Math.max(0,p)
  // A brief exact phrase can move the first line immediately. Keep short matches
  // close and forward-only so fillers and common words cannot rewind the script.
  if(recent.length<4){
    if(/^[嗯啊呃哦呀哈]+$/u.test(recent))return unchanged
    const limit=recent.length===2?8:12
    const local=manuscript.text.slice(Math.max(0,center-recent.length),center+limit)
    const candidates=[...local.matchAll(new RegExp(recent,'gu'))].map(match=>manuscript.offsets[Math.max(0,center-recent.length)+match.index!+recent.length-1]).filter(next=>next>=position&&next<=position+limit)
    return candidates.length===1&&candidates[0]>position?{position:candidates[0],confidence:1,matched:true}:unchanged
  }
  const start=Math.max(0,center-64), end=Math.min(manuscript.text.length,center+110)
  const target=manuscript.text.slice(start,end)
  // When someone repeats a sentence, the recognizer can retain earlier words.
  // Retry shorter, more exact suffixes rather than jumping outside this window.
  const queries=[recent,...[16,10,6,4].filter(n=>n<recent.length).map(n=>recent.slice(-n))]
  for(const query of queries){
  let previous=Array(target.length+1).fill(0) as number[]
  for(let i=1;i<=query.length;i++) {
    const row=[i]
    for(let j=1;j<=target.length;j++) row[j]=Math.min(row[j-1]+1,previous[j]+1,previous[j-1]+(query[i-1]===target[j-1]?0:1))
    previous=row
  }
  const candidates=[] as {score:number; confidence:number; position:number}[]
  for(let j=1;j<=target.length;j++) {
    const confidence=1-previous[j]/query.length
    const next=manuscript.offsets[start+j-1]
    // A common short suffix is not evidence for skipping a sentence. Longer
    // results still support nearby repeats; short tails only recover locally.
    if(query.length<=6 && (next>position+16 || next<position-12))continue
    // Real streaming results sometimes omit a particle and insert a couple of
    // words. A longer phrase with a matching last character may recover nearby
    // forward progress; rewinds and short suffixes keep the stricter threshold.
    const forwardTail=query.length>=10&&next>=position&&next<=position+48&&target[j-1]===query.at(-1)
    const minimum=query===recent?(forwardTail?0.72:0.76):query.length<=6?1:0.9
    if(confidence<minimum || next>position+90 || next<position-55) continue
    candidates.push({position:next,confidence,score:confidence-Math.abs(next-position)*0.0015})
  }
  candidates.sort((a,b)=>b.score-a.score)
  const best=candidates[0]
  if(!best) continue
  // Prefer nearby occurrences of repeated phrases; never seek the entire manuscript.
  return {position:best.position,confidence:best.confidence,matched:true}
  }
  if(soundMatch){
    const near=homophoneMatch(manuscript,recent,center,position)
    if(near)return near
  }
  return unchanged
}
import {pinyin} from 'pinyin-pro'


// Rescue a short, nearby phrase with identical Mandarin syllables and tones.
// Require exact characters as anchors, and reject multiple plausible positions.
function homophoneMatch(manuscript:ReturnType<typeof normalize>,recent:string,center:number,position:number):Match|undefined{
  const query=recent.slice(-10)
  if(query.length<4||!/^[\p{Script=Han}]+$/u.test(query)||[...query].length!==query.length)return
  const start=Math.max(0,center-26)
  const local=manuscript.text.slice(start,center+24)
  if([...local].length!==local.length)return
  const spoken=pinyin(query,{toneType:'num',type:'array',toneSandhi:false})
  const written=pinyin(local,{toneType:'num',type:'array',toneSandhi:false})
  const matches:number[]=[]
  for(let i=0;i<=local.length-query.length;i++){
    const next=manuscript.offsets[start+i+query.length-1]
    if(next<=position||next>position+18)continue
    const phrase=local.slice(i,i+query.length)
    if(!/^[\p{Script=Han}]+$/u.test(phrase))continue
    let substitutions=0
    for(let j=0;j<query.length;j++){
      if(query[j]===phrase[j])continue
      if(spoken[j]!==written[i+j]){substitutions=Infinity;break}
      substitutions++
    }
    if(substitutions>=1&&substitutions<=Math.min(2,query.length-3))matches.push(next)
  }
  return matches.length===1?{position:matches[0],confidence:0.8,matched:true}:undefined
}
