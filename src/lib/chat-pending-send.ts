// Guarda somente solicitações que chegaram à etapa de RPC; arquivos já estão no bucket privado.
// A chave permanece após trocar de conversa ou recarregar, evitando UUID novo num retry incerto.
export interface PendingChatSend {id:string;chat:string;body:string;path?:string;mime?:string;filename?:string;reply_msg_id?:string;reply_preview?:string|null;reply_sender_name?:string|null}
export interface PendingStorage {getItem(key:string):string|null;setItem(key:string,value:string):void;removeItem(key:string):void}
const key=(user:string,chat:string)=>`crm-chat-pending:${user}:${chat}`
export function readPendingSend(storage:PendingStorage,user:string,chat:string):PendingChatSend|null {
  try {const r=JSON.parse(storage.getItem(key(user,chat))||'null');return r&&r.chat===chat&&typeof r.id==='string'&&typeof r.body==='string'&&(r.reply_msg_id===undefined||(typeof r.reply_msg_id==='string'&&!!r.reply_msg_id.trim()))?r:null}catch{return null}
}
export function savePendingSend(storage:PendingStorage,user:string,send:PendingChatSend){storage.setItem(key(user,send.chat),JSON.stringify(send))}
export function clearPendingSend(storage:PendingStorage,user:string,chat:string){storage.removeItem(key(user,chat))}
