export interface QuickReply {id:string;title:string;body:string}
interface ReplyStorage {getItem(key:string):string|null;setItem(key:string,value:string):void}
const key=(user:string)=>`crm-chat-quick-replies:${user}`
export const defaultQuickReplies:QuickReply[]=[
  {id:'greeting',title:'Cumprimentar',body:'Olá! Tudo bem? Como posso ajudar você hoje?'},
  {id:'proposal',title:'Enviar proposta',body:'Vou preparar sua proposta. Pode me confirmar o que você precisa?'},
  {id:'follow-up',title:'Retomar contato',body:'Olá! Conseguiu conferir nossa proposta? Fico à disposição para tirar suas dúvidas.'},
]
export function readQuickReplies(storage:Pick<ReplyStorage,'getItem'>,user:string):QuickReply[] {
  try {
    const raw=storage.getItem(key(user));if(!raw)return defaultQuickReplies.map(r=>({...r}))
    const rows=JSON.parse(raw);if(!Array.isArray(rows))return defaultQuickReplies.map(r=>({...r}))
    return rows.filter((r):r is QuickReply=>r&&typeof r.id==='string'&&typeof r.title==='string'&&typeof r.body==='string'&&r.title.trim()&&r.title.length<=60&&r.body.trim()&&r.body.length<=4000).slice(0,20)
  } catch{return defaultQuickReplies.map(r=>({...r}))}
}
export function saveQuickReplies(storage:ReplyStorage,user:string,rows:QuickReply[]){storage.setItem(key(user),JSON.stringify(rows))}
