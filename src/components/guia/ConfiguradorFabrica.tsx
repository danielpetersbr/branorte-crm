/**
 * CONFIGURADOR DE FÁBRICA — dentro do Atendimento rápido.
 *
 * O vendedor está no telefone e o cliente já disse o rebanho. Daqui pra frente é
 * o caminho que o Daniel percorre na cabeça, na ordem em que ele pensa:
 *
 *   consumo mensal  →  QUANTO ELE QUER TRABALHAR  →  produção por hora
 *   →  margem  →  a formulação vira capacidade de silo  →  granel ou ensacado
 *
 * O SEGUNDO PASSO É O QUE MUDA TUDO — e por isso a jornada NÃO mora mais aqui:
 * ela é estado do `AtendimentoRapido`, porque o kg/h do mostrador sai dela. Ter
 * a jornada aqui dentro produzia DOIS kg/h na mesma tela: o painel "Capacidade
 * para análise" assumia 26 dias × 8 h × 80% = 166,4 h/mês, e este componente
 * nascia em 6 × (52/12) × 8 = 208 h/mês. 25% de diferença, dois degraus de
 * moinho, os dois números a 30 cm um do outro e nada dizendo qual valia.
 *
 * O catálogo vem de `precos_branorte` ao vivo. Nada de lista copiada: preço e
 * modelo mudam, e a única verdade é a tabela.
 */
import { useMemo, useState } from 'react'
import { AlertCircle, ChevronDown, Truck, Warehouse } from 'lucide-react'
import { Input } from '@/components/ui/Input'
import { usePrecosBranorte } from '@/hooks/usePrecosBranorte'
import { formulasReferencia } from '@/lib/formulacoes-racao'
import {
  dimensionar, EXPEDICAO_INFO, LIMITE_CAIXA_KG,
  type Expedicao, type ItemCatalogo, type Jornada, type Recebimento,
} from '@/lib/dimensionamento-fabrica'
import type { Especie } from '@/lib/venda-racao/tipos'
import { cn } from '@/lib/utils'

const ton = (n: number) => `${(n / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} t`
const brl = (n: number | null | undefined) =>
  n == null ? '—' : n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })

/**
 * Acima disto o catálogo não tem preço monofásico em SKU nenhum.
 * Conferido em `precos_branorte` em 05/08/2026: 11 SKUs acima de 20 CV, ZERO
 * com `valor_com_motor_mono`; o maior CV com preço mono é 15.
 */
const LIMITE_CV_MONOFASICO = 15

/**
 * Espécie do Guia → espécie do catálogo de formulações.
 *
 * Ovino e caprino ficam de FORA de propósito. O mapa mandava os dois pra
 * `bovinos`, e no dia em que existir uma fase de ovino chamada `cria` a tela
 * serviria uma formulação BOVINA rotulada "Formulação de referência · Fonte:
 * Embrapa" pra ovelha. Mineral formulado pra bovino intoxica ovino por cobre.
 * Sem formulação é uma resposta; a formulação errada com selo de fonte não é.
 */
const ESPECIE_FORMULA: Record<string, Especie> = {
  bovinos: 'bovinos', suinos: 'suinos', aves: 'aves',
}

interface Props {
  /** Vem do levantamento: consumo mensal de ração, em kg. */
  necessidadeMesKg: number | null
  especie: string | null
  fase: string | null
  /** Jornada é do PAI — é dela que sai o kg/h do mostrador. */
  jornada: Jornada
  onJornada: (j: Jornada) => void
  /**
   * O levantamento tem TODOS os dados? A tela inteira segue a disciplina de não
   * fechar equipamento sem isso — e o configurador estava furando: nomeava
   * modelo, capacidade e CV enquanto o painel ao lado dizia "sem todos os dados
   * não dá pra fechar equipamento". Nomear máquina é o que o cliente leva
   * embora da conversa.
   *
   * Silo e caixa de ração pronta TAMBÉM passaram a respeitar isso. "2× silo
   * 42,47 t · funil 60°" é equipamento fechado com capacidade e quantidade, e
   * saía sem trava nenhuma enquanto o texto ao lado prometia que "nada aqui
   * fecha equipamento". Só o moinho cumpria a promessa.
   */
  podeFechar: boolean
}

