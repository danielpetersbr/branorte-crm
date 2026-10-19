import type { VercelRequest, VercelResponse } from '@vercel/node'
import { autorizarVendidos, revalidarVendidos } from './_lib/vendidos-acesso.js'
import { lerVendidos } from './_lib/vendidos-reader.js'
export const config={maxDuration:45}
export function criarHandlerVendidos(deps={autorizar:autorizarVendidos,revalidar:revalidarVendidos,ler:lerVendidos,timeoutMs:35000}) {
  return async(req:VercelRequest,res:VercelResponse)=>{
    res.setHeader('Cache-Control','no-store, max-age=0');res.setHeader('Vary','Authorization')
    if(req.method!=='GET'){res.setHeader('Allow','GET');return res.status(405).json({error:'method_not_allowed'})}
    if(Object.keys(req.query??{}).length)return res.status(400).json({error:'parametros_invalidos'})
    const controller=new AbortController()
    let timer:ReturnType<typeof setTimeout>|undefined
    try {
      const timeout=new Promise<never>((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(new Error('timeout'))},deps.timeoutMs)})
      const result=await Promise.race([timeout,(async()=>{
        const acesso=await deps.autorizar(req.headers.authorization)
        if(!acesso.ok)return {status:acesso.status,data:{error:acesso.error}}
        controller.signal.throwIfAborted()
        const data=await deps.ler(acesso.escopo,controller.signal)
        const atual=await deps.revalidar(req.headers.authorization,acesso)
        controller.signal.throwIfAborted()
        return atual.ok?{status:200,data}:{status:atual.status,data:{error:atual.error}}
      })()])
      return res.status(result.status).json(result.data)
    }catch{return res.status(503).json({error:'vendidos_indisponiveis'})}
    finally{if(timer)clearTimeout(timer);controller.abort()}
  }
}
export default criarHandlerVendidos()
