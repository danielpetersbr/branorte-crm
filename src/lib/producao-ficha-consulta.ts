import {autoridadeEspelhoValida,chaveConsultaEspelho,type AutoridadeEspelho} from './producao-espelho-consulta.js';

export type ArquivoFichaEspelho={id:string;tipo:'anexo'|'video'|'foto'|'comentario';nome:string;mime:string|null;tamanho:number|null;categoria:string|null;criadoEm:string|null};
export type ProjetoFichaEspelho={id:string;card_id:string;responsavel_projeto_id:string|null;responsavel_nome:string|null;status_projeto:string|null;andamento:number|null;previsao_termino:string|null;prazo_prometido:string|null;prazo_interno:string|null;motivo_bloqueio:string|null;bom_aprovada:boolean|null;data_inicio:string|null;data_conclusao:string|null;standby_inicio:string|null;dias_pausados:number|null};
export type LogisticaFichaEspelho={card_id:string;peso_kg:string|null;qtd_volumes:number|null;medidas:string|null;observacoes:string|null;updated_at:string;updated_by:string|null};
export type BomFichaEspelho={id:string;card_id:string;item:string;categoria:string|null;quantidade:string;unidade:string|null;item_critico:boolean|null;observacao:string|null;status_item:string|null;created_at:string|null;updated_at:string|null};
export type ChecklistProjetoFichaEspelho={id:string;card_id:string;titulo:string;descricao:string|null;ordem:number|null;status:string|null;responsavel_id:string|null;responsavel_nome:string|null;created_at:string|null;updated_at:string|null;concluido_por:string|null;concluido_em:string|null};
export type ComentarioFichaEspelho={id:string;conteudo:string;autor_nome:string|null;created_at:string|null;updated_at:string|null;anexos:ArquivoFichaEspelho[]};
export type FichaEspelho={cardId:string;consultadoEm:string;parcial:false;aviso:string;complete:{projeto:true;logistica:true;bom:true;projetoChecklist:true;comentarios:true;anexos:true};totals:{projeto:number;logistica:number;bom:number;projetoChecklist:number;comentarios:number;anexos:number};documento:{disponivel:boolean};projeto:ProjetoFichaEspelho|null;logistica:LogisticaFichaEspelho|null;bom:BomFichaEspelho[];projetoChecklist:ChecklistProjetoFichaEspelho[];comentarios:ComentarioFichaEspelho[];anexos:ArquivoFichaEspelho[]};
export const uuidFicha=(v:unknown):v is string=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
const own=(v:object,key:string)=>Object.prototype.hasOwnProperty.call(v,key);
const fail=():never=>{throw Error('Ficha de produção indisponível. Tente novamente.');};
const obj=(v:unknown):Record<string,unknown>=>{if(!v||typeof v!=='object'||Array.isArray(v))return fail();return v as Record<string,unknown>;};
const str=(v:unknown):v is string=>typeof v==='string';
const int=(v:unknown)=>typeof v==='number'&&Number.isInteger(v)&&v>=-2147483648&&v<=2147483647;
const bool=(v:unknown)=>typeof v==='boolean';
const numeric=(v:unknown)=>str(v)&&/^(?:NaN|-?Infinity|[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?)$/.test(v);
type Field=[string,(v:unknown)=>boolean,boolean?];
const texts=(names:string):Field[]=>names.split(',').map(name=>[name,str,true]);
const physical=(v:unknown,schema:Field[])=>{const row=obj(v),out:Record<string,unknown>={};for(const [name,test,nullable] of schema){if(!own(row,name)||!(nullable&&row[name]===null)&&!test(row[name]))return fail();out[name]=row[name];}return out;};
const dense=(v:unknown):unknown[]=>{if(!Array.isArray(v)||v.length>100000)return fail();for(let i=0;i<v.length;i++)if(!own(v,String(i)))return fail();return v;};
const unique=(rows:Array<{id:string}>)=>{const ids=new Set<string>();for(const row of rows){const id=row.id.toLowerCase();if(ids.has(id))return fail();ids.add(id);}};
const relation=(v:unknown,cardId:string)=>{if(!uuidFicha(v)||v.toLowerCase()!==cardId.toLowerCase())return fail();};
const fileSchema:Field[]=[['id',uuidFicha],['tipo',v=>str(v)&&['anexo','video','foto','comentario'].includes(v)],['nome',str],...texts('mime,categoria,criadoEm'),['tamanho',v=>int(v)&&Number(v)>=0,true]];
const projectSchema:Field[]=[['id',uuidFicha],['card_id',uuidFicha],['responsavel_projeto_id',uuidFicha,true],...texts('responsavel_nome,status_projeto,previsao_termino,prazo_prometido,prazo_interno,motivo_bloqueio,data_inicio,data_conclusao,standby_inicio'),['andamento',int,true],['dias_pausados',int,true],['bom_aprovada',bool,true]];
const logisticsSchema:Field[]=[['card_id',uuidFicha],['peso_kg',numeric,true],['qtd_volumes',int,true],...texts('medidas,observacoes'),['updated_at',str],['updated_by',uuidFicha,true]];
const bomSchema:Field[]=[['id',uuidFicha],['card_id',uuidFicha],['item',str],['quantidade',numeric],...texts('categoria,unidade,observacao,status_item,created_at,updated_at'),['item_critico',bool,true]];
const checkSchema:Field[]=[['id',uuidFicha],['card_id',uuidFicha],['titulo',str],...texts('descricao,status,responsavel_nome,created_at,updated_at,concluido_em'),['responsavel_id',uuidFicha,true],['concluido_por',uuidFicha,true],['ordem',int,true]];

/** Closed browser/server DTO: paths, signed URLs, emails and source credentials never cross this boundary. */
export function decodificarFichaEspelho(input:unknown,cardId:string):FichaEspelho {
  const data=obj(input),keys=['projeto','logistica','bom','projetoChecklist','comentarios','anexos'] as const;
  if(!['cardId','consultadoEm','parcial','aviso','complete','totals','documento',...keys].every(k=>own(data,k)))return fail();
  if(!uuidFicha(cardId)||!uuidFicha(data.cardId)||data.cardId.toLowerCase()!==cardId.toLowerCase()||!own(data,'parcial')||data.parcial!==false||!str(data.consultadoEm)||!/^\d{4}-\d{2}-\d{2}T/.test(data.consultadoEm)||!Number.isFinite(Date.parse(data.consultadoEm))||!str(data.aviso))return fail();
  const complete=obj(data.complete),totals=obj(data.totals),documento=obj(data.documento);
  for(const key of keys)if(!own(complete,key)||complete[key]!==true||!own(totals,key)||!Number.isSafeInteger(totals[key])||Number(totals[key])<0)return fail();
  if(!own(documento,'disponivel')||!bool(documento.disponivel)||!own(data,'projeto')||!own(data,'logistica'))return fail();
  const projeto=data.projeto===null?null:physical(data.projeto,projectSchema) as ProjetoFichaEspelho|null;
  if(projeto){relation(projeto.card_id,cardId);if(projeto.responsavel_projeto_id===null?projeto.responsavel_nome!==null:!str(projeto.responsavel_nome)||!projeto.responsavel_nome.trim())return fail();}
  const logistica=data.logistica===null?null:physical(data.logistica,logisticsSchema) as LogisticaFichaEspelho|null;
  if(logistica)relation(logistica.card_id,cardId);
  const bom=dense(data.bom).map(v=>{const row=physical(v,bomSchema) as BomFichaEspelho;relation(row.card_id,cardId);return row;});unique(bom);
  const projetoChecklist=dense(data.projetoChecklist).map(v=>{const row=physical(v,checkSchema) as ChecklistProjetoFichaEspelho;relation(row.card_id,cardId);return row;});unique(projetoChecklist);
  const files=(v:unknown,comment=false)=>dense(v).map(v=>{const row=physical(v,fileSchema) as ArquivoFichaEspelho;if(comment&&row.tipo!=='comentario'||!comment&&row.tipo==='comentario')return fail();return row;});
  const comentarios=dense(data.comentarios).map(v=>{const row=physical(v,[['id',uuidFicha],['conteudo',str],...texts('autor_nome,created_at,updated_at')]) as Omit<ComentarioFichaEspelho,'anexos'>;return {...row,anexos:files(obj(v).anexos,true)};});unique(comentarios);
  const anexos=files(data.anexos),allFiles=[...anexos,...comentarios.flatMap(c=>c.anexos)];unique(allFiles);
  const counts={projeto:projeto?1:0,logistica:logistica?1:0,bom:bom.length,projetoChecklist:projetoChecklist.length,comentarios:comentarios.length,anexos:allFiles.length};
  if(Object.values(counts).reduce((n,v)=>n+v,0)>100000||keys.some(key=>totals[key]!==counts[key]))return fail();
  const out: FichaEspelho={cardId:data.cardId,consultadoEm:data.consultadoEm,parcial:false,aviso:data.aviso,complete:{projeto:true,logistica:true,bom:true,projetoChecklist:true,comentarios:true,anexos:true},totals:counts,documento:{disponivel:documento.disponivel as boolean},projeto,logistica,bom,projetoChecklist,comentarios,anexos};
  if(new TextEncoder().encode(JSON.stringify(out)).byteLength>4000000)return fail();return out;
}

export type DepsConsultaFicha={cardId:string;authority:AutoridadeEspelho;signal:AbortSignal;getCurrentAuthority:()=>AutoridadeEspelho;getCurrentToken:()=>string|null;getSession:()=>Promise<{user:{id:string};access_token:string}|null>;fetch:(url:string,init:RequestInit)=>Promise<{ok:boolean;status:number;json:()=>Promise<unknown>}>};
export async function consultarFichaEspelho(d:DepsConsultaFicha):Promise<FichaEspelho>{
  const signature=JSON.stringify(chaveConsultaEspelho(d.authority)),token=d.getCurrentToken();
  const check=()=>{const current=d.getCurrentAuthority();if(d.signal.aborted||!uuidFicha(d.cardId)||!token||d.getCurrentToken()!==token||!autoridadeEspelhoValida(d.authority)||!autoridadeEspelhoValida(current)||signature!==JSON.stringify(chaveConsultaEspelho(current)))throw Error('Sessão alterada. Abra o card novamente.');};
  const sessionCheck=(session:Awaited<ReturnType<DepsConsultaFicha['getSession']>>)=>{check();if(!session||session.user.id!==d.authority.userId||session.access_token!==token)throw Error('Sessão alterada. Abra o card novamente.');};
  try {
    check();sessionCheck(await d.getSession());
    const response=await d.fetch('/api/controle-producao-ficha?cardId='+encodeURIComponent(d.cardId),{method:'GET',headers:{Authorization:'Bearer '+token},cache:'no-store',signal:d.signal});check();
    if(!response.ok)return fail();const raw=await response.json();check();const out=decodificarFichaEspelho(raw,d.cardId);check();sessionCheck(await d.getSession());return out;
  } catch(error){check();if(error instanceof Error&&error.message==='Ficha de produção indisponível. Tente novamente.')throw error;return fail();}
}
