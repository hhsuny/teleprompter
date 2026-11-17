export const highFrameRateFormats=['video/mp4;codecs=avc1.64002a,mp4a.40.2','video/mp4;codecs=hvc1,mp4a.40.2'] as const

export function recordingOptions(mp4Only=false,bitrate=16_000_000,preferredMime?:string):MediaRecorderOptions{
  if(!globalThis.MediaRecorder)throw new Error('当前浏览器不支持网页录像，请使用 Safari。')
  if(preferredMime&&!MediaRecorder.isTypeSupported(preferredMime))throw new Error('测试通过的录像编码当前不可用，请重新检查相机。')
  const formats=['video/mp4',highFrameRateFormats[0],...mp4Only?[]:['video/webm;codecs=vp8,opus','video/webm']]
  const mimeType=preferredMime??formats.find(type=>MediaRecorder.isTypeSupported(type))
  if(mp4Only&&!mimeType)throw new Error('当前浏览器无法录制可检测的 MP4，请用 Safari 打开。')
  return {...mimeType?{mimeType}:{},videoBitsPerSecond:bitrate,audioBitsPerSecond:128_000}
}
