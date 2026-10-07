import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'

// ───────────────────────────────────────────────────────────────────────────
// Rastreio da origem da venda pelo telefone (07/10/2026).
//
// Uma linha por venda do período, com os FATOS que a RPC controle_vendas_rastreio
// achou cruzando o telefone do pedido e do orçamento ligado a ele com os registros
// de chegada (lead, repasse a vendedor, clique em anúncio). Quem decide a origem
// é lib/vendas-origem (origemFinalVenda) — aqui só se busca.
//
// A RPC devolve ZERO linha (sem erro) pra quem não tem `menu.controle`: o guard é
// dela, não desta tela.
// ───────────────────────────────────────────────────────────────────────────

export interface RastreioVenda {
  pedido_id: string
  pedido_numero: string | null
  numero_orcamento: string | null
  cliente: string | null
  vendedor: string | null
  vendedor_2: string | null
  data_venda: string
  valor: number | null
  /** O que o vendedor marcou em "Como o cliente encontrou a empresa?". */
  fonte_declarada: string | null
  /** Data do primeiro contato que o vendedor informou no pedido (texto livre do form). */
  data_primeiro_contato: string | null
  telefone_pedido: string | null
  telefone_orcamento: string | null
  /** A chegada que vale: 1ª com origem forte do ciclo; sem nenhuma forte, a 1ª que houver. */
  chegada_em: string | null
  chegada_origem: string | null
  chegada_criativo: string | null
  chegada_anuncio: string | null
  /** 'lead' | 'repasse' | 'clique' — de qual registro saiu. */
  chegada_fonte: string | null
  /** 'pedido' | 'orcamento' — qual telefone casou. */
  chegada_via: string | null
  chegadas_com_origem: number
  ultima_chegada_em: string | null
  ultima_chegada_origem: string | null
  /** Contato registrado SEM origem identificada (o cliente apareceu, mas não se sabe de onde). */
  contato_sem_origem_em: string | null
  pedido_anterior_numero: string | null
  pedido_anterior_data: string | null
  na_base_desde: string | null
}

/** `from`/`to` em 'YYYY-MM-DD' (data da venda, inclusive nas duas pontas). */
export async function fetchRastreioVendas(from: string, to: string): Promise<RastreioVenda[]> {
  const { data, error } = await supabase.rpc('controle_vendas_rastreio', { p_from: from, p_to: to })
  if (error) throw error
  return (data ?? []) as RastreioVenda[]
}

export function useControleRastreio(from: string, to: string) {
  return useQuery({
    queryKey: ['controle-vendas', 'rastreio', from, to],
    queryFn: () => fetchRastreioVendas(from, to),
    staleTime: 5 * 60_000,
  })
}
