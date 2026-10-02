import {test} from 'node:test'
import assert from 'node:assert/strict'
import {createChatRecorder,type RecorderRuntime} from './chat-recorder'

test('Firefox usa voz Ogg nativa sem carregar codificador extra',async()=>{
  let loads=0
  class Native {mimeType:string;constructor(_stream:MediaStream,options:MediaRecorderOptions){this.mimeType=options.mimeType!}static isTypeSupported(mime:string){return mime==='audio/ogg;codecs=opus'}}
  const recorder=await createChatRecorder({} as MediaStream,{native:Native as unknown as RecorderRuntime['native'],loadOgg:async()=>{loads++;throw new Error('should not load')}})
  assert.equal(recorder.mimeType,'audio/ogg;codecs=opus')
  assert.equal(loads,0)
})
test('Chrome grava Ogg através do codificador carregado sob demanda',async()=>{
  class Native {static isTypeSupported(mime:string){return mime==='audio/webm;codecs=opus'}}
  const recorder=await createChatRecorder({} as MediaStream,{native:Native as unknown as RecorderRuntime['native'],loadOgg:async()=>()=>({mimeType:'audio/ogg'} as MediaRecorder)})
  assert.equal(recorder.mimeType,'audio/ogg')
})
test('falha do codificador permite anexo de áudio nativo sem travar compositor',async()=>{
  class Native {mimeType:string;constructor(_stream:MediaStream,options:MediaRecorderOptions){this.mimeType=options.mimeType!}static isTypeSupported(mime:string){return mime==='audio/mp4'}}
  const recorder=await createChatRecorder({} as MediaStream,{native:Native as unknown as RecorderRuntime['native'],loadOgg:async()=>{throw new Error('network')}})
  assert.equal(recorder.mimeType,'audio/mp4')
})
