import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'

/** Uma etiqueta aplicada num WhatsApp específico. O mesmo número costuma
 *  aparecer etiquetado em vários aparelhos — daí o `vendedor` por item. */
export interface WaEtiquetaAplicada {
  etiqueta: string
  vendedor: string | null
  em: string | null
}

/**
 * O resumo em si, SEM o telefone.
 *
 * Existe separado porque `contatos_page` devolve exatamente estes campos
 * embutidos em cada linha de contato — então a linha da RPC de contatos
 * *é* um `WaResumoCampos` e pode ser passada direto pros componentes de
 * etiqueta/último contato, sem lookup por telefone.
 *
 * Tudo anulável: em `contatos_page` o join com a matview é LEFT (contato sem
 * WhatsApp sincronizado vem com todos estes campos em null).
 */
export interface WaResumoCampos {
  fc: string | null
  etiquetas: WaEtiquetaAplicada[]
  etiqueta_principal: string | null
  etiqueta_principal_vendedor: string | null
  n_vendedores: number | null
  ultimo_contato: string | null
  /** Quem mandou a última mensagem. 'cliente' = bola com o vendedor. */
  quem_falou: 'cliente' | 'vendedor' | 'sistema' | null
  ultimo_vendedor: string | null
}

export interface WaResumo extends WaResumoCampos {
  /** Telefone EXATAMENTE como foi enviado (a RPC ecoa o input; `fc` é o canônico). */
  phone: string
}

/**
 * Pra um conjunto de telefones visíveis na tela, traz num tiro só o resumo do
 * WhatsApp de cada um: etiquetas (por vendedor), última mensagem e quem falou
 * por último. Resultado é um Map pra lookup O(1) na renderização.
 *
 * Manda o telefone CRU — a RPC canoniza no SQL (`fone_canon`) e devolve o
 * mesmo texto que recebeu na coluna `phone`, então a chave do Map é o telefone
 * que você passou, sem precisar normalizar no cliente.
 *
 * Limitação: só ~5% dos contatos têm chat no WhatsApp sincronizado. A RPC
 * simplesmente OMITE quem não tem dado (é um JOIN), então `get()` devolvendo
 * undefined é o caso COMUM, não erro. Papéis restritos recebem lista vazia.
 *
 * NÃO use na tela /contatos: `contatos_page` já devolve estes mesmos campos
 * embutidos em cada linha, e chamar os dois seria um round-trip duplicado.
 * Este hook serve pra telas que têm uma lista de telefones SEM as linhas de
 * `contacts` junto (ex.: partir de orçamentos ou de uma lista importada).
 */
export function useWaResumo(phones: string[]) {
  // Dedup + sort pra cache key estável independente de ordem/repetição na página.
  const unicos = [...new Set(phones.filter(Boolean))].sort()
  const stableKey = unicos.join(',')
  return useQuery({
    queryKey: ['wa-resumo', stableKey],
    queryFn: async () => {
      const map = new Map<string, WaResumo>()
      if (unicos.length === 0) return map
      const { data, error } = await supabase.rpc('wa_resumo_por_telefone', { p_phones: unicos })
      if (error) throw error
      for (const r of (data ?? []) as WaResumo[]) {
        if (!r?.phone) continue
        // `etiquetas` vem como jsonb; blinda contra null/objeto pra o caller
        // poder fazer .map/.filter sem checar.
        map.set(r.phone, { ...r, etiquetas: Array.isArray(r.etiquetas) ? r.etiquetas : [] })
      }
      return map
    },
    enabled: unicos.length > 0,
    staleTime: 60_000,
  })
}

/** Uma etiqueta que EXISTE hoje no dado, com quantos contatos carregam ela. */
export interface WaEtiquetaDisponivel {
  /** Texto CRU, exatamente como está gravado no WhatsApp. */
  etiqueta: string
  contatos: number
}

/**
 * Etiquetas que realmente existem em `etiqueta_principal`, com a contagem.
 *
 * Serve pra montar filtro de etiqueta a partir do DADO, não de uma constante:
 * `ETIQUETA_COR` só conhece as 18 do funil oficial e escondia etiquetas reais
 * (FEIRA, SUPORTE TECNICO, AGENDAMENTO, IMPORTANTES...) que ninguém conseguia
 * filtrar porque não estavam na lista.
 *
 * O texto vem CRU de propósito: `contatos_page` compara `p_etiqueta` com
 * `etiqueta_principal` por igualdade EXATA, então o valor daqui é o único que
 * garantidamente casa. Canonizar (`canonico()`) serve pra COR e pra checar
 * ocultas — nunca pro valor enviado à RPC.
 *
 * Papéis restritos recebem lista vazia (a RPC aplica `papel_restrito()`).
 * `staleTime` alto: etiqueta nova é evento raro, e a fonte é uma matview.
 */
export function useWaEtiquetasDisponiveis() {
  return useQuery({
    queryKey: ['wa-etiquetas-disponiveis'],
    queryFn: async (): Promise<WaEtiquetaDisponivel[]> => {
      const { data, error } = await supabase.rpc('wa_etiquetas_disponiveis')
      if (error) throw error
      const linhas = (data ?? []) as { etiqueta: string | null; contatos: number | string | null }[]
      return linhas
        .filter(r => !!r?.etiqueta)
        // `contatos` é bigint no Postgres — pode chegar como string.
        .map(r => ({ etiqueta: String(r.etiqueta), contatos: Number(r.contatos ?? 0) }))
    },
    staleTime: 30 * 60_000,
  })
}
