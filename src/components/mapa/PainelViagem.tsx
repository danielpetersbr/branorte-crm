import { useMemo, useState } from 'react'
import {
  type ConfigViagem, type Parada, type Programacao, type Precisao, type Trecho,
  PRECISAO_INFO, MAX_PARADAS, nomeParada, minutosDaParada, roteavel,
  km, dur, durMin, minParaHhmm, hhmmComDia, dataBRcurta, diaSemana, linkGoogleMaps, diasNecessarios,
  resumoWhatsApp, mensagemConfirmacao,
} from '@/lib/viagem'

// Cor por dia — a MESMA lista é usada pelos pinos e pela polyline no mapa,
// senão o roteiro do painel não bate com o desenho.
export const CORES_DIA = ['#2563eb', '#16a34a', '#d97706', '#dc2626', '#7c3aed', '#0891b2', '#db2777', '#65a30d']
export const corDoDia = (d: number) => CORES_DIA[(d - 1) % CORES_DIA.length]

const ATALHOS_MIN = [30, 60, 90, 120, 180]

interface Props {
  cfg: ConfigViagem
  setCfg: (patch: Partial<ConfigViagem>) => void
  paradas: Parada[]
  setParadas: (p: Parada[]) => void
  prog: Programacao
  /** Distâncias reais já resolvidas. Sem isto o "usar N dias" conta por
      haversine e pode sugerir um número que ainda deixa parada de fora. */
  trechos: Map<string, Trecho>
  calculando: boolean
  provedor: string | null
  onCalcular: () => void
  onSair: () => void
  onFocar: (p: Parada) => void
  onPedirOrigemNoMapa: () => void
  escolhendoOrigem: boolean
  onSalvar: () => void
  /** Erro do último salvar. Vive aqui porque o `window.alert` do navegador pode
   *  ser silenciado pelo usuário ("impedir que esta página crie caixas de diálogo")
   *  — e aí o erro sumia por completo e o botão parecia não fazer nada. */
  erroSalvar?: string | null
  /** Esta conta pode gravar viagem? Vem de `viagem_pode_editar()` -- a MESMA
   *  funcao que a RLS usa. Quando false, a tela avisa LOGO e nao deixa montar
   *  o roteiro inteiro pra falhar no ultimo clique. */
  podeSalvar?: boolean
  salvando: boolean
  salvoEm: string | null
  onPDF: () => void
  gerandoPdf: boolean
  onConfirmarLocalizacao: (p: Parada) => void
  // persistência (§19)
  viagemId: string | null
  status: ViagemStatus
  setStatus: (s: ViagemStatus) => void
  onAbrirSalvas: () => void
  onNova: () => void
  carregando: boolean
}

export type ViagemStatus =
  | 'rascunho' | 'aguardando_localizacoes' | 'aguardando_confirmacoes'
  | 'pronta' | 'em_andamento' | 'concluida' | 'cancelada'

const STATUS_OPCOES: Array<[ViagemStatus, string]> = [
  ['rascunho', 'Rascunho'],
  ['aguardando_localizacoes', 'Aguardando localizações'],
  ['aguardando_confirmacoes', 'Aguardando confirmações'],
  ['pronta', 'Pronta'],
  ['em_andamento', 'Em andamento'],
  ['concluida', 'Concluída'],
  ['cancelada', 'Cancelada'],
]

