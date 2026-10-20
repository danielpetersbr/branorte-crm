import type {VercelRequest,VercelResponse} from '@vercel/node'
import {autorizarVendidos,revalidarVendidos} from './_lib/vendidos-acesso.js'
import {lerConversao,validarFiltro,ajustarConversao} from './_lib/conversao-comercial-reader.js'
export const config={maxDuration:60}
export function criarHandlerConversao(deps={autorizar:autorizarVendidos,revalidar:revalidarVendidos,ler:lerConversao,ajustar:ajustarConversao,timeoutMs:45000}){
 return async(req:VercelRequest,res:VercelResponse)=>{
  res.setHeader('Cache-Control','no-store, max-age=0');res.setHeader('Vary','Authorization')
  if(!['GET','POST'].includes(req.method??'')){res.setHeader('Allow','GET, POST');return res.status(405).json({error:'method_not_allowed'})}
  const controller=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined
  try{
   const timeout=new Promise<never>((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(new Error('timeout'))},deps.timeoutMs)})
   const result=await Promise.race([timeout,(async()=>{
    const access=await deps.autorizar(req.headers.authorization)
    if(!access.ok)return {status:access.status,data:{error:access.error}}
    controller.signal.throwIfAborted()
    if(req.method==='POST'){
     if(access.escopo.role!=='admin')return {status:403,data:{error:'sem_permissao'}}
     if(Object.keys(req.query??{}).length||!req.body||typeof req.body!=='object'||Array.isArray(req.body)||JSON.stringify(req.body).length>5000)return {status:400,data:{error:'ajuste_invalido'}}
     const fresh=await deps.revalidar(req.headers.authorization,access)
     if(!fresh.ok)return {status:fresh.status,data:{error:fresh.error}}
     controller.signal.throwIfAborted()
     const data=await deps.ajustar(access.snapshot.userId,req.body,controller.signal)
     controller.signal.throwIfAborted()
     return {status:200,data}
    }
    const filtro=validarFiltro(req.query??{}),data=await deps.ler(access.escopo,filtro,controller.signal)
    const current=await deps.revalidar(req.headers.authorization,access)
    controller.signal.throwIfAborted()
    return current.ok?{status:200,data}:{status:current.status,data:{error:current.error}}
   })()])
   return res.status(result.status).json(result.data)
  }catch(error){
   const reason=error instanceof Error?error.message:''
   if(reason==='sem_permissao')return res.status(403).json({error:reason})
   if(['parametros_invalidos','periodo_invalido','acao_invalida','ajuste_invalido','pedido_nao_encontrado'].includes(reason))return res.status(400).json({error:reason})
   return res.status(503).json({error:'conversao_indisponivel'})
  }finally{if(timer)clearTimeout(timer);controller.abort()}
 }
}
export default criarHandlerConversao()
