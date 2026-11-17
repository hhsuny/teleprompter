export function transcriptionErrors(reference,hypothesis){
  const clean=text=>[...String(text).normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu,'')]
  const expected=clean(reference),actual=clean(hypothesis)
  let row=Array.from({length:actual.length+1},(_,index)=>index)
  for(let i=1;i<=expected.length;i++){
    const next=[i]
    for(let j=1;j<=actual.length;j++)next[j]=Math.min(next[j-1]+1,row[j]+1,row[j-1]+(expected[i-1]===actual[j-1]?0:1))
    row=next
  }
  return {referenceCharacters:expected.length,errors:row[actual.length],cer:expected.length?row[actual.length]/expected.length:null}
}
