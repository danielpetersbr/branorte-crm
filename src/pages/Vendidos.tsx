import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import { CheckCircle, RefreshCw } from 'lucide-react'
import { useVendidos } from '@/hooks/useVendidos'
import { ClienteWhatsAppOrcamento } from '@/components/orcamento/ClienteWhatsAppOrcamento'
import { PageLoading } from '@/components/ui/LoadingSpinner'
import { QueryNotice } from '@/components/ui/QueryNotice'
import { filtrarPedidosVendidos, contagemVendidos, SITUACOES_VENDIDOS, ETAPAS_VENDIDOS, type SituacaoVendido } from '@/lib/vendidos'
const Historico = lazy(()=>import('@/components/vendidos/HistoricoVendidos').then(m=>({default:m.HistoricoVendidos})))
const input='h-10 rounded-md border border-border bg-surface-2 px-3 text-sm text-ink outline-none focus:border-accent focus-visible:ring-2 focus-visible:ring-accent/30'
const inicial={mes:'',vendedor:'',situacao:'',busca:''}
const dataCivil=(s:string|null)=>s?new Date(s.length===10?`${s}T12:00:00`:s).toLocaleDateString('pt-BR'):'—'
export function Vendidos() {
  const {data,isPending,error,isFetching,refetch,autorizado,authLoading,isAdmin}=useVendidos()
  const [filtros,setFiltros]=useState(inicial),[pagina,setPagina]=useState(1),[historico,setHistorico]=useState(false)
  const alterar=(patch:Partial<typeof inicial>)=>{setFiltros(f=>({...f,...patch}));setPagina(1)}
  const pedidos=data?.pedidos??[]
  const meses=useMemo(()=>[...new Set(pedidos.flatMap(p=>p.dataVenda?[p.dataVenda.slice(0,7)]:[]))].sort().reverse(),[pedidos])
  const vendedores=useMemo(()=>[...new Set(pedidos.flatMap(p=>[p.vendedor,p.vendedor2].filter((v):v is string=>!!v)))].sort(),[pedidos])
  const base=useMemo(()=>filtrarPedidosVendidos(pedidos,filtros,false),[pedidos,filtros])
  const filtrados=useMemo(()=>filtrarPedidosVendidos(pedidos,filtros),[pedidos,filtros])
  const paginas=Math.max(1,Math.ceil(filtrados.length/50)),atual=Math.min(pagina,paginas)
  useEffect(()=>{setPagina(p=>Math.min(p,paginas))},[paginas])
  if(authLoading)return <PageLoading/>
  if(!autorizado)return <p className="p-6 text-ink">Sem acesso aos pedidos vendidos.</p>
  return <div className="p-4 lg:p-8 space-y-4">
    <header className="flex items-start justify-between gap-3 flex-wrap">
      <div><h1 className="flex items-center gap-2 text-2xl font-bold text-ink"><CheckCircle className="h-6 w-6 text-accent"/>Vendidos</h1><p className="mt-1 text-sm text-ink-muted">{isAdmin?'Pedidos de venda · produção e entrega':'Seus pedidos de venda · produção e entrega'}</p></div>
      <div className="flex gap-2 flex-wrap"><button type="button" className={input+' inline-flex items-center gap-2'} disabled={isFetching} onClick={()=>{void refetch()}}><RefreshCw className={'h-4 w-4 '+(isFetching?'animate-spin':'')} aria-hidden/>Atualizar</button>{isAdmin&&<button type="button" className={input} aria-expanded={historico} onClick={()=>setHistorico(v=>!v)}>{historico?'Voltar aos pedidos':'Histórico de clientes'}</button>}</div>
    </header>
    {historico&&isAdmin?<Suspense fallback={<PageLoading/>}><Historico/></Suspense>:<>
      <div className="flex flex-wrap gap-2">
        <input aria-label="Buscar pedidos vendidos" placeholder="Buscar cliente, pedido, WhatsApp ou produto…" className={input+' flex-1 min-w-[220px] max-w-lg'} value={filtros.busca} onChange={e=>alterar({busca:e.target.value})}/>
        <select aria-label="Mês da venda" className={input} value={filtros.mes} onChange={e=>alterar({mes:e.target.value})}><option value="">Todos os meses</option>{meses.map(m=><option key={m} value={m}>{new Date(`${m}-01T12:00:00`).toLocaleDateString('pt-BR',{month:'long',year:'numeric'})}</option>)}</select>
        {isAdmin&&<select aria-label="Vendedor" className={input} value={filtros.vendedor} onChange={e=>alterar({vendedor:e.target.value})}><option value="">Todos os vendedores</option>{vendedores.map(v=><option key={v} value={v}>{v}</option>)}</select>}
        <select aria-label="Situação do pedido" className={input} value={filtros.situacao} onChange={e=>alterar({situacao:e.target.value})}><option value="">Todas as situações</option>{Object.entries(SITUACOES_VENDIDOS).map(([v,n])=><option key={v} value={v}>{n}</option>)}</select>
        {Object.values(filtros).some(Boolean)&&<button type="button" className={input} onClick={()=>{setFiltros(inicial);setPagina(1)}}>Limpar filtros</button>}
      </div>
      {error?<QueryNotice error={error} loading={isFetching} onRetry={()=>{void refetch()}} message="Não foi possível carregar os pedidos vendidos. Confira seu acesso e tente novamente."/>:isPending?<PageLoading/>:data&&<>
        {(!data.producaoDisponivel||!data.entregasDisponiveis)&&<p role="alert" className="rounded-lg border border-warning/30 bg-warning/10 p-3 text-sm text-ink">{!data.producaoDisponivel&&'Produção indisponível. As quantidades na empresa e embarcadas não podem ser conferidas agora. '}{!data.entregasDisponiveis&&'Confirmações de entrega indisponíveis.'}</p>}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {(['', 'na_empresa','embarcado','entregue'] as const).map(s=>{
            const n=contagemVendidos(base,s||undefined),disponivel=s==='entregue'?data.entregasDisponiveis:s?data.producaoDisponivel:true
            return <button type="button" key={s} aria-pressed={filtros.situacao===s} disabled={!disponivel} onClick={()=>alterar({situacao:s})} className={`rounded-xl border p-4 text-left transition focus-visible:ring-2 focus-visible:ring-accent ${filtros.situacao===s?'border-accent bg-accent/5':'border-border bg-surface'} disabled:opacity-60`}>
              <span className="block text-sm text-ink-muted">{s?SITUACOES_VENDIDOS[s]:'Todos os clientes'}</span><strong className="mt-1 block text-2xl font-bold text-ink">{disponivel?n.clientes:'—'}</strong><span className="text-xs text-ink-faint">{disponivel?`${n.pedidos} pedido(s)`:'Leitura indisponível'}</span>
            </button>
          })}
        </div>
        <p className="text-xs text-ink-muted">Mês pela data da venda. Um cliente pode ter pedidos em mais de uma situação. Embarcado significa saída da fábrica; entregue exige confirmação de recebimento.</p>
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm"><thead className="bg-surface-2 text-ink-muted"><tr>{['Venda','Pedido / orçamento','Cliente','WhatsApp','Vendedor','Etapa de produção','Situação','Entrega confirmada'].map(h=><th key={h} className="px-3 py-3 text-left text-xs font-semibold">{h}</th>)}</tr></thead><tbody className="divide-y divide-border">
            {filtrados.slice((atual-1)*50,atual*50).map(p=><tr key={p.id} className="hover:bg-surface-2/50">
              <td className="px-3 py-3 whitespace-nowrap text-ink-muted">{dataCivil(p.dataVenda)}</td>
              <td className="px-3 py-3"><span className="font-mono font-semibold text-ink">{p.numero||'Sem número'}</span>{p.orcamento&&<span className="block text-xs text-ink-faint">Orç. {p.orcamento}</span>}</td>
              <td className="px-3 py-3"><span className="font-medium text-ink">{p.cliente||'Sem nome'}</span><span className="block text-xs text-ink-faint">{[p.cidade,p.estado].filter(Boolean).join(' / ')}</span>{p.produto&&<span title={p.produto} className="mt-1 block max-w-[240px] truncate text-xs text-ink-muted">{p.produto}</span>}</td>
              <td className="px-3 py-3"><ClienteWhatsAppOrcamento cliente={{cliente_nome:p.cliente,cliente_fone:p.telefone,vendedor_nome:p.vendedor,numero:p.numero}}/></td>
              <td className="px-3 py-3 text-xs text-ink-muted">{[p.vendedor,p.vendedor2].filter(Boolean).join(' / ')}</td>
              <td className="px-3 py-3 text-xs text-ink">{!data.producaoDisponivel?'Produção indisponível':p.etapas.length?p.etapas.map(e=>ETAPAS_VENDIDOS[e]??e).join(' · '):'Sem produção vinculada'}</td>
              <td className="px-3 py-3"><span className="inline-flex rounded-md border border-border bg-surface-2 px-2 py-1 text-xs font-medium text-ink">{SITUACOES_VENDIDOS[p.situacao]}</span></td>
              <td className="px-3 py-3 whitespace-nowrap text-xs text-ink-muted">{!data.entregasDisponiveis?'Indisponível':p.entregaEm?dataCivil(p.entregaEm):'Não confirmada'}</td>
            </tr>)}
            {!filtrados.length&&<tr><td colSpan={8} className="px-4 py-10 text-center text-ink-muted">Nenhum pedido corresponde aos filtros.</td></tr>}
          </tbody></table>
        </div>
        <nav aria-label="Paginação de vendidos" className="flex items-center justify-between gap-3 flex-wrap"><p role="status" className="text-sm text-ink-muted">{filtrados.length} pedido(s) · {contagemVendidos(filtrados).clientes} cliente(s) · página {atual} de {paginas}</p><div className="flex gap-2"><button type="button" className={input} disabled={atual===1} onClick={()=>setPagina(atual-1)}>Anterior</button><button type="button" className={input} disabled={atual===paginas} onClick={()=>setPagina(atual+1)}>Próxima</button></div></nav>
        <p className="text-xs text-ink-faint">Consulta em {new Date(data.consultadoEm).toLocaleString('pt-BR')}. {base.some(p=>p.situacao==='sem_info')&&'Pedidos sem produção vinculada aparecem como sem informação, sem presumir que já saíram.'}</p>
      </>}
    </>}
  </div>
}
