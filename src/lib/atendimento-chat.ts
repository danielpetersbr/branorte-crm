export type ChatAttachmentType = 'image' | 'audio' | 'video' | 'document'
export const CHAT_MEDIA_BUCKET = 'crm-chat-media'
export const CHAT_PRIVATE_MEDIA_PREFIX='https://flwbeevtvjiouxdjmziv.supabase.co/storage/v1/object/authenticated/crm-chat-media/'
export function privateChatMediaPath(url:string|null):string|null {
  if(!url?.startsWith(CHAT_PRIVATE_MEDIA_PREFIX))return null
  const path=url.slice(CHAT_PRIVATE_MEDIA_PREFIX.length)
  return /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\.[a-z0-9]+$/.test(path)?path:null
}
export const CHAT_MAX_FILE_BYTES = 20 * 1024 * 1024
const TYPES: Record<string, ChatAttachmentType> = {
  'image/jpeg':'image', 'image/png':'image', 'image/webp':'image',
  'audio/webm':'audio', 'audio/ogg':'audio', 'audio/mp4':'audio', 'audio/mpeg':'audio', 'audio/wav':'audio',
  'video/mp4':'video', 'video/webm':'video', 'application/pdf':'document',
  'application/msword':'document', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document':'document',
  'application/vnd.ms-excel':'document', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':'document',
  'application/vnd.ms-powerpoint':'document', 'application/vnd.openxmlformats-officedocument.presentationml.presentation':'document',
  'text/plain':'document', 'text/csv':'document', 'application/zip':'document',
}
const EXTENSIONS:Record<string,string> = {
  'image/jpeg':'jpg', 'image/png':'png', 'image/webp':'webp',
  'audio/webm':'webm', 'audio/ogg':'ogg', 'audio/mp4':'m4a', 'audio/mpeg':'mp3', 'audio/wav':'wav',
  'video/mp4':'mp4', 'video/webm':'webm', 'application/pdf':'pdf',
  'application/msword':'doc', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document':'docx',
  'application/vnd.ms-excel':'xls', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':'xlsx',
  'application/vnd.ms-powerpoint':'ppt', 'application/vnd.openxmlformats-officedocument.presentationml.presentation':'pptx',
  'text/plain':'txt', 'text/csv':'csv', 'application/zip':'zip',
}
const ALIASES:Record<string,string>={'audio/x-wav':'audio/wav','application/x-zip-compressed':'application/zip','image/jpg':'image/jpeg'}
const normalizeMime=(mime:string)=>{const base=mime.split(';')[0].trim().toLowerCase();return ALIASES[base]??base}
// Prefer browser MIME; only infer a known extension when Windows omits it.
const FILE_MIMES:Record<string,string>={...Object.fromEntries(Object.entries(EXTENSIONS).map(([mime,ext])=>[ext,mime])),jpeg:'image/jpeg',webm:'video/webm'}
export const CHAT_ATTACHMENT_ACCEPT=Object.keys(TYPES).join(',')+','+Object.keys(FILE_MIMES).map(ext=>`.${ext}`).join(',')
export function attachmentType(mime: string): ChatAttachmentType | null {
  return TYPES[normalizeMime(mime)] ?? null
}
export function resolveAttachmentMime(file:{type:string;name?:string}):string|null {
  const mime=normalizeMime(file.type)
  if (TYPES[mime]) return mime
  if (mime && mime!=='application/octet-stream') return null
  return FILE_MIMES[file.name?.split('.').pop()?.toLowerCase()??'']??null
}
export function attachmentExtension(mime:string):string|null {return EXTENSIONS[normalizeMime(mime)]??null}
export function displayMessageBody(body:string|null):string {
  if (!body) return ''
  const trimmed=body.trim()
  if (/^data:(?:image|audio|video)\/[a-z0-9.+-]+;base64,/i.test(trimmed)) return ''
  if (trimmed.length>128 && /^(?:\/9j\/|iVBORw0|UklGR|T2dnUw)/.test(trimmed) && /^[A-Za-z0-9+/=\r\n]+$/.test(trimmed)) return ''
  return body
}
export function validateAttachment(file: {type:string;size:number;name?:string}): string | null {
  if (!resolveAttachmentMime(file)) return 'Formato não permitido. Envie foto, áudio, vídeo ou documento compatível.'
  if (!file.size) return 'O arquivo está vazio.'
  if (file.size > CHAT_MAX_FILE_BYTES) return 'O limite é de 20 MB por arquivo.'
  return null
}
export function deliveryLabel(status: string): string {
  return ({pending:'Na fila da VPS',sending:'Aguardando confirmação',sent:'Enviada pelo WhatsApp',failed:'Falha no envio',cancelled:'Cancelada',canceled:'Cancelada'} as Record<string,string>)[status] ?? status
}
export function reconcileOutbox<T extends {wa_msg_id:string|null;status?:string}>(outbox:T[], history:{msg_id:string}[]):T[] {
  // History stores WA's hash; sendFileMessage can return its serialized MessageId.
  const hash=(id:string)=>id.match(/^(?:true|false)_[^_]+@(?:c\.us|s\.whatsapp\.net|lid|g\.us)_([^_]+)(?:_.*)?$/)?.[1]??id
  const ids = new Set(history.map(m=>hash(m.msg_id)))
  return outbox.filter(m=>(m.status!==undefined&&m.status!=='sent') || !m.wa_msg_id || !ids.has(hash(m.wa_msg_id)))
}
export interface ChatConversation {
  id:string; wa_chat_id:string; phone:string; name:string; contact_id:string|null;
  vendor_id:string|null; vendor_name:string|null; status:'open'|'resolved'; tags:string[];
  last_message_at:string; last_preview:string|null; last_from_me:boolean; unread:number;
  human_hold:boolean; lock_user_id:string|null; lock_session_id:string|null; lock_until:string|null;
  avatar_url?:string|null;
}
export interface ChatMessage {
  id:number; msg_id:string; from_me:boolean; tipo:string; body:string|null;
  media_url:string|null; data_msg:string; transcricao:string|null; duracao_seg:number|null;
  filename?:string|null;
}
export interface ChatOutbox {
  id:string; body:string; tipo:string; media_path:string|null; created_at:string;
  status:string; error:string|null; sent_at:string|null; wa_msg_id:string|null; sender_name:string|null;
  filename?:string|null;
}
export interface ChatNote {id:string;body:string;created_at:string;author_name:string|null}
