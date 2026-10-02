import type { SupabaseClient } from '@supabase/supabase-js';
import {exigirAprovado,exigirPermissaoDoPapel} from './exigir-aprovado.js';
import {criarCrmEspelho} from './producao-espelho-acesso.js';
import {resolverEscopo,ehGateErro} from './financeiro-core.js';
export type SnapshotControleVendas = {userId:string;role:string;approvedAt:string;vendorId:string|number|null;vendedores:string[]|null};
export type AcessoControleVendas = {ok:true;snapshot:SnapshotControleVendas}|{ok:false;status:number;error:string};
export type DependenciasAcessoVendas={crm:SupabaseClient;resolver:(authorization:string|undefined)=>Promise<unknown>};
const record=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const uuid=(v:unknown):v is string=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
const denied=(error='sem_escopo'):AcessoControleVendas=>({ok:false,status:403,error});

/** CRM approval, exact Financeiro capability and existing canonical seller scope are fresh reads. */
export async function autorizarControleVendas(authorization:string|undefined,deps?:DependenciasAcessoVendas):Promise<AcessoControleVendas>{
  const token=typeof authorization==='string'?authorization.match(/^Bearer ([^\s]+)$/i)?.[1]:undefined;
  if(!token)return {ok:false,status:401,error:'no_auth'};
  try {
    const current=deps??{crm:criarCrmEspelho({SUPABASE_URL:process.env.SUPABASE_URL,SUPABASE_SERVICE_ROLE_KEY:process.env.SUPABASE_SERVICE_ROLE_KEY}),resolver:resolverEscopo};
    const approved=await exigirAprovado(current.crm,token);
    if(!approved.ok)return {ok:false,status:approved.status,error:approved.error};
    if(approved.usuario.contaTecnica||!uuid(approved.usuario.userId)||!approved.usuario.role)return denied();
    const receipt=await current.crm.from('user_profiles').select('id,role,approved_at,vendor_id').eq('id',approved.usuario.userId).maybeSingle();
    const row:unknown=receipt.data;
    if(receipt.error)return {ok:false,status:500,error:'profile_lookup_failed'};
    if(!record(row)||row.id!==approved.usuario.userId||row.role!==approved.usuario.role||typeof row.approved_at!=='string'||!row.approved_at||!Object.prototype.hasOwnProperty.call(row,'vendor_id'))return denied('identity_changed');
    const vendorId=row.vendor_id;
    if(vendorId!==null&&!uuid(vendorId)&&!(typeof vendorId==='number'&&Number.isSafeInteger(vendorId)&&vendorId>0))return denied('sem_escopo');
    const permission=await exigirPermissaoDoPapel(current.crm,approved.usuario,'menu.financeiro');
    if(!permission.ok)return permission;
    const scope=await current.resolver(authorization);
    if(!record(scope))return denied();
    if(ehGateErro(scope as Awaited<ReturnType<typeof resolverEscopo>>)){
      const status=typeof scope.status==='number'&&[401,403,500,503].includes(scope.status)?scope.status:503;
      const error=typeof scope.error==='string'&&/^[a-z_]{1,64}$/.test(scope.error)?scope.error:'controle_indisponivel';
      return {ok:false,status,error};
    }
    if(scope.userId!==row.id||scope.role!==row.role)return denied('identity_changed');
    const global=['admin','financeiro'].includes(row.role as string);
    let vendedores:string[]|null=null;
    if(global){if(scope.vendedores!==null)return denied('identity_changed');}
    else {
      if(vendorId===null||!Array.isArray(scope.vendedores)||!scope.vendedores.length||scope.vendedores.length>10||scope.vendedores.some(v=>typeof v!=='string'||!v.trim()||v.length>160))return denied();
      vendedores=[...new Set(scope.vendedores as string[])].sort();
    }
    return {ok:true,snapshot:{userId:row.id as string,role:row.role as string,approvedAt:row.approved_at,vendorId:vendorId as string|number|null,vendedores}};
  } catch {return {ok:false,status:503,error:'controle_indisponivel'};}
}

/** Source data may only leave under the same approved identity and scope that requested it. */
export async function revalidarControleVendas(authorization:string|undefined,snapshot:SnapshotControleVendas,deps?:DependenciasAcessoVendas):Promise<AcessoControleVendas>{
  const next=await autorizarControleVendas(authorization,deps);
  if(!next.ok)return next;
  if(!['userId','role','approvedAt','vendorId'].every(k=>next.snapshot[k as keyof SnapshotControleVendas]===snapshot[k as keyof SnapshotControleVendas]))return denied('identity_changed');
  const a=snapshot.vendedores,b=next.snapshot.vendedores;
  if(a===null?b!==null:b===null||a.length!==b.length||a.some(v=>!b.includes(v)))return denied('identity_changed');
  return next;
}
