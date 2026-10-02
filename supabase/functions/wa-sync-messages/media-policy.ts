export const CRM_MAX_MEDIA_BYTES = 20 * 1024 * 1024
export const LEGACY_MAX_MEDIA_BYTES = 6_000_000
export const MAX_JSON_BODY_BYTES = 32 * 1024 * 1024
export const LEGACY_CAPTURE_TYPES = ['ptt', 'audio', 'image']
export const CRM_CAPTURE_TYPES = [...LEGACY_CAPTURE_TYPES, 'video', 'document', 'sticker']

// Cache capture is independent of any AI audio/image-analysis policy.
export function captureTypes(vendor: string): string[] {
  return vendor === 'ANA' ? CRM_CAPTURE_TYPES : LEGACY_CAPTURE_TYPES
}
const extensions: Record<string,string> = {
  'image/jpeg':'jpg','image/png':'png','image/webp':'webp','image/gif':'gif',
  'audio/webm':'webm','audio/ogg':'ogg','audio/mp4':'m4a','audio/mpeg':'mp3','audio/wav':'wav','audio/aac':'aac','audio/opus':'ogg',
  'video/mp4':'mp4','video/webm':'webm',
  'application/pdf':'pdf','application/msword':'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document':'docx',
  'application/vnd.ms-excel':'xls','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':'xlsx',
  'application/vnd.ms-powerpoint':'ppt','application/vnd.openxmlformats-officedocument.presentationml.presentation':'pptx',
  'text/plain':'txt','text/csv':'csv','application/zip':'zip',
}
const aliases: Record<string,string> = {'image/jpg':'image/jpeg','audio/x-wav':'audio/wav','application/x-zip-compressed':'application/zip'}
const privateMimes=new Set(['image/jpeg','image/png','image/webp','audio/webm','audio/ogg','audio/mp4','audio/mpeg','audio/wav','video/mp4','video/webm','application/pdf','application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/vnd.ms-excel','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','application/vnd.ms-powerpoint','application/vnd.openxmlformats-officedocument.presentationml.presentation','text/plain','text/csv','application/zip'])
function canonicalMime(raw: string, filename?: string | null, type?: string): string {
  const normalized=raw.split(';',1)[0].trim().toLowerCase()
  if (normalized==='application/octet-stream' || !normalized) {
    const ext=(filename ?? '').split('.').pop()?.toLowerCase()
    const family=type==='video' ? 'video/' : type==='ptt' || type==='audio' ? 'audio/' : type==='image' || type==='sticker' ? 'image/' : ''
    return Object.keys(extensions).find(m => extensions[m]===ext && m.startsWith(family)) ?? normalized
  }
  return aliases[normalized] ?? normalized
}
export type MediaValidation =
  | {ok:true; mime:string; extension:string; bucket:string; encoded:string; decodedLength:number}
  | {ok:false; reason:'unsupported_type'|'unsupported_mime'|'invalid_base64'|'too_large'}

export function validateMedia(vendor: string, type: string, dataUrl: string, filename?: string | null): MediaValidation {
  if (!captureTypes(vendor).includes(type)) return {ok:false,reason:'unsupported_type'}
  const marker=dataUrl.indexOf(';base64,')
  if (!dataUrl.startsWith('data:') || marker<5 || marker>200) return {ok:false,reason:'invalid_base64'}
  const mime=canonicalMime(dataUrl.slice(5,marker),filename,type)
  const extension=extensions[mime]
  const audio=type==='ptt' || type==='audio'
  const accepted=extension && (audio ? mime.startsWith('audio/') : type==='image' || type==='sticker' ? mime.startsWith('image/') : type==='video' ? mime.startsWith('video/') : true)
  const privateFile=vendor==='ANA' && (type==='document' || type==='video')
  if (!accepted || privateFile && !privateMimes.has(mime)) return {ok:false,reason:'unsupported_mime'}
  const encoded=dataUrl.slice(marker+8)
  const maxBytes=vendor==='ANA' ? CRM_MAX_MEDIA_BYTES : LEGACY_MAX_MEDIA_BYTES
  // Check encoded size before allocation/atob, then validate its exact decoded size.
  if (encoded.length>4*Math.ceil(maxBytes/3)) return {ok:false,reason:'too_large'}
  const padding=encoded.endsWith('==') ? 2 : encoded.endsWith('=') ? 1 : 0
  const decodedLength=encoded.length/4*3-padding
  if (decodedLength>maxBytes) return {ok:false,reason:'too_large'}
  if (!encoded.length || encoded.length%4!==0 || /[^A-Za-z0-9+/=]/.test(encoded) || encoded.slice(0,-padding || undefined).includes('=')) return {ok:false,reason:'invalid_base64'}
  return {ok:true,mime,extension,bucket:privateFile ? 'crm-chat-media' : audio ? 'wa-audios' : 'wa-midias',encoded,decodedLength}
}

export class PayloadTooLargeError extends Error {}
export async function readLimitedJson(request: Request, maxBytes=MAX_JSON_BODY_BYTES): Promise<any> {
  const declared=Number(request.headers.get('content-length'))
  if (declared>maxBytes) throw new PayloadTooLargeError('payload_too_large')
  if (!request.body) throw new SyntaxError('invalid_json')
  const reader=request.body.getReader()
  const decoder=new TextDecoder()
  const pieces: string[]=[]
  let size=0
  try {
    while (true) {
      const {done,value}=await reader.read()
      if (done) break
      size+=value.byteLength
      if (size>maxBytes) { await reader.cancel(); throw new PayloadTooLargeError('payload_too_large') }
      pieces.push(decoder.decode(value,{stream:true}))
    }
    pieces.push(decoder.decode())
    return JSON.parse(pieces.join(''))
  } finally { reader.releaseLock() }
}
