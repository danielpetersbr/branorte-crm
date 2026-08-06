import { useMemo, useState } from 'react'
import {
  ClipboardList, MapPin, Navigation, CheckCircle, AlertCircle, Phone, Package,
  CalendarDays, ChevronDown, ChevronUp,
} from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { Badge } from '@/components/ui/Badge'
import { BRLInput } from '@/components/ui/BRLInput'
import { cn } from '@/lib/utils'
import {
  useMinhasVisitas, useMinhasAtividades, useCheckin, useCheckout,
  useSalvarRelatorio, useConcluirAtividade,
  RESULTADOS, RESULTADO_LABEL, PROXIMO_PASSO_MIN,
  type MinhaVisita,
} from '@/hooks/useVisitasCampo'

// Tela do representante em campo. Roda no celular, em tema claro forçado
// (Layout força tema claro pra papel restrito — conta de gente de fora não tem
// o botão de trocar tema).

interface ToastMsg { id: number; texto: string; tone: 'success' | 'danger' | 'info' }

function useToast(): [ToastMsg[], (texto: string, tone?: ToastMsg['tone']) => void] {
  const [toasts, setToasts] = useState<ToastMsg[]>([])
  const push = (texto: string, tone: ToastMsg['tone'] = 'info') => {
    const id = Date.now() + Math.random()
    setToasts(t => [...t, { id, texto, tone }])
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 5000)
  }
  return [toasts, push]
}

function ToastStack({ toasts }: { toasts: ToastMsg[] }) {
  if (!toasts.length) return null
  return (
    <div className="fixed left-1/2 -translate-x-1/2 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] md:bottom-6 z-[1100] flex flex-col gap-2 items-center pointer-events-none px-3 w-full max-w-md">
      {toasts.map(t => (
        <div key={t.id} className={cn(
          'w-full text-center px-4 py-2.5 rounded-lg shadow-lg text-[13px] font-medium border backdrop-blur bg-surface/95',
          t.tone === 'success' && 'border-success/30 text-success',
          t.tone === 'danger' && 'border-danger/30 text-danger',
          t.tone === 'info' && 'border-border text-ink',
        )}>{t.texto}</div>
      ))}
    </div>
  )
}

function hoje(): string {
  return new Date().toLocaleDateString('sv-SE') // YYYY-MM-DD no fuso local
}

function dataBonita(iso: string | null): string {
  if (!iso) return 'Sem data'
  const [a, m, d] = iso.split('-').map(Number)
  const dt = new Date(a, m - 1, d)
  const label = dt.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit' })
  if (iso === hoje()) return `Hoje · ${label}`
  return label
}

function horaCurta(ts: string | null): string {
  if (!ts) return ''
  return new Date(ts).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
}

type Estado = 'planejada' | 'em_visita' | 'encerrada'

function estadoDa(v: MinhaVisita): Estado {
  if (v.checkout_at) return 'encerrada'
  if (v.checkin_at) return 'em_visita'
  return 'planejada'
}

const ESTADO_META: Record<Estado, { label: string; cls: string }> = {
  planejada: { label: 'A visitar', cls: 'text-info bg-info/10' },
  em_visita: { label: 'Em visita', cls: 'text-warning bg-warning/10' },
  encerrada: { label: 'Encerrada', cls: 'text-success bg-success/10' },
}

