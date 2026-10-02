export type ChatChange={id?:string;kind:'conversation'|'messages'|'notes'|'outbox'|'tags'}
export function chatChange(value:unknown):ChatChange|null {
  if(!value||typeof value!=='object')return null
  const v=value as Record<string,unknown>
  if(Object.keys(v).some(k=>k!=='id'&&k!=='kind'))return null
  if(v.kind==='tags'&&v.id===undefined)return {kind:'tags'}
  if(!['conversation','messages','notes','outbox'].includes(String(v.kind))||typeof v.id!=='string'||!/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(v.id))return null
  return {id:v.id,kind:v.kind as ChatChange['kind']}
}
export function chatRefresh(change:ChatChange,selected:string|null):string[] {
  const keys:string[]=[]
  if(['conversation','messages','tags'].includes(change.kind))keys.push('list')
  if(['conversation','messages','outbox'].includes(change.kind))keys.push('summary')
  if(change.kind==='tags')keys.push('quick-replies')
  if(change.id&&change.id===selected){keys.push('detail');if(change.kind==='messages')keys.push('messages')}
  return keys
}
