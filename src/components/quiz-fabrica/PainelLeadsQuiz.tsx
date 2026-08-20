/**
 * Leads que chegaram pelo quiz público /monte-sua-fabrica.
 *
 * Cada linha é um produtor que respondeu as 7 perguntas, viu a fábrica dele na
 * tela e pediu pra falar com um técnico. O que ele VIU está guardado em
 * `resultado` — o vendedor abre e liga sabendo exatamente qual linha apareceu.
 */
import { useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, MessageCircle } from 'lucide-react'
import {
  STATUS_LEAD, useAtualizarLead, useQuizLeads,
  type QuizLeadRow, type StatusLead,
} from '@/hooks/useQuizFabrica'
import { kg } from '@/lib/quiz-fabrica/motor'

const RECEBIMENTO: Record<string, string> = {
  granel: 'grão a granel', ensacado: 'grão ensacado', propria: 'colheita própria',
}
const ESTOQUE: Record<string, string> = {
  nenhum: 'sem silo', mes: 'silo de ~1 mês', safra: 'silo de safra',
}
const EXPEDICAO: Record<string, string> = {
  ensacada: 'ensaca', granel: 'a granel', ambos: 'ensaca e granel',
}
const ENERGIA: Record<string, string> = {
  trifasico: 'trifásica', monofasico: 'monofásica', nao_sei: 'não sabe a energia',
}

/**
 * Decimal em português: 3,4 — não 3.4.
 *
 * Interpolar o número cru dava "20.000 animais × 3.4 kg/mês": milhar certo e
 * decimal americano na MESMA linha, o que faz o vendedor duvidar do número
 * inteiro antes de duvidar do formato.
 */
function dec(v: number | null): string {
  return (v ?? 0).toLocaleString('pt-BR', { maximumFractionDigits: 2 })
}

function data(iso: string): string {
  return new Date(iso).toLocaleString('pt-BR', {
    day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit',
  })
}

/** wa.me só engole dígitos, e com o 55 na frente. */
function whatsapp(tel: string): string {
  const so = tel.replace(/\D/g, '').replace(/^55/, '')
  return `https://wa.me/55${so}`
}

