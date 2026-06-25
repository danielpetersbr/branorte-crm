// /frete/cotacoes — painel KANBAN do vendedor. Colunas = pipeline:
// Pendente -> Analisando -> Concluída -> Fretes fechados.
// Fecha um frete arrastando o card pra "Fretes fechados" OU pelo botão "Fechar frete"
// (abre modal pra informar o valor final combinado). Funciona no desktop (drag) e no celular (botão).
import { useMemo, useState } from 'react'
import type { DragEvent } from 'react'
import { Link } from 'react-router-dom'
import { Truck, MapPin, Trophy, Clock, CheckCircle2, Paperclip, PackageCheck, X, Undo2, Loader2, Send, RotateCw } from 'lucide-react'
import { useCotacoesPainel, useEscolherVencedor, useFinalizarFrete, useReenviarCotacao, type CotacaoPainel } from '@/hooks/useFrete'
import { useCan } from '@/hooks/usePermissions'

const COLS = [
  { key: 'pendente',   label: 'Pendente',             dot: 'bg-amber-500',   head: 'text-amber-600',   icon: Clock },
  { key: 'analisando', label: 'Enviado · aguardando', dot: 'bg-blue-500',    head: 'text-blue-600',    icon: Send },
  { key: 'concluida',  label: 'Concluída',            dot: 'bg-green-500',   head: 'text-green-600',   icon: CheckCircle2 },
  { key: 'fechado',    label: 'Fretes fechados',      dot: 'bg-emerald-600', head: 'text-emerald-700', icon: PackageCheck },
] as const

