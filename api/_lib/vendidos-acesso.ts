import type { SupabaseClient } from '@supabase/supabase-js'
import { exigirAprovado, exigirPermissaoDoPapel } from './exigir-aprovado.js'
import { criarCrmEspelho, resolverEscopoEspelho, ErroAcessoEspelho, type SnapshotEspelho, type EscopoEspelho } from './producao-espelho-acesso.js'
export type AcessoVendidos = { ok:true; snapshot:SnapshotEspelho; escopo:EscopoEspelho } | {ok:false;status:number;error:string}
export async function autorizarVendidos(authorization:string|undefined, crm?:SupabaseClient):Promise<AcessoVendidos> {
  const token=authorization?.match(/^Bearer\s+([^\s]+)$/i)?.[1]
  if(!token)return {ok:false,status:401,error:'no_auth'}
  try {
    const db=crm??criarCrmEspelho({SUPABASE_URL:process.env.SUPABASE_URL,SUPABASE_SERVICE_ROLE_KEY:process.env.SUPABASE_SERVICE_ROLE_KEY})
    const approval=await exigirAprovado(db,token)
    if(!approval.ok)return approval
    if(approval.usuario.contaTecnica||!['admin','vendor'].includes(approval.usuario.role??''))return {ok:false,status:403,error:'sem_permissao'}
    const permission=await exigirPermissaoDoPapel(db,approval.usuario,'menu.vendidos')
    if(!permission.ok)return permission
    const {data:p,error}=await db.from('user_profiles').select('id,role,approved_at,vendor_id').eq('id',approval.usuario.userId).maybeSingle()
    if(error)return {ok:false,status:503,error:'perfil_indisponivel'}
    if(!p||p.id!==approval.usuario.userId||p.role!==approval.usuario.role||!p.approved_at)return {ok:false,status:403,error:'identity_changed'}
    const snapshot:SnapshotEspelho={userId:p.id,role:p.role,approvedAt:p.approved_at,vendorId:p.vendor_id}
    return {ok:true,snapshot,escopo:await resolverEscopoEspelho(db,snapshot)}
  }catch(error){return {ok:false,status:error instanceof ErroAcessoEspelho?error.status:503,error:error instanceof ErroAcessoEspelho?error.message:'acesso_indisponivel'}}
}
export async function revalidarVendidos(authorization:string|undefined, anterior:Extract<AcessoVendidos,{ok:true}>, crm?:SupabaseClient):Promise<AcessoVendidos> {
  const atual=await autorizarVendidos(authorization,crm)
  if(!atual.ok)return atual
  const a=anterior.escopo.vendedores,b=atual.escopo.vendedores
  if(['userId','role','approvedAt','vendorId'].some(k=>anterior.snapshot[k as keyof SnapshotEspelho]!==atual.snapshot[k as keyof SnapshotEspelho])
    || (a===null?b!==null:b===null||a.length!==b.length||a.some(v=>!b.includes(v))))return {ok:false,status:403,error:'identity_changed'}
  return atual
}
