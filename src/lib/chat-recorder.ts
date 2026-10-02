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

export function disposeChatRecorder(recorder:MediaRecorder):void {
  try {(recorder as MediaRecorder&{dispose?:()=>void}).dispose?.()} catch {}
}

export async function prepareChatRecorder({isCurrent,onStream,getStream=()=>navigator.mediaDevices.getUserMedia({audio:true}),createRecorder=createChatRecorder}:{
  isCurrent:()=>boolean;
  onStream?:(stream:MediaStream)=>void;
  getStream?:()=>Promise<MediaStream>;
  createRecorder?:(stream:MediaStream)=>Promise<MediaRecorder>;
}):Promise<{stream:MediaStream;recorder:MediaRecorder}|null> {
  let stream:MediaStream|null=null
  let recorder:MediaRecorder|null=null
  try {
    stream=await getStream()
    if(!isCurrent()){stream.getTracks().forEach(track=>track.stop());return null}
    onStream?.(stream)
    recorder=await createRecorder(stream)
    if(!isCurrent()){disposeChatRecorder(recorder);stream.getTracks().forEach(track=>track.stop());return null}
    return {stream,recorder}
  } catch(error) {
    if(recorder)disposeChatRecorder(recorder)
    stream?.getTracks().forEach(track=>track.stop())
    throw error
  }
}
