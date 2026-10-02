export interface RecorderRuntime {native:typeof MediaRecorder|undefined;loadOgg:()=>Promise<(stream:MediaStream)=>MediaRecorder>}
export async function createChatRecorder(stream:MediaStream,runtime:RecorderRuntime={
  native:typeof MediaRecorder==='undefined'?undefined:MediaRecorder,
  loadOgg:async()=> (await import('./chat-opus-recorder')).createOpusRecorder,
}):Promise<MediaRecorder> {
  const Native=runtime.native
  if(Native?.isTypeSupported('audio/ogg;codecs=opus')) return new Native(stream,{mimeType:'audio/ogg;codecs=opus'})
  try {return (await runtime.loadOgg())(stream)} catch (error) {
    const mime=['audio/webm;codecs=opus','audio/mp4'].find(type=>Native?.isTypeSupported(type))
    if(Native && mime) return new Native(stream,{mimeType:mime})
    throw error
  }
}
