import {createClient,type SupabaseClient} from '@supabase/supabase-js';
import {exigirAprovado} from './exigir-aprovado.js';
export type EscopoEspelho={userId:string;role:string;displayName:string;vendedores:string[]|null};
export type SnapshotEspelho={userId:string;role:string;approvedAt:string;vendorId:string|null};
export type AcessoEspelho={ok:true;snapshot:SnapshotEspelho}|{ok:false;status:number;error:string};
export class ErroAcessoEspelho extends Error {constructor(public status:number,message:string){super(message);}}
const roles=['admin','financeiro','vendor','mapa','marketing','visualizador'];
const capability='menu.producao_fabrica';
const uuid=(v:unknown):v is string=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
const own=(v:object,key:PropertyKey)=>Object.prototype.hasOwnProperty.call(v,key);
const record=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const unavailable=():never=>{throw new ErroAcessoEspelho(503,'producao_indisponivel');};
const denied=(error='sem_permissao'):AcessoEspelho=>({ok:false,status:403,error});
type Factory=(url:string,key:string,options:{auth:{persistSession:false;autoRefreshToken:false;detectSessionInUrl:false}})=>SupabaseClient;
/** Explicit CRM server channel, independent of both production and canonical Controle. */
export function criarCrmEspelho(config:Record<string,unknown>,create:Factory=(url,key,options)=>createClient(url,key,options) as unknown as SupabaseClient):SupabaseClient {
  try {
    if(!record(config)||Object.keys(config).some(k=>!['SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY'].includes(k)))return unavailable();
    const root='https://flwbeevtvjiouxdjmziv.supabase.co',url=config.SUPABASE_URL,secret=config.SUPABASE_SERVICE_ROLE_KEY;
    if(url!==root&&url!==root+'/')return unavailable();
    if(typeof secret!=='string'||/[\s\u0000-\u001f\u007f]/.test(secret))return unavailable();
    if(!/^sb_secret_[A-Za-z0-9_-]{20,}$/.test(secret)) {
      if(!/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(secret))return unavailable();
      const header=JSON.parse(Buffer.from(secret.split('.')[0],'base64url').toString('utf8')) as unknown;
      const payload=JSON.parse(Buffer.from(secret.split('.')[1],'base64url').toString('utf8')) as unknown;
      if(!record(header)||!own(header,'alg')||header.alg!=='HS256'||!record(payload)||!own(payload,'ref')||!own(payload,'role')||payload.role!=='service_role'||payload.ref!=='flwbeevtvjiouxdjmziv')return unavailable();
    }
    return create(root,secret,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
  } catch {return unavailable();}
}
/** Reuses the published approval helper but never relies on its legacy numeric vendorId. */
export async function obterAcessoEspelho(crm:SupabaseClient,token:string):Promise<AcessoEspelho> {
  try {
    const approval=await exigirAprovado(crm,token);
    if(!approval.ok)return {ok:false,status:approval.status,error:approval.error};
    const user=approval.usuario;
    if(!uuid(user.userId)||user.contaTecnica||!roles.includes(user.role??''))return denied();
    const receipt=await crm.from('user_profiles').select('id,role,approved_at,vendor_id').eq('id',user.userId).maybeSingle();
    if(receipt.error)return {ok:false,status:500,error:'profile_lookup_failed'};
    const row=receipt.data as unknown;
    if(!record(row)||!['id','role','approved_at','vendor_id'].every(k=>own(row,k))||row.id!==user.userId||row.role!==user.role||typeof row.approved_at!=='string'||!row.approved_at||row.vendor_id!==null&&!uuid(row.vendor_id))return denied('identity_changed');
    const snapshot:SnapshotEspelho={userId:user.userId,role:user.role!,approvedAt:row.approved_at,vendorId:row.vendor_id as string|null};
    const papel=await crm.from('role_permissions').select('permissions').eq('role',snapshot.role).maybeSingle();
    if(papel.error)return {ok:false,status:500,error:'permissions_lookup_failed'};
    const override=await crm.from('controle_permissoes_usuario').select('permitido').eq('user_id',snapshot.userId).eq('feature_key',capability).maybeSingle();
    if(override.error)return {ok:false,status:500,error:'permissions_lookup_failed'};
    const r=override.data as unknown;
    if(r!==null&&(!record(r)||!own(r,'permitido')||typeof r.permitido!=='boolean'))return {ok:false,status:500,error:'permissions_lookup_failed'};
    const p=papel.data as unknown;
    const permissions=record(p)&&own(p,'permissions')?p.permissions:undefined;
    if(permissions!==undefined&&permissions!==null&&!record(permissions))return {ok:false,status:500,error:'permissions_lookup_failed'};
    const permitido=r===null?record(permissions)&&own(permissions,capability)&&permissions[capability]===true:(r as Record<string,unknown>).permitido===true;
    return permitido?{ok:true,snapshot}:denied();
  } catch {return {ok:false,status:503,error:'producao_indisponivel'};}
}
export async function revalidarAcessoEspelho(crm:SupabaseClient,token:string,old:SnapshotEspelho,oldScope:EscopoEspelho):Promise<AcessoEspelho> {
  const next=await obterAcessoEspelho(crm,token);if(!next.ok)return next;
  if(!['userId','role','approvedAt','vendorId'].every(k=>next.snapshot[k as keyof SnapshotEspelho]===old[k as keyof SnapshotEspelho]))return denied('identity_changed');
  try {
    // Re-read the canonical entity and all cross-field collisions after the source await.
    // Never project previously fetched data under a newly acquired scope.
    const currentScope=await resolverEscopoEspelho(crm,next.snapshot);
    const previous=oldScope.vendedores,current=currentScope.vendedores;
    const same=previous===null?current===null:current!==null&&previous.length===current.length&&previous.every(value=>current.includes(value));
    return same&&oldScope.userId===currentScope.userId&&oldScope.role===currentScope.role?next:denied('identity_changed');
  } catch(error) {
    return {ok:false,status:error instanceof ErroAcessoEspelho?error.status:503,error:error instanceof ErroAcessoEspelho?error.message:'producao_indisponivel'};
  }
}
export async function resolverEscopoEspelho(crm:SupabaseClient,snapshot:SnapshotEspelho):Promise<EscopoEspelho> {
  if(!uuid(snapshot.userId)||!roles.includes(snapshot.role))throw new ErroAcessoEspelho(403,'sem_escopo');
  if(['admin','financeiro'].includes(snapshot.role))return {userId:snapshot.userId,role:snapshot.role,displayName:'',vendedores:null};
  if(!uuid(snapshot.vendorId))throw new ErroAcessoEspelho(403,'sem_escopo');
  try {
    const receipt=await crm.from('vendors').select('id,key,name').eq('id',snapshot.vendorId).maybeSingle();
    const row=receipt.data as unknown;
    if(receipt.error||!record(row)||!['id','key','name'].every(k=>own(row,k))||row.id!==snapshot.vendorId||typeof row.key!=='string'||!row.key.trim()||typeof row.name!=='string'||!row.name.trim())return unavailable();
    // Only the current CRM entity supplies canonical strings. Reject ambiguous cross-field mappings.
    const values=[...new Set([row.key,row.name])];
    for(const value of values)for(const field of ['key','name']) {
      const match=await crm.from('vendors').select('id').eq(field,value).maybeSingle();
      if(match.error||match.data!==null&&(!record(match.data)||!own(match.data,'id')||match.data.id!==snapshot.vendorId))return unavailable();
    }
    return {userId:snapshot.userId,role:snapshot.role,displayName:'',vendedores:values};
  } catch {return unavailable();}
}
/** Exact canonical strings only: no card name, substring, case-fold or invented alias. */
export function pedidoNoEscopoEspelho(pedido:{vendedor:string|null;vendedor_2:string|null},scope:EscopoEspelho) {
  return scope.vendedores===null||[pedido.vendedor,pedido.vendedor_2].some(v=>typeof v==='string'&&scope.vendedores!.includes(v));
}
