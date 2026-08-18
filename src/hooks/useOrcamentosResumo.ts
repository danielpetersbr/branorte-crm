import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { parseCustomRange, type DashboardPreset } from './useDashboard'
import { soVendedores } from '@/lib/vendedores-fora-do-ranking'

// Resumo das PROPOSTAS montadas no builder de orçamento (tabela orcamentos_gerados).
// É a única fonte real de R$ no fluxo de lead. O status 'enviado'/'rascunho' do builder
// NÃO é confiável, então contamos a PROPOSTA MONTADA sem distinguir.
// DEDUPE POR CLIENTE: o vendedor re-orça o mesmo cliente várias vezes (versões/ALT/
// re-cotação) — conta 1 por cliente, pegando a ÚLTIMA proposta (mais recente). Senão o
// R$ infla (ex.: Gustavo tinha 62 propostas mas só 30 clientes).
// O DONO fica fora da conta de vendedor — ver `lib/vendedores-fora-do-ranking.ts`.
// (Este comentário dizia "Daniel (testes)". Não é conta de teste: são 223 propostas
//  e 11 vendas reais. É o dono, e a distinção evita que alguém apague o filtro.)

export interface OrcamentosResumo {
  geradas: number          // clientes distintos com proposta (não propostas brutas)
  propostasBrutas: number  // total de propostas montadas (com repetição de cliente)
  valorTotalBRL: number    // soma da última proposta de cada cliente
  ticketMedioBRL: number   // valorTotalBRL / clientes distintos
  porVendedor: {
    vendedor: string
    n: number              // clientes distintos com proposta
    propostasN: number     // propostas brutas (com repetição)
    brl: number            // soma da última proposta por cliente
    ultimaDias: number | null  // dias desde a última proposta (null = nenhuma)
  }[]
}

interface OrcRow {
  vendedor_nome: string | null
  total_proposta: number | null
  created_at: string
  cliente_dados: { fone?: string | null; nome?: string | null } | null
  cliente_nome: string | null
}

function desdeFromPreset(preset: DashboardPreset): string | null {
  const _custom = parseCustomRange(preset)
  if (_custom) return _custom.from.toISOString()
  const now = new Date()
  const d = (back: number) => { const x = new Date(now); x.setDate(x.getDate() - back); x.setHours(0, 0, 0, 0); return x.toISOString() }
  if (preset === 'hoje') { const x = new Date(now); x.setHours(0, 0, 0, 0); return x.toISOString() }
  if (preset === 'ontem') return d(1)
  if (preset === '7d') return d(6)
  if (preset === '30d') return d(29)
  if (preset === 'mes') return new Date(now.getFullYear(), now.getMonth(), 1).toISOString()
  return null // Tudo
}

/** Teto de linhas por consulta. Ver o aviso de truncamento dentro do queryFn. */
const TETO = 20_000

export function useOrcamentosResumo(preset: DashboardPreset = '') {
  return useQuery({
    queryKey: ['orcamentos-resumo-v3', preset],
    queryFn: async (): Promise<OrcamentosResumo> => {
      const desde = desdeFromPreset(preset)
      let q = supabase
        .from('orcamentos_gerados')
        .select('vendedor_nome, total_proposta, created_at, cliente_dados, cliente_nome')
        .order('created_at', { ascending: false }) // mais recente primeiro → 1º visto = última proposta
        .limit(TETO)
      if (desde) q = q.gte('created_at', desde)
      const { data, error } = await q
      if (error) throw error

      // Truncamento SILENCIOSO: sem preset ("Tudo") isto varre a tabela inteira.
      // Em 18/08/2026 são 1.307 linhas contra teto de 20.000 — folgado. Mas a
      // uma média de ~13 propostas/dia o teto chega, e quando chegar a página
      // não quebra: ela passa a mostrar um R$ MENOR, sem avisar ninguém. Como
      // vem ordenado por data desc, o que some é sempre o mais ANTIGO — a
      // queda pareceria "mês fraco". Por isso o aviso é explícito.
      const truncado = (data?.length ?? 0) >= TETO
      if (truncado) {
        console.warn(
          `[useOrcamentosResumo] teto de ${TETO} linhas atingido — o R$ total está SUBESTIMADO. ` +
          `Paginar a query (range) antes de confiar no número.`,
        )
      }

      const rows = ((data ?? []) as OrcRow[]).filter(soVendedores(r => r.vendedor_nome))

      type Acc = { vendedor: string; n: number; propostasN: number; brl: number; maxMs: number; clientes: Set<string> }
      const map = new Map<string, Acc>()
      rows.forEach((r, i) => {
        const nome = (r.vendedor_nome || '—').trim() || '—'
        const fone = String(r.cliente_dados?.fone ?? '').replace(/\D/g, '')
        const cli = String(r.cliente_dados?.nome ?? r.cliente_nome ?? '').trim().toLowerCase()
        // Sem fone E sem nome = não dá pra deduplicar: cada linha vira um "cliente"
        // novo, o que INFLA `geradas`/`valorTotalBRL` e DERRUBA o ticket médio.
        // Medido em 18/08/2026: 0 de 1.084 linhas caem aqui — hoje é inerte. Fica o
        // aviso porque o dia em que o builder aceitar salvar sem cliente, o número
        // sobe sozinho e ninguém liga uma coisa à outra.
        const clientKey = fone || cli || `__sem-cliente-${i}`
        const acc = map.get(nome) ?? { vendedor: nome, n: 0, propostasN: 0, brl: 0, maxMs: 0, clientes: new Set<string>() }
        acc.propostasN += 1
        const ms = new Date(r.created_at).getTime()
        if (Number.isFinite(ms) && ms > acc.maxMs) acc.maxMs = ms
        if (!acc.clientes.has(clientKey)) {            // 1ª vez = proposta mais recente desse cliente
          acc.clientes.add(clientKey)
          acc.n += 1
          acc.brl += Number(r.total_proposta) || 0
        }
        map.set(nome, acc)
      })

      const agora = Date.now()
      const porVendedor = [...map.values()]
        .map(a => ({
          vendedor: a.vendedor, n: a.n, propostasN: a.propostasN, brl: a.brl,
          ultimaDias: a.maxMs > 0 ? Math.floor((agora - a.maxMs) / 86_400_000) : null,
        }))
        .sort((a, b) => b.brl - a.brl)
      const geradas = porVendedor.reduce((s, v) => s + v.n, 0)
      const valorTotalBRL = porVendedor.reduce((s, v) => s + v.brl, 0)
      return {
        geradas,
        propostasBrutas: rows.length,
        valorTotalBRL,
        ticketMedioBRL: geradas > 0 ? valorTotalBRL / geradas : 0,
        porVendedor,
      }
    },
    staleTime: 60_000,
    refetchInterval: 60_000,
    placeholderData: prev => prev,
    retry: 2,
  })
}