export function MinhasVisitas() {
  const [periodo, setPeriodo] = useState<'hoje' | 'semana' | 'tudo'>('semana')
  const [toasts, push] = useToast()

  const { de, ate } = useMemo(() => {
    if (periodo === 'tudo') return { de: null, ate: null }
    const h = new Date()
    const ini = h.toLocaleDateString('sv-SE')
    if (periodo === 'hoje') return { de: ini, ate: ini }
    const fim = new Date(h.getTime() + 6 * 86400_000).toLocaleDateString('sv-SE')
    return { de: ini, ate: fim }
  }, [periodo])

  const { data: visitas = [], isLoading, isError } = useMinhasVisitas(de, ate)
  const { data: atividades = [] } = useMinhasAtividades()
  const concluir = useConcluirAtividade()

  const porDia = useMemo(() => {
    const m = new Map<string, MinhaVisita[]>()
    for (const v of visitas) {
      const k = v.data_prevista ?? 'sem-data'
      if (!m.has(k)) m.set(k, [])
      m.get(k)!.push(v)
    }
    return [...m.entries()].sort(([a], [b]) => a.localeCompare(b))
  }, [visitas])

  const pendentes = atividades.filter(a => !a.concluido)

  return (
    <div className="p-3 lg:p-6 max-w-[900px] mx-auto pb-24">
      <div className="mb-4">
        <h1 className="text-2xl lg:text-3xl font-semibold text-ink tracking-tight flex items-center gap-2">
          <ClipboardList className="h-6 w-6 text-accent" /> Minhas Visitas
        </h1>
        <p className="text-[12px] text-ink-faint mt-0.5">
          Bate o check-in ao chegar. O relatório é obrigatório pra encerrar.
        </p>
      </div>

      <div className="flex gap-1.5 mb-4">
        {([['hoje', 'Hoje'], ['semana', '7 dias'], ['tudo', 'Todas']] as const).map(([k, label]) => (
          <button
            key={k}
            onClick={() => setPeriodo(k)}
            className={cn(
              'px-3 py-1.5 rounded-full text-[12px] font-medium border transition-all',
              periodo === k
                ? 'bg-accent text-white border-accent'
                : 'bg-surface text-ink-muted border-border hover:border-border-strong',
            )}
          >{label}</button>
        ))}
      </div>

      {pendentes.length > 0 && (
        <div className="rounded-xl border border-border bg-surface-2 p-3 mb-4">
          <p className="text-[11px] uppercase font-bold text-ink-muted mb-2 flex items-center gap-1.5">
            <CalendarDays className="h-3.5 w-3.5" /> Próximos passos ({pendentes.length})
          </p>
          <div className="space-y-1.5">
            {pendentes.slice(0, 6).map(a => (
              <label key={a.id} className="flex items-start gap-2 text-[13px] text-ink cursor-pointer">
                <input
                  type="checkbox"
                  className="mt-0.5 h-4 w-4 shrink-0 accent-current"
                  checked={a.concluido}
                  onChange={e => concluir.mutate({ id: a.id, concluido: e.target.checked })}
                />
                <span className="flex-1 leading-snug">
                  {a.titulo}
                  {a.data && (
                    <span className={cn(
                      'ml-1.5 text-[11px]',
                      a.data < hoje() ? 'text-danger font-semibold' : 'text-ink-faint',
                    )}>
                      {a.data < hoje() ? 'vencido · ' : ''}{dataBonita(a.data)}
                    </span>
                  )}
                </span>
              </label>
            ))}
          </div>
        </div>
      )}

      {isLoading ? (
        <p className="text-[13px] text-ink-muted py-10 text-center">Carregando…</p>
      ) : isError ? (
        <div className="rounded-xl border border-danger/30 bg-danger/5 py-8 text-center">
          <AlertCircle className="h-7 w-7 text-danger mx-auto mb-2" />
          <p className="text-[13px] text-ink-muted">Não consegui carregar suas visitas. Tente de novo em instantes.</p>
        </div>
      ) : visitas.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border py-14 text-center">
          <MapPin className="h-8 w-8 text-ink-faint mx-auto mb-2" />
          <p className="text-[13px] text-ink-muted">Nenhuma visita no período.</p>
          <p className="text-[12px] text-ink-faint mt-1">
            As visitas aparecem aqui quando o roteiro é montado no Mapa de Visitas.
          </p>
        </div>
      ) : (
        <div className="space-y-5">
          {porDia.map(([dia, lista]) => (
            <div key={dia}>
              <p className="text-[11px] uppercase font-bold text-ink-muted mb-2">
                {dia === 'sem-data' ? 'Sem data' : dataBonita(dia)} · {lista.length}
              </p>
              <div className="space-y-2.5">
                {lista.map(v => (
                  <VisitaCard key={v.parada_id} v={v} onAviso={push} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      <ToastStack toasts={toasts} />
    </div>
  )
}

function VisitaCard({ v, onAviso }: { v: MinhaVisita; onAviso: (t: string, tone?: ToastMsg['tone']) => void }) {
  const [aberto, setAberto] = useState(false)
  const checkin = useCheckin()
  const checkout = useCheckout()
  const estado = estadoDa(v)
  const meta = ESTADO_META[estado]

  async function bater() {
    try {
      const r = await checkin.mutateAsync(v.parada_id)
      if (r.ja_tinha_checkin) { onAviso('Você já tinha batido o check-in aqui.', 'info'); return }
      const avisos: string[] = []
      if (r.sem_gps) avisos.push('sem GPS')
      if (r.fora_do_ponto) avisos.push(`${((r.distancia_m ?? 0) / 1000).toFixed(1)} km do ponto do cliente`)
      onAviso(avisos.length ? `Check-in registrado (${avisos.join(', ')}).` : 'Check-in registrado.', 'success')
      setAberto(true)
    } catch (e) {
      onAviso((e as Error).message || 'Não consegui registrar o check-in.', 'danger')
    }
  }

  async function encerrar() {
    try {
      const r = await checkout.mutateAsync(v.parada_id)
      onAviso(r.ja_encerrada ? 'Visita já estava encerrada.' : `Visita encerrada (${r.minutos} min).`, 'success')
      setAberto(false)
    } catch (e) {
      onAviso((e as Error).message || 'Não consegui encerrar a visita.', 'danger')
    }
  }

  const rota = v.lat != null && v.lng != null
    ? `https://www.google.com/maps/dir/?api=1&destination=${v.lat},${v.lng}`
    : null

  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <h3 className="text-[14px] font-semibold text-ink tracking-tight truncate">{v.cliente}</h3>
          <p className="text-[11px] text-ink-faint flex items-center gap-1 mt-0.5">
            <MapPin className="h-3 w-3 shrink-0" />
            {v.cidade ?? '—'}{v.uf ? ` · ${v.uf}` : ''}
            {!v.ponto_confiavel && (
              <span className="text-warning ml-1" title="A localização é a da cidade, não o endereço exato">
                · local aproximado
              </span>
            )}
          </p>
        </div>
        <Badge className={meta.cls}>{meta.label}</Badge>
      </div>

      {(v.equipamento || v.valor) && (
        <p className="text-[12px] text-ink-muted mt-2 flex items-center gap-1.5">
          <Package className="h-3.5 w-3.5 shrink-0 text-ink-faint" />
          <span className="truncate">{v.equipamento ?? 'Equipamento não informado'}</span>
          {v.valor ? <span className="text-ink font-medium shrink-0">
            {v.valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })}
          </span> : null}
        </p>
      )}

      {v.checkin_at && (
        <p className="text-[11px] text-ink-faint mt-2">
          Chegou {horaCurta(v.checkin_at)}
          {v.checkout_at ? ` · saiu ${horaCurta(v.checkout_at)}` : ''}
          {v.distancia_m != null ? ` · ${v.distancia_m} m do ponto` : ''}
        </p>
      )}

      {v.tem_relatorio && v.resultado && (
        <p className="text-[12px] text-ink mt-2">
          <CheckCircle className="h-3.5 w-3.5 inline-block mr-1 text-success align-[-2px]" />
          {RESULTADO_LABEL[v.resultado] ?? v.resultado}
          {v.proxima_data ? <span className="text-ink-faint"> · retorno {dataBonita(v.proxima_data)}</span> : null}
        </p>
      )}

      <div className="flex flex-wrap gap-2 mt-3">
        {estado === 'planejada' && (
          <Button variant="primary" size="md" onClick={bater} loading={checkin.isPending} className="flex-1 min-w-[130px]">
            <Navigation className="h-4 w-4" /> Cheguei
          </Button>
        )}
        {estado === 'em_visita' && (
          <>
            <Button variant={v.tem_relatorio ? 'secondary' : 'primary'} size="md"
                    onClick={() => setAberto(a => !a)} className="flex-1 min-w-[130px]">
              <ClipboardList className="h-4 w-4" />
              {v.tem_relatorio ? 'Editar relatório' : 'Relatório'}
              {aberto ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
            </Button>
            <Button variant={v.tem_relatorio ? 'primary' : 'secondary'} size="md"
                    onClick={encerrar} loading={checkout.isPending} className="flex-1 min-w-[130px]">
              <CheckCircle className="h-4 w-4" /> Encerrar
            </Button>
          </>
        )}
        {estado === 'encerrada' && v.tem_relatorio && (
          <Button variant="ghost" size="sm" onClick={() => setAberto(a => !a)}>
            Ver relatório {aberto ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          </Button>
        )}
        {v.telefone && (
          <a href={`tel:${v.telefone.replace(/\D/g, '')}`}
             className="inline-flex items-center justify-center gap-1.5 h-9 px-3 rounded-md border border-border text-[13px] text-ink-muted hover:text-ink hover:border-border-strong">
            <Phone className="h-4 w-4" />
          </a>
        )}
        {rota && (
          <a href={rota} target="_blank" rel="noreferrer"
             className="inline-flex items-center justify-center gap-1.5 h-9 px-3 rounded-md border border-border text-[13px] text-ink-muted hover:text-ink hover:border-border-strong">
            <Navigation className="h-4 w-4" />
          </a>
        )}
      </div>

      {aberto && <FormRelatorio v={v} onAviso={onAviso} onSalvou={() => setAberto(false)} />}
    </div>
  )
}

function FormRelatorio({ v, onAviso, onSalvou }: {
  v: MinhaVisita
  onAviso: (t: string, tone?: ToastMsg['tone']) => void
  onSalvou: () => void
}) {
  const salvar = useSalvarRelatorio()
  const congelado = !!v.checkout_at
  // Abre PREENCHIDO com o que já foi relatado. Sem isto, reabrir pra corrigir
  // uma linha zeraria interesse/valor/concorrente/objeção no banco, porque o
  // salvar sobrescreve campo a campo.
  const [resultado, setResultado] = useState(v.resultado ?? '')
  const [proximoPasso, setProximoPasso] = useState(v.proximo_passo ?? '')
  const [interesse, setInteresse] = useState(v.interesse ?? '')
  const [valor, setValor] = useState<number | null>(v.valor_potencial ?? null)
  const [concorrente, setConcorrente] = useState(v.concorrente ?? '')
  const [objecao, setObjecao] = useState(v.objecao ?? '')
  const [proximaData, setProximaData] = useState(v.proxima_data ?? '')
  const [erro, setErro] = useState<string | null>(null)

  async function enviar() {
    setErro(null)
    try {
      await salvar.mutateAsync({
        parada_id: v.parada_id,
        resultado, proximo_passo: proximoPasso, interesse,
        valor_potencial: valor, concorrente, objecao,
        proxima_data: proximaData || null,
      })
      onAviso('Relatório salvo.', 'success')
      onSalvou()
    } catch (e) {
      setErro((e as Error).message || 'Não consegui salvar o relatório.')
    }
  }

  if (congelado) {
    const campos: Array<[string, string | null]> = [
      ['Como terminou', v.resultado ? (RESULTADO_LABEL[v.resultado] ?? v.resultado) : null],
      ['Próximo passo', v.proximo_passo],
      ['Interesse', v.interesse],
      ['Valor em jogo', v.valor_potencial != null
        ? v.valor_potencial.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })
        : null],
      ['Concorrente', v.concorrente],
      ['Objeção', v.objecao],
      ['Voltar a falar em', v.proxima_data ? dataBonita(v.proxima_data) : null],
    ]
    return (
      <div className="mt-3 pt-3 border-t border-border space-y-2">
        {campos.filter(([, valor]) => !!valor).map(([label, valor]) => (
          <div key={label}>
            <p className="text-[10px] uppercase font-bold text-ink-faint">{label}</p>
            <p className="text-[13px] text-ink whitespace-pre-wrap">{valor}</p>
          </div>
        ))}
        <p className="text-[11px] text-ink-faint pt-1">
          Visita encerrada — correção só pela gestão.
        </p>
      </div>
    )
  }

  const faltam = PROXIMO_PASSO_MIN - proximoPasso.trim().length

  return (
    <div className="mt-3 pt-3 border-t border-border space-y-3">
      <div>
        <p className="text-[11px] uppercase font-bold text-ink-muted mb-1">Como terminou *</p>
        <Select
          className="w-full"
          options={RESULTADOS.map(r => ({ value: r.value, label: r.label }))}
          placeholder="Escolha…"
          value={resultado}
          onChange={e => setResultado(e.target.value)}
        />
      </div>

      <div>
        <p className="text-[11px] uppercase font-bold text-ink-muted mb-1">Próximo passo *</p>
        <textarea
          rows={3}
          value={proximoPasso}
          onChange={e => setProximoPasso(e.target.value)}
          placeholder="O que você combinou de fazer, e quando"
          className="w-full rounded-md border border-border bg-surface px-3 py-2 text-[14px] sm:text-[13px] text-ink placeholder:text-ink-faint focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/30 transition-all resize-y"
        />
        {faltam > 0 && proximoPasso.length > 0 && (
          <p className="text-[11px] text-ink-faint mt-1">Faltam {faltam} caracteres.</p>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <p className="text-[11px] uppercase font-bold text-ink-muted mb-1">Interesse</p>
          <Input value={interesse} onChange={e => setInteresse(e.target.value)} placeholder="Ex.: fábrica 2 t/h" />
        </div>
        <div>
          <p className="text-[11px] uppercase font-bold text-ink-muted mb-1">Valor em jogo</p>
          <BRLInput value={valor} onChange={setValor} placeholder="0,00" className="w-full" />
        </div>
        <div>
          <p className="text-[11px] uppercase font-bold text-ink-muted mb-1">Concorrente</p>
          <Input value={concorrente} onChange={e => setConcorrente(e.target.value)} placeholder="Quem mais está na jogada" />
        </div>
        <div>
          <p className="text-[11px] uppercase font-bold text-ink-muted mb-1">Objeção</p>
          <Input value={objecao} onChange={e => setObjecao(e.target.value)} placeholder="O que travou" />
        </div>
      </div>

      <div>
        <p className="text-[11px] uppercase font-bold text-ink-muted mb-1">Voltar a falar em</p>
        <Input type="date" value={proximaData} onChange={e => setProximaData(e.target.value)} className="sm:max-w-[200px]" />
        <p className="text-[11px] text-ink-faint mt-1">Com data, vira tarefa na sua lista de próximos passos.</p>
      </div>

      {erro && (
        <div className="rounded-md border border-danger/30 bg-danger/5 px-3 py-2 text-[12px] text-danger">{erro}</div>
      )}

      <Button variant="primary" size="md" onClick={enviar} loading={salvar.isPending} className="w-full">
        Salvar relatório
      </Button>
    </div>
  )
}
