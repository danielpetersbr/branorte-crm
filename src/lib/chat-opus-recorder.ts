import OpusMediaRecorder from 'opus-media-recorder/OpusMediaRecorder.umd.js'
import encoderWorkerUrl from 'opus-media-recorder/encoderWorker.umd.js?url'
import oggEncoderUrl from 'opus-media-recorder/OggOpusEncoder.wasm?url'

// Loaded only when the seller explicitly starts a recording. Keep MediaRecorder global unchanged.
export function createOpusRecorder(stream:MediaStream):MediaRecorder {
  let worker:Worker|null=null
  const dispose=()=>{worker?.terminate();worker=null}
  try {
    const recorder=new OpusMediaRecorder(stream,{mimeType:'audio/ogg'},{
      encoderWorkerFactory:()=>{worker=new Worker(encoderWorkerUrl);return worker},
      OggOpusEncoderWasmPath:oggEncoderUrl,
    })
    return Object.assign(recorder,{dispose})
  } catch(error){dispose();throw error}
}
