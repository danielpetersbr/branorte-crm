export type ChatAttachmentType = 'image' | 'audio' | 'video' | 'document'
export const CHAT_MEDIA_BUCKET = 'crm-chat-media'
export const CHAT_MAX_FILE_BYTES = 20 * 1024 * 1024
const TYPES: Record<string, ChatAttachmentType> = {
  'image/jpeg':'image', 'image/png':'image', 'image/webp':'image',
  'audio/webm':'audio', 'audio/ogg':'audio', 'audio/mp4':'audio', 'audio/mpeg':'audio', 'audio/wav':'audio',
  'video/mp4':'video', 'video/webm':'video', 'application/pdf':'document',
}
export function attachmentType(mime: string): ChatAttachmentType | null {
  return TYPES[mime.split(';')[0].toLowerCase()] ?? null
}
export function validateAttachment(file: {type:string;size:number}): string | null {
  if (!attachmentType(file.type)) return 'Formato não permitido. Envie foto, áudio, vídeo ou PDF.'
  if (!file.size) return 'O arquivo está vazio.'
  if (file.size > CHAT_MAX_FILE_BYTES) return 'O limite é de 20 MB por arquivo.'
  return null
}
export function deliveryLabel(status: string): string {
  return ({pending:'Na fila da VPS',sending:'Aguardando confirmação',sent:'Enviada pelo WhatsApp',failed:'Falha no envio',cancelled:'Cancelada',canceled:'Cancelada'} as Record<string,string>)[status] ?? status
}
export function reconcileOutbox<T extends {wa_msg_id:string|null}>(outbox:T[], history:{msg_id:string}[]):T[] {
  const ids = new Set(history.map(m=>m.msg_id))
  return outbox.filter(m=>!m.wa_msg_id || !ids.has(m.wa_msg_id))
}
export interface ChatConversation {
  id:string; wa_chat_id:string; phone:string; name:string; contact_id:string|null;
  vendor_id:string|null; vendor_name:string|null; status:'open'|'resolved'; tags:string[];
  last_message_at:string; last_preview:string|null; last_from_me:boolean; unread:number;
  human_hold:boolean; lock_user_id:string|null; lock_session_id:string|null; lock_until:string|null;
}
export interface ChatMessage {
  id:number; msg_id:string; from_me:boolean; tipo:string; body:string|null;
  media_url:string|null; data_msg:string; transcricao:string|null; duracao_seg:number|null;
}
export interface ChatOutbox {
  id:string; body:string; tipo:string; media_path:string|null; created_at:string;
  status:string; error:string|null; sent_at:string|null; wa_msg_id:string|null; sender_name:string|null;
}
export interface ChatNote {id:string;body:string;created_at:string;author_name:string|null}