function fmtMoeda(v: number | null | undefined) {
  if (v == null) return '—'
  return Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })
}
function resumoEquip(c: CotacaoPainel) {
  const arr = Array.isArray(c.equipamentos_itens) ? c.equipamentos_itens : []
  if (arr.length) return arr.map(i => `${i.qtd && i.qtd > 1 ? i.qtd + '× ' : ''}${i.nome}`).join(' + ')
  return 'Equipamento'
}
// parse "15.000" / "15000" / "9.500,50" -> número
function parseValor(s: string): number {
  return Number(String(s).replace(/\s/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.'))
}
function vencedorDe(c: CotacaoPainel) {
  return c.lances.find(l => l.status === 'vencedor') ?? null
}

function KanbanCard({ c, todas, podeEscolher, onEscolher, escolhendo, onFechar, onReabrir, onDragStart, onReenviar }: {
  c: CotacaoPainel
  todas: boolean
  podeEscolher: boolean
  onEscolher: (solicId: string, lanceId: string) => void
  escolhendo: boolean
  onFechar: (c: CotacaoPainel) => void
  onReabrir: (c: CotacaoPainel) => void
  onDragStart: (e: DragEvent, c: CotacaoPainel) => void
  onReenviar: (lanceId: string) => void
}) {
  const fechada = c.status === 'fechada'
  const fechado = c.derived_status === 'fechado'
  const venc = vencedorDe(c)
  const comValor = c.lances.filter(l => l.valor != null)
  const analisando = c.lances.filter(l => l.valor == null)
  const arrastavel = podeEscolher && (c.derived_status === 'concluida' || fechado)
  return (
    <div
      draggable={arrastavel}
      onDragStart={e => onDragStart(e, c)}
      className={`bg-surface-1 border rounded-xl p-3 transition-colors ${fechado ? 'border-emerald-500/40' : 'border-border hover:border-accent/40'} ${arrastavel ? 'cursor-grab active:cursor-grabbing' : ''}`}
    >
      <div className="flex items-center gap-1.5 flex-wrap mb-1">
        <span className="text-[11px] font-mono text-ink-faint">{c.codigo}</span>
        {c.tipo_cotacao === 'carregar' && <span className="text-[9px] px-1.5 py-0.5 rounded-full font-medium bg-red-500/15 text-red-500">Embarque imediato</span>}
        {c.urgente && <span className="text-[9px] px-1.5 py-0.5 rounded-full font-medium bg-red-500/15 text-red-500">⚠ Urgente</span>}
        {fechado && <span className="text-[9px] px-1.5 py-0.5 rounded-full font-medium bg-emerald-500/15 text-emerald-700">✓ Fechado</span>}
      </div>
      <div className="text-sm font-semibold text-ink leading-snug">{resumoEquip(c)}</div>
      <div className="text-xs text-ink-muted flex items-center gap-1 mt-1">
        <MapPin className="h-3 w-3 shrink-0" />
        <span className="truncate">{c.cidade_destino ?? '—'}/{c.uf_destino ?? '—'}{c.distancia_km ? ` · ${Math.round(c.distancia_km)} km` : ''}</span>
      </div>
      {c.cliente_nome && <div className="text-xs text-ink-faint mt-0.5 truncate">Cliente: {c.cliente_nome}</div>}
      {todas && (c.vendedor_nome || c.solicitante_nome) && (
        <div className="text-[11px] text-ink-faint mt-0.5 truncate">Vendedor: {c.vendedor_nome || c.solicitante_nome}</div>
      )}

      {/* FECHADO: valor final + transportadora */}
      {fechado ? (
        <div className="mt-2.5 pt-2.5 border-t border-emerald-500/30">
          <div className="flex items-end justify-between">
            <div className="min-w-0">
              <div className="text-[10px] text-emerald-700/80 uppercase tracking-wide">Valor final combinado</div>
              <div className="text-lg font-extrabold text-emerald-700 leading-tight">{fmtMoeda(c.valor_final_combinado)}</div>
            </div>
            {venc && (
              <div className="text-right shrink-0 ml-2">
                <div className="text-[10px] text-ink-faint">transportadora</div>
                <div className="text-xs font-medium text-ink truncate max-w-[120px]">{venc.transportadora_nome ?? '—'}</div>
                {venc.prazo_dias != null && <div className="text-[10px] text-ink-faint">{venc.prazo_dias} dias</div>}
              </div>
            )}
          </div>
          {podeEscolher && (
            <button onClick={() => onReabrir(c)} className="mt-2 text-[11px] text-ink-muted hover:text-ink inline-flex items-center gap-1">
              <Undo2 className="h-3 w-3" /> Reabrir (voltar pra Concluída)
            </button>
          )}
        </div>
      ) : (
        <>
          {comValor.length > 0 && (
            <div className="mt-2.5 pt-2.5 border-t border-border space-y-1.5">
              {c.menor_valor != null && comValor.length > 1 && (
                <div className="text-[10px] text-ink-faint uppercase tracking-wide">menor: <span className="text-accent font-bold normal-case text-xs">{fmtMoeda(c.menor_valor)}</span></div>
              )}
              {comValor.map(l => (
                <div key={l.lance_id} className={`flex items-center gap-2 rounded-lg border px-2 py-1.5 ${l.status === 'vencedor' ? 'border-green-500/50 bg-green-500/5' : 'border-border bg-bg'}`}>
                  <span className="flex-1 min-w-0 text-xs text-ink truncate">{l.transportadora_nome ?? '—'}</span>
                  {l.anexo_url && <a href={l.anexo_url} target="_blank" rel="noreferrer" className="text-ink-faint hover:text-accent shrink-0" title="Anexo"><Paperclip className="h-3 w-3" /></a>}
                  {l.prazo_dias != null && <span className="text-[10px] text-ink-faint shrink-0">{l.prazo_dias}d</span>}
                  <span className="text-xs font-bold text-ink shrink-0">{fmtMoeda(l.valor)}</span>
                  {l.status === 'vencedor' ? (
                    <Trophy className="h-3.5 w-3.5 text-green-600 shrink-0" />
                  ) : podeEscolher && !fechada ? (
                    <button onClick={() => onEscolher(c.id, l.lance_id)} disabled={escolhendo}
                      className="text-[10px] px-1.5 py-0.5 rounded border border-border text-ink-muted hover:text-accent hover:border-accent disabled:opacity-40 shrink-0">✓</button>
                  ) : null}
                </div>
              ))}
            </div>
          )}
          {comValor.length === 0 && analisando.length > 0 && (
            <div className="mt-2 pt-2 border-t border-border space-y-1.5">
              {analisando.map(l => {
                const expirou = l.status === 'expirado'
                return (
                  <div key={l.lance_id} className="flex items-center gap-2 text-xs">
                    <span className={`flex-1 min-w-0 truncate ${expirou ? 'text-amber-600' : 'text-blue-500/90'}`}>
                      {l.transportadora_nome ?? 'Transportadora'} — {expirou ? '⏱️ sem resposta' : 'aguardando…'}
                    </span>
                    {podeEscolher && (
                      <button onClick={() => onReenviar(l.lance_id)} title="Reenviar cotação"
                        className="shrink-0 inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border border-border text-ink-muted hover:text-accent hover:border-accent">
                        <RotateCw className="h-3 w-3" /> Reenviar
                      </button>
                    )}
                  </div>
                )
              })}
            </div>
          )}
          {c.lances.length === 0 && (
            <div className="mt-2 pt-2 border-t border-border text-[11px] text-ink-faint">Aguardando transportadoras dos estados de destino.</div>
          )}
          {/* Botão fechar (alternativa ao drag — funciona no celular) */}
          {podeEscolher && c.derived_status === 'concluida' && (
            <button onClick={() => onFechar(c)}
              className="mt-2.5 w-full px-3 py-1.5 rounded-lg bg-emerald-600/10 text-emerald-700 hover:bg-emerald-600 hover:text-white text-xs font-semibold transition-colors inline-flex items-center justify-center gap-1.5">
              <PackageCheck className="h-3.5 w-3.5" /> Fechar frete
            </button>
          )}
        </>
      )}
    </div>
  )
}

export default function FreteCotacoesPainel() {
  const [todas, setTodas] = useState(false)
  const painel = useCotacoesPainel(todas)
  const vencedor = useEscolherVencedor()
  const finalizar = useFinalizarFrete()
  const reenviar = useReenviarCotacao()
  const can = useCan()
  const podeEscolher = can('frete.aprovar')
  const lista = painel.data ?? []
  const [dropAlvo, setDropAlvo] = useState<string | null>(null)

  // modal de fechar
  const [fechando, setFechando] = useState<CotacaoPainel | null>(null)
  const [valorStr, setValorStr] = useState('')
  const [erroModal, setErroModal] = useState('')

  const totalFechado = useMemo(
    () => lista.filter(c => c.derived_status === 'fechado').reduce((s, c) => s + (c.valor_final_combinado || 0), 0),
    [lista]
  )

  async function escolher(solicId: string, lanceId: string) {
    if (!confirm('Definir essa transportadora como vencedora e FECHAR a cotação?')) return
    try { await vencedor.mutateAsync({ solicitacao_id: solicId, lance_id: lanceId }) }
    catch (e: any) { alert(`Erro: ${e?.message ?? e}`) }
  }

  function abrirFechar(c: CotacaoPainel) {
    const sug = vencedorDe(c)?.valor ?? c.menor_valor ?? null
    setValorStr(sug != null ? String(sug) : '')
    setErroModal('')
    setFechando(c)
  }

  async function confirmarFechar() {
    if (!fechando) return
    const v = parseValor(valorStr)
    if (!Number.isFinite(v) || v <= 0) { setErroModal('Informe um valor válido.'); return }
    try {
      await finalizar.mutateAsync({ solicitacao_id: fechando.id, valor_final: v })
      setFechando(null)
    } catch (err: any) { setErroModal('Não consegui fechar: ' + (err?.message ?? err)) }
  }

  async function reabrir(c: CotacaoPainel) {
    if (!confirm('Reabrir esse frete e voltar pra Concluída?')) return
    try { await finalizar.mutateAsync({ solicitacao_id: c.id, valor_final: null }) }
    catch (err: any) { alert(`Erro: ${err?.message ?? err}`) }
  }

  async function onReenviar(lanceId: string) {
    if (!confirm('Reenviar essa cotação pra transportadora agora?')) return
    try { await reenviar.mutateAsync({ lance_id: lanceId }) }
    catch (err: any) { alert(`Erro ao reenviar: ${err?.message ?? err}`) }
  }

  function onDragStart(e: DragEvent, c: CotacaoPainel) {
    e.dataTransfer.setData('text/plain', JSON.stringify({ id: c.id, from: c.derived_status }))
    e.dataTransfer.effectAllowed = 'move'
  }

  function onDrop(colKey: string, e: DragEvent) {
    e.preventDefault(); setDropAlvo(null)
    let p: { id: string; from: string }
    try { p = JSON.parse(e.dataTransfer.getData('text/plain')) } catch { return }
    if (!p?.id || p.from === colKey) return
    const card = lista.find(c => c.id === p.id)
    if (!card) return
    if (colKey === 'fechado') abrirFechar(card)
    else if (colKey === 'concluida' && p.from === 'fechado') reabrir(card)
  }

  return (
    <div className="w-full px-4 sm:px-6 lg:px-8 py-6">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <Truck className="h-6 w-6 text-accent" />
          <h1 className="text-2xl font-bold text-ink">Cotações</h1>
          <div className="flex items-center gap-1 ml-2 p-0.5 rounded-lg bg-surface-2 border border-border">
            <button onClick={() => setTodas(false)} className={`px-3 py-1 rounded-md text-sm transition-colors ${!todas ? 'bg-accent text-white' : 'text-ink-muted hover:text-ink'}`}>Minhas</button>
            <button onClick={() => setTodas(true)} className={`px-3 py-1 rounded-md text-sm transition-colors ${todas ? 'bg-accent text-white' : 'text-ink-muted hover:text-ink'}`}>Todas</button>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Link to="/frete/mapa" className="px-3 py-1.5 rounded-lg border border-border text-sm text-ink-muted hover:text-ink inline-flex items-center gap-1.5"><MapPin className="h-4 w-4" /> Mapa</Link>
          <Link to="/frete/solicitar" className="px-3 py-1.5 rounded-lg bg-accent text-white text-sm font-medium hover:opacity-90">+ Pedir frete</Link>
        </div>
      </div>

      {painel.isLoading && <div className="text-sm text-ink-faint">Carregando…</div>}

      {!painel.isLoading && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4 items-start">
          {COLS.map(col => {
            const Icon = col.icon
            const cards = lista.filter(c => c.derived_status === col.key)
            const isDropZone = col.key === 'fechado' || col.key === 'concluida'
            return (
              <div key={col.key}
                onDragOver={isDropZone ? (e => { e.preventDefault(); setDropAlvo(col.key) }) : undefined}
                onDragLeave={isDropZone ? (() => setDropAlvo(a => (a === col.key ? null : a))) : undefined}
                onDrop={isDropZone ? (e => onDrop(col.key, e)) : undefined}
                className={`rounded-2xl p-3 flex flex-col min-h-[160px] border transition-colors ${col.key === 'fechado' ? 'bg-emerald-500/5' : 'bg-surface-2/40'} ${dropAlvo === col.key ? 'border-emerald-500 ring-2 ring-emerald-500/30' : 'border-border'}`}>
                <div className="flex items-center gap-2 mb-3 px-1">
                  <span className={`h-2.5 w-2.5 rounded-full ${col.dot}`} />
                  <Icon className={`h-4 w-4 ${col.head}`} />
                  <h2 className={`text-sm font-semibold ${col.head}`}>{col.label}</h2>
                  <span className="text-xs text-ink-faint ml-auto tabular-nums px-2 py-0.5 rounded-full bg-surface-1">{cards.length}</span>
                </div>
                <div className="space-y-2.5 flex-1">
                  {cards.length === 0 && (
                    <div className="text-xs text-ink-faint text-center py-10 border border-dashed border-border rounded-xl">
                      {col.key === 'fechado' ? '🚚 Arraste pra cá (ou use "Fechar frete") os fretes combinados.' : 'Nada aqui.'}
                    </div>
                  )}
                  {cards.map(c => (
                    <KanbanCard key={c.id} c={c} todas={todas} podeEscolher={podeEscolher} onEscolher={escolher}
                      escolhendo={vencedor.isPending} onFechar={abrirFechar} onReabrir={reabrir} onDragStart={onDragStart} onReenviar={onReenviar} />
                  ))}
                </div>
                {col.key === 'fechado' && cards.length > 0 && (
                  <div className="mt-2 pt-2 border-t border-emerald-500/30 flex items-center justify-between text-xs">
                    <span className="text-emerald-700/80">Total fechado</span>
                    <span className="font-bold text-emerald-700 tabular-nums">{fmtMoeda(totalFechado)}</span>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Modal: fechar frete com valor final combinado */}
      {fechando && (
        <div className="fixed inset-0 z-[1000] bg-black/50 flex items-center justify-center p-4" onClick={() => setFechando(null)}>
          <div className="bg-surface rounded-2xl border border-border w-full max-w-md p-5" onClick={e => e.stopPropagation()}>
            <div className="flex items-center gap-2 mb-1">
              <PackageCheck className="h-5 w-5 text-emerald-600" />
              <h3 className="text-lg font-bold text-ink">Fechar frete</h3>
              <button onClick={() => setFechando(null)} className="ml-auto text-ink-faint hover:text-ink"><X className="h-5 w-5" /></button>
            </div>
            <p className="text-sm text-ink-muted">{fechando.codigo} · {resumoEquip(fechando)}</p>
            <p className="text-xs text-ink-faint mb-4">{fechando.cidade_destino}/{fechando.uf_destino}{fechando.cliente_nome ? ` · ${fechando.cliente_nome}` : ''}</p>

            <label className="block text-sm font-medium text-ink mb-1.5">Valor final combinado (R$) <span className="text-red-500">*</span></label>
            <input
              autoFocus inputMode="decimal" value={valorStr}
              onChange={e => { setValorStr(e.target.value); setErroModal('') }}
              onKeyDown={e => { if (e.key === 'Enter') confirmarFechar() }}
              placeholder="0,00"
              className={`w-full px-3 py-2.5 rounded-lg bg-bg border text-ink text-lg font-semibold placeholder:text-ink-faint outline-none focus:border-accent ${erroModal ? 'border-red-400 ring-1 ring-red-400/30' : 'border-border'}`}
            />
            {/* sugestões */}
            <div className="flex flex-wrap gap-2 mt-2">
              {vencedorDe(fechando)?.valor != null && (
                <button onClick={() => setValorStr(String(vencedorDe(fechando)!.valor))}
                  className="text-[11px] px-2 py-1 rounded-full border border-border text-ink-muted hover:border-accent hover:text-accent">
                  Vencedor: {fmtMoeda(vencedorDe(fechando)!.valor)}
                </button>
              )}
              {fechando.menor_valor != null && fechando.menor_valor !== vencedorDe(fechando)?.valor && (
                <button onClick={() => setValorStr(String(fechando.menor_valor))}
                  className="text-[11px] px-2 py-1 rounded-full border border-border text-ink-muted hover:border-accent hover:text-accent">
                  Menor: {fmtMoeda(fechando.menor_valor)}
                </button>
              )}
            </div>
            {erroModal && <p className="text-sm text-red-500 mt-2">{erroModal}</p>}

            <div className="flex gap-2 mt-5">
              <button onClick={confirmarFechar} disabled={finalizar.isPending}
                className="flex-1 px-4 py-2.5 rounded-xl bg-emerald-600 text-white text-sm font-semibold hover:opacity-90 disabled:opacity-60 inline-flex items-center justify-center gap-1.5">
                {finalizar.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Fechar frete
              </button>
              <button onClick={() => setFechando(null)} className="px-4 py-2.5 rounded-xl border border-border text-sm text-ink-muted hover:text-ink">Cancelar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