export function PainelViagem(p: Props) {
  const [aba, setAba] = useState<'roteiro' | 'ajustes'>('roteiro')
  const [arrastando, setArrastando] = useState<string | null>(null)
  const [copiado, setCopiado] = useState(false)

  const aproximadas = useMemo(() => p.paradas.filter(x => x.precisao === 'cidade').length, [p.paradas])
  const semLoc = p.prog.semLocalizacao.length
  const totalClientes = useMemo(() => p.paradas.reduce((s, x) => s + x.clientes.length, 0), [p.paradas])
  // Só calcula quando algo ficou de fora — é um programar() por dia testado.
  const precisaDias = useMemo(
    () => (p.prog.foraDoPlano.length ? diasNecessarios(p.paradas, p.cfg, p.trechos) : p.cfg.dias),
    [p.prog.foraDoPlano.length, p.paradas, p.cfg],
  )

  const patch = (id: string, mud: Partial<Parada>) =>
    p.setParadas(p.paradas.map(x => (x.id === id ? { ...x, ...mud } : x)))

  const remover = (id: string) => p.setParadas(p.paradas.filter(x => x.id !== id))

  function soltar(alvoId: string) {
    if (!arrastando || arrastando === alvoId) return setArrastando(null)
    const arr = [...p.paradas]
    const de = arr.findIndex(x => x.id === arrastando)
    const para = arr.findIndex(x => x.id === alvoId)
    if (de < 0 || para < 0) return setArrastando(null)
    const [item] = arr.splice(de, 1)
    arr.splice(para, 0, item)
    p.setParadas(arr)
    setArrastando(null)
  }

  function copiarWhatsApp() {
    const txt = resumoWhatsApp(p.prog, p.cfg)
    navigator.clipboard?.writeText(txt).then(
      () => { setCopiado(true); window.setTimeout(() => setCopiado(false), 2500) },
      () => window.prompt('Copie o resumo:', txt),
    )
  }

  function pedirConfirmacao(par: Parada) {
    const d = p.prog.dias.find(x => x.paradas.some(y => y.parada.id === par.id)) ?? null
    const pp = d?.paradas.find(y => y.parada.id === par.id) ?? null
    const msg = mensagemConfirmacao(par, p.cfg, d, pp?.chegada ?? null)
    const tel = (par.clientes[0]?.telefone || '').replace(/\D/g, '')
    const url = tel
      ? `https://wa.me/55${tel.replace(/^55/, '')}?text=${encodeURIComponent(msg)}`
      : `https://wa.me/?text=${encodeURIComponent(msg)}`
    window.open(url, '_blank', 'noopener')
    patch(par.id, { confirmacao: 'aguardando_vendedor' })
  }

  return (
    // w-full + min-w-0: o pai e um flex container de largura FIXA com
    // overflow-hidden. Sem isto a raiz do painel usa flex-basis auto (largura
    // do CONTEUDO) e, quando o min-content passa da largura do pai, o painel
    // vaza pra direita e e cortado — sumindo justo com a coluna de botoes do
    // card (engrenagem / cadeado / X de tirar da viagem). Foi o que acontecia
    // em notebook: o X existia, mas estava fora da area visivel.
    <div className="flex flex-col h-full min-h-0 w-full min-w-0 overflow-hidden">
      {/* cabeçalho */}
      <div className="shrink-0 px-3 pt-3 pb-2 border-b border-border">
        <div className="flex items-center gap-2">
          <span className="text-[15px]">🧭</span>
          <input
            value={p.cfg.nome}
            onChange={e => p.setCfg({ nome: e.target.value })}
            placeholder="Nome da viagem"
            className="flex-1 min-w-0 h-8 px-2 rounded-md bg-surface-2 border border-border text-[14px] font-semibold text-ink placeholder:text-ink-faint outline-none focus:border-accent"
          />
          <button onClick={p.onAbrirSalvas} title="Viagens salvas — abrir, duplicar, excluir"
                  className="h-8 w-8 shrink-0 rounded-md text-ink-muted hover:bg-surface-2">📁</button>
          <button onClick={p.onSair} title="Sair do planejamento (mantém seus filtros)"
                  className="h-8 w-8 shrink-0 rounded-md text-ink-muted hover:bg-surface-2">✕</button>
        </div>

        {p.carregando && <div className="mt-1 text-[11px] text-ink-muted">Carregando viagem salva…</div>}

        {p.podeSalvar === false && (
          <div role="alert" className="mt-2 rounded-lg border border-amber-300 bg-amber-50 px-2.5 py-2 text-[11.5px] leading-snug text-amber-800">
            <span className="font-semibold">Esta conta não grava viagem.</span> Dá pra montar e conferir o
            roteiro, gerar o PDF e mandar o resumo — mas o Salvar não vai funcionar.
            Entre com uma conta que tenha permissão, ou peça a liberação.
          </div>
        )}

        <div className="mt-1.5 flex items-center gap-1.5">
          <select
            value={p.status}
            onChange={e => p.setStatus(e.target.value as ViagemStatus)}
            title="Estado do planejamento (§19)"
            className="h-7 flex-1 min-w-0 px-1.5 rounded-md border border-border bg-surface-2 text-[11.5px] text-ink outline-none focus:border-accent"
          >
            {STATUS_OPCOES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          {p.viagemId
            ? <button onClick={p.onNova} title="Começar uma viagem em branco"
                      className="h-7 px-2 shrink-0 rounded-md border border-border bg-surface text-[11px] font-semibold text-ink-muted">＋ nova</button>
            : <span className="text-[10px] text-ink-faint shrink-0 px-1">não salva</span>}
        </div>

        <div className="mt-2 flex items-center gap-1 text-[12px]">
          {(['roteiro', 'ajustes'] as const).map(a => (
            <button key={a} onClick={() => setAba(a)}
              className={`h-7 px-2.5 rounded-md font-semibold transition-colors ${aba === a ? 'bg-accent-bg text-accent' : 'text-ink-muted hover:text-ink'}`}>
              {a === 'roteiro' ? `Roteiro (${p.paradas.length})` : 'Ajustes'}
            </button>
          ))}
          {p.paradas.length > 0 && (
            <span className="ml-auto text-[11px] tabular-nums text-ink-faint">
              {km(p.prog.totalMetros)} · {dur(p.prog.totalDeslocamentoSeg)}
              {p.prog.estimado && <span className="text-warning" title="Distância em linha reta × 1,3 — a rota real ainda não foi calculada"> ~</span>}
            </span>
          )}
        </div>
      </div>

      {/* Sem origem a rota é ficção: o 1º trecho não existe e o dia começa "0 km".
          Isso tem que estar na cara, não escondido na aba de ajustes. */}
      {p.paradas.length > 0 && !p.cfg.origem && (
        <button
          onClick={p.onPedirOrigemNoMapa}
          className="shrink-0 w-full px-3 py-2 border-b border-border bg-blue-50 dark:bg-blue-950/20 text-left"
        >
          <div className="text-[12px] font-bold text-blue-800 dark:text-blue-300">📍 Falta o ponto de partida</div>
          <div className="text-[11px] text-blue-700 dark:text-blue-400 leading-snug">
            Sem ele não dá pra calcular deslocamento — o roteiro começa direto no cliente, com 0 km.
            Toque aqui pra marcar no mapa, ou use a aba Ajustes pra buscar um aeroporto.
          </div>
        </button>
      )}

      {/* avisos honestos sobre o dado */}
      {(semLoc > 0 || aproximadas > 0 || p.prog.foraDoPlano.length > 0) && (
        <div className="shrink-0 px-3 py-2 border-b border-border bg-amber-50 dark:bg-amber-950/20 text-[11px] leading-snug space-y-1">
          {semLoc > 0 && (
            <div className="text-red-700 dark:text-red-400">
              <b>{semLoc} sem localização real</b> — coordenada de estado, não entra na rota. Confirme o endereço.
            </div>
          )}
          {aproximadas > 0 && (
            <div className="text-amber-800 dark:text-amber-400">
              <b>{aproximadas} aproximada(s)</b> — é o centro da cidade, não a propriedade. Confirme antes de fechar a viagem.
            </div>
          )}
          {p.prog.foraDoPlano.length > 0 && (
            <div className="text-red-700 dark:text-red-400">
              <b>{p.prog.foraDoPlano.length} não coube</b> em {p.cfg.dias} dia{p.cfg.dias === 1 ? '' : 's'}:{' '}
              {p.prog.foraDoPlano.map(nomeParada).join(', ')}
              {/* Só aparece com os dias FIXOS: no automático o ajuste já
                  aconteceu antes deste aviso existir. Aqui a pessoa disse
                  quantos dias tem, então o botão pergunta em vez de decidir. */}
              {precisaDias > p.cfg.dias && (
                <button
                  onClick={() => p.setCfg({ dias: precisaDias, diasManual: true })}
                  className="ml-1 font-bold underline decoration-dotted"
                >
                  usar {precisaDias} dias →
                </button>
              )}
            </div>
          )}
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-y-auto">
        {aba === 'ajustes' ? (
          <Ajustes cfg={p.cfg} setCfg={p.setCfg} onPedirOrigemNoMapa={p.onPedirOrigemNoMapa} escolhendo={p.escolhendoOrigem} />
        ) : p.paradas.length === 0 ? (
          <div className="p-4 text-[13px] text-ink-muted leading-relaxed">
            <p className="font-semibold text-ink mb-1">Como monta</p>
            <p>Clique num pino do mapa e use <b>＋ Adicionar à viagem</b>. Pode misturar cidades e estados.</p>
            <p className="mt-3 text-[12px] text-ink-faint">
              Clientes que dividem a mesma coordenada entram como <b>uma parada de cidade</b> — o CRM só tem o centro do
              município, então ordenar entre eles seria chute.
            </p>
            {!p.cfg.origem && (
              <button onClick={() => setAba('ajustes')} className="mt-3 h-9 w-full rounded-lg bg-accent-bg border border-accent/30 text-accent text-[13px] font-semibold">
                Definir ponto de partida →
              </button>
            )}
          </div>
        ) : (
          <div className="p-2 space-y-3">
            {p.prog.dias.map(d => (
              <div key={d.dia}>
                <div className="flex items-center gap-2 px-1 pb-1.5">
                  <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ backgroundColor: corDoDia(d.dia) }} />
                  <span className="text-[12px] font-bold text-ink">
                    Dia {d.dia}{d.data ? ` · ${dataBRcurta(d.data)} ${diaSemana(d.data)}` : ''}
                  </span>
                  <span className="ml-auto text-[10px] tabular-nums text-ink-faint">
                    {d.paradas.length} · {km(d.metros)} · {minParaHhmm(d.inicio)}–{hhmmComDia(d.fim)}
                  </span>
                </div>
                <ul className="space-y-1.5">
                  {d.paradas.map(pp => (
                    <CardParada
                      key={pp.parada.id}
                      pp={pp}
                      cfg={p.cfg}
                      arrastando={arrastando === pp.parada.id}
                      onArrastar={setArrastando}
                      onSoltar={soltar}
                      onPatch={patch}
                      onRemover={remover}
                      onFocar={p.onFocar}
                      onConfirmar={pedirConfirmacao}
                      onCorrigirLocal={p.onConfirmarLocalizacao}
                    />
                  ))}
                </ul>
                {/* Onde o dia acaba é informação de viagem: é ali que se procura
                    hotel. Sem isto o roteiro some entre um dia e outro. */}
                {d.pernoiteEm && (
                  <div className="mt-1.5 ml-1 text-[11px] text-ink-faint">
                    🛏️ Dia termina em <b className="text-ink">{d.pernoiteEm}</b> — pernoite por conta
                  </div>
                )}
                {linkGoogleMaps(d, p.cfg) && (
                  <a href={linkGoogleMaps(d, p.cfg)} target="_blank" rel="noopener"
                     className="mt-1.5 ml-1 inline-block text-[11px] font-semibold text-accent hover:underline">
                    Abrir rota do dia {d.dia} no Google Maps ↗
                  </a>
                )}
              </div>
            ))}

            {(p.prog.semLocalizacao.length > 0 || p.prog.foraDoPlano.length > 0) && (
              <div className="pt-2 border-t border-border">
                <div className="px-1 pb-1.5 text-[11px] uppercase tracking-wide text-ink-faint">Fora da rota</div>
                <ul className="space-y-1.5">
                  {[...p.prog.semLocalizacao, ...p.prog.foraDoPlano].map(par => (
                    <li key={par.id} className="rounded-lg border border-red-200 dark:border-red-900/50 bg-red-50/60 dark:bg-red-950/20 px-2.5 py-2">
                      <div className="flex items-start gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="text-[12.5px] font-semibold text-ink truncate">{nomeParada(par)}</div>
                          <div className="text-[11px] text-ink-muted">{[par.cidade, par.uf].filter(Boolean).join('/') || '—'}</div>
                          <div className="text-[11px] text-red-700 dark:text-red-400 mt-0.5">
                            {roteavel(par) ? 'Não coube nos dias' : PRECISAO_INFO[par.precisao].rotulo}
                          </div>
                        </div>
                        <button onClick={() => remover(par.id)} title="Tirar da viagem"
                                className="h-6 w-6 shrink-0 rounded text-ink-faint hover:bg-surface-2">✕</button>
                      </div>
                      {!roteavel(par) && (
                        <button onClick={() => p.onConfirmarLocalizacao(par)}
                                className="mt-1.5 w-full h-7 rounded-md bg-surface border border-border text-[11px] font-semibold text-ink">
                          📍 Corrigir localização
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ações */}
      <div className="shrink-0 border-t border-border p-2 space-y-1.5">
        {p.paradas.length >= MAX_PARADAS && (
          <div className="text-[11px] text-warning px-1">Limite de {MAX_PARADAS} paradas atingido.</div>
        )}
        <div className="flex gap-1.5">
          <button
            onClick={p.onCalcular}
            disabled={p.calculando || p.paradas.length < 1}
            className="flex-1 h-9 rounded-lg bg-accent text-white text-[12.5px] font-bold disabled:opacity-50"
            title="Calcula a rota real por estrada (OSRM) e reordena"
          >
            {p.calculando ? 'Calculando…' : '✨ Calcular melhor rota'}
          </button>
          <button
            onClick={() => p.setCfg({ modo: p.cfg.modo === 'otimizar' ? 'manual' : 'otimizar' })}
            title={p.cfg.modo === 'otimizar' ? 'Otimizando automaticamente' : 'Mantendo a sua ordem'}
            className={`h-9 px-2.5 rounded-lg border text-[12px] font-semibold ${p.cfg.modo === 'otimizar' ? 'bg-accent-bg border-accent/30 text-accent' : 'bg-surface border-border text-ink-muted'}`}
          >
            {p.cfg.modo === 'otimizar' ? '🔀 Auto' : '✋ Minha ordem'}
          </button>
        </div>
        {p.erroSalvar && (
          <div role="alert"
               className="mb-1.5 rounded-lg border border-red-300 bg-red-50 px-2.5 py-2 text-[12px] leading-snug text-red-700">
            <span className="font-semibold">Não salvou.</span> {p.erroSalvar}
          </div>
        )}
        <div className="flex gap-1.5">
          <button onClick={p.onSalvar}
                  disabled={p.salvando || !p.cfg.nome.trim() || p.podeSalvar === false}
                  title={p.podeSalvar === false
                    ? 'Sua conta não tem permissão pra gravar viagem'
                    : !p.cfg.nome.trim() ? 'Dê um nome à viagem primeiro' : 'Salvar no banco'}
                  className="flex-1 h-8 rounded-lg bg-surface border border-border text-[12px] font-semibold text-ink disabled:opacity-50">
            {p.salvando ? 'Salvando…' : p.salvoEm ? '💾 Salvo' : '💾 Salvar'}
          </button>
          <button onClick={copiarWhatsApp} disabled={!p.prog.dias.length}
                  className="flex-1 h-8 rounded-lg bg-surface border border-border text-[12px] font-semibold text-ink disabled:opacity-50">
            {copiado ? '✓ Copiado' : '💬 Resumo'}
          </button>
          <button onClick={p.onPDF} disabled={p.gerandoPdf || !p.prog.dias.length}
                  className="flex-1 h-8 rounded-lg bg-surface border border-border text-[12px] font-semibold text-ink disabled:opacity-50">
            {p.gerandoPdf ? 'Gerando…' : '📄 PDF'}
          </button>
        </div>
        <div className="flex items-center gap-2 px-1 text-[10px] text-ink-faint">
          <span>{totalClientes} cliente(s) em {p.paradas.length} parada(s)</span>
          {p.provedor && <span className="ml-auto">rota: {p.provedor === 'osrm' ? 'OSRM (real)' : 'estimada'}</span>}
        </div>
      </div>
    </div>
  )
}

// ── card de uma parada ───────────────────────────────────────────────────────

function CardParada({
  pp, cfg, arrastando, onArrastar, onSoltar, onPatch, onRemover, onFocar, onConfirmar, onCorrigirLocal,
}: {
  pp: import('@/lib/viagem').ParadaProgramada
  cfg: ConfigViagem
  arrastando: boolean
  onArrastar: (id: string | null) => void
  onSoltar: (id: string) => void
  onPatch: (id: string, m: Partial<Parada>) => void
  onRemover: (id: string) => void
  onFocar: (p: Parada) => void
  onConfirmar: (p: Parada) => void
  onCorrigirLocal: (p: Parada) => void
}) {
  const [aberto, setAberto] = useState(false)
  const p = pp.parada
  const info = PRECISAO_INFO[p.precisao]
  const c0 = p.clientes[0]
  const tel = (c0?.telefone || '').replace(/\D/g, '')

  return (
    <li
      draggable
      onDragStart={() => onArrastar(p.id)}
      onDragOver={e => e.preventDefault()}
      onDrop={() => onSoltar(p.id)}
      onDragEnd={() => onArrastar(null)}
      className={`rounded-lg border bg-surface transition-opacity ${arrastando ? 'opacity-40' : ''} ${p.ordemTravada ? 'border-accent/50' : 'border-border'}`}
    >
      <div className="flex items-start gap-2 px-2 py-1.5">
        <span
          className="mt-0.5 h-5 w-5 shrink-0 rounded-full text-[11px] font-bold text-white flex items-center justify-center cursor-grab"
          style={{ backgroundColor: corDoDia(pp.dia) }}
          title="Arraste pra reordenar"
        >
          {pp.ordem}
        </span>

        <button onClick={() => onFocar(p)} className="min-w-0 flex-1 text-left">
          <div className="text-[12.5px] font-semibold text-ink truncate">{nomeParada(p)}</div>
          <div className="text-[11px] text-ink-muted truncate">
            {[p.cidade, p.uf].filter(Boolean).join('/') || '—'}
            {c0?.vendedor ? ` · ${c0.vendedor}` : ''}
          </div>
          <div className="mt-0.5 flex items-center gap-1.5 text-[11px] tabular-nums">
            <span className="font-semibold text-ink">{hhmmComDia(pp.chegada)}</span>
            <span className="text-ink-faint">→ {hhmmComDia(pp.saida)}</span>
            <span className="text-ink-faint">· {durMin(pp.visitaMinutos)}</span>
          </div>
          {pp.trechoAnterior && pp.trechoAnterior.metros > 0 && (
            <div className="text-[10.5px] text-ink-faint truncate">
              {km(pp.trechoAnterior.metros)} · {dur(pp.trechoAnterior.segundos)} desde {pp.deQuem}
              {pp.trechoAnterior.estimado && ' (est.)'}
            </div>
          )}
          <div className="mt-1 flex flex-wrap items-center gap-1">
            <span className="text-[10px] px-1.5 py-0.5 rounded-full font-semibold"
                  style={{ backgroundColor: info.cor + '22', color: info.cor }}
                  title={info.rotulo}>
              {info.icone} {p.precisao === 'cidade' ? 'aprox.' : p.precisao === 'estado' ? 'sem local' : 'exata'}
            </span>
            {c0?.vendido && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-blue-100 text-blue-800 font-semibold">✓ vendido</span>}
            {p.tipo === 'cidade' && p.clientes.length > 1 && (
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-surface-2 text-ink-muted font-semibold">
                {p.clientes.length} clientes
              </span>
            )}
            {p.ordemTravada && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-accent-bg text-accent font-semibold">🔒 travada</span>}
          </div>
          {pp.alertas.map((a, i) => (
            <div key={i} className="mt-0.5 text-[10.5px] text-amber-700 dark:text-amber-400">{a}</div>
          ))}
        </button>

        <div className="flex flex-col gap-0.5 shrink-0">
          <button onClick={() => setAberto(v => !v)} title="Editar tempo, horário e nota"
                  className="h-6 w-6 rounded text-ink-faint hover:bg-surface-2 text-[12px]">⚙</button>
          <button onClick={() => onPatch(p.id, { ordemTravada: !p.ordemTravada })}
                  title={p.ordemTravada ? 'Destravar ordem' : 'Travar nesta posição'}
                  className={`h-6 w-6 rounded text-[11px] hover:bg-surface-2 ${p.ordemTravada ? 'text-accent' : 'text-ink-faint'}`}>
            {p.ordemTravada ? '🔒' : '🔓'}
          </button>
          <button onClick={() => onRemover(p.id)} title="Tirar da viagem"
                  className="h-6 w-6 rounded text-ink-faint hover:bg-surface-2 text-[12px]">✕</button>
        </div>
      </div>

      {aberto && (
        <div className="px-2 pb-2 pt-1 border-t border-border space-y-2">
          {/* tempo de visita */}
          <div>
            <div className="text-[10px] uppercase tracking-wide text-ink-faint mb-1">Tempo nesta parada</div>
            <div className="flex flex-wrap gap-1">
              {ATALHOS_MIN.map(m => (
                <button key={m} onClick={() => onPatch(p.id, { visitaMinutos: m })}
                        className={`h-7 px-2 rounded-md border text-[11px] font-semibold ${minutosDaParada(p, cfg) === m ? 'bg-accent-bg border-accent/40 text-accent' : 'bg-surface border-border text-ink-muted'}`}>
                  {durMin(m)}
                </button>
              ))}
              <input
                type="number" min={0} step={15}
                value={p.visitaMinutos ?? ''}
                placeholder={String(minutosDaParada(p, cfg))}
                onChange={e => onPatch(p.id, { visitaMinutos: e.target.value === '' ? null : Math.max(0, Number(e.target.value)) })}
                className="h-7 w-16 px-1.5 rounded-md border border-border bg-surface-2 text-[11px] text-ink"
                title="Minutos (vazio = padrão da viagem)"
              />
            </div>
            {p.tipo === 'cidade' && p.clientes.length > 1 && p.visitaMinutos == null && (
              <div className="text-[10px] text-ink-faint mt-1">
                Padrão × {p.clientes.length} clientes = {durMin(minutosDaParada(p, cfg))}
              </div>
            )}
          </div>

          {/* janela de atendimento */}
          <div>
            <div className="text-[10px] uppercase tracking-wide text-ink-faint mb-1">Horário do cliente</div>
            <div className="flex items-center gap-1.5 text-[11px] text-ink-muted">
              <input type="time" value={p.janelaInicio ?? ''} onChange={e => onPatch(p.id, { janelaInicio: e.target.value || null })}
                     className="h-7 px-1.5 rounded-md border border-border bg-surface-2 text-ink" />
              <span>até</span>
              <input type="time" value={p.janelaFim ?? ''} onChange={e => onPatch(p.id, { janelaFim: e.target.value || null })}
                     className="h-7 px-1.5 rounded-md border border-border bg-surface-2 text-ink" />
              {(p.janelaInicio || p.janelaFim) && (
                <button onClick={() => onPatch(p.id, { janelaInicio: null, janelaFim: null })} className="text-accent">limpar</button>
              )}
            </div>
          </div>

          {/* clientes da parada-cidade */}
          {p.clientes.length > 1 && (
            <div>
              <div className="text-[10px] uppercase tracking-wide text-ink-faint mb-1">Clientes nesta cidade</div>
              <ul className="space-y-0.5">
                {p.clientes.map(c => (
                  <li key={c.cliKey} className="flex items-center gap-1.5 text-[11px]">
                    <span className="truncate flex-1 text-ink">{c.nome || '—'}</span>
                    {c.telefone && (
                      <a href={`https://wa.me/55${c.telefone.replace(/\D/g, '').replace(/^55/, '')}`} target="_blank" rel="noopener"
                         className="text-green-600 shrink-0">wa ↗</a>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div>
            <div className="text-[10px] uppercase tracking-wide text-ink-faint mb-1">Observação</div>
            <textarea rows={2} value={p.notas ?? ''} onChange={e => onPatch(p.id, { notas: e.target.value || null })}
                      placeholder="Ex: confirmar com o filho · portão azul depois da ponte"
                      className="w-full rounded-md border border-border bg-surface-2 px-2 py-1.5 text-[11.5px] text-ink placeholder:text-ink-faint outline-none focus:border-accent resize-none" />
          </div>

          <div className="flex gap-1.5">
            <button onClick={() => onConfirmar(p)}
                    className="flex-1 h-7 rounded-md bg-surface-2 border border-border text-[11px] font-semibold text-ink"
                    title="Abre o WhatsApp com a mensagem pronta — não envia sozinho">
              📍 Pedir confirmação
            </button>
            <button onClick={() => onCorrigirLocal(p)}
                    className="flex-1 h-7 rounded-md bg-surface-2 border border-border text-[11px] font-semibold text-ink">
              ✏️ Corrigir local
            </button>
            <a href={`https://www.google.com/maps/search/?api=1&query=${p.lat},${p.lng}`} target="_blank" rel="noopener"
               className="h-7 px-2 rounded-md bg-surface-2 border border-border text-[11px] font-semibold text-ink flex items-center">
              Maps ↗
            </a>
          </div>
          {tel && (
            <div className="text-[10.5px] text-ink-faint">📱 {c0?.telefone}</div>
          )}
        </div>
      )}
    </li>
  )
}

// ── aba de ajustes ───────────────────────────────────────────────────────────

function Ajustes({
  cfg, setCfg, onPedirOrigemNoMapa, escolhendo,
}: {
  cfg: ConfigViagem
  setCfg: (p: Partial<ConfigViagem>) => void
  onPedirOrigemNoMapa: () => void
  escolhendo: boolean
}) {
  const campo = 'h-8 w-full px-2 rounded-md border border-border bg-surface-2 text-[12.5px] text-ink outline-none focus:border-accent'
  const rot = 'text-[10px] uppercase tracking-wide text-ink-faint mb-1'

  return (
    <div className="p-3 space-y-3">
      <div>
        <div className={rot}>Ponto de partida</div>
        {cfg.origem ? (
          <div className="rounded-md border border-border bg-surface-2 px-2 py-1.5">
            <div className="text-[12.5px] font-semibold text-ink truncate">📍 {cfg.origem.nome}</div>
            <div className="text-[10.5px] tabular-nums text-ink-faint">{cfg.origem.lat.toFixed(4)}, {cfg.origem.lng.toFixed(4)}</div>
            <div className="mt-1 flex gap-1.5">
              <button onClick={onPedirOrigemNoMapa} className="text-[11px] font-semibold text-accent">trocar no mapa</button>
              <button onClick={() => setCfg({ origem: null })} className="text-[11px] text-ink-muted ml-auto">remover</button>
            </div>
          </div>
        ) : (
          <button onClick={onPedirOrigemNoMapa}
                  className={`h-9 w-full rounded-md border text-[12.5px] font-semibold ${escolhendo ? 'bg-accent text-white border-accent' : 'bg-surface border-border text-ink'}`}>
            {escolhendo ? 'Clique no mapa…' : '＋ Definir no mapa'}
          </button>
        )}
        <BuscaLocal onEscolher={pt => setCfg({ origem: pt })} placeholder="Ou busque: Aeroporto de Teresina…" />
      </div>

      {/* A pergunta que decide se a viagem longa é possível. Marcada = o dia
          acaba na última visita e o seguinte começa dali. Desmarcada = volta pra
          base todo fim de dia, o que só fecha a conta com cliente perto. */}
      <label className="flex items-center gap-2 text-[12.5px] text-ink cursor-pointer">
        <input type="checkbox" checked={cfg.pernoitar !== false} onChange={e => setCfg({ pernoitar: e.target.checked })}
               className="h-4 w-4 accent-blue-600" />
        Dormir na estrada <span className="text-ink-faint">— volta pra base só no fim</span>
      </label>

      <label className="flex items-center gap-2 text-[12.5px] text-ink cursor-pointer">
        <input type="checkbox" checked={cfg.retornarOrigem} onChange={e => setCfg({ retornarOrigem: e.target.checked })}
               className="h-4 w-4 accent-blue-600" />
        {cfg.pernoitar !== false ? 'Voltar ao ponto de partida no fim da viagem' : 'Voltar ao ponto de partida no fim do dia'}
      </label>

      {!cfg.retornarOrigem && (
        <div>
          <div className={rot}>Terminar em</div>
          {cfg.destino
            ? <div className="rounded-md border border-border bg-surface-2 px-2 py-1.5 text-[12.5px] text-ink flex items-center gap-2">
                <span className="truncate flex-1">🏁 {cfg.destino.nome}</span>
                <button onClick={() => setCfg({ destino: null })} className="text-ink-faint">✕</button>
              </div>
            : <BuscaLocal onEscolher={pt => setCfg({ destino: pt })} placeholder="Hotel, aeroporto, cidade…" />}
        </div>
      )}

      <div className="grid grid-cols-2 gap-2">
        <div>
          <div className={rot}>Data de início</div>
          <input type="date" value={cfg.dataInicio ?? ''} onChange={e => setCfg({ dataInicio: e.target.value || null })} className={campo} />
        </div>
        <div>
          <div className={rot}>
            Dias
            {/* Precisa ficar explícito que o número se mexe sozinho — senão a
                pessoa digita 2, vê virar 5 e acha que a tela está com defeito. */}
            {cfg.diasManual
              ? <button type="button" onClick={() => setCfg({ diasManual: false })}
                        className="ml-1 font-normal normal-case underline decoration-dotted opacity-70 hover:opacity-100">
                  fixo · voltar ao automático
                </button>
              : <span className="ml-1 font-normal normal-case opacity-60">automático</span>}
          </div>
          {/* Digitar aqui é dizer "só tenho N dias": vira restrição de verdade e
              o que não couber passa a aparecer em "Fora da rota". */}
          <input type="number" min={1} max={60} value={cfg.dias}
                 onChange={e => setCfg({ dias: Math.max(1, Math.min(60, Number(e.target.value) || 1)), diasManual: true })} className={campo} />
        </div>
        <div>
          <div className={rot}>Sai às</div>
          <input type="time" value={cfg.horaInicio} onChange={e => setCfg({ horaInicio: e.target.value || '08:00' })} className={campo} />
        </div>
        <div>
          <div className={rot}>Encerra às</div>
          <input type="time" value={cfg.horaFim} onChange={e => setCfg({ horaFim: e.target.value || '18:00' })} className={campo} />
        </div>
        <div>
          <div className={rot}>Almoço</div>
          <input type="time" value={cfg.almocoInicio ?? ''} onChange={e => setCfg({ almocoInicio: e.target.value || null })} className={campo} />
        </div>
        <div>
          <div className={rot}>Duração almoço</div>
          <input type="number" min={0} max={240} step={15} value={cfg.almocoMinutos}
                 onChange={e => setCfg({ almocoMinutos: Math.max(0, Math.min(240, Number(e.target.value) || 0)) })} className={campo} />
        </div>
      </div>

      <div>
        <div className={rot}>Tempo padrão por visita</div>
        <div className="flex flex-wrap gap-1">
          {ATALHOS_MIN.map(m => (
            <button key={m} onClick={() => setCfg({ visitaMinutosPadrao: m })}
                    className={`h-8 px-2.5 rounded-md border text-[12px] font-semibold ${cfg.visitaMinutosPadrao === m ? 'bg-accent-bg border-accent/40 text-accent' : 'bg-surface border-border text-ink-muted'}`}>
              {durMin(m)}
            </button>
          ))}
          <input type="number" min={5} step={15} value={cfg.visitaMinutosPadrao}
                 onChange={e => setCfg({ visitaMinutosPadrao: Math.max(5, Number(e.target.value) || 90) })}
                 className="h-8 w-16 px-1.5 rounded-md border border-border bg-surface-2 text-[12px] text-ink" />
        </div>
        <div className="text-[10px] text-ink-faint mt-1">
          Vale por parada. Parada-cidade com N clientes multiplica por N — dá pra sobrescrever em cada uma.
        </div>
      </div>
    </div>
  )
}

/** Busca de local via Nominatim (mesmo provedor que o CRM já usa pra geocodificar cidade). */
function BuscaLocal({ onEscolher, placeholder }: { onEscolher: (p: { nome: string; lat: number; lng: number }) => void; placeholder: string }) {
  const [q, setQ] = useState('')
  const [res, setRes] = useState<Array<{ nome: string; lat: number; lng: number }>>([])
  const [carregando, setCarregando] = useState(false)

  async function buscar() {
    const termo = q.trim()
    if (termo.length < 3) return
    // Link do Google Maps colado (§5 do spec): extrai @lat,lng direto, sem chamar API.
    const gmaps = termo.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/) || termo.match(/[?&]q=(-?\d+\.\d+),\s*(-?\d+\.\d+)/)
    if (gmaps) {
      onEscolher({ nome: 'Ponto do Google Maps', lat: Number(gmaps[1]), lng: Number(gmaps[2]) })
      setQ(''); setRes([]); return
    }
    // Coordenada colada direto
    const coord = termo.match(/^\s*(-?\d+[.,]\d+)\s*[,;]\s*(-?\d+[.,]\d+)\s*$/)
    if (coord) {
      onEscolher({ nome: 'Coordenada', lat: Number(coord[1].replace(',', '.')), lng: Number(coord[2].replace(',', '.')) })
      setQ(''); setRes([]); return
    }
    setCarregando(true)
    try {
      const r = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&limit=6&countrycodes=br&q=${encodeURIComponent(termo)}`,
        { headers: { 'Accept-Language': 'pt-BR' } },
      )
      const j = await r.json()
      setRes((Array.isArray(j) ? j : []).map((x: { display_name: string; lat: string; lon: string }) => ({
        nome: String(x.display_name).split(',').slice(0, 3).join(',').trim(),
        lat: Number(x.lat), lng: Number(x.lon),
      })))
    } catch {
      setRes([])
    } finally {
      setCarregando(false)
    }
  }

  return (
    <div className="mt-1.5">
      <div className="flex gap-1.5">
        <input
          value={q}
          onChange={e => setQ(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); buscar() } }}
          placeholder={placeholder}
          className="h-8 flex-1 min-w-0 px-2 rounded-md border border-border bg-surface-2 text-[12.5px] text-ink placeholder:text-ink-faint outline-none focus:border-accent"
        />
        <button onClick={buscar} disabled={carregando || q.trim().length < 3}
                className="h-8 px-2.5 rounded-md bg-surface border border-border text-[12px] font-semibold text-ink disabled:opacity-50">
          {carregando ? '…' : '🔍'}
        </button>
      </div>
      {res.length > 0 && (
        <ul className="mt-1 rounded-md border border-border bg-surface overflow-hidden">
          {res.map((x, i) => (
            <li key={i}>
              <button onClick={() => { onEscolher(x); setQ(''); setRes([]) }}
                      className="w-full text-left px-2 py-1.5 text-[11.5px] text-ink hover:bg-surface-2 truncate">
                📍 {x.nome}
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="text-[10px] text-ink-faint mt-1">Aceita endereço, coordenada ou link do Google Maps.</div>
    </div>
  )
}
