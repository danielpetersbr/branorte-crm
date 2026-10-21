import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { contasDoEspelho, finalDoNumero, mapaEtiquetas, type ContaWhatsApp, type LinhaEspelho } from '@/lib/whatsapp-espelho'
import { useAuth } from './useAuth'

/**
 * "Mudou alguma coisa na lista deste vendedor?" — a mensagem mais recente e a última
 * troca de etiqueta, ~200 bytes. A lista inteira tem ~450 KB por vendedor: relê-la a
 * cada 10 s dava ~160 MB/hora com a aba aberta. Com o sinal, ela só é relida quando muda.
 */
export function useSinalEspelho(vendedor: string | null, intervaloMs: number) {
  const userId = useAuth().session?.user.id
  return useQuery<string>({
    queryKey: ['whatsapp-espelho-sinal', vendedor, userId],
    enabled: !!vendedor && !!userId,
    refetchInterval: intervaloMs,
    queryFn: async ({ signal }) => {
      const [mensagem, etiqueta] = await Promise.all([
        supabase.from('wa_chat_labels').select('last_message_at').eq('vendedor_nome', vendedor!)
          .not('last_message_at', 'is', null).order('last_message_at', { ascending: false }).limit(1).abortSignal(signal),
        supabase.from('wa_chat_labels').select('label_changed_at').eq('vendedor_nome', vendedor!)
          .not('label_changed_at', 'is', null).order('label_changed_at', { ascending: false }).limit(1).abortSignal(signal),
      ])
      if (mensagem.error) throw mensagem.error
      if (etiqueta.error) throw etiqueta.error
      return `${mensagem.data?.[0]?.last_message_at ?? ''}|${etiqueta.data?.[0]?.label_changed_at ?? ''}`
    },
  })
}

/**
 * Só as conversas do vendedor que mudaram desde `desdeMsg`/`desdeEtiqueta` (+ catálogo de
 * etiquetas, ~20 linhas). Os cortes já vêm com folga do chamador: a lista do vendedor
 * chega fora de ordem (até ~1,5 min), então "maior que o último visto" perderia mensagem
 * que entrou atrasada. Devolve null quando é melhor reler tudo.
 */
export async function buscarMudancasEspelho(vendedor: string, desdeMsg: string | null, desdeEtiqueta: string | null) {
  const filtros = [
    desdeMsg && `last_message_at.gte."${desdeMsg}"`,
    desdeEtiqueta && `label_changed_at.gte."${desdeEtiqueta}"`,
  ].filter(Boolean)
  if (!filtros.length) return null
  const [linhas, catalogo] = await Promise.all([
    supabase.from('wa_chat_labels')
      .select('vendedor_nome, phone, chat_id, contact_name, label_ids, last_message_at, last_message_from_me, last_message_preview, foto_url, updated_at')
      .eq('vendedor_nome', vendedor).or(filtros.join(',')).limit(500),
    supabase.from('wascript_etiquetas').select('vendedor_nome, etiqueta_id_wascript, etiqueta_nome_normalizado').eq('vendedor_nome', vendedor),
  ])
  if (linhas.error) throw linhas.error
  if (catalogo.error) throw catalogo.error
  // 500 = algo grande mudou (ex.: limpeza em massa de etiquetas) — melhor reler tudo
  if ((linhas.data ?? []).length >= 500) return null
  return { linhas: (linhas.data ?? []) as LinhaEspelho[], idParaNome: mapaEtiquetas(catalogo.data ?? []) }
}

/**
 * Contas que têm espelho no CRM: quem tem catálogo de etiquetas sincronizado
 * pela extensão (o mesmo critério do quadro do funil). O final do número vem
 * do WhatsApp que a extensão VIU conectado (`wid_observado`); o `telefone`
 * cadastrado só entra quando ainda não houve leitura — eles divergem quando o
 * vendedor troca de chip.
 */
export function useEspelhoContas(habilitado: boolean) {
  const userId = useAuth().session?.user.id
  return useQuery<ContaWhatsApp[]>({
    queryKey: ['whatsapp-espelho-contas', userId],
    enabled: habilitado && !!userId,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const [etiquetas, vendedores] = await Promise.all([
        supabase.from('wascript_etiquetas').select('vendedor_nome'),
        supabase.from('vendors').select('name, telefone, wid_observado').eq('ativo', true),
      ])
      if (etiquetas.error) throw etiquetas.error
      if (vendedores.error) throw vendedores.error
      const finais: Record<string, string | null> = {}
      for (const v of vendedores.data ?? []) finais[v.name] = finalDoNumero(v.wid_observado) ?? finalDoNumero(v.telefone)
      return contasDoEspelho((etiquetas.data ?? []).map(r => r.vendedor_nome as string), finais)
    },
  })
}
