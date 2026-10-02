import {ErroAcessoEspelho,pedidoNoEscopoEspelho,type EscopoEspelho} from './producao-espelho-acesso.js';
import {criarFonteEspelhoPrivada,validarEscopoEspelho,type FonteEspelho} from './producao-espelho-reader.js';
import {decodificarFichaEspelho,uuidFicha,type FichaEspelho,type ArquivoFichaEspelho} from '../../src/lib/producao-ficha-consulta.js';
export type DepsFicha={fonte?:()=>FonteEspelho|Promise<FonteEspelho>;fontePais?:()=>FonteEspelho|Promise<FonteEspelho>;signal?:AbortSignal;agora?:()=>number;instante?:()=>string;deadlineMs?:number};
export type CardAutorizadoFicha={id:string;pedido_id:string;doc_tratado_path:string|null};
type Row=Record<string,unknown>;
type Field=[string,(value:unknown)=>boolean,boolean?];
const str=(v:unknown)=>typeof v==='string',int=(v:unknown)=>typeof v==='number'&&Number.isInteger(v)&&v>=-2147483648&&v<=2147483647,bool=(v:unknown)=>typeof v==='boolean';
const numeric=(v:unknown)=>typeof v==='string'&&/^(?:NaN|-?Infinity|[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?)$/.test(v);
const texts=(names:string):Field[]=>names.split(',').map(name=>[name,str,true]);
const own=(v:object,k:string)=>Object.prototype.hasOwnProperty.call(v,k);
const fail=():never=>{throw Error('producao_indisponivel');};
const key=(v:unknown)=>{if(!uuidFicha(v))return fail();return v.toLowerCase();};
const record=(v:unknown):Row=>{if(!v||typeof v!=='object'||Array.isArray(v))return fail();return v as Row;};
const dense=(v:unknown):unknown[]=>{if(!Array.isArray(v)||v.length>100000)return fail();for(let i=0;i<v.length;i++)if(!own(v,String(i)))return fail();return v;};
const schemas:Record<string,Field[]>={
  producao_cards:[['id',uuidFicha],['pedido_id',str],...texts('doc_tratado_path')],
  pedidos_venda:[['id',uuidFicha],...texts('vendedor,vendedor_2')],
  projeto_detalhes:[['id',uuidFicha],['card_id',uuidFicha],['responsavel_projeto_id',uuidFicha,true],...texts('status_projeto,previsao_termino,prazo_prometido,prazo_interno,motivo_bloqueio,data_inicio,data_conclusao,standby_inicio'),['andamento',int,true],['dias_pausados',int,true],['bom_aprovada',bool,true]],
  projetistas:[['id',uuidFicha],['nome',v=>str(v)&&String(v).trim().length>0]],
  profiles:[['id',uuidFicha],...texts('full_name')],
  producao_logistica:[['card_id',uuidFicha],['peso_kg',numeric,true],['qtd_volumes',int,true],...texts('medidas,observacoes'),['updated_at',str],['updated_by',uuidFicha,true]],
  bom_itens:[['id',uuidFicha],['card_id',uuidFicha],['item',str],['quantidade',numeric],...texts('categoria,unidade,observacao,status_item,created_at,updated_at'),['item_critico',bool,true]],
  projeto_checklist:[['id',uuidFicha],['card_id',uuidFicha],['titulo',str],...texts('descricao,status,created_at,updated_at,concluido_em'),['responsavel_id',uuidFicha,true],['concluido_por',uuidFicha,true],['ordem',int,true]],
  comentarios:[['id',uuidFicha],['card_id',uuidFicha],['autor_id',uuidFicha,true],['conteudo',str],...texts('created_at,updated_at')],
  card_attachments:[['id',uuidFicha],['card_id',uuidFicha],['file_name',str],['file_path',str],...texts('file_type'),['file_size',v=>int(v)&&Number(v)>=0,true],['created_at',str],['categoria',str]],
  comentarios_anexos:[['id',uuidFicha],['comentario_id',uuidFicha],['file_name',str],['file_path',str],...texts('file_type,created_at'),['file_size',v=>int(v)&&Number(v)>=0,true]],
};
type Context={signal:AbortSignal;check:()=>void;read:(source:FonteEspelho,table:string,field:string,ids:string[])=>Promise<Row[]>};
async function bounded<T>(deps:DepsFicha,work:(context:Context)=>Promise<T>):Promise<T>{
  const duration=deps.deadlineMs??30000;if(!Number.isFinite(duration)||duration<=0||duration>30000)return fail();
  const controller=new AbortController(),now=deps.agora??(()=>performance.now()),start=now();let last=start,used=0,active=0;
  const queue:Array<{start:()=>void;reject:(error:Error)=>void}>=[];
  let rejectStop:(error:Error)=>void=()=>{};
  const stopped=new Promise<never>((_,reject)=>{rejectStop=reject;});
  const stop=()=>{controller.abort();const error=Error('producao_indisponivel');for(const task of queue.splice(0))task.reject(error);rejectStop(error);};
  const check=()=>{const t=now();if(controller.signal.aborted||!Number.isFinite(t)||!Number.isFinite(start)||t<last||t>=start+duration)return fail();last=t;};
  const timer=setTimeout(stop,duration);deps.signal?.addEventListener('abort',stop,{once:true});
  const drain=()=>{while(!controller.signal.aborted&&active<4&&queue.length)queue.shift()!.start();};
  const limited=(read:()=>Promise<Row[]>):Promise<Row[]>=>new Promise((resolve,reject)=>{
    if(controller.signal.aborted){reject(Error('producao_indisponivel'));return;}
    const begin=()=>{try{check();}catch{stop();reject(Error('producao_indisponivel'));return;}active++;void(async()=>{try{const value=await read();check();resolve(value);}catch{stop();reject(Error('producao_indisponivel'));}finally{active--;drain();}})();};
    queue.push({start:begin,reject});drain();
  });
  const read:Context['read']=async(source,table,field,ids)=>{
    const schema=schemas[table];if(!schema)return fail();const requested=[...new Set(ids.map(key))];
    const chunks=await Promise.all(Array.from({length:Math.ceil(requested.length/100)},async(_,batch)=>{
      check();const allowed=new Set(requested.slice(batch*100,batch*100+100));
      return limited(async()=>{
        const rows:Row[]=[];let count:number|undefined,previous:string|undefined;
        const pk=table==='producao_logistica'?'card_id':'id',columns=schema.map(([name])=>['peso_kg','quantidade'].includes(name)?name+':'+name+'::text':name).join(',');
        for(let offset=0;;offset+=1000){
          check();const receipt=await source.from(table).select(columns,{count:'exact'}).in(field,[...allowed]).order(pk,{ascending:true}).range(offset,offset+999).abortSignal(controller.signal);check();
          const r=record(receipt);if(!['data','count','error'].every(k=>own(r,k))||r.error!==null&&r.error!==undefined||!Number.isSafeInteger(r.count)||Number(r.count)<0||Number(r.count)>100000)return fail();
          if(count===undefined){count=r.count as number;used+=count;if(used>100000)return fail();}else if(count!==r.count)return fail();
          const page=dense(r.data);if(page.length!==Math.min(1000,Math.max(0,count-offset)))return fail();
          for(const value of page){check();const raw=record(value),row:Row={};for(const [name,test,nullable] of schema){check();if(!own(raw,name)||!(nullable&&raw[name]===null)&&!test(raw[name]))return fail();row[name]=raw[name];}if(!allowed.has(key(row[field])))return fail();const id=key(row[pk]);if(previous!==undefined&&id<=previous)return fail();previous=id;rows.push(row);}
          if(offset+1000>=count)break;
        }
        return rows;
      });
    }));
    check();const rows=chunks.flat(),pk=table==='producao_logistica'?'card_id':'id',seen=new Set<string>();for(const row of rows){const id=key(row[pk]);if(seen.has(id))return fail();seen.add(id);}return rows;
  };
  try {
    const run=async()=>{if(deps.signal?.aborted)stop();check();return work({signal:controller.signal,check,read});};
    return await Promise.race([run(),stopped]);
  }catch(error){stop();if(error instanceof ErroAcessoEspelho)throw error;return fail();}
  finally{clearTimeout(timer);deps.signal?.removeEventListener('abort',stop);}
}
const sourceFactory=(deps:DepsFicha)=>deps.fonte?.()??criarFonteEspelhoPrivada({PRODUCAO_SUPABASE_URL:process.env.PRODUCAO_SUPABASE_URL,PRODUCAO_PRIVATE_READ_KEY:process.env.PRODUCAO_PRIVATE_READ_KEY},'fabrica');
async function authorize(scopeInput:EscopoEspelho,cardId:string,deps:DepsFicha,ctx:Context){
  const scope=validarEscopoEspelho(scopeInput);if(!uuidFicha(cardId))throw new ErroAcessoEspelho(400,'parametros_invalidos');
  const fonte=await sourceFactory(deps);ctx.check();const cards=await ctx.read(fonte,'producao_cards','id',[cardId]);ctx.check();
  if(cards.length===0)throw new ErroAcessoEspelho(404,'card_nao_encontrado');if(cards.length!==1)return fail();const card=cards[0] as CardAutorizadoFicha;
  if(scope.vendedores!==null){
    if(!uuidFicha(card.pedido_id))throw new ErroAcessoEspelho(403,'sem_escopo');
    const pais=await(deps.fontePais?.()??criarFonteEspelhoPrivada({CONTROLE_SUPABASE_URL:process.env.CONTROLE_SUPABASE_URL,CONTROLE_SERVICE_KEY:process.env.CONTROLE_SERVICE_KEY},'pais'));ctx.check();
    const parents=await ctx.read(pais,'pedidos_venda','id',[card.pedido_id]);ctx.check();
    if(parents.length!==1||!pedidoNoEscopoEspelho(parents[0] as {vendedor:string|null;vendedor_2:string|null},scope))throw new ErroAcessoEspelho(403,'sem_escopo');
  }
  return {fonte,card,signal:deps.signal??ctx.signal};
}
export async function autorizarCardFicha(scope:EscopoEspelho,cardId:string,deps:DepsFicha={}):Promise<{fonte:FonteEspelho;card:CardAutorizadoFicha;signal:AbortSignal}>{return bounded(deps,ctx=>authorize(scope,cardId,deps,ctx));}

/** Read extras for this authorized card only; never add them to the initial Kanban payload. */
export async function lerFichaEspelho(scope:EscopoEspelho,cardId:string,deps:DepsFicha={}):Promise<FichaEspelho>{
  return bounded(deps,async ctx=>{
    const {fonte,card}=await authorize(scope,cardId,deps,ctx);ctx.check();
    const [projects,logistics,bom,checks,comments,attachments]=await Promise.all([
      ctx.read(fonte,'projeto_detalhes','card_id',[card.id]),ctx.read(fonte,'producao_logistica','card_id',[card.id]),ctx.read(fonte,'bom_itens','card_id',[card.id]),ctx.read(fonte,'projeto_checklist','card_id',[card.id]),ctx.read(fonte,'comentarios','card_id',[card.id]),ctx.read(fonte,'card_attachments','card_id',[card.id]),
    ]);ctx.check();if(projects.length>1||logistics.length>1)return fail();
    const professionalIds=projects.flatMap(p=>p.responsavel_projeto_id===null?[]:[key(p.responsavel_projeto_id)]),profileIds=[...comments.flatMap(c=>c.autor_id===null?[]:[key(c.autor_id)]),...checks.flatMap(c=>c.responsavel_id===null?[]:[key(c.responsavel_id)])];
    const [professionals,profiles,commentFiles]=await Promise.all([ctx.read(fonte,'projetistas','id',professionalIds),ctx.read(fonte,'profiles','id',profileIds),ctx.read(fonte,'comentarios_anexos','comentario_id',comments.map(c=>key(c.id)))]);ctx.check();
    const names=new Map(profiles.map(p=>[key(p.id),p.full_name])),professionalNames=new Map(professionals.map(p=>[key(p.id),p.nome]));
    const file=(row:Row,comment=false):ArquivoFichaEspelho=>({id:row.id as string,tipo:comment?'comentario':typeof row.file_type==='string'&&row.file_type.startsWith('video/')?'video':row.categoria==='logistica'&&typeof row.file_type==='string'&&row.file_type.startsWith('image/')?'foto':'anexo',nome:row.file_name as string,mime:row.file_type as string|null,tamanho:row.file_size as number|null,categoria:comment?null:row.categoria as string,criadoEm:row.created_at as string|null});
    const projeto=projects.length?{...projects[0],responsavel_nome:projects[0].responsavel_projeto_id===null?null:professionalNames.get(key(projects[0].responsavel_projeto_id))}:null;
    const comentarioFiles=new Map<string,ArquivoFichaEspelho[]>();for(const row of commentFiles){ctx.check();const id=key(row.comentario_id),list=comentarioFiles.get(id)??[];list.push(file(row,true));comentarioFiles.set(id,list);}
    const out={cardId:card.id,consultadoEm:(deps.instante??(()=>new Date().toISOString()))(),parcial:false,aviso:'Leituras independentes; consistência entre coleções não comprovada.',complete:{projeto:true,logistica:true,bom:true,projetoChecklist:true,comentarios:true,anexos:true},totals:{projeto:projects.length,logistica:logistics.length,bom:bom.length,projetoChecklist:checks.length,comentarios:comments.length,anexos:attachments.length+commentFiles.length},documento:{disponivel:typeof card.doc_tratado_path==='string'&&/\.docx$/i.test(card.doc_tratado_path)},projeto,logistica:logistics[0]??null,bom,projetoChecklist:checks.map(c=>({...c,responsavel_nome:c.responsavel_id===null?null:names.get(key(c.responsavel_id))??null})),comentarios:comments.map(c=>({id:c.id,conteudo:c.conteudo,autor_nome:c.autor_id===null?null:names.get(key(c.autor_id))??null,created_at:c.created_at,updated_at:c.updated_at,anexos:comentarioFiles.get(key(c.id))??[]})),anexos:attachments.map(a=>file(a))};
    ctx.check();const result=decodificarFichaEspelho(out,card.id);ctx.check();return result;
  });
}
