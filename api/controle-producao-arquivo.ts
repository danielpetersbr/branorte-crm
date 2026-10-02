import type {VercelRequest,VercelResponse} from '@vercel/node';
import type {SupabaseClient} from '@supabase/supabase-js';
import {criarCrmEspelho,obterAcessoEspelho,resolverEscopoEspelho,revalidarAcessoEspelho,ErroAcessoEspelho,type EscopoEspelho} from './_lib/producao-espelho-acesso.js';
import {criarFonteEspelhoPrivada,type FonteEspelho} from './_lib/producao-espelho-reader.js';
import {autorizarCardFicha} from './_lib/producao-ficha-reader.js';
import {caminhoArquivoPrivado,caminhoPedidoTratado,lerCorpoLimitado,limparPedidoProducao} from './_lib/producao-ficha-arquivo.js';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,CHUNK=3*1024*1024,MAX_FILE=80*1024*1024;
const fail=(status=503):never=>{throw new ErroAcessoEspelho(status,'arquivo_indisponivel');};
const registro=(v:unknown):Record<string,unknown>=>{if(!v||typeof v!=='object'||Array.isArray(v))return fail();return v as Record<string,unknown>;};
export type RecursoFicha={cardId:string;tipo:'pedido'|'anexo'|'video'|'foto'|'comentario';arquivoId?:string;inicio:number};
export type ArquivoFicha={bytes:Buffer;nome:string;mime:string;total:number;inicio:number;versao:string};
export function parametrosArquivoFicha(query:Record<string,unknown>):RecursoFicha {
  const own=(key:string)=>Object.prototype.hasOwnProperty.call(query,key);
  if(!own('cardId')||!own('tipo')||query.arquivoId!==undefined&&!own('arquivoId')||query.inicio!==undefined&&!own('inicio')||Object.keys(query).some(k=>!['cardId','tipo','arquivoId','inicio'].includes(k))||typeof query.cardId!=='string'||!UUID.test(query.cardId)||typeof query.tipo!=='string'||!['pedido','anexo','video','foto','comentario'].includes(query.tipo))return fail(400);
  const tipo=query.tipo as RecursoFicha['tipo'];
  if(tipo==='pedido'?query.arquivoId!==undefined:typeof query.arquivoId!=='string'||!UUID.test(query.arquivoId))return fail(400);
  if(query.inicio!==undefined&&(typeof query.inicio!=='string'||!/^\d{1,9}$/.test(query.inicio)||Number(query.inicio)>=MAX_FILE||Number(query.inicio)%CHUNK!==0||tipo==='pedido'))return fail(400);
  return {cardId:query.cardId,tipo,arquivoId:query.arquivoId as string|undefined,inicio:Number(query.inicio??0)};
}
async function selecionado(fonte:FonteEspelho,table:string,columns:string,id:string,signal:AbortSignal,cardId?:string){
  let q=fonte.from(table).select(columns,{count:'exact'}).in('id',[id]);if(cardId)q=q.in('card_id',[cardId]);
  const receipt=await q.order('id',{ascending:true}).range(0,1).abortSignal(signal);
  registro(receipt);
  if(!['data','count','error'].every(k=>Object.prototype.hasOwnProperty.call(receipt,k))||receipt.error!==null&&receipt.error!==undefined||!Number.isSafeInteger(receipt.count)||Number(receipt.count)<0||!Array.isArray(receipt.data)||receipt.count!==receipt.data.length||receipt.data.length>1||receipt.data.length===1&&!Object.prototype.hasOwnProperty.call(receipt.data,0))return fail();
  if(!receipt.data.length)return fail(404);const row=registro(receipt.data[0]);
  if(!columns.split(',').every(k=>Object.prototype.hasOwnProperty.call(row,k))||row.id!==id||cardId&&row.card_id!==cardId)return fail();return row;
}
export async function lerArquivoProducao(scope:EscopoEspelho,recurso:RecursoFicha,signal:AbortSignal,deps:{autorizar?:typeof autorizarCardFicha;fetch?:typeof fetch;config?:{PRODUCAO_SUPABASE_URL?:string;PRODUCAO_PRIVATE_READ_KEY?:string}}={}):Promise<ArquivoFicha>{
  const context=await (deps.autorizar??autorizarCardFicha)(scope,recurso.cardId,{signal});if(signal.aborted)return fail();
  let bucket='producao',path='',nome='ORCAMENTO_TRATADO.docx',mime='application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  if(recurso.tipo==='pedido')path=caminhoPedidoTratado(context.card.doc_tratado_path);
  else {
    bucket=recurso.tipo==='comentario'?'comentarios-anexos':'card-attachments';
    const row=await selecionado(context.fonte,recurso.tipo==='comentario'?'comentarios_anexos':'card_attachments',recurso.tipo==='comentario'?'id,comentario_id,file_name,file_path,file_type,file_size':'id,card_id,file_name,file_path,file_type,file_size,categoria',recurso.arquivoId!,signal,recurso.tipo==='comentario'?undefined:recurso.cardId);
    if(recurso.tipo==='comentario'){
      if(typeof row.comentario_id!=='string'||!UUID.test(row.comentario_id))return fail();await selecionado(context.fonte,'comentarios','id,card_id',row.comentario_id,signal,recurso.cardId);
    }
    if(typeof row.file_name!=='string'||!row.file_name||row.file_name.length>256||row.file_size!==null&&(!Number.isSafeInteger(row.file_size)||Number(row.file_size)<0||Number(row.file_size)>MAX_FILE)||row.file_type!==null&&typeof row.file_type!=='string')return fail();
    path=caminhoArquivoPrivado(bucket,row.file_path);
    if(!path.toLowerCase().startsWith(recurso.cardId.toLowerCase()+'/')&&recurso.tipo!=='comentario')return fail();
    if(recurso.tipo==='foto'&&(row.categoria!=='logistica'||!/^image\/(?:jpeg|png|webp)$/i.test(String(row.file_type))))return fail(404);
    if(recurso.tipo==='video'&&!/^video\/(?:mp4|webm|quicktime)$/i.test(String(row.file_type)))return fail(404);
    nome=row.file_name;mime=/^(?:image\/(?:jpeg|png|webp)|video\/(?:mp4|webm|quicktime)|application\/pdf)$/i.test(String(row.file_type))?String(row.file_type).toLowerCase():'application/octet-stream';
  }
  let url='',secret='';
  criarFonteEspelhoPrivada(deps.config??{PRODUCAO_SUPABASE_URL:process.env.PRODUCAO_SUPABASE_URL,PRODUCAO_PRIVATE_READ_KEY:process.env.PRODUCAO_PRIVATE_READ_KEY},'fabrica',(root,key)=>{url=root;secret=key;return context.fonte;});
  const response=await (deps.fetch??fetch)(`${url}/storage/v1/object/authenticated/${bucket}/${path.split('/').map(encodeURIComponent).join('/')}`,{headers:{Authorization:`Bearer ${secret}`,apikey:secret,...(recurso.tipo==='pedido'?{}:{Range:`bytes=${recurso.inicio}-${recurso.inicio+CHUNK-1}`})},signal,redirect:'error',cache:'no-store'});
  if(!response.ok||signal.aborted)return fail(response.status===404?404:503);
  if(recurso.tipo==='pedido'){
    const bytes=await limparPedidoProducao(await lerCorpoLimitado(response,15*1024*1024));if(signal.aborted)return fail();return {bytes,nome,mime,total:bytes.length,inicio:0,versao:'tratado'};
  }
  let total=0;const range=response.headers.get('Content-Range');
  if(response.status===206){const match=/^bytes (\d+)-(\d+)\/(\d+)$/.exec(range??'');if(!match||Number(match[1])!==recurso.inicio||Number(match[2])!==Math.min(recurso.inicio+CHUNK-1,Number(match[3])-1)||Number(match[2])<recurso.inicio||Number(match[3])>MAX_FILE||Number(match[3])<=Number(match[2]))return fail();total=Number(match[3]);}
  else if(response.status!==200||recurso.inicio!==0)return fail();
  const bytes=await lerCorpoLimitado(response,CHUNK);if(signal.aborted)return fail();if(!total)total=bytes.length;
  if(total<=0||bytes.length!==Math.min(CHUNK,total-recurso.inicio))return fail();
  const versao=response.headers.get('ETag')??response.headers.get('Last-Modified')??'';
  if(versao.length>256||/[\u0000-\u001f\u007f]/.test(versao)||total>CHUNK&&!versao)return fail();
  return {bytes,nome,mime,total,inicio:recurso.inicio,versao};
}
export function criarHandlerArquivoProducao(deps:{crm?:()=>SupabaseClient;ler?:typeof lerArquivoProducao;deadlineMs?:number}={}) {
  return async(req:VercelRequest,res:VercelResponse)=>{
    res.setHeader('Cache-Control','no-store');res.setHeader('Vary','Authorization');res.setHeader('X-Content-Type-Options','nosniff');
    if(req.method!=='GET'){res.setHeader('Allow','GET');return res.status(405).json({error:'method_not_allowed'});}
    let recurso:RecursoFicha;try{if(req.body!==null&&req.body!==undefined)return fail(400);recurso=parametrosArquivoFicha(req.query??{});}catch{return res.status(400).json({error:'parametros_invalidos'});}
    const token=typeof req.headers.authorization==='string'?/^Bearer[ \t]+([^\s]+)$/i.exec(req.headers.authorization)?.[1]:null;
    if(!token)return res.status(401).json({error:'no_auth'});
    const controller=new AbortController(),duration=deps.deadlineMs??45000;let timer:ReturnType<typeof setTimeout>|undefined;
    if(!Number.isFinite(duration)||duration<=0||duration>45000)return res.status(503).json({error:'arquivo_indisponivel'});
    const check=()=>{if(controller.signal.aborted)return fail();};
    try{
      const stop=new Promise<never>((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(new ErroAcessoEspelho(503,'arquivo_indisponivel'));},duration);});
      const work=async()=>{
        const crm=deps.crm?.()??criarCrmEspelho({SUPABASE_URL:process.env.SUPABASE_URL,SUPABASE_SERVICE_ROLE_KEY:process.env.SUPABASE_SERVICE_ROLE_KEY});
        const access=await obterAcessoEspelho(crm,token);check();if(!access.ok)return {error:access};
        const scope=await resolverEscopoEspelho(crm,access.snapshot);check();const arquivo=await (deps.ler??lerArquivoProducao)(scope,recurso,controller.signal);check();
        const current=await revalidarAcessoEspelho(crm,token,access.snapshot,scope);check();if(!current.ok)return {error:current};
        if(!Buffer.isBuffer(arquivo.bytes)||!arquivo.bytes.length||arquivo.bytes.length>CHUNK||typeof arquivo.nome!=='string'||typeof arquivo.mime!=='string'||!Number.isSafeInteger(arquivo.total)||arquivo.total<arquivo.bytes.length||arquivo.total>MAX_FILE||arquivo.inicio!==recurso.inicio||typeof arquivo.versao!=='string')return fail();
        return {arquivo};
      };
      const result=await Promise.race([work(),stop]);check();
      if(result.error)return res.status(result.error.status).json({error:result.error.error});
      const a=result.arquivo;res.setHeader('Content-Type',a.mime);res.setHeader('Content-Disposition',`attachment; filename*=UTF-8''${encodeURIComponent(a.nome.replace(/[\r\n\\/]/g,'_'))}`);res.setHeader('X-Arquivo-Total',String(a.total));res.setHeader('X-Arquivo-Inicio',String(a.inicio));res.setHeader('X-Arquivo-Versao',encodeURIComponent(a.versao));return res.status(200).send(a.bytes);
    }catch(error){return res.status(error instanceof ErroAcessoEspelho?error.status:503).json({error:'arquivo_indisponivel'});}
    finally{controller.abort();if(timer!==undefined)clearTimeout(timer);}
  };
}
export default criarHandlerArquivoProducao();
