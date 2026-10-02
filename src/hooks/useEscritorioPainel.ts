import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { todasAsLinhas } from '@/lib/rpc-paginado'
import { atendimentoHoje, diaComercial, intervaloDia, rankingMensal, valorPorNome, type RankingMesFonte } from '@/lib/escritorio-painel'
import { foraDoRanking } from '@/lib/vendedores-fora-do-ranking'

export type VendedorPainelFonte = { vendedor_nome: string; online: boolean }
export type StatusPainelFonte = { status: string }
type FunilFonte = { vendedor_nome: string; atendimentos: number; followup: number; quente: number; atualizado_em: string | null }
const rotulos: Record<string, string> = {
  ativo: 'Trabalhando', ocioso: 'Aberto, parado', aguardando: 'Aguardando WhatsApp',
  wa_fechado: 'WhatsApp fechado', verificar_wa: 'Verificar WhatsApp', lento: 'Conexão lenta',
  versao_antiga: 'Recarregar extensão', desconectado: 'Sem conexão', desligado: 'Desligado',
}

export function useEscritorioPainel(vendedores: VendedorPainelFonte[], live: Record<string, StatusPainelFonte>) {
  const [dia, setDia] = useState(() => diaComercial())
  useEffect(() => {
    const atualizarDia = () => setDia(diaComercial())
    const timer = window.setInterval(atualizarDia, 15_000)
    window.addEventListener('focus', atualizarDia)
    return () => { window.clearInterval(timer); window.removeEventListener('focus', atualizarDia) }
  }, [])
  const nomes = vendedores.filter(v => !foraDoRanking(v.vendedor_nome)).map(v => v.vendedor_nome)

  const leads = useQuery({
    queryKey: ['painel-escritorio', 'leads', dia],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('escritorio_leads_hoje')
      if (error) throw error
      return Object.fromEntries((data as { vend: string; leads: number }[] ?? []).map(r => [r.vend, r.leads])) as Record<string, number>
    }, refetchInterval: 30_000,
  })
  const orcamentos = useQuery({
    queryKey: ['painel-escritorio', 'orcamentos', dia],
    queryFn: async () => {
      const { inicio, fim } = intervaloDia(dia)
      const rows = await todasAsLinhas<{ vendedor_nome: string | null }>(async (de, ate) => {
        const { data, error, count } = await supabase.from('orcamentos_gerados')
          .select('vendedor_nome', { count: 'exact' }).gte('created_at', inicio).lt('created_at', fim)
          .order('id').range(de, ate)
        if (error) throw error
        return { linhas: data ?? [], total: count }
      }, 1000)
      const mapa: Record<string, number> = {}
      for (const row of rows) {
        const nome = (row.vendedor_nome ?? '').trim().split(/\s+/)[0].toUpperCase()
        if (nome) mapa[nome] = (mapa[nome] ?? 0) + 1
      }
      return mapa
    }, refetchInterval: 30_000,
  })
  const funil = useQuery({
    queryKey: ['painel-escritorio', 'funil', dia],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('escritorio_funil_vivo')
      if (error) throw error
      return (data ?? []) as FunilFonte[]
    }, refetchInterval: 30_000,
  })
  const ligacoes = useQuery({
    queryKey: ['painel-escritorio', 'ligacoes', dia],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('escritorio_ligacoes_prospec_hoje')
      if (error) throw error
      return Object.fromEntries((data as { vend: string; lig_atendidas: number }[] ?? []).map(r => [r.vend, r.lig_atendidas])) as Record<string, number>
    }, refetchInterval: 30_000,
  })
  const mes = useQuery({
    queryKey: ['painel-escritorio', 'mes', dia.slice(0, 7)],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('escritorio_ranking_mes')
      if (error) throw error
      return (data ?? []) as RankingMesFonte[]
    }, refetchInterval: 60_000,
  })

  const ranking = rankingMensal(mes.isError ? [] : mes.data ?? [], nomes)
  const lista = nomes.sort((a, b) => a.localeCompare(b, 'pt-BR')).map(nome => {
    const f = funil.isError ? undefined : funil.data?.find(r => r.vendedor_nome === nome)
    const atendimentos = atendimentoHoje(f, dia)
    const status = live[nome]?.status ?? 'desconectado'
    return {
      nome, status, statusLabel: rotulos[status] ?? 'Sem sinal', atendimentos,
      leads: valorPorNome(leads.isError ? null : leads.data ?? null, nome, nomes),
      orcamentos: valorPorNome(orcamentos.isError ? null : orcamentos.data ?? null, nome, nomes),
      ligacoes: valorPorNome(ligacoes.isError ? null : ligacoes.data ?? null, nome, nomes),
      followup: atendimentos === null ? null : f?.followup ?? null,
      quentes: atendimentos === null ? null : f?.quente ?? null,
      mes: mes.isError || !mes.data ? null : ranking.find(r => r.nome === nome) ?? { atendimentos: 0, leads: 0, orcamentos: 0 },
    }
  })
  const fontes = [leads, orcamentos, funil, ligacoes]
  const timestamps = fontes.map(q => q.dataUpdatedAt).filter(Boolean)
  return {
    vendedores: lista, rankingMes: ranking,
    atualizadoEm: timestamps.length === fontes.length ? Math.min(...timestamps) : null,
    carregando: fontes.some(q => q.isPending),
    erro: fontes.some(q => q.isError) || (funil.isSuccess && lista.some(v => v.atendimentos === null)),
    rankingCarregando: mes.isPending, rankingErro: mes.isError,
    onRefresh: () => { for (const q of [...fontes, mes]) void q.refetch() },
  }
}
