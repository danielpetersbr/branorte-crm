interface GateClient {
  rpc(name:string,args:Record<string,string>):PromiseLike<{data:unknown;error:unknown}>
}
export interface AnaCrmGate {allowed:boolean;reason:string}

// The service-role client stays in the authenticated Edge Function.
// A failed check must not spend AI credits or reactivate a paused conversation.
export async function anaCrmGate(client:GateClient,chatId:string):Promise<AnaCrmGate> {
  const {data,error}=await client.rpc('crm_ana_automation_gate',{p_chat_id:chatId})
  if(error||!data||typeof (data as AnaCrmGate).allowed!=='boolean')throw new Error('Não foi possível verificar a pausa da Ana no CRM.')
  const gate=data as AnaCrmGate
  return {allowed:gate.allowed,reason:typeof gate.reason==='string'?gate.reason:'crm_automation_paused'}
}
