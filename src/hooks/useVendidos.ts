import { useQuery } from '@tanstack/react-query'
import { useAuth } from './useAuth'
import { supabase } from '@/lib/supabase'
import type { DadosVendidos } from '@/lib/vendidos'
export function useVendidos() {
  const auth=useAuth(), p=auth.profile
  const autorizado=!!auth.session?.user.id&&auth.session.user.id===p?.id&&!auth.loading&&!auth.profileError&&!!p?.approved_at&&['admin','vendor'].includes(p.role)
  const query=useQuery<DadosVendidos>({
    queryKey:['vendidos-pedidos',auth.session?.user.id,p?.role,p?.vendor_id,p?.approved_at],
    enabled:autorizado,staleTime:30000,refetchInterval:60000,retry:1,
    queryFn:async({signal})=>{
      const {data:{session}}=await supabase.auth.getSession()
      if(!session||session.user.id!==auth.session?.user.id)throw new Error('Sessão indisponível. Entre novamente.')
      const r=await fetch('/api/vendidos',{headers:{Authorization:`Bearer ${session.access_token}`},signal,cache:'no-store'})
      if(!r.ok)throw new Error(r.status===403?'Seu acesso ou vínculo de vendedor não permite esta consulta.':'Não foi possível consultar os pedidos vendidos.')
      const data=await r.json() as DadosVendidos
      if(!Array.isArray(data.pedidos)||typeof data.producaoDisponivel!=='boolean'||typeof data.entregasDisponiveis!=='boolean')throw new Error('Resposta de vendidos inválida')
      return data
    },
  })
  return {...query,data:autorizado&&!query.error?query.data:undefined,autorizado,authLoading:auth.loading,isAdmin:p?.role==='admin'}
}