function Linha({ l }: { l: QuizLeadRow }) {
  const [aberto, setAberto] = useState(false)
  const [notas, setNotas] = useState(l.notas_internas ?? '')
  const atualizar = useAtualizarLead()

  const resumo = useMemo(() => [
    l.recebimento && RECEBIMENTO[l.recebimento],
    l.estoque_grao && ESTOQUE[l.estoque_grao],
    l.expedicao && EXPEDICAO[l.expedicao],
    l.pesagem_automatica === true ? 'quer pesagem automática' : l.pesagem_automatica === false ? 'pesa na balança' : null,
    l.energia && ENERGIA[l.energia],
  ].filter(Boolean).join(' · '), [l])

  return (
    <div className={`rounded-lg border bg-surface ${l.status === 'novo' ? 'border-accent/50' : 'border-border'}`}>
      <div className="flex items-start gap-3 px-4 py-3">
        <button type="button" onClick={() => setAberto(a => !a)}
          className="mt-0.5 text-ink-muted hover:text-ink shrink-0" aria-label={aberto ? 'Fechar' : 'Abrir'}>
          {aberto ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </button>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
            <span className="text-[15px] font-bold text-ink">{l.nome}</span>
            {(l.cidade || l.uf) && (
              <span className="text-[13px] text-ink-muted">
                {[l.cidade, l.uf].filter(Boolean).join('/')}
              </span>
            )}
            <span className="text-[12px] text-ink-faint font-mono">{data(l.criado_em)}</span>
            {l.status === 'novo' && (
              <span className="text-[10.5px] font-bold uppercase tracking-wide text-accent border border-accent/40 rounded px-1.5 py-0.5">
                novo
              </span>
            )}
            {l.fora_de_escopo && (
              <span className="text-[10.5px] font-bold uppercase tracking-wide text-danger border border-danger/40 rounded px-1.5 py-0.5">
                fora de escopo · {l.fora_de_escopo}
              </span>
            )}
          </div>

          <div className="text-[13.5px] text-ink mt-1">
            {l.compacta_codigo
              ? <><strong>{l.compacta_codigo.replace(/ - .*$/, '')}</strong>{' · '}</>
              : l.capacidade_kg_h
                ? <><strong>{Math.round(l.capacidade_kg_h).toLocaleString('pt-BR')} kg/h sob medida</strong>{' · '}</>
                : null}
            {l.demanda_mensal_kg ? `${kg(l.demanda_mensal_kg)}/mês` : 'sem volume'}
            {l.especie ? ` · ${l.especie}${l.categoria ? ` (${l.categoria})` : ''}` : ''}
          </div>

          {resumo && <div className="text-[12.5px] text-ink-muted leading-snug mt-0.5">{resumo}</div>}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <a href={whatsapp(l.telefone)} target="_blank" rel="noopener"
            className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-accent hover:underline">
            <MessageCircle className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">{l.telefone}</span>
          </a>
          <select
            value={l.status}
            onChange={e => atualizar.mutate({ id: l.id, status: e.target.value as StatusLead })}
            className="text-[12.5px] rounded-md border border-border bg-bg text-ink px-2 py-1.5"
          >
            {STATUS_LEAD.map(s => <option key={s.chave} value={s.chave}>{s.nome}</option>)}
          </select>
        </div>
      </div>

      {aberto && (
        <div className="border-t border-border px-4 py-3.5 space-y-4">
          {/* O que ele respondeu, cru. */}
          <div className="text-[13px] text-ink-muted leading-relaxed">
            {l.modo === 'animais'
              ? `${(l.numero_animais ?? 0).toLocaleString('pt-BR')} animais × ${dec(l.consumo_por_animal_mes)} kg/mês`
              : `${dec(l.toneladas_mes)} t/mês informadas direto`}
            {' · '}
            {l.dias_por_semana} {l.dias_por_semana === 1 ? 'dia' : 'dias'}/semana × {l.horas_por_dia} h/dia
          </div>

          {/* O que ele VIU. Não recalculado — é o snapshot da tela dele. */}
          {l.resultado?.estacoes?.length ? (
            <div>
              <div className="text-[12px] font-bold uppercase tracking-wide text-ink-muted mb-2">
                A linha que apareceu pra ele
              </div>
              <ul className="space-y-1.5">
                {l.resultado.estacoes.filter(e => e.ordem > 0).map(e => (
                  <li key={e.chave} className="text-[13px] text-ink leading-snug">
                    <span className="font-mono text-ink-faint mr-1.5">{e.ordem}.</span>
                    <strong>{e.titulo}:</strong>{' '}
                    <span className="text-ink-muted">{e.itens.map(i => i.nome).join(' · ')}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {l.resultado?.alertas?.length ? (
            <div className="rounded-md border-l-[3px] border-warning bg-warning/10 px-3 py-2">
              <div className="text-[12px] font-bold text-ink mb-1">Avisos que ele leu</div>
              <ul className="space-y-1">
                {l.resultado.alertas.map((a, i) => (
                  <li key={i} className="text-[12.5px] text-ink leading-snug">{a}</li>
                ))}
              </ul>
            </div>
          ) : null}

          <div>
            <label className="block text-[12px] font-bold uppercase tracking-wide text-ink-muted mb-1.5">
              Nota interna
            </label>
            <textarea
              rows={2}
              value={notas}
              onChange={e => setNotas(e.target.value)}
              onBlur={() => { if (notas !== (l.notas_internas ?? '')) atualizar.mutate({ id: l.id, notas }) }}
              placeholder="O que ficou combinado na ligação…"
              className="w-full rounded-md border border-border bg-bg px-3 py-2 text-[13.5px] text-ink placeholder:text-ink-faint focus:outline-none focus:border-accent"
            />
          </div>
        </div>
      )}
    </div>
  )
}

export function PainelLeadsQuiz() {
  const [verDescartados, setVerDescartados] = useState(false)
  const { data: leads = [], isLoading, error } = useQuizLeads(verDescartados)
  const novos = leads.filter(l => l.status === 'novo').length

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-[17px] font-extrabold text-ink tracking-tight">
            Quem respondeu o quiz
          </h2>
          <p className="text-[13px] text-ink-muted leading-snug mt-0.5">
            Chegam de{' '}
            <a href="/monte-sua-fabrica" target="_blank" rel="noopener"
               className="text-accent font-mono hover:underline">/monte-sua-fabrica</a>
            {' — '}o link que dá pra colar no WhatsApp, no anúncio ou no perfil.{' '}
            <a href="/monte-sua-fabrica/previa" className="text-accent hover:underline">Ver a prévia</a>.
          </p>
        </div>
        <label className="flex items-center gap-2 text-[13px] text-ink-muted">
          <input type="checkbox" checked={verDescartados} onChange={e => setVerDescartados(e.target.checked)} />
          mostrar descartados
        </label>
      </div>

      {novos > 0 && (
        <div className="text-[13.5px] text-ink">
          <strong>{novos}</strong> {novos === 1 ? 'lead novo esperando contato' : 'leads novos esperando contato'}.
        </div>
      )}

      {isLoading && <div className="text-[14px] text-ink-muted">Carregando…</div>}

      {error && (
        <div className="rounded-md border-l-[3px] border-danger bg-danger/10 px-4 py-3 text-[13.5px] text-ink">
          Não consegui carregar os leads. Se você não é admin, vendedor ou marketing, esta lista não
          é visível pro seu perfil — é a RLS barrando, não um erro de tela.
        </div>
      )}

      {!isLoading && !error && leads.length === 0 && (
        <div className="rounded-lg border border-border bg-surface px-4 py-8 text-center">
          <p className="text-[14.5px] text-ink">Ninguém respondeu o quiz ainda.</p>
          <p className="text-[13px] text-ink-muted mt-1.5">
            Divulgue o link e as respostas caem aqui.
          </p>
        </div>
      )}

      <div className="space-y-2.5">
        {leads.map(l => <Linha key={l.id} l={l} />)}
      </div>
    </div>
  )
}
