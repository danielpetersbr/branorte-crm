import type {PendingStorage} from './chat-pending-send'
const key=(user:string,chat:string)=>`crm-chat-draft:${user}:${chat}`
export function readChatDraft(storage:PendingStorage,user:string,chat:string):string {
  try {return storage.getItem(key(user,chat))??''} catch {return ''}
}
export function saveChatDraft(storage:PendingStorage,user:string,chat:string,body:string):void {
  try {if(body) storage.setItem(key(user,chat),body); else storage.removeItem(key(user,chat))} catch { /* A full/disabled cache must not block composing. */ }
}
export function clearChatDraft(storage:PendingStorage,user:string,chat:string):void {
  try {storage.removeItem(key(user,chat))} catch { /* Draft persistence is optional. */ }
}
