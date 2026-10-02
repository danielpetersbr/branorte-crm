import type {VercelRequest,VercelResponse} from '@vercel/node';
import {executarAnaliseVendas,type DependenciasAnaliseVendas} from './_lib/controle-vendas-analise.js';
import {autorizarControleVendas,revalidarControleVendas} from './_lib/controle-vendas-acesso.js';
export const config={api:{bodyParser:{sizeLimit:'32kb'}},maxDuration:30};
const originAllowed=(origin:string)=>origin==='https://branorte-crm.vercel.app'||/^https:\/\/branorte-[a-z0-9-]+-danielpetersbrs-projects\.vercel\.app$/.test(origin)||/^http:\/\/(localhost|127\.0\.0\.1):\d{1,5}$/.test(origin);
export function criarHandlerAnaliseVendas(deps?:DependenciasAnaliseVendas){
  return async(req:VercelRequest,res:VercelResponse)=>{
    res.setHeader('Cache-Control','no-store');res.setHeader('Vary','Authorization, Origin');
    const origin=req.headers.origin;
    if(origin!==undefined&&(typeof origin!=='string'||!originAllowed(origin)))return res.status(400).json({error:'origin_invalida'});
    if(origin)res.setHeader('Access-Control-Allow-Origin',origin);
    if(req.method!=='POST'){res.setHeader('Allow','POST');return res.status(405).json({error:'method_not_allowed'});}
    if(Object.keys(req.query??{}).length)return res.status(400).json({error:'parametros_invalidos'});
    if(typeof req.headers['content-type']!=='string'||!/^application\/json(?:\s*;.*)?$/i.test(req.headers['content-type']))return res.status(415).json({error:'json_required'});
    const declared=req.headers['content-length'];
    if(declared!==undefined&&(typeof declared!=='string'||!/^(0|[1-9]\d*)$/.test(declared)))return res.status(400).json({error:'parametros_invalidos'});
    if(declared!==undefined&&Number(declared)>32768)return res.status(413).json({error:'corpo_excedido'});
    try {
      const raw=typeof req.body==='string'?req.body:JSON.stringify(req.body);
      if(typeof raw==='string'&&Buffer.byteLength(raw,'utf8')>32768)return res.status(413).json({error:'corpo_excedido'});
      const result=await executarAnaliseVendas(typeof req.headers.authorization==='string'?req.headers.authorization:undefined,req.body,deps??{
        apiKey:process.env.OPENAI_API_KEY,authorize:autorizarControleVendas,revalidate:revalidarControleVendas,
      });
      return res.status(result.status).json(result.body);
    }catch{return res.status(503).json({error:'analise_indisponivel'});}
  };
}
export default criarHandlerAnaliseVendas();
