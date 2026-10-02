import {test} from 'node:test'
import assert from 'node:assert/strict'
import {createChatRecorder,disposeChatRecorder,prepareChatRecorder,type RecorderRuntime} from './chat-recorder'

function deferred<T>() {
  let resolve!:(value:T)=>void
  const promise=new Promise<T>(done=>{resolve=done})
  return {promise,resolve}
}
function fakeStream() {
  let stopped=0
  const stream={getTracks:()=>[{stop(){stopped++}},{stop(){stopped++}}]} as unknown as MediaStream
  return {stream,get stopped(){return stopped}}
}
const idleRecorder={state:'inactive',start(){throw new Error('Preparation must not start recording')}} as unknown as MediaRecorder

test('troca de contexto enquanto microfone aguarda permissão libera todas as faixas',async()=>{
  const permission=deferred<MediaStream>(),resource=fakeStream()
  let current=true,assigned=0,factories=0
  const preparation=prepareChatRecorder({isCurrent:()=>current,getStream:()=>permission.promise,onStream:()=>{assigned++},createRecorder:async()=>{factories++;return idleRecorder}})
  current=false;permission.resolve(resource.stream)
  assert.equal(await preparation,null);assert.equal(resource.stopped,2)
  assert.equal(assigned,0);assert.equal(factories,0)
})

test('stream fica disponível para cancelamento antes de aguardar codificador',async()=>{
  const encoder=deferred<MediaRecorder>(),started=deferred<void>(),resource=fakeStream()
  let current=true,assigned:MediaStream|null=null,disposed=0
  const preparation=prepareChatRecorder({isCurrent:()=>current,getStream:async()=>resource.stream,onStream:s=>{assigned=s},createRecorder:()=>{started.resolve();return encoder.promise}})
  await started.promise
  assert.equal(assigned,resource.stream);assert.equal(resource.stopped,0)
  current=false;encoder.resolve({...idleRecorder,dispose(){disposed++}} as MediaRecorder)
  assert.equal(await preparation,null);assert.equal(resource.stopped,2)
  assert.equal(disposed,1)
})

test('cancelamento permanente não ressuscita tentativa quando contexto volta a ser válido',async()=>{
  const encoder=deferred<MediaRecorder>(),started=deferred<void>(),resource=fakeStream()
  let sameChat=true,cancelled=false
  const preparation=prepareChatRecorder({isCurrent:()=>sameChat&&!cancelled,getStream:async()=>resource.stream,createRecorder:()=>{started.resolve();return encoder.promise}})
  await started.promise
  cancelled=true;sameChat=false;sameChat=true;encoder.resolve(idleRecorder)
  assert.equal(await preparation,null);assert.equal(cancelled,true);assert.equal(resource.stopped,2)
})

test('permissão negada preserva erro e permite nova tentativa sem recursos antigos',async()=>{
  const denied=Object.assign(new Error('denied'),{name:'NotAllowedError'}),resource=fakeStream()
  let attempts=0,factories=0
  const options={isCurrent:()=>true,getStream:async()=>{if(attempts++===0)throw denied;return resource.stream},createRecorder:async()=>{factories++;return idleRecorder}}
  await assert.rejects(prepareChatRecorder(options),error=>error===denied)
  assert.equal(factories,0)
  assert.deepEqual(await prepareChatRecorder(options),{stream:resource.stream,recorder:idleRecorder})
  assert.equal(factories,1);assert.equal(resource.stopped,0)
})

test('erro do codificador libera faixas e mantém a exceção original',async()=>{
  const resource=fakeStream(),failure=new Error('encoder failed')
  let assigned=false
  await assert.rejects(prepareChatRecorder({isCurrent:()=>true,getStream:async()=>resource.stream,onStream:()=>{assigned=true},createRecorder:async()=>{throw failure}}),error=>error===failure)
  assert.equal(assigned,true);assert.equal(resource.stopped,2)
})

test('preparação válida entrega recursos sem iniciar gravação ou parar microfone',async()=>{
  const resource=fakeStream()
  assert.deepEqual(await prepareChatRecorder({isCurrent:()=>true,getStream:async()=>resource.stream,createRecorder:async s=>{assert.equal(s,resource.stream);return idleRecorder}}),{stream:resource.stream,recorder:idleRecorder})
  assert.equal(resource.stopped,0)
})

test('descarte de gravador nativo é no-op e dispose falho não impede limpeza das faixas',async()=>{
  assert.doesNotThrow(()=>disposeChatRecorder(idleRecorder))
  const resource=fakeStream(),failure=new Error('context failed')
  let checks=0,disposed=0
  await assert.rejects(prepareChatRecorder({isCurrent:()=>{if(checks++===0)return true;throw failure},getStream:async()=>resource.stream,createRecorder:async()=>({...idleRecorder,dispose(){disposed++;throw new Error('worker cleanup failed')}} as MediaRecorder)}),error=>error===failure)
  assert.equal(disposed,1);assert.equal(resource.stopped,2)
})

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
