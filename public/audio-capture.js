// Capture once; the original MediaStream also feeds MediaRecorder.
class CaptureProcessor extends AudioWorkletProcessor {
  constructor(){super();this.buffer=new Float32Array(1600);this.count=0;this.phase=0;this.total=0;this.sum=0;this.samples=0;this.sent=0}
  process(inputs,outputs){
    const channels=inputs[0]
    if(!channels?.[0])return true
    let square=0
    for(let i=0;i<channels[0].length;i++){
      let value=0;for(const channel of channels)value+=channel[i]/channels.length
      square+=value*value
      this.sum+=value;this.samples++;this.phase+=16000
      if(this.phase>=sampleRate){this.phase-=sampleRate;this.buffer[this.count++]=this.sum/this.samples;this.sum=0;this.samples=0}
      if(this.count===this.buffer.length){
        const samples=this.buffer
        this.port.postMessage({type:'audio',samples},[samples.buffer]);this.buffer=new Float32Array(1600);this.count=0
      }
    }
    this.total+=channels[0].length
    if(this.total-this.sent>sampleRate/10){this.sent=this.total;this.port.postMessage({type:'level',value:Math.sqrt(square/channels[0].length)})}
    // Outputs remain silent: never feed the microphone back into the speaker.
    for(const channel of outputs[0]||[])channel.fill(0)
    return true
  }
}
registerProcessor('capture-processor',CaptureProcessor)
