type SessaoVendas={user:{id:string};access_token:string}
type Dependencias={url:string;signal?:AbortSignal;body?:unknown;getSession:()=>Promise<SessaoVendas|null>;fetch:typeof fetch}
export class ControleVendasErro extends Error {
  constructor(message:string,public readonly status:number){super(message);this.name='ControleVendasErro'}
}

/** Nenhum resultado sobrevive a uma troca de sessão durante a leitura. */
export async function requisitarControleVendas({url,signal,body,getSession,fetch:transport}:Dependencias):Promise<unknown>{
  if(!/^\/api\/controle-vendas(?:-analise)?(?:\?|$)/.test(url))throw new Error('Destino de leitura inválido.')
  const verificarCancelamento=()=>{if(signal?.aborted)throw new Error('Leitura cancelada.')}
  verificarCancelamento()
  const antes=await getSession()
  if(!antes?.access_token||!antes.user.id)throw new ControleVendasErro('Sua sessão terminou. Entre novamente.',401)
  verificarCancelamento()
  const response=await transport(url,{method:body===undefined?'GET':'POST',credentials:'same-origin',cache:'no-store',signal,
    headers:{Authorization:`Bearer ${antes.access_token}`,...(body===undefined?{}:{'Content-Type':'application/json'})},
    ...(body===undefined?{}:{body:JSON.stringify(body)})})
  verificarCancelamento()
  const depois=await getSession()
  if(!depois||depois.user.id!==antes.user.id||depois.access_token!==antes.access_token)throw new ControleVendasErro('A sessão mudou. Atualize a leitura.',401)
  if(response.status===401)throw new ControleVendasErro('Sua sessão terminou. Entre novamente.',401)
  if(response.status===403)throw new ControleVendasErro('Sem permissão para consultar essas vendas.',403)
  if(!response.ok)throw new Error('Não foi possível consultar o Controle. Tente novamente.')
  const payload:unknown=await response.json()
  verificarCancelamento()
  const final=await getSession()
  if(!final||final.user.id!==antes.user.id||final.access_token!==antes.access_token)throw new ControleVendasErro('A sessão mudou. Atualize a leitura.',401)
  return payload
}
