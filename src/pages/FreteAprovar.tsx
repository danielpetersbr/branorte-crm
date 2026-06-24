// /frete/aprovar — fila de cotação reversa (Jardel + admins). Revisa a solicitação,
// seleciona as transportadoras que atendem a UF de destino, dispara o link pelo
// WhatsApp do Jardel, acompanha os lances chegando (~tempo real) e escolhe o vencedor.
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Truck, Send, MapPin, Loader2, Settings, Trophy, Copy, Check, X, Ban, ExternalLink,
} from 'lucide-react'
import {
  useSolicitacoes, useLances, useDispararFrete, useEscolherVencedor, useAtualizarSolicitacao,
  useTransportadoras, useTiposCaminhao, useFreteConfig, useSetFreteConfig,
  type FreteSolicitacao, type FreteSolicitacaoStatus,
} from '@/hooks/useFrete'

const FILTROS: { key: FreteSolicitacaoStatus | 'ativas'; label: string }[] = [
  { key: 'ativas', label: 'Ativas' },
  { key: 'pendente', label: 'Pendentes' },
  { key: 'em_cotacao', label: 'Em cotação' },
  { key: 'fechada', label: 'Fechadas' },
]

const STATUS_BADGE: Record<string, string> = {
  rascunho: 'bg-surface-2 text-ink-faint',
  pendente: 'bg-amber-500/15 text-amber-600',
  aprovada: 'bg-blue-500/15 text-blue-500',
  em_cotacao: 'bg-accent/15 text-accent',
  fechada: 'bg-green-500/15 text-green-600',
  cancelada: 'bg-surface-2 text-ink-faint line-through',
}

function fmtMoeda(v: number | null | undefined) {
  if (v == null) return '—'
  return Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })
}
function fmtDataHora(s: string | null) {
  if (!s) return '—'
  return new Date(s).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}
function resumoEquip(s: FreteSolicitacao) {
  const arr = Array.isArray(s.equipamentos_itens) ? s.equipamentos_itens : []
  if (arr.length) return arr.map(i => `${i.qtd && i.qtd > 1 ? i.qtd + 'x ' : ''}${i.nome}`).join(' + ')
  return s.descricao_carga || 'Equipamento'
}

