import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { TIMES, type TimeSlug } from '@/hooks/useRelatorioLider'

// ============================================================================
// Reunião do Time — a que o Daniel conduz durante a semana.
//
// Substituiu o relatório diário do líder. A pauta é exatamente o que ele
// anunciou no grupo: ligações, orçamentos, negociações em andamento,
// oportunidades e o que precisa melhorar.
//
// ⚠️ É AQUI que o MOTIVO DE PERDA passou a ser capturado. Ele era a coisa mais
// valiosa do relatório antigo (nenhum campo do sistema explica por que um time
// vende menos), e sem líder perdeu o gatilho diário. Registrar na reunião é o
// gatilho que sobrou — e é melhor: o time inteiro está junto pra lembrar.
// ============================================================================

export interface PautaNumeros {
  ligacoes_feitas: number; ligacoes_recebidas: number
  orcamentos: number; orcamentos_valor: number
  msgs: number; clientes_atendidos: number
  quentes: number; quentes_sem_resposta: number
  orcamentos_sem_andamento: number
}

export function usePautaNumeros(time: TimeSlug | null, dias = 7) {
  return useQuery({
    queryKey: ['reuniao-pauta', time, dias],
    enabled: !!time,
    staleTime: 60_000,
    queryFn: async (): Promise<PautaNumeros> => {
      const { data, error } = await supabase.rpc('reuniao_pauta', { p_time: time, p_dias: dias })
      if (error) throw error
      const r = (data?.[0] ?? {}) as Record<string, unknown>
      const n = (v: unknown) => Number(v ?? 0)
      return {
        ligacoes_feitas: n(r.ligacoes_feitas), ligacoes_recebidas: n(r.ligacoes_recebidas),
        orcamentos: n(r.orcamentos), orcamentos_valor: n(r.orcamentos_valor),
        msgs: n(r.msgs), clientes_atendidos: n(r.clientes_atendidos),
        quentes: n(r.quentes), quentes_sem_resposta: n(r.quentes_sem_resposta),
        orcamentos_sem_andamento: n(r.orcamentos_sem_andamento),
      }
    },
  })
}

/** Vendido do mês do time — mesma fonte do Nova Venda: pedidos_venda. */
export function useVendidoMes(time: TimeSlug | null) {
  return useQuery({
    queryKey: ['reuniao-vendido', time],
    enabled: !!time,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const r = await fetch('https://kfucuvwrnwrkshxpsmyq.supabase.co/functions/v1/ranking-vendas')
      if (!r.ok) throw new Error('ranking-vendas ' + r.status)
      const j = await r.json() as { ranking?: { vendedor: string; vendido: number; pedidos: number }[] }
      const membros = (TIMES.find(t => t.slug === time)?.membros ?? []) as unknown as string[]
      const chave = (s: string) => s.trim().toUpperCase().split(' ')[0]
      const meus = (j.ranking ?? []).filter(v => membros.some(m => chave(m) === chave(v.vendedor)))
      return {
        vendido: meus.reduce((s, v) => s + (v.vendido || 0), 0),
        pedidos: meus.reduce((s, v) => s + (v.pedidos || 0), 0),
        porPessoa: meus.map(v => ({ nome: v.vendedor, vendido: v.vendido, pedidos: v.pedidos }))
          .sort((a, b) => b.vendido - a.vendido),
      }
    },
  })
}

export interface PerdaForm {
  cliente: string; vendedor_nome: string; valor: number | null
  motivo: string; concorrente: string
}

export interface ReuniaoSalva {
  id: number; time_slug: string; data: string
  conduzida_por: string | null
  funcionando: string | null; melhorar: string | null; proximos_passos: string | null
  perdas?: { cliente: string; vendedor_nome: string | null; valor: number | null
             motivo: string | null; concorrente: string | null }[]
}

export const MOTIVOS_PERDA = [
  'Preço acima do que o cliente esperava',
  'Fechou com concorrente',
  'Adiou — sem verba agora',
  'Fora do perfil (peixe, peletizado, pequeno demais)',
  'Sumiu / não responde mais',
  'Frete inviabilizou',
  'Crédito negado',
  'Prazo de entrega longo demais',
  'Outro',
] as const

const hojeSP = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' })

export function useReuniaoDoDia(time: TimeSlug | null) {
  return useQuery({
    queryKey: ['reuniao-dia', time],
    enabled: !!time,
    staleTime: 30_000,
    queryFn: async (): Promise<ReuniaoSalva | null> => {
      const { data, error } = await supabase
        .from('reuniao_time')
        .select('*, perdas:reuniao_perda(*)')
        .eq('time_slug', time!).eq('data', hojeSP()).maybeSingle()
      if (error) throw error
      return data as ReuniaoSalva | null
    },
  })
}

export function useSalvarReuniao() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (f: {
      time_slug: string; conduzida_por: string
      funcionando: string; melhorar: string; proximos_passos: string
      perdas: PerdaForm[]
    }) => {
      // upsert por (time_slug, data): reabrir no mesmo dia CORRIGE em vez de
      // criar uma segunda reunião do mesmo time.
      const { data: r, error: e1 } = await supabase.from('reuniao_time').upsert({
        time_slug: f.time_slug, data: hojeSP(),
        conduzida_por: f.conduzida_por || null,
        funcionando: f.funcionando || null,
        melhorar: f.melhorar || null,
        proximos_passos: f.proximos_passos || null,
        atualizado_em: new Date().toISOString(),
      }, { onConflict: 'time_slug,data' }).select('id').single()
      if (e1) throw e1

      const { error: e2 } = await supabase.from('reuniao_perda').delete().eq('reuniao_id', r.id)
      if (e2) throw e2

      const validas = f.perdas.filter(p => p.cliente.trim())
      if (validas.length) {
        const { error: e3 } = await supabase.from('reuniao_perda').insert(
          validas.map(p => ({
            reuniao_id: r.id, cliente: p.cliente, vendedor_nome: p.vendedor_nome || null,
            valor: p.valor, motivo: p.motivo || null,
            concorrente: p.motivo.includes('concorrente') ? (p.concorrente || null) : null,
          })),
        )
        if (e3) throw e3
      }
      return r.id as number
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['reuniao-dia'] })
      qc.invalidateQueries({ queryKey: ['reuniao-historico'] })
    },
  })
}

/** Histórico: as reuniões já feitas, com as perdas registradas. */
export function useReuniaoHistorico(dias = 30) {
  return useQuery({
    queryKey: ['reuniao-historico', dias],
    staleTime: 60_000,
    queryFn: async () => {
      const d = new Date(); d.setDate(d.getDate() - dias)
      const de = d.toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' })
      const { data, error } = await supabase
        .from('reuniao_time')
        .select('*, perdas:reuniao_perda(*)')
        .gte('data', de).order('data', { ascending: false })
      if (error) throw error
      return (data ?? []) as ReuniaoSalva[]
    },
  })
}
