import OpusMediaRecorder from 'opus-media-recorder/OpusMediaRecorder.umd.js'
import encoderWorkerUrl from 'opus-media-recorder/encoderWorker.umd.js?url'
import oggEncoderUrl from 'opus-media-recorder/OggOpusEncoder.wasm?url'

// Loaded only when the seller explicitly starts a recording. Keep MediaRecorder global unchanged.
export function createOpusRecorder(stream:MediaStream):MediaRecorder {
  return new OpusMediaRecorder(stream,{mimeType:'audio/ogg'},{
    encoderWorkerFactory:()=>new Worker(encoderWorkerUrl),
    OggOpusEncoderWasmPath:oggEncoderUrl,
  })
}
