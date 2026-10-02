import type {VercelRequest,VercelResponse} from '@vercel/node';
import type {SupabaseClient} from '@supabase/supabase-js';
import {criarCrmEspelho,obterAcessoEspelho,resolverEscopoEspelho,revalidarAcessoEspelho,ErroAcessoEspelho} from './_lib/producao-espelho-acesso.js';
import {lerFichaEspelho} from './_lib/producao-ficha-reader.js';
import {decodificarFichaEspelho,uuidFicha} from '../src/lib/producao-ficha-consulta.js';

export function criarHandlerProducaoFicha(deps:{crm?:()=>SupabaseClient;lerFicha?:typeof lerFichaEspelho;deadlineMs?:number}={}){
  return async(req:VercelRequest,res:VercelResponse)=>{
    res.setHeader('Cache-Control','no-store');res.setHeader('Vary','Authorization');
    if(req.method!=='GET'){res.setHeader('Allow','GET');return res.status(405).json({error:'method_not_allowed'});}
    const query=req.query??{};
    if(!Object.prototype.hasOwnProperty.call(query,'cardId')||!uuidFicha(query.cardId)||Object.keys(query).length!==1||req.body!==null&&req.body!==undefined)return res.status(400).json({error:'parametros_invalidos'});
    const header=req.headers.authorization,token=typeof header==='string'?/^Bearer[ \t]+([^\s]+)$/i.exec(header)?.[1]:undefined;
    if(!token)return res.status(401).json({error:'no_auth'});
    const duration=deps.deadlineMs??45000,controller=new AbortController();
    if(!Number.isFinite(duration)||duration<=0||duration>45000)return res.status(503).json({error:'producao_indisponivel'});
    let timer:ReturnType<typeof setTimeout>|undefined;
    const check=()=>{if(controller.signal.aborted)throw new ErroAcessoEspelho(503,'producao_indisponivel');};
    try{
      const stopped=new Promise<never>((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(new ErroAcessoEspelho(503,'producao_indisponivel'));},duration);});
      const work=async()=>{
        check();const crm=deps.crm?.()??criarCrmEspelho({SUPABASE_URL:process.env.SUPABASE_URL,SUPABASE_SERVICE_ROLE_KEY:process.env.SUPABASE_SERVICE_ROLE_KEY});
        const access=await obterAcessoEspelho(crm,token);check();if(!access.ok)return {status:access.status,body:{error:access.error}};
        const scope=await resolverEscopoEspelho(crm,access.snapshot);check();
        const raw=await(deps.lerFicha??lerFichaEspelho)(scope,query.cardId as string,{signal:controller.signal});check();
        const current=await revalidarAcessoEspelho(crm,token,access.snapshot,scope);check();if(!current.ok)return {status:current.status,body:{error:current.error}};
        const data=decodificarFichaEspelho(raw,query.cardId as string);check();return {status:200,body:data};
      };
      const result=await Promise.race([work(),stopped]);return res.status(result.status).json(result.body);
    }catch(error){return res.status(error instanceof ErroAcessoEspelho?error.status:503).json({error:error instanceof ErroAcessoEspelho?error.message:'producao_indisponivel'});}
    finally{controller.abort();if(timer!==undefined)clearTimeout(timer);}
  };
}
export default criarHandlerProducaoFicha();
