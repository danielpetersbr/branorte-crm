import { useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { AlertCircle, MapPin, Inbox } from 'lucide-react'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { Badge } from '@/components/ui/Badge'
import { cn } from '@/lib/utils'
import {
  useCandidaturas, salvarTriagem, CAND_STATUS, LINHA_LABEL, TICKET_LABEL,
  type Candidatura,
} from '@/hooks/useRepresentantes'

// Quem preencheu o formulário público /seja-representante.
//
// A nota (0-100) e as flags de incoerência vêm PRONTAS do banco — o trigger
// fn_score_candidatura calcula no INSERT. Esta tela não recalcula nada: só
// apresenta e deixa fazer a triagem (status + nota interna).
// A leitura já é filtrada pela RLS (pode_gerir_representantes): admin e Patrick.

function corDaFaixa(score: number, conflito: boolean) {
  if (conflito) return { card: 'border-danger/40 bg-danger/5', txt: 'text-danger' }
  if (score >= 85) return { card: 'border-accent/50 bg-accent/5', txt: 'text-accent' }
  if (score >= 70) return { card: 'border-success/40 bg-success/5', txt: 'text-success' }
  if (score >= 55) return { card: 'border-warning/40 bg-warning/5', txt: 'text-warning' }
  if (score >= 40) return { card: 'border-border bg-surface', txt: 'text-ink-muted' }
  return { card: 'border-danger/30 bg-danger/5', txt: 'text-danger' }
}

function resumoTexto(c: Candidatura): string {
  const flags = (c.flags ?? []).map(f => `[${f.k}] ${f.m}`).join('\n')
  return [
    `CANDIDATO A REPRESENTANTE — ${c.score}/100 · ${c.faixa.toUpperCase()}`,
    '--------------------------------',
    c.nome, c.telefone, `${c.cidade}/${c.uf}`, '',
    'TERRITORIO PEDIDO',
    `- Estados: ${c.ufs_desejadas.join(', ')} (${c.ufs_desejadas.length})`,
    `- Roteiro hoje: ${c.cidades_atendidas}`, '',
    'PERFIL',
    `- ${c.anos_agro} anos no agro | CNPJ: ${c.cnpj} | veiculo: ${c.veiculo ? 'sim' : 'NAO'}`,
    `- Linha: ${LINHA_LABEL[c.linha_principal] ?? c.linha_principal}`,
    `- Representa: ${c.marcas}`,
    `- Especies: ${c.especies.join(', ')}`,
    `- Conflito com concorrente: ${c.conflito ? 'SIM' : 'nao'}`, '',
    'CARTEIRA',
    `- ${c.clientes_ativos} ativos | ${c.visitados_90d} visitados em 90 dias`,
    `- ${c.visitas_semana} visitas/semana | ${c.km_mes} km/mes`,
    `- Ticket medio: ${TICKET_LABEL[c.ticket_faixa] ?? '-'}`,
    `- ${c.clientes_racao} clientes com perfil de racao propria`, '',
    'MAIOR VENDA', c.maior_venda, '',
    'OS 3 CLIENTES-ALVO', c.tres_clientes, '',
    'REFERENCIA', c.referencia, '',
    'CHECAGEM', flags,
  ].join('\n')
}

function Campo({ t, v, full, pre }: { t: string; v: string; full?: boolean; pre?: boolean }) {
  return (
    <div className={full ? 'sm:col-span-2' : ''}>
      <p className="text-[10px] uppercase font-bold text-ink-faint leading-tight">{t}</p>
      <p className={cn('text-[12.5px] text-ink leading-snug', pre && 'whitespace-pre-wrap')}>{v || '—'}</p>
    </div>
  )
}

export function PainelCandidaturas() {
  const qc = useQueryClient()
  const [filtro, setFiltro] = useState('')
  const [busca, setBusca] = useState('')
  const [aberto, setAberto] = useState<string | null>(null)
  const [copiado, setCopiado] = useState<string | null>(null)
  const { data, isLoading, error } = useCandidaturas(filtro || null)

  const lista = useMemo(() => {
    const t = busca.trim().toLowerCase()
    if (!t) return data ?? []
    return (data ?? []).filter(c =>
      c.nome.toLowerCase().includes(t) ||
      c.cidade.toLowerCase().includes(t) ||
      c.uf.toLowerCase().includes(t) ||
      c.ufs_desejadas.join(' ').toLowerCase().includes(t))
  }, [data, busca])

  async function mudar(id: string, patch: { status?: string; notas_internas?: string }) {
    await salvarTriagem(id, patch)
    qc.invalidateQueries({ queryKey: ['rep-candidaturas'] })
  }

  async function copiar(c: Candidatura) {
    try {
      await navigator.clipboard.writeText(resumoTexto(c))
      setCopiado(c.id)
      setTimeout(() => setCopiado(null), 1800)
    } catch { /* clipboard bloqueado — sem drama */ }
  }

  if (error) {
    return (
      <div className="rounded-xl border border-danger/30 bg-danger/5 py-8 text-center">
        <AlertCircle className="h-7 w-7 text-danger mx-auto mb-2" />
        <p className="text-[13px] text-ink">Não consegui carregar as candidaturas.</p>
        <p className="text-[12px] text-ink-muted mt-1">
          Nada aqui está zerado — está <strong>indisponível</strong>. Recarregue em instantes.
        </p>
      </div>
    )
  }
  if (isLoading) return <p className="text-[13px] text-ink-muted py-10 text-center">Carregando…</p>

  const url = `${window.location.origin}/seja-representante`

  return (
    <div>
      <div className="rounded-lg border border-border bg-surface-2 px-4 py-3 mb-4 flex flex-wrap items-center gap-x-3 gap-y-2">
        <p className="text-[12px] text-ink-muted leading-relaxed flex-1 min-w-[260px]">
          Link do formulário pra divulgar:{' '}
          <a href="/seja-representante" target="_blank" rel="noopener"
             className="text-accent font-mono font-semibold hover:underline">/seja-representante</a>
          {' '}— abre sem login. A nota de 0 a 100 é calculada no banco a partir das respostas;
          o candidato não vê nota nenhuma.
        </p>
        <button onClick={() => navigator.clipboard.writeText(url).catch(() => {})}
          className="text-[12px] px-3 py-1.5 rounded-md border border-border text-ink hover:border-border-strong shrink-0">
          Copiar link
        </button>
      </div>

      <div className="flex flex-wrap gap-2 mb-4">
        <Input placeholder="Buscar por nome, cidade ou estado…" value={busca}
          onChange={e => setBusca(e.target.value)} className="max-w-xs" />
        <Select value={filtro} onChange={e => setFiltro(e.target.value)} className="max-w-[210px]"
          placeholder="Todos os status"
          options={Object.entries(CAND_STATUS).map(([value, label]) => ({ value, label }))} />
      </div>

      {lista.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border py-14 text-center">
          <Inbox className="h-8 w-8 text-ink-faint mx-auto mb-2" />
          <p className="text-[13px] text-ink-muted">
            {busca || filtro
              ? 'Nenhuma candidatura com esse filtro.'
              : 'Nenhuma candidatura recebida ainda. Divulgue o link acima.'}
          </p>
        </div>
      ) : (
        <div className="space-y-2.5">
          {lista.map(c => {
            const cor = corDaFaixa(c.score, c.conflito)
            const exp = aberto === c.id
            return (
              <div key={c.id} className={cn('rounded-xl border transition-all', cor.card)}>
                <button onClick={() => setAberto(exp ? null : c.id)}
                  className="w-full text-left px-4 py-3 flex items-start gap-3">
                  <div className="shrink-0 text-center min-w-[54px]">
                    <p className={cn('text-[26px] font-bold leading-none tabular-nums', cor.txt)}>{c.score}</p>
                    <p className="text-[10px] text-ink-faint">de 100</p>
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <p className="text-[14px] font-semibold text-ink truncate">{c.nome}</p>
                      <Badge variant={c.status === 'novo' ? 'default' : 'outline'}>
                        {CAND_STATUS[c.status] ?? c.status}
                      </Badge>
                    </div>
                    <p className={cn('text-[12px] font-semibold mt-0.5', cor.txt)}>{c.faixa}</p>
                    <div className="text-[12px] text-ink-muted mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
                      <span className="inline-flex items-center gap-1">
                        <MapPin className="h-3 w-3" />{c.cidade}/{c.uf}
                      </span>
                      <span>quer: <strong className="text-ink">{c.ufs_desejadas.join(', ')}</strong></span>
                      <span>{LINHA_LABEL[c.linha_principal] ?? c.linha_principal}</span>
                      <span>{c.clientes_ativos} ativos · {c.visitados_90d} visitados</span>
                    </div>
                  </div>
                  <span className="text-[11px] text-ink-faint shrink-0 tabular-nums">
                    {new Date(c.created_at).toLocaleDateString('pt-BR')}
                  </span>
                </button>

                {exp && (
                  <div className="px-4 pb-4 border-t border-border/60 pt-3 space-y-4">
                    {(c.flags ?? []).length > 0 && (
                      <div className="space-y-1.5">
                        <p className="text-[10px] uppercase font-bold tracking-wider text-ink-faint">
                          Checagem de coerência
                        </p>
                        {c.flags.map((f, i) => (
                          <div key={i} className={cn('flex gap-2.5 px-3 py-2 rounded-md text-[12.5px] leading-snug',
                            f.t === 'red' ? 'bg-danger/10' : f.t === 'amber' ? 'bg-warning/10' : 'bg-success/10')}>
                            <span className={cn('font-mono font-bold text-[10px] pt-0.5 shrink-0',
                              f.t === 'red' ? 'text-danger' : f.t === 'amber' ? 'text-warning' : 'text-success')}>
                              {f.k}
                            </span>
                            <span className="text-ink">{f.m}</span>
                          </div>
                        ))}
                      </div>
                    )}

                    <div className="grid sm:grid-cols-2 gap-x-6 gap-y-3">
                      <Campo t="WhatsApp" v={c.telefone} />
                      <Campo t="Anos no agro" v={`${c.anos_agro} anos`} />
                      <Campo t="CNPJ" v={c.cnpj === 'sim' ? 'Sim' : c.cnpj === 'abrindo' ? 'Em abertura' : 'NÃO TEM'} />
                      <Campo t="Veículo próprio" v={c.veiculo ? 'Sim' : 'NÃO TEM'} />
                      <Campo t="Ticket médio" v={TICKET_LABEL[c.ticket_faixa] ?? '—'} />
                      <Campo t="Visitas/semana · km/mês" v={`${c.visitas_semana} · ${c.km_mes} km`} />
                      <Campo t="Clientes com perfil de ração" v={String(c.clientes_racao)} />
                      <Campo t="Espécies" v={c.especies.join(', ')} />
                      <Campo t="Roteiro hoje" v={c.cidades_atendidas} full />
                      <Campo t="Representa hoje" v={c.marcas} full />
                      <Campo t="Maior venda" v={c.maior_venda} full />
                      <Campo t="Os 3 clientes-alvo" v={c.tres_clientes} full pre />
                      <Campo t="Referência comercial" v={c.referencia} full />
                    </div>

                    <div className="border-t border-border/60 pt-3">
                      <p className="text-[10px] uppercase font-bold tracking-wider text-ink-faint mb-2">Triagem</p>
                      <div className="flex flex-wrap gap-1.5 mb-3">
                        {Object.entries(CAND_STATUS).map(([v, l]) => (
                          <button key={v} onClick={() => mudar(c.id, { status: v })}
                            className={cn('text-[12px] px-3 py-1.5 rounded-md border transition-all',
                              c.status === v
                                ? 'bg-accent text-white border-accent font-semibold'
                                : 'bg-surface text-ink border-border hover:border-border-strong')}>
                            {l}
                          </button>
                        ))}
                      </div>
                      <textarea defaultValue={c.notas_internas ?? ''} rows={2}
                        placeholder="Nota interna (o candidato não vê)…"
                        onBlur={e => {
                          if (e.target.value !== (c.notas_internas ?? '')) mudar(c.id, { notas_internas: e.target.value })
                        }}
                        className="w-full rounded-md border border-border bg-surface px-3 py-2 text-[13px] text-ink placeholder:text-ink-faint focus:outline-none focus:border-accent" />
                      <div className="flex flex-wrap gap-2 mt-2">
                        <button onClick={() => copiar(c)}
                          className="text-[12px] px-3 py-1.5 rounded-md border border-border text-ink hover:border-border-strong">
                          {copiado === c.id ? 'Copiado' : 'Copiar resumo'}
                        </button>
                        <a href={`https://wa.me/55${c.telefone.replace(/\D/g, '')}`} target="_blank" rel="noopener"
                          className="text-[12px] px-3 py-1.5 rounded-md border border-border text-ink hover:border-border-strong">
                          Chamar no WhatsApp
                        </a>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