export function ConfiguradorFabrica({
  necessidadeMesKg, especie, fase, jornada, onJornada, podeFechar,
}: Props) {
  const [diasEstoque, setDiasEstoque] = useState(30)
  const [kgRacaoPronta, setKgPronta] = useState(2000)
  const [expedicao, setExpedicao] = useState<Expedicao[]>([])
  const [formulaEscolhida, setFormula] = useState<string | null>(null)
  const [recebimento, setRecebimento] = useState<Record<string, Recebimento>>({})
  // Formulação, silos, ração pronta e expedição são decisão de PROJETO, de
  // segunda conversa com o orçamento na mão. Abertas por padrão, competiam por
  // atenção com o número que a primeira ligação precisa — e convidavam o
  // vendedor a mexer em granel/ensacado enquanto o cliente ainda contava o
  // rebanho.
  const [detalhando, setDetalhando] = useState(false)

  const { data: precos = [], isLoading: carregandoCatalogo } = usePrecosBranorte()

  const catalogo: ItemCatalogo[] = useMemo(
    () => precos.map(p => ({
      id: p.id,
      modelo: p.modelo ?? null,
      capacidade: p.capacidade ?? null,
      categoria: p.categoria ?? null,
      subcategoria: p.subcategoria ?? null,
      funilTipo: (p as { funil_tipo?: string | null }).funil_tipo ?? null,
      motorCv: p.motor_cv != null ? Number(p.motor_cv) : null,
      valor: p.valor_equipamento != null ? Number(p.valor_equipamento) : null,
      valorComMotorTrif: p.valor_com_motor_trif != null ? Number(p.valor_com_motor_trif) : null,
      valorComMotorMono: p.valor_com_motor_mono != null ? Number(p.valor_com_motor_mono) : null,
    })),
    [precos],
  )

  const especieFormula = especie ? ESPECIE_FORMULA[especie] : undefined
  const opcoesFormula = useMemo(
    () => (especieFormula ? formulasReferencia(especieFormula, fase ?? '') : []),
    [especieFormula, fase],
  )
  const formula = opcoesFormula.find(f => f.chave === formulaEscolhida) ?? opcoesFormula[0] ?? null

  const d = useMemo(() => dimensionar({
    consumoMensalKg: necessidadeMesKg ?? 0,
    jornada,
    formula: (formula?.itens ?? []).map(i => ({ nome: i.nome, participacaoPct: i.participacao })),
    diasEstoqueMateria: diasEstoque,
    kgRacaoPronta,
    expedicao,
    recebimentoPorNome: recebimento,
  }, catalogo), [
    necessidadeMesKg, jornada, formula, diasEstoque, kgRacaoPronta,
    expedicao, recebimento, catalogo,
  ])

  const alternarExpedicao = (e: Expedicao) =>
    setExpedicao(v => (v.includes(e) ? v.filter(x => x !== e) : [...v, e]))

  const setJ = (p: Partial<Jornada>) => onJornada({ ...jornada, ...p })

  return (
    <div className="space-y-3">
      {/* ── 1. a pergunta que muda tudo — colada ao kg/h de cima ─────────── */}
      <div>
        <div className="mb-1.5 text-[12px] text-ink-muted">
          <span className="font-semibold text-ink">Quanto ele quer trabalhar?</span>
          {' '}— é isto que define o equipamento, não o rebanho
        </div>
        <div className="grid grid-cols-3 gap-2">
          <label className="block">
            <span className="mb-1 block text-[11px] text-ink-faint">Dias por semana</span>
            <Input type="number" min={1} max={7} value={jornada.diasPorSemana}
                   onChange={e => setJ({ diasPorSemana: Math.max(1, Math.min(7, Number(e.target.value) || 1)) })} />
          </label>
          <label className="block">
            <span className="mb-1 block text-[11px] text-ink-faint">Horas por dia</span>
            <Input type="number" min={1} max={24} value={jornada.horasPorDia}
                   onChange={e => setJ({ horasPorDia: Math.max(1, Math.min(24, Number(e.target.value) || 1)) })} />
          </label>
          <label className="block">
            <span className="mb-1 block text-[11px] text-ink-faint">Folga (%)</span>
            <Input type="number" min={0} max={200} value={jornada.margemPct ?? 0}
                   onChange={e => setJ({ margemPct: Math.max(0, Math.min(200, Number(e.target.value) || 0)) })} />
          </label>
        </div>
      </div>

      {/* ── 2. o equipamento. É o que sai da boca do vendedor ────────────── */}
      {!!necessidadeMesKg && (
        <div className="rounded-md border border-border bg-surface px-3 py-2.5">
          <div className="text-[11px] font-medium uppercase tracking-wide text-ink-muted">
            Moinho para análise
          </div>
          {carregandoCatalogo ? (
            <p className="mt-1 text-[13px] text-ink-faint">Carregando catálogo…</p>
          ) : !podeFechar ? (
            // O mostrador logo acima já nomeia o que falta. Repetir aqui era
            // dizer a mesma coisa duas vezes em 20px de distância.
            <p className="mt-1 text-[13px] text-warning">
              Sem modelo enquanto o levantamento não fecha.
            </p>
          ) : d.moinho ? (
            <>
              <p className="mt-0.5 text-[19px] font-bold leading-tight tracking-[-0.01em] text-ink">
                {d.moinho.modelo}
              </p>
              <p className="text-[12.5px] text-ink-muted">
                {d.moinho.capacidade}
                {d.moinho.motorCv ? ` · ${d.moinho.motorCv} CV` : ''}
              </p>

              {/* O preço estava carregado em memória e nunca era impresso: o
                  vendedor ouvia "e quanto custa?" e abria outra aba. É tabela
                  do equipamento — não é proposta. */}
              {(d.moinho.valorComMotorTrif ?? d.moinho.valor) != null && (
                <p className="mt-1.5 border-t border-border pt-1.5 text-[13px] text-ink">
                  <b className="tabular-nums">
                    {brl(d.moinho.valorComMotorTrif ?? d.moinho.valor)}
                  </b>
                  <span className="text-ink-muted">
                    {' '}— tabela{d.moinho.valorComMotorTrif != null ? ' com motor trifásico' : ' do equipamento'}
                  </span>
                  {d.moinho.valorComMotorMono != null && (
                    <span className="block text-[12px] text-ink-muted">
                      Monofásico: <span className="tabular-nums">{brl(d.moinho.valorComMotorMono)}</span>
                    </span>
                  )}
                  <span className="block text-[11px] text-ink-faint">
                    Só o equipamento. Sem frete, instalação, painel e obra.
                  </span>
                </p>
              )}

              {/* Energia. Só fala quando o DADO diz algo: nenhum SKU acima de
                  20 CV tem preço monofásico no catálogo, e o maior com mono é
                  de 15 CV. Abaixo disso a coluna está vazia em 3 de cada 4
                  SKUs — ausência de preço não é ausência de máquina, e um
                  aviso que dispara sempre vira moldura. */}
              {d.moinho.valorComMotorMono == null && (d.moinho.motorCv ?? 0) > LIMITE_CV_MONOFASICO && (
                <p className="mt-1.5 text-[12px] leading-relaxed text-warning">
                  {d.moinho.motorCv} CV: acima de {LIMITE_CV_MONOFASICO} CV o catálogo não tem
                  opção monofásica. Confirmar se a propriedade tem trifásico antes de seguir.
                </p>
              )}
            </>
          ) : (
            <p className="mt-1 text-[13px] text-danger">
              Nenhum moinho do catálogo atende. Levar à engenharia.
            </p>
          )}

          {/* O buraco mais sério do dimensionamento, dito na cara em vez de
              escondido: fábrica farelada é processo em BATELADA, e a vazão da
              linha sai do par (carga do misturador ÷ tempo de ciclo). O moinho
              é contínuo. `producao_kgh` é NULL em todos os 21 misturadores de
              precos_branorte — o tempo de ciclo não existe no catálogo, então
              a tela não tem como dimensionar o misturador. Calar sobre isso é
              vender capacidade de MOINHO como capacidade de FÁBRICA. */}
          {podeFechar && d.moinho && (
            <p className="mt-2 border-t border-border pt-2 text-[12px] leading-relaxed text-ink-muted">
              Este kg/h é do <b className="text-ink">moinho</b>. A vazão da fábrica depende também
              da carga do misturador e do tempo de batida, que não estão no catálogo —
              dimensionar o misturador com a engenharia.
            </p>
          )}
        </div>
      )}

      {/* ── 3. o resto é projeto: fechado até o vendedor pedir ───────────── */}
      <button
        type="button"
        onClick={() => setDetalhando(v => !v)}
        aria-expanded={detalhando}
        className="flex w-full items-center gap-1.5 rounded-md px-1 py-1 text-[12px] text-ink-muted hover:text-ink"
      >
        <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', detalhando && 'rotate-180')} />
        {detalhando ? 'Esconder o projeto' : 'Detalhar o projeto'}
        <span className="text-ink-faint">— formulação, silos, ração pronta, expedição</span>
      </button>

      {detalhando && (
        <div className="space-y-3 border-t border-border pt-3">
          {/* ── formulação ───────────────────────────────────────────────── */}
          {opcoesFormula.length > 0 && (
            <div>
              <div className="mb-1.5 text-[12px] font-semibold text-ink">Formulação de referência</div>
              <select
                value={formula?.chave ?? ''}
                onChange={e => setFormula(e.target.value)}
                className="h-9 w-full rounded-md border border-border bg-surface px-2 text-[13px] text-ink outline-none focus:border-accent"
              >
                {opcoesFormula.map(f => (
                  <option key={f.chave} value={f.chave}>{f.nome}</option>
                ))}
              </select>
              {formula && (
                <div className="mt-1 text-[11px] text-ink-faint">Fonte: {formula.fonte}</div>
              )}
              {formula?.nota && (
                <div className="mt-1 flex gap-1.5 text-[11px] text-warning">
                  <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                  <span>{formula.nota}</span>
                </div>
              )}
            </div>
          )}

          {/* ── silos ────────────────────────────────────────────────────── */}
          {d.materias.length > 0 && (
            <div>
              <div className="mb-1.5 flex items-center gap-1.5 text-[12px] font-semibold text-ink">
                <Warehouse className="h-3.5 w-3.5" />
                Recebimento e armazenagem
                <label className="ml-auto flex items-center gap-1 text-[11px] font-normal text-ink-faint">
                  guardar
                  <input type="number" min={1} max={365} value={diasEstoque}
                         onChange={e => setDiasEstoque(Math.max(1, Math.min(365, Number(e.target.value) || 1)))}
                         className="h-7 w-14 rounded border border-border bg-surface px-1.5 text-[12px] text-ink" />
                  dias
                </label>
              </div>
              {!podeFechar && (
                <p className="mb-1.5 text-[11px] leading-relaxed text-warning">
                  Volume de estocagem para conversa. Silo e funil só saem com o levantamento fechado.
                </p>
              )}
              <div className="space-y-1">
                {d.materias.map(m => (
                  <div key={m.nome} className="rounded border border-border bg-surface-2 px-2.5 py-1.5">
                    <div className="flex flex-wrap items-baseline gap-x-2">
                      <span className="text-[12.5px] font-semibold text-ink">{m.nome}</span>
                      <span className="text-[11px] text-ink-faint">{m.participacaoPct}%</span>
                      <span className="ml-auto text-[12px] tabular-nums text-ink-muted">{ton(m.kgEstocar)}</span>
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5">
                      {/* Granel vs ensacado muda o equipamento de recebimento —
                          por isso é escolha por matéria-prima, não da fábrica. */}
                      {(['granel', 'ensacado'] as Recebimento[]).map(r => (
                        <button
                          key={r}
                          type="button"
                          onClick={() => setRecebimento(v => ({ ...v, [m.nome]: r }))}
                          className={cn(
                            'rounded-full border px-2 py-0.5 text-[11px] transition-colors',
                            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
                            m.recebimento === r
                              ? 'border-accent bg-accent text-white'
                              : 'border-border bg-surface text-ink-faint hover:text-ink',
                          )}
                        >
                          {r === 'granel' ? 'a granel' : 'ensacado'}
                        </button>
                      ))}
                      {podeFechar && m.silo && (
                        <span className="text-[11.5px] text-ink-muted">
                          {m.quantidadeSilos > 1 ? `${m.quantidadeSilos}× ` : ''}
                          silo {m.silo.capacidade}
                          {m.silo.funilTipo ? ` · funil ${m.silo.funilTipo}°` : ''}
                        </span>
                      )}
                      {/* O catálogo tem degraus enormes: pra 45 t de milho o menor
                          que cabe sozinho é o de 196,5 t. A combinação fica ao lado
                          pra o vendedor escolher — a conta não decide por ele. */}
                      {podeFechar && m.alternativa && (
                        <span className="text-[11.5px] text-accent">
                          ou {m.alternativa.quantidade}× {m.alternativa.silo.capacidade}
                        </span>
                      )}
                    </div>
                    {m.observacao && (
                      <div className="mt-1 text-[11px] text-ink-faint">{m.observacao}</div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── ração pronta ─────────────────────────────────────────────── */}
          <div>
            <div className="mb-1.5 flex items-center gap-2 text-[12px] font-semibold text-ink">
              Ração pronta guardada
              <input type="number" min={0} step={500} value={kgRacaoPronta}
                     onChange={e => setKgPronta(Math.max(0, Number(e.target.value) || 0))}
                     className="h-7 w-24 rounded border border-border bg-surface px-1.5 text-[12px] text-ink" />
              <span className="font-normal text-ink-faint">kg</span>
            </div>
            <div className="text-[12.5px] text-ink-muted">
              {!podeFechar
                ? <span className="text-warning">Sai com o levantamento fechado.</span>
                : d.racaoPronta.item
                  ? <>
                      {d.racaoPronta.quantidade > 1 ? `${d.racaoPronta.quantidade}× ` : ''}
                      <b className="text-ink">
                        {d.racaoPronta.tipo === 'caixa' ? 'Caixa' : 'Silo de ração'} {d.racaoPronta.item.capacidade}
                      </b>
                      {d.racaoPronta.item.modelo ? ` (${d.racaoPronta.item.modelo})` : ''}
                    </>
                  : <span className="text-ink-faint">Nada a guardar.</span>}
              <div className="text-[11px] text-ink-faint">
                Até {ton(LIMITE_CAIXA_KG)} é caixa; acima é silo de ração (funil 60°).
              </div>
            </div>
          </div>

          {/* ── expedição ────────────────────────────────────────────────── */}
          <div>
            <div className="mb-1.5 flex items-center gap-1.5 text-[12px] font-semibold text-ink">
              <Truck className="h-3.5 w-3.5" /> Como sai a ração
            </div>
            <div className="flex flex-wrap gap-1.5">
              {(Object.keys(EXPEDICAO_INFO) as Expedicao[]).map(e => (
                <button
                  key={e}
                  type="button"
                  aria-pressed={expedicao.includes(e)}
                  onClick={() => alternarExpedicao(e)}
                  className={cn(
                    'rounded-full border px-2.5 py-1 text-[12px] transition-colors',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
                    expedicao.includes(e)
                      ? 'border-accent bg-accent text-white'
                      : 'border-border bg-surface text-ink-muted hover:text-ink',
                  )}
                >
                  {EXPEDICAO_INFO[e].rotulo}
                </button>
              ))}
            </div>
            {expedicao.map(e => (
              <div key={e} className="mt-1 text-[11px] text-ink-faint">
                {EXPEDICAO_INFO[e].rotulo}: {EXPEDICAO_INFO[e].precisa}
              </div>
            ))}
          </div>

          {/* ── o que impede de fechar ───────────────────────────────────── */}
          {d.pendencias.length > 0 && (
            <div className="rounded-md border-l-[3px] border-l-warning bg-warning-bg/40 px-3 py-2">
              <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-warning">
                Falta pra fechar equipamento
              </div>
              <ul className="space-y-0.5 text-[12px] text-ink-muted">
                {d.pendencias.map((p, i) => <li key={i}>• {p}</li>)}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
