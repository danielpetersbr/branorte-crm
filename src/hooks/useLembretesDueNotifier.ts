import { useCallback, useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useVendedorNome } from '@/hooks/useVendedorNome'
import { persistirAcaoLembrete } from '@/lib/agenda-lembrete-acoes'
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
  pendingIds: number[]
  actionErrors: Record<number, string>
  concluir: (item: AgendaItem) => Promise<void>
  adiar1h: (item: AgendaItem) => Promise<void>
  dispensar: (id: number) => void
}

export function useLembretesDueNotifier(): LembreteNotifierApi {
  const qc = useQueryClient()
  const { nome } = useVendedorNome()

  const [cards, setCards] = useState<AgendaItem[]>([])
  const [pendingIds, setPendingIds] = useState<number[]>([])
  const [actionErrors, setActionErrors] = useState<Record<number, string>>({})
  const pendingRef = useRef(new Set<number>())
  const nomeRef = useRef(nome)
  nomeRef.current = nome
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
      if (nomeRef.current !== nome) return

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
    setCards([])
    setActionErrors({})
    setPendingIds([])
    pendingRef.current.clear()
    shownRef.current.clear()
    if (!nome) return
    poll()
    const id = window.setInterval(poll, POLL_MS)
    return () => window.clearInterval(id)
  }, [nome, poll])

  const executar = useCallback(async (item: AgendaItem, acao: 'concluir' | 'adiar') => {
    if (pendingRef.current.has(item.id)) return
    const vendedor = nomeRef.current
    pendingRef.current.add(item.id)
    setPendingIds([...pendingRef.current])
    setActionErrors(prev => { const next = { ...prev }; delete next[item.id]; return next })
    const agendado = item.data ? parseLocalDateTime(item.data, item.hora).getTime() : Date.now()
    const alvo = new Date(Math.max(agendado, Date.now()) + HORA_MS)
    const patch = acao === 'concluir'
      ? { concluido: true, atualizado_em: new Date().toISOString() }
      : { data: ymd(alvo), hora: `${hm(alvo)}:00`, notificado_app: false, notificado_wa: false, atualizado_em: new Date().toISOString() }
    try {
      await persistirAcaoLembrete(
        () => supabase.from('agenda_itens').update(patch).eq('id', item.id).select('id').single(),
        () => {
          if (nomeRef.current !== vendedor) return
          if (acao === 'adiar') shownRef.current.delete(item.id)
          setCards(prev => prev.filter(c => c.id !== item.id))
          invalidar()
        },
      )
    } catch {
      if (nomeRef.current === vendedor) {
        setActionErrors(prev => ({ ...prev, [item.id]: `Não foi possível ${acao === 'concluir' ? 'concluir' : 'adiar'} o lembrete. Tente novamente.` }))
      }
    } finally {
      if (nomeRef.current === vendedor) {
        pendingRef.current.delete(item.id)
        setPendingIds([...pendingRef.current])
      }
    }
  }, [invalidar])

  const concluir = useCallback((item: AgendaItem) => executar(item, 'concluir'), [executar])
  const adiar1h = useCallback((item: AgendaItem) => executar(item, 'adiar'), [executar])

  // Dispensa só tira da tela — o item já foi marcado notificado_app=true no poll.
  const dispensar = useCallback((id: number) => {
    if (pendingRef.current.has(id)) return
    setCards(prev => prev.filter(c => c.id !== id))
  }, [])

  return { nome, cards, pendingIds, actionErrors, concluir, adiar1h, dispensar }
}
