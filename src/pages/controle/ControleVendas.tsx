import {useAuth} from '@/hooks/useAuth'
import {useCan} from '@/hooks/usePermissions'
import ControleVendasOriginal from './ControleVendasOriginal'

export default function ControleVendas(){
  const {session,profile,loading,profileError}=useAuth(),can=useCan()
  if(loading)return <div role="status" className="p-6">Carregando acesso ao Controle de Vendas...</div>
  if(profileError||!session||!profile||profile.id!==session.user.id||!profile.approved_at||!can('menu.financeiro'))return <div role="alert" className="p-6">Sem permissão para consultar o Controle de Vendas.</div>
  return <ControleVendasOriginal key={`${profile.id}:${profile.role}:${profile.vendor_id}:${profile.approved_at}`}/>
}
