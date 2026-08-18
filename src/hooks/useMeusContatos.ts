import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'

/**
 * "Pegar pra mim", placar do vendedor e relatório de donos — tudo da /contatos.
 *
 * O MOTOR não é novo: é o pool de prospecção que já existia no banco desde
 * 02/07/2026 (`prospeccao_claims` + as travas anti-colisão). A tela /prospeccao
 * foi removida em 17/08 e o backend ficou inteiro; aqui ele volta a ter dono,
 * dentro da /contatos, que é onde o vendedor já está.
 *
 * A trava contra dois vendedores pegarem o mesmo cliente NÃO está aqui: é um
 * unique index parcial em `prospeccao_claims (contact_id) WHERE released_at IS
 * NULL` mais o `vendor_id IS NULL` no próprio UPDATE. Dois cliques no mesmo
 * segundo: um ganha, o outro volta em `recusados`. Não dá pra resolver isso no
 * navegador — quem tentar validar antes só cria uma janela de corrida maior.
 */

/** Por que um contato não pôde ser pego. Vem cru da RPC; o rótulo é aqui. */
export type MotivoRecusa =
  | 'ja_tem_dono'
  | 'ja_era_seu'
  | 'ja_tem_conversa_no_whatsapp'
  | 'mesmo_telefone_de_contato_com_dono'
  | 'em_atendimento_ativo'
  | 'nao_encontrado'
  | 'recusado'

export const MOTIVO_RECUSA_LABEL: Record<MotivoRecusa, string> = {
  ja_tem_dono:                        'já tem vendedor',
  ja_era_seu:                         'já era seu',
  ja_tem_conversa_no_whatsapp:        'já tem conversa no WhatsApp de um vendedor',
  mesmo_telefone_de_contato_com_dono: 'mesmo telefone de um cliente que já tem dono',
  em_atendimento_ativo:               'está em atendimento agora',
  nao_encontrado:                     'contato não encontrado',
  recusado:                           'não pôde ser pego',
}

export interface ResultadoPegar {
  ok: boolean
  erro?: string
  msg?: string
  pegos?: string[]
  n_pegos?: number
  recusados?: { id: string; motivo: MotivoRecusa }[]
}

export function usePegarPraMim() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (contactIds: string[]): Promise<ResultadoPegar> => {
      const { data, error } = await (supabase as any).rpc('contatos_pegar_pra_mim', {
        p_contact_ids: contactIds,
      })
      if (error) throw error
      return (data ?? { ok: false }) as ResultadoPegar
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['contacts'] })
      qc.invalidateQueries({ queryKey: ['contatos_atividade'] })
      qc.invalidateQueries({ queryKey: ['meu-placar'] })
      qc.invalidateQueries({ queryKey: ['contatos-relatorio'] })
    },
  })
}

export interface MeuPlacar {
  vendor_id: string | null
  vendedor: string | null
  hoje: number
  sete_dias: number
  trinta_dias: number
  total: number
  carteira: number
}

/**
 * Quantos o vendedor puxou da lista. `enabled` fica com quem chama: admin sem
 * vendor ligado recebe null da RPC (não é erro — admin não prospecta).
 */
export function useMeuPlacar(habilitado = true) {
  return useQuery({
    queryKey: ['meu-placar'],
    queryFn: async (): Promise<MeuPlacar | null> => {
      const { data, error } = await (supabase as any).rpc('contatos_meu_placar')
      if (error) throw error
      return (data ?? null) as MeuPlacar | null
    },
    enabled: habilitado,
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  })
}

export interface RelatorioContatos {
  total: number
  com_vendedor: number
  sem_vendedor: number
  sem_vendedor_sem_orcamento: number
  /** Sem vendedor MAS com orçamento — a regra que não deveria ser violada. */
  violacoes_sem_vendedor_com_orcamento: number
  /** Dessas: 2+ vendedores no histórico de orçamento (precisa decisão humana). */
  violacoes_disputa: number
  /** Dessas: nenhum orçamento sabe o vendedor (ex-vendedor, sem identificação). */
  violacoes_orfa: number
  /** Dessas: têm orçamento na origem mas nenhum arquivo ligado — falta o vínculo. */
  violacoes_sem_vinculo: number
  /**
   * Por que os outros ficaram FORA do pool. Sem isto o dono lê "172.826 sem
   * vendedor" e "167.741 no pool" e não sabe o que houve com os 5.085 do meio.
   */
  fora_do_pool_por_motivo: Record<string, number>
  por_vendedor: { vendedor: string; vendor_id: string; contatos: number }[]
  admin: boolean
  gerado_em: string
}

export const MOTIVO_FORA_LABEL: Record<string, string> = {
  tem_orcamento:                      'já têm orçamento',
  ja_tem_conversa_no_whatsapp:        'já têm conversa no WhatsApp de um vendedor',
  mesmo_telefone_de_contato_com_dono: 'mesmo telefone de um cliente que já tem dono',
  em_atendimento_ativo:               'estão em atendimento agora',
}

export function useRelatorioContatos(habilitado = true) {
  return useQuery({
    queryKey: ['contatos-relatorio'],
    queryFn: async (): Promise<RelatorioContatos | null> => {
      const { data, error } = await (supabase as any).rpc('contatos_relatorio')
      if (error) throw error
      if (!data || (data as any).erro) return null
      return data as RelatorioContatos
    },
    enabled: habilitado,
    staleTime: 60_000,
  })
}

export interface Violacao {
  contact_id: string
  nome: string | null
  telefone: string | null
  uf: string | null
  n_orcamentos: number
  ano_recente: number | null
  vendedores: string
  /** 'disputa' = 2+ vendedores | 'orfao' = nenhum sabe | 'propagar' = devia ter sido carimbado */
  tipo: 'disputa' | 'orfao' | 'propagar'
}

export function useViolacoes(habilitado = false) {
  return useQuery({
    queryKey: ['contatos-violacoes'],
    queryFn: async (): Promise<Violacao[]> => {
      const { data, error } = await (supabase as any).rpc('contatos_violacoes', {
        p_limit: 500, p_offset: 0,
      })
      if (error) throw error
      return ((data ?? []) as any[]).map(r => ({
        ...r,
        // bigint do Postgres chega como string
        n_orcamentos: Number(r.n_orcamentos ?? 0),
        ano_recente: r.ano_recente == null ? null : Number(r.ano_recente),
      })) as Violacao[]
    },
    enabled: habilitado,
    staleTime: 60_000,
  })
}
