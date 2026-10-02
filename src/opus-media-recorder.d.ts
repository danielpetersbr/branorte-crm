declare module 'opus-media-recorder/OpusMediaRecorder.umd.js' {
  const OpusMediaRecorder:{new(stream:MediaStream,options:MediaRecorderOptions,workerOptions:{encoderWorkerFactory:()=>Worker;OggOpusEncoderWasmPath:string}):MediaRecorder}
  export default OpusMediaRecorder
}
