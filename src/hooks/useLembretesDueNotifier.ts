import { useCallback, useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useVendedorNome } from '@/hooks/useVendedorNome'
import {
  AGENDA_SELECT, hm, parseLocalDateTime, ymd, likeExato,
  type AgendaItem,
} from '@/lib/agenda'

// ============================================================================
// Notificador GLOBAL de lembretes/compromissos vencidos. Roda no Layout, então
// aparece em QUALQUER página do CRM. A cada ~60s procura itens do vendedor logado
// que já venceram (data+hora <= agora, BR local) e ainda não foram avisados NA TELA
// (notificado_app=false). Ao exibir, marca notificado_app=true pra não repetir.
// ============================================================================

const POLL_MS = 60 * 1000
const HORA_MS = 60 * 60 * 1000

export interface LembreteNotifierApi {
  nome: string
  cards: AgendaItem[]
  concluir: (item: AgendaItem) => Promise<void>
  adiar1h: (item: AgendaItem) => Promise<void>
  dispensar: (id: number) => void
}

export function useLembretesDueNotifier(): LembreteNotifierApi {
  const qc = useQueryClient()
  const { nome } = useVendedorNome()

  const [cards, setCards] = useState<AgendaItem[]>([])
  // Ids já mostrados nesta sessão — evita duplicar o card entre ciclos de poll.
  const shownRef = useRef<Set<number>>(new Set())
  const runningRef = useRef(false)

  const invalidar = useCallback(() => {
    qc.invalidateQueries({ queryKey: ['agenda-itens'] })
  }, [qc])

  const poll = useCallback(async () => {
    if (!nome || runningRef.current) return
    runningRef.current = true
    try {
      const agora = new Date()
      const hojeYmd = ymd(agora)
      const { data, error } = await supabase
        .from('agenda_itens')
        .select(AGENDA_SELECT)
        .ilike('vendedor_nome', likeExato(nome))
        .eq('concluido', false)
        .eq('notificado_app', false)
        .not('data', 'is', null)
        .lte('data', hojeYmd)
        .order('data', { ascending: true })
        .order('hora', { ascending: true, nullsFirst: true })
        .limit(50)
      if (error) throw error

      const vencidos = ((data ?? []) as AgendaItem[]).filter(it => {
        if (!it.data) return false
        if (shownRef.current.has(it.id)) return false
        return parseLocalDateTime(it.data, it.hora).getTime() <= agora.getTime()
      })
      if (vencidos.length === 0) return

      for (const it of vencidos) shownRef.current.add(it.id)
      setCards(prev => {
        const existentes = new Set(prev.map(c => c.id))
        const novos = vencidos.filter(v => !existentes.has(v.id))
        return novos.length ? [...prev, ...novos] : prev
      })

      // Marca como avisado NA TELA pra não repetir em próximos ciclos/recarregamentos.
      const ids = vencidos.map(v => v.id)
      const { error: upErr } = await supabase
        .from('agenda_itens')
        .update({ notificado_app: true, atualizado_em: new Date().toISOString() })
        .in('id', ids)
      if (upErr) {
        // eslint-disable-next-line no-console
        console.error('[lembretes] falha ao marcar notificado_app:', upErr)
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[lembretes] poll falhou:', err)
    } finally {
      runningRef.current = false
    }
  }, [nome])

  // Ciclo de polling: roda já ao montar e a cada POLL_MS. Reinicia quando o
  // vendedor muda (login/troca de conta).
  useEffect(() => {
    if (!nome) return
    poll()
    const id = window.setInterval(poll, POLL_MS)
    return () => window.clearInterval(id)
  }, [nome, poll])

  const concluir = useCallback(async (item: AgendaItem) => {
    setCards(prev => prev.filter(c => c.id !== item.id))
    const { error } = await supabase
      .from('agenda_itens')
      .update({ concluido: true, atualizado_em: new Date().toISOString() })
      .eq('id', item.id)
    if (error) {
      // eslint-disable-next-line no-console
      console.error('[lembretes] concluir falhou:', error)
    }
    invalidar()
  }, [invalidar])

  const adiar1h = useCallback(async (item: AgendaItem) => {
    setCards(prev => prev.filter(c => c.id !== item.id))
    // Base = o mais tarde entre o horário agendado e agora; +1h a partir daí.
    // (Se estava vencido, isso vira "agora + 1h" — o lembrete volta em 1 hora.)
    const agendado = item.data ? parseLocalDateTime(item.data, item.hora).getTime() : Date.now()
    const alvo = new Date(Math.max(agendado, Date.now()) + HORA_MS)
    // Libera pra voltar a disparar nesta sessão também.
    shownRef.current.delete(item.id)
    const { error } = await supabase
      .from('agenda_itens')
      .update({
        data: ymd(alvo),
        hora: `${hm(alvo)}:00`,
        notificado_app: false,
        notificado_wa: false,
        atualizado_em: new Date().toISOString(),
      })
      .eq('id', item.id)
    if (error) {
      // eslint-disable-next-line no-console
      console.error('[lembretes] adiar falhou:', error)
    }
    invalidar()
  }, [invalidar])

  // Dispensa só tira da tela — o item já foi marcado notificado_app=true no poll.
  const dispensar = useCallback((id: number) => {
    setCards(prev => prev.filter(c => c.id !== id))
  }, [])

  return { nome, cards, concluir, adiar1h, dispensar }
}