export default function FreteAprovar() {
  const [filtro, setFiltro] = useState<typeof FILTROS[number]['key']>('ativas')
  const statusArg = filtro === 'ativas'
    ? (['pendente', 'aprovada', 'em_cotacao'] as FreteSolicitacaoStatus[])
    : filtro
  const solics = useSolicitacoes({ status: statusArg, refetchInterval: 12000 })
  const transportadoras = useTransportadoras()
  const tipos = useTiposCaminhao()
  const disparar = useDispararFrete()
  const vencedor = useEscolherVencedor()
  const atualizar = useAtualizarSolicitacao()
  const cfg = useFreteConfig()
  const setCfg = useSetFreteConfig()

  const [selId, setSelId] = useState<string | null>(null)
  const [selectedTransp, setSelectedTransp] = useState<Set<number>>(new Set())
  const [dispatchResult, setDispatchResult] = useState<any[] | null>(null)
  const [copiado, setCopiado] = useState<string | null>(null)
  const [showConfig, setShowConfig] = useState(false)

  const solic = useMemo(() => solics.data?.find(s => s.id === selId) ?? null, [solics.data, selId])
  const lances = useLances(selId, { refetchInterval: 8000 })

  const aptas = useMemo(() => {
    const uf = solic?.uf_destino ?? ''
    return (transportadoras.data ?? []).filter(t => t.ativo && (!t.ufs_atende?.length || t.ufs_atende.includes(uf)))
  }, [transportadoras.data, solic?.uf_destino])

  // ao trocar de solicitação: pré-seleciona todas as transportadoras aptas
  useEffect(() => {
    if (!solic) return
    const uf = solic.uf_destino ?? ''
    const ap = (transportadoras.data ?? []).filter(t => t.ativo && (!t.ufs_atende?.length || t.ufs_atende.includes(uf)))
    setSelectedTransp(new Set(ap.map(t => t.id)))
    setDispatchResult(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selId])

  const caminhaoNome = (id: number | null) => tipos.data?.find(t => t.id === id)?.nome ?? '—'
  const disparoAtivo = (cfg.data?.disparo_ativo ?? 'true') === 'true'

  function toggleTransp(id: number) {
    setSelectedTransp(prev => {
      const n = new Set(prev)
      n.has(id) ? n.delete(id) : n.add(id)
      return n
    })
  }

  async function fazerDisparo() {
    if (!solic) return
    const ids = [...selectedTransp]
    if (!ids.length) { alert('Selecione ao menos uma transportadora.'); return }
    try {
      const res = await disparar.mutateAsync({ solicitacao_id: solic.id, transportadora_ids: ids })
      setDispatchResult(res.results)
    } catch (e: any) {
      alert(`Erro ao disparar: ${e?.message ?? e}`)
    }
  }

  async function escolherVencedor(lanceId: string) {
    if (!solic) return
    if (!confirm('Definir como vencedor e FECHAR esta cotação?')) return
    try { await vencedor.mutateAsync({ solicitacao_id: solic.id, lance_id: lanceId }) }
    catch (e: any) { alert(`Erro: ${e?.message ?? e}`) }
  }

  async function cancelar() {
    if (!solic) return
    if (!confirm('Cancelar esta solicitação?')) return
    await atualizar.mutateAsync({ id: solic.id, patch: { status: 'cancelada' } })
    setSelId(null)
  }

  function copiar(link: string) {
    navigator.clipboard?.writeText(link)
    setCopiado(link)
    setTimeout(() => setCopiado(null), 1500)
  }

  return (
    <div className="container mx-auto py-6 px-4 max-w-6xl">
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-3">
          <Truck className="h-6 w-6 text-accent" />
          <h1 className="text-2xl font-bold text-ink">Fila de Frete</h1>
        </div>
        <div className="flex items-center gap-2">
          <Link to="/frete/solicitar" className="px-3 py-1.5 rounded-lg bg-accent text-white text-sm font-medium hover:opacity-90">+ Pedido</Link>
          <button onClick={() => setShowConfig(s => !s)} title="Config do disparo" className="p-2 rounded-lg border border-border text-ink-faint hover:text-ink"><Settings className="h-4 w-4" /></button>
        </div>
      </div>

      {!disparoAtivo && (
        <div className="mb-4 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-600">
          <b>Disparo automático desligado.</b> Os links são gerados mas <b>não enviados</b> — copie e mande manual. Ligue em ⚙️ quando confirmar o nome do Jardel na extensão.
        </div>
      )}

      {showConfig && <ConfigDisparo cfg={cfg.data} onSave={(k, v) => setCfg.mutate({ chave: k, valor: v })} saving={setCfg.isPending} onClose={() => setShowConfig(false)} />}

      {/* Filtros */}
      <div className="flex gap-1.5 mb-4">
        {FILTROS.map(f => (
          <button key={f.key} onClick={() => { setFiltro(f.key); setSelId(null) }}
            className={`px-3 py-1.5 rounded-full text-sm border transition-colors ${filtro === f.key ? 'bg-accent text-white border-accent' : 'bg-surface-1 text-ink-muted border-border hover:border-accent'}`}>
            {f.label}
          </button>
        ))}
        <span className="ml-auto self-center text-xs text-ink-faint">{solics.data?.length ?? 0} pedido(s)</span>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[340px_1fr] gap-4">
        {/* Lista */}
        <div className="space-y-2">
          {solics.isLoading && <div className="text-sm text-ink-faint">Carregando…</div>}
          {!solics.isLoading && (solics.data?.length ?? 0) === 0 && (
            <div className="border border-dashed border-border rounded-xl p-6 text-center text-sm text-ink-faint">Nenhum pedido aqui.</div>
          )}
          {solics.data?.map(s => (
            <button key={s.id} onClick={() => setSelId(s.id)}
              className={`w-full text-left bg-surface-1 border rounded-xl p-3 transition-colors ${selId === s.id ? 'border-accent' : 'border-border hover:border-accent/50'}`}>
              <div className="flex items-center justify-between gap-1 mb-1">
                <span className="text-xs font-mono text-ink-faint">{s.codigo}</span>
                <div className="flex items-center gap-1 flex-wrap justify-end">
                  {s.urgente && <span className="text-[10px] px-1.5 py-0.5 rounded-full font-medium bg-red-500/15 text-red-500">⚠</span>}
                  <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${s.tipo_cotacao === 'carregar' ? 'bg-red-500/15 text-red-500' : 'bg-accent/15 text-accent'}`}>{s.tipo_cotacao === 'carregar' ? 'Carregar' : 'Cotação'}</span>
                  <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${STATUS_BADGE[s.status] ?? ''}`}>{s.status}</span>
                </div>
              </div>
              <div className="text-sm font-medium text-ink truncate">{resumoEquip(s)}</div>
              <div className="text-xs text-ink-muted flex items-center gap-1 mt-0.5"><MapPin className="h-3 w-3" />{s.cidade_destino ?? '—'}/{s.uf_destino ?? '—'}{s.distancia_km ? ` · ${Math.round(s.distancia_km)} km` : ''}</div>
            </button>
          ))}
        </div>

        {/* Detalhe */}
        <div>
          {!solic ? (
            <div className="border border-dashed border-border rounded-xl p-10 text-center text-sm text-ink-faint">Selecione um pedido pra revisar e disparar.</div>
          ) : (
            <div className="space-y-4">
              {/* Header detalhe */}
              <div className="bg-surface-1 border border-border rounded-xl p-4">
                <div className="flex items-start justify-between">
                  <div>
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <span className="text-xs font-mono text-ink-faint">{solic.codigo}</span>
                      <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${solic.tipo_cotacao === 'carregar' ? 'bg-red-500/15 text-red-500' : 'bg-accent/15 text-accent'}`}>{solic.tipo_cotacao === 'carregar' ? 'Pra carregar' : 'Cotação'}</span>
                      {solic.urgente && <span className="text-[10px] px-2 py-0.5 rounded-full font-medium bg-red-500/15 text-red-500">⚠ Urgente</span>}
                      <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${STATUS_BADGE[solic.status] ?? ''}`}>{solic.status}</span>
                    </div>
                    <div className="text-base font-semibold text-ink">{resumoEquip(solic)}</div>
                  </div>
                  {solic.status !== 'fechada' && solic.status !== 'cancelada' && (
                    <button onClick={cancelar} title="Cancelar" className="text-ink-faint hover:text-red-500"><Ban className="h-4 w-4" /></button>
                  )}
                </div>
                <dl className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm mt-3">
                  <div><dt className="text-xs text-ink-faint">Destino</dt><dd className="text-ink">{solic.cidade_destino}/{solic.uf_destino}</dd></div>
                  <div><dt className="text-xs text-ink-faint">Distância</dt><dd className="text-ink">{solic.distancia_km ? `${Math.round(solic.distancia_km)} km` : '—'}</dd></div>
                  <div><dt className="text-xs text-ink-faint">Peso</dt><dd className="text-ink">{solic.peso_total_kg ? `${Math.round(solic.peso_total_kg)} kg` : '—'}</dd></div>
                  <div><dt className="text-xs text-ink-faint">Caminhão</dt><dd className="text-ink">{caminhaoNome(solic.caminhao_recomendado_id)}</dd></div>
                  <div><dt className="text-xs text-ink-faint">Piso ANTT</dt><dd className="text-ink">{fmtMoeda(solic.valor_antt_minimo)}</dd></div>
                  <div><dt className="text-xs text-ink-faint">Ref. (×1,3)</dt><dd className="text-ink">{fmtMoeda(solic.valor_referencia)}</dd></div>
                  <div><dt className="text-xs text-ink-faint">Cliente</dt><dd className="text-ink truncate">{solic.cliente_nome ?? '—'}</dd></div>
                  <div><dt className="text-xs text-ink-faint">Tipo</dt><dd className={solic.tipo_cotacao === 'carregar' ? 'text-red-500 font-medium' : 'text-ink'}>{solic.tipo_cotacao === 'carregar' ? 'Pra carregar' : 'Cotação'}</dd></div>
                </dl>
                {solic.observacoes && <p className="text-sm text-ink-muted mt-2 pt-2 border-t border-border">{solic.observacoes}</p>}
              </div>

              {/* Seleção + disparo */}
              {solic.status !== 'fechada' && solic.status !== 'cancelada' && (
                <div className="bg-surface-1 border border-border rounded-xl p-4">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-sm font-semibold text-ink">Transportadoras que atendem {solic.uf_destino} <span className="text-ink-faint font-normal">({aptas.length})</span></h3>
                    <button onClick={fazerDisparo} disabled={disparar.isPending || !selectedTransp.size}
                      className="px-4 py-2 rounded-lg bg-accent text-white text-sm font-medium hover:opacity-90 disabled:opacity-40 flex items-center gap-1.5">
                      {disparar.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                      {disparoAtivo ? 'Disparar' : 'Gerar links'} ({selectedTransp.size})
                    </button>
                  </div>
                  {aptas.length === 0 ? (
                    <p className="text-sm text-ink-faint">Nenhuma transportadora cadastrada atende {solic.uf_destino}. <Link to="/frete/transportadoras" className="text-accent hover:underline">Cadastrar</Link>.</p>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {aptas.map(t => {
                        const on = selectedTransp.has(t.id)
                        const semTel = !t.telefone || t.telefone.replace(/\D/g, '').length < 10
                        return (
                          <button key={t.id} onClick={() => toggleTransp(t.id)}
                            className={`px-3 py-1.5 rounded-lg text-sm border flex items-center gap-1.5 ${on ? 'bg-accent/10 border-accent text-accent' : 'bg-bg border-border text-ink-muted hover:border-accent/50'}`}>
                            {on ? <Check className="h-3.5 w-3.5" /> : <span className="w-3.5" />}{t.nome}
                            {semTel && <span title="sem telefone" className="text-amber-500 text-[10px]">⚠</span>}
                          </button>
                        )
                      })}
                    </div>
                  )}

                  {/* Resultado do disparo: links */}
                  {dispatchResult && (
                    <div className="mt-3 pt-3 border-t border-border space-y-1.5">
                      {dispatchResult.map((r: any) => (
                        <div key={r.transportadora_id} className="flex items-center gap-2 text-xs">
                          <span className="text-ink w-40 truncate">{r.nome}</span>
                          {r.erro ? <span className="text-red-500">{r.erro}</span> : (
                            <>
                              <span className={r.enqueued ? 'text-green-600' : 'text-amber-600'}>{r.enqueued ? '✓ enviado' : r.sem_telefone ? 'sem telefone' : 'link gerado'}</span>
                              {r.link && (
                                <>
                                  <button onClick={() => copiar(r.link)} className="text-ink-faint hover:text-accent inline-flex items-center gap-0.5">{copiado === r.link ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />} copiar</button>
                                  <a href={r.link} target="_blank" rel="noreferrer" className="text-ink-faint hover:text-accent inline-flex items-center gap-0.5"><ExternalLink className="h-3 w-3" /> abrir</a>
                                </>
                              )}
                            </>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Lances */}
              <div className="bg-surface-1 border border-border rounded-xl p-4">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-semibold text-ink">Lances {lances.data?.length ? `(${lances.data.length})` : ''}</h3>
                  {solic.status === 'em_cotacao' && <span className="text-[10px] text-accent flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-accent animate-pulse" /> ao vivo</span>}
                </div>
                {(lances.data?.length ?? 0) === 0 ? (
                  <p className="text-sm text-ink-faint">Nenhum lance ainda. Os valores aparecem aqui conforme as transportadoras respondem.</p>
                ) : (
                  <div className="space-y-1.5">
                    {lances.data!.map(l => (
                      <div key={l.id} className={`flex items-center gap-3 rounded-lg border px-3 py-2 ${l.status === 'vencedor' ? 'border-green-500/50 bg-green-500/5' : 'border-border bg-bg'}`}>
                        <span className="flex-1 text-sm text-ink truncate">{l.transportadora_nome ?? '—'}</span>
                        <span className="text-xs text-ink-faint">{l.respondido_em ? fmtDataHora(l.respondido_em) : l.status}</span>
                        {l.prazo_dias != null && <span className="text-xs text-ink-muted">{l.prazo_dias}d</span>}
                        <span className={`text-sm font-semibold ${l.valor != null ? 'text-ink' : 'text-ink-faint'}`}>{l.valor != null ? fmtMoeda(l.valor) : '—'}</span>
                        {l.status === 'vencedor' ? (
                          <span className="text-green-600 inline-flex items-center gap-1 text-xs font-medium"><Trophy className="h-3.5 w-3.5" /> Vencedor</span>
                        ) : l.valor != null && solic.status !== 'fechada' ? (
                          <button onClick={() => escolherVencedor(l.id)} disabled={vencedor.isPending} className="text-xs px-2 py-1 rounded-md border border-border text-ink-muted hover:text-accent hover:border-accent disabled:opacity-40">Escolher</button>
                        ) : l.status === 'recusado' ? (
                          <span className="text-xs text-ink-faint inline-flex items-center gap-1"><X className="h-3 w-3" /> recusou</span>
                        ) : null}
                      </div>
                    ))}
                  </div>
                )}
                {lances.data?.some(l => l.observacoes) && (
                  <div className="mt-3 pt-3 border-t border-border space-y-1">
                    {lances.data!.filter(l => l.observacoes).map(l => (
                      <p key={l.id} className="text-xs text-ink-muted"><b className="text-ink">{l.transportadora_nome}:</b> {l.observacoes}</p>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function ConfigDisparo({ cfg, onSave, saving, onClose }: {
  cfg: Record<string, string> | undefined
  onSave: (k: string, v: string) => void
  saving: boolean
  onClose: () => void
}) {
  const [nome, setNome] = useState(cfg?.vendedor_nome_disparo ?? 'JARDEL')
  const ativo = (cfg?.disparo_ativo ?? 'true') === 'true'
  return (
    <div className="mb-4 bg-surface-1 border border-border rounded-xl p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-ink">Config do disparo</h3>
        <button onClick={onClose} className="text-ink-faint hover:text-ink"><X className="h-4 w-4" /></button>
      </div>
      <div className="flex flex-col sm:flex-row gap-3 items-end">
        <div className="flex-1">
          <label className="text-xs text-ink-faint block mb-1">Nome do vendedor na extensão (quem envia)</label>
          <input value={nome} onChange={e => setNome(e.target.value.toUpperCase())}
            className="w-full px-3 py-2 rounded-lg bg-bg border border-border text-ink text-sm outline-none focus:border-accent" />
          <p className="text-[11px] text-ink-faint mt-1">Tem que bater EXATO com o nome configurado na extensão do Jardel (ex: JARDEL). Se errado, nada é enviado.</p>
        </div>
        <button onClick={() => onSave('vendedor_nome_disparo', nome.trim().toUpperCase())} disabled={saving}
          className="px-3 py-2 rounded-lg bg-accent text-white text-sm font-medium hover:opacity-90 disabled:opacity-50">Salvar nome</button>
        <button onClick={() => onSave('disparo_ativo', ativo ? 'false' : 'true')} disabled={saving}
          className={`px-3 py-2 rounded-lg text-sm font-medium border ${ativo ? 'border-green-500/50 text-green-600' : 'border-amber-500/50 text-amber-600'}`}>
          Disparo: {ativo ? 'LIGADO' : 'desligado'}
        </button>
      </div>
    </div>
  )
}
