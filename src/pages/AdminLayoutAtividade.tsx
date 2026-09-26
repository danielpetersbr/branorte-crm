// Admin → Layout (atividade): o que cada vendedor faz no Fazedor de Layout.
// Lê public.layout_atividade (RLS deixa só admin ler). Mostra a linha do tempo por
// vendedor: quando entrou/saiu (e quanto tempo ficou), o que abriu e salvou, quantos
// equipamentos tinha no projeto e a miniatura do que montou.
import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Boxes, Clock, FolderOpen, Save, LogIn, LogOut } from 'lucide-react'
import { supabase } from '@/lib/supabase'

interface LinhaAtividade {
  id: number
  user_id: string
  email: string | null
  acao: 'entrou' | 'abriu' | 'salvou' | 'saiu'
  projeto_id: string | null
  projeto_nome: string | null
  qtd_equip: number | null
  equipamentos: string[] | null
  thumb: string | null
  at: string
}

function useAtividade(dias: number) {
  return useQuery({
    queryKey: ['layout_atividade', dias],
    queryFn: async () => {
      const desde = new Date(Date.now() - dias * 86400_000).toISOString()
      const { data, error } = await supabase
        .from('layout_atividade')
        .select('id,user_id,email,acao,projeto_id,projeto_nome,qtd_equip,equipamentos,thumb,at')
        .gte('at', desde)
        .order('at', { ascending: false })
        .limit(2000)
      if (error) throw error
      return (data ?? []) as LinhaAtividade[]
    },
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  })
}

const fmt = (s: string) =>
  new Date(s).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })

const ICONE = { entrou: LogIn, abriu: FolderOpen, salvou: Save, saiu: LogOut } as const
const ROTULO = { entrou: 'Entrou', abriu: 'Abriu', salvou: 'Salvou', saiu: 'Saiu' } as const

/** Soma o tempo dentro da ferramenta juntando cada 'entrou' com o 'saiu' seguinte. */
function tempoTotal(linhas: LinhaAtividade[]): string {
  const asc = [...linhas].sort((a, b) => a.at.localeCompare(b.at))
  let ms = 0
  let entrada: number | null = null
  for (const l of asc) {
    if (l.acao === 'entrou') entrada = new Date(l.at).getTime()
    else if (l.acao === 'saiu' && entrada != null) {
      const dur = new Date(l.at).getTime() - entrada
      if (dur > 0 && dur < 8 * 3600_000) ms += dur
      entrada = null
    }
  }
  if (ms < 60_000) return '—'
  const min = Math.round(ms / 60_000)
  return min < 60 ? `${min} min` : `${Math.floor(min / 60)}h${String(min % 60).padStart(2, '0')}`
}

export function AdminLayoutAtividade() {
  const [dias, setDias] = useState(7)
  const [quem, setQuem] = useState<string>('')
  const { data, isLoading } = useAtividade(dias)

  const pessoas = useMemo(() => {
    const m = new Map<string, string>()
    for (const l of data ?? []) if (l.email) m.set(l.email, l.email)
    return [...m.keys()].sort()
  }, [data])

  const linhas = useMemo(
    () => (data ?? []).filter((l) => !quem || l.email === quem),
    [data, quem],
  )

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto">
      <div className="flex items-center gap-2 mb-1">
        <Boxes className="w-5 h-5 text-brand" />
        <h1 className="text-xl font-semibold text-ink">Layout — atividade dos vendedores</h1>
      </div>
      <p className="text-[13px] text-ink-muted mb-4">
        O que cada um faz no Fazedor de Layout: quando entrou, o que abriu e salvou, e o que montou.
      </p>

      <div className="flex flex-wrap gap-3 mb-4">
        <select value={quem} onChange={(e) => setQuem(e.target.value)}
          className="border border-border rounded-md px-3 py-1.5 text-sm bg-surface text-ink">
          <option value="">Todos os vendedores</option>
          {pessoas.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
        <select value={dias} onChange={(e) => setDias(Number(e.target.value))}
          className="border border-border rounded-md px-3 py-1.5 text-sm bg-surface text-ink">
          <option value={1}>Últimas 24h</option>
          <option value={7}>Últimos 7 dias</option>
          <option value={30}>Últimos 30 dias</option>
        </select>
        {quem && (
          <span className="inline-flex items-center gap-1 text-sm text-ink-muted px-2">
            <Clock className="w-4 h-4" /> Tempo na ferramenta: <b className="text-ink">{tempoTotal(linhas)}</b>
          </span>
        )}
      </div>

      {isLoading ? (
        <p className="text-ink-muted text-sm">Carregando…</p>
      ) : linhas.length === 0 ? (
        <p className="text-ink-muted text-sm">Nenhuma atividade no período.</p>
      ) : (
        <div className="space-y-2">
          {linhas.map((l) => {
            const Icone = ICONE[l.acao]
            return (
              <div key={l.id} className="flex gap-3 items-start border border-border rounded-lg p-3 bg-surface">
                {l.thumb ? (
                  <img src={l.thumb} alt="" className="w-20 h-16 object-cover rounded border border-border shrink-0" />
                ) : (
                  <div className="w-9 h-9 rounded-full bg-surface-2 flex items-center justify-center shrink-0">
                    <Icone className="w-4 h-4 text-ink-muted" />
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <span className="font-medium text-ink">{ROTULO[l.acao]}</span>
                    {l.projeto_nome && <span className="text-ink-muted truncate">· {l.projeto_nome}</span>}
                    {l.qtd_equip != null && (
                      <span className="text-[12px] text-ink-faint">· {l.qtd_equip} equipamento(s)</span>
                    )}
                    <span className="text-[12px] text-ink-faint ml-auto">{fmt(l.at)}</span>
                  </div>
                  {!quem && l.email && <div className="text-[12px] text-ink-muted">{l.email}</div>}
                  {l.equipamentos && l.equipamentos.length > 0 && (
                    <div className="text-[12px] text-ink-faint mt-1 line-clamp-2">
                      {l.equipamentos.join(', ')}
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
