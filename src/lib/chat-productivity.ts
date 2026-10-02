import { displayMessageBody } from './atendimento-chat'
export type ChatQueue = 'all'|'waiting'|'overdue'
export function selectChatQueue(queue:ChatQueue,status:string):{queue:ChatQueue;status:string} {
  return {queue,status:queue==='waiting'?'open':queue==='overdue'?'':status}
}
export function selectChatStatus(status:string,queue:ChatQueue):{queue:ChatQueue;status:string} {
  return {queue:queue==='waiting'&&status!=='open'?'all':queue,status}
}
interface QueueRow {id:string;last_message_at:string;waiting_since?:string|null;follow_up_at?:string|null}
const queueDate=(row:QueueRow,queue:ChatQueue)=>queue==='waiting'?row.waiting_since:queue==='overdue'?row.follow_up_at:row.last_message_at
export function orderChatQueue<T extends QueueRow>(rows:T[],queue:ChatQueue):T[] {
  const direction=queue==='all'?-1:1
  return [...rows].sort((a,b)=>direction*((queueDate(a,queue)||'').localeCompare(queueDate(b,queue)||'')||a.id.localeCompare(b.id)))
}
export function chatQueueCursor(items:QueueRow[],queue:ChatQueue,size=100) {
  const last=items[items.length-1],before=last&&queueDate(last,queue)
  return items.length===size&&last&&before?{before,before_id:last.id}:undefined
}
export function mergeHistoryPages<T extends {msg_id:string;id:number;data_msg:string}>(pages:T[][]|undefined,descending=false):T[] {
  const rows=new Map<string,T>();pages?.forEach(page=>page.forEach(row=>{if(!rows.has(row.msg_id))rows.set(row.msg_id,row)}))
  return [...rows.values()].sort((a,b)=>(descending?-1:1)*(a.data_msg.localeCompare(b.data_msg)||a.id-b.id))
}
export function waitingTime(since:string,now=Date.now()):string {
  const minutes=Math.max(0,Math.floor((now-Date.parse(since))/60000))
  if(!Number.isFinite(minutes)||minutes<1)return 'agora'
  if(minutes<60)return `${minutes}min`
  if(minutes<1440)return `${Math.floor(minutes/60)}h${minutes%60?` ${minutes%60}min`:''}`
  return `${Math.floor(minutes/1440)}d${Math.floor(minutes%1440/60)?` ${Math.floor(minutes%1440/60)}h`:''}`
}
export function followUpState(due:string|null|undefined,now=Date.now()):'overdue'|'scheduled'|null {
  return due&&Number.isFinite(Date.parse(due))?(Date.parse(due)<=now?'overdue':'scheduled'):null
}
export function localDateTime(iso:string):string {
  const date=new Date(iso)
  if(!Number.isFinite(date.getTime()))return ''
  const pad=(n:number)=>String(n).padStart(2,'0')
  return `${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}
export function followUpIso(value:string,now=Date.now()):string|null {
  if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value))return null
  const date=new Date(value)
  return Number.isFinite(date.getTime())&&date.getTime()>now&&localDateTime(date.toISOString())===value?date.toISOString():null
}
export interface ChatCitation {reply_msg_id:string;reply_preview:string|null;reply_sender_name:string|null}
export function messageCitation(message:{msg_id:string;from_me:boolean;body:string|null;tipo:string;sender_name?:string|null},customer:string):ChatCitation {
  const types:Record<string,string>={image:'Foto',sticker:'Figurinha',audio:'Áudio',ptt:'Áudio',video:'Vídeo',document:'Documento'}
  return {reply_msg_id:message.msg_id,reply_preview:(displayMessageBody(message.body)||types[message.tipo]||'Mensagem').slice(0,400),reply_sender_name:message.from_me?message.sender_name?.trim()||null:customer}
}
