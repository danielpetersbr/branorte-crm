import type {VercelRequest,VercelResponse} from '@vercel/node';
import {autorizarControleVendas,revalidarControleVendas,type SnapshotControleVendas} from './_lib/controle-vendas-acesso.js';
import {lerDadosControleVendas,validarConsultaVendas,ErroControleVendas,type ConsultaVendas,type DadosControleVendas} from './_lib/controle-vendas-reader.js';
export type DependenciasHandlerVendas={autorizar:typeof autorizarControleVendas;revalidar:typeof revalidarControleVendas;ler:(query:ConsultaVendas,snapshot:SnapshotControleVendas,signal:AbortSignal)=>Promise<DadosControleVendas>;timeoutMs?:number};
export const config={maxDuration:60};
const originAllowed=(origin:string)=>origin==='https://branorte-crm.vercel.app'||/^https:\/\/branorte-[a-z0-9-]+-danielpetersbrs-projects\.vercel\.app$/.test(origin)||/^http:\/\/(localhost|127\.0\.0\.1):\d{1,5}$/.test(origin);

export function criarHandlerControleVendas(deps:DependenciasHandlerVendas={autorizar:autorizarControleVendas,revalidar:revalidarControleVendas,ler:(query,snapshot,signal)=>lerDadosControleVendas(query,snapshot,undefined,signal)}){
  return async(req:VercelRequest,res:VercelResponse)=>{
    res.setHeader('Cache-Control','no-store, max-age=0');
    res.setHeader('Vary','Authorization');
    const origin=req.headers.origin;
    if(origin!==undefined&&(typeof origin!=='string'||!originAllowed(origin)))return res.status(400).json({error:'origin_invalida'});
    if(origin){res.setHeader('Access-Control-Allow-Origin',origin);res.setHeader('Vary','Authorization, Origin');}
    res.setHeader('Access-Control-Allow-Methods','GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers','authorization, content-type');
    if(req.method==='OPTIONS')return res.status(204).end();
    if(req.method!=='GET')return res.status(405).json({error:'method_not_allowed'});
    const controller=new AbortController();
    let timer:ReturnType<typeof setTimeout>|undefined;
    const deadline=new Promise<never>((_resolve,reject)=>{timer=setTimeout(()=>{const error=new ErroControleVendas(504,'controle_indisponivel');controller.abort(error);reject(error);},deps.timeoutMs??22000);});
    try {
      const result=await Promise.race([deadline,(async()=>{
        const access=await deps.autorizar(req.headers.authorization);controller.signal.throwIfAborted();
        if(!access.ok)return {status:access.status,body:{error:access.error}};
        const query=validarConsultaVendas(req.query);
        const data=await deps.ler(query,access.snapshot,controller.signal);controller.signal.throwIfAborted();
        const latest=await deps.revalidar(req.headers.authorization,access.snapshot);controller.signal.throwIfAborted();
        if(!latest.ok)return {status:latest.status,body:{error:latest.error}};
        return {status:200,body:data};
      })()]);
      return res.status(result.status).json(result.body);
    } catch(error){return res.status(error instanceof ErroControleVendas?error.status:502).json({error:error instanceof ErroControleVendas?error.message:'controle_indisponivel'});}
    finally {if(timer!==undefined)clearTimeout(timer);controller.abort();}
  };
}
export default criarHandlerControleVendas();
