/**
 * CONFIGURADOR DE FÁBRICA — dentro do Atendimento rápido.
 *
 * O vendedor está no telefone e o cliente já disse o rebanho. Daqui pra frente é
 * o caminho que o Daniel percorre na cabeça, na ordem em que ele pensa:
 *
 *   consumo mensal  →  QUANTO ELE QUER TRABALHAR  →  produção por hora
 *   →  margem  →  a formulação vira capacidade de silo  →  granel ou ensacado
 *
 * O SEGUNDO PASSO É O QUE MUDA TUDO, e era o que estava escondido: a
 * `capacidadeParaAnalise` do resumo assume 26 dias × 8 h × 80% CRAVADOS no
 * código. Dois clientes com o mesmo rebanho compram máquinas diferentes por
 * causa dessa pergunta, então aqui ela é campo, não premissa.
 *
 * O catálogo vem de `precos_branorte` ao vivo. Nada de lista copiada: preço e
 * modelo mudam, e a única verdade é a tabela.
 */
import { useMemo, useState } from 'react'
import { AlertCircle, Factory, Truck, Warehouse } from 'lucide-react'
import { Input } from '@/components/ui/Input'
import { usePrecosBranorte } from '@/hooks/usePrecosBranorte'
import { formulasReferencia } from '@/lib/formulacoes-racao'
import {
  dimensionar, EXPEDICAO_INFO, LIMITE_CAIXA_KG,
  type Expedicao, type ItemCatalogo, type Recebimento,
} from '@/lib/dimensionamento-fabrica'
import type { Especie } from '@/lib/venda-racao/tipos'
import { cn } from '@/lib/utils'

const kg = (n: number) => `${Math.round(n).toLocaleString('pt-BR')} kg`
const ton = (n: number) => `${(n / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} t`

/** Espécie do Guia → espécie do catálogo de formulações. */
const ESPECIE_FORMULA: Record<string, Especie> = {
  bovinos: 'bovinos', suinos: 'suinos', aves: 'aves',
  ovinos: 'bovinos', caprinos: 'bovinos',
}

interface Props {
  /** Vem do levantamento: consumo mensal de ração, em kg. */
  necessidadeMesKg: number | null
  especie: string | null
  fase: string | null
}

export function ConfiguradorFabrica({ necessidadeMesKg, especie, fase }: Props) {
  // Padrão = 6 × 8, que dá os mesmos ~26 dias/mês que o resumo acima assume.
  // Assim o número não pula ao abrir o configurador — muda quando o vendedor
  // mexe, que é o ponto.
  const [diasPorSemana, setDias] = useState(6)
  const [horasPorDia, setHoras] = useState(8)
  const [margemPct, setMargem] = useState(0)
  const [diasEstoque, setDiasEstoque] = useState(30)
  const [kgRacaoPronta, setKgPronta] = useState(2000)
  const [expedicao, setExpedicao] = useState<Expedicao[]>([])
  const [formulaEscolhida, setFormula] = useState<string | null>(null)
  const [recebimento, setRecebimento] = useState<Record<string, Recebimento>>({})

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
    jornada: { diasPorSemana, horasPorDia, margemPct },
    formula: (formula?.itens ?? []).map(i => ({ nome: i.nome, participacaoPct: i.participacao })),
    diasEstoqueMateria: diasEstoque,
    kgRacaoPronta,
    expedicao,
    recebimentoPorNome: recebimento,
  }, catalogo), [
    necessidadeMesKg, diasPorSemana, horasPorDia, margemPct, formula,
    diasEstoque, kgRacaoPronta, expedicao, recebimento, catalogo,
  ])

  const alternarExpedicao = (e: Expedicao) =>
    setExpedicao(v => (v.includes(e) ? v.filter(x => x !== e) : [...v, e]))

  return (
    <div className="rounded-lg border border-border bg-surface p-3">
      <div className="mb-3 flex items-center gap-2">
        <Factory className="h-4 w-4 text-accent" />
        <h3 className="text-[12px] font-bold uppercase tracking-wide text-ink-muted">
          Configurar a fábrica
        </h3>
      </div>

      {!necessidadeMesKg ? (
        <p className="text-[12.5px] text-ink-faint">
          Falta o consumo mensal. Preencha espécie, fase e quantidade de animais lá em cima —
          é dele que sai a produção por hora.
        </p>
      ) : (
        <div className="space-y-3">
          {/* ── 1. a pergunta que muda tudo ─────────────────────────────── */}
          <div>
            <div className="mb-1.5 text-[11.5px] font-semibold text-ink">
              Quanto ele quer trabalhar?
              <span className="ml-1 font-normal text-ink-faint">
                — é isto que define o equipamento, não o rebanho
              </span>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <label className="block">
                <span className="mb-1 block text-[11px] text-ink-faint">Dias por semana</span>
                <Input type="number" min={1} max={7} value={diasPorSemana}
                       onChange={e => setDias(Math.max(1, Math.min(7, Number(e.target.value) || 1)))} />
              </label>
              <label className="block">
                <span className="mb-1 block text-[11px] text-ink-faint">Horas por dia</span>
                <Input type="number" min={1} max={24} value={horasPorDia}
                       onChange={e => setHoras(Math.max(1, Math.min(24, Number(e.target.value) || 1)))} />
              </label>
              <label className="block">
                <span className="mb-1 block text-[11px] text-ink-faint">Folga (%)</span>
                <Input type="number" min={0} max={200} value={margemPct}
                       onChange={e => setMargem(Math.max(0, Math.min(200, Number(e.target.value) || 0)))} />
              </label>
            </div>
          </div>

          {/* ── 2. o número que sai disso ───────────────────────────────── */}
          {d.producao && (
            <div className="rounded-md border border-accent/30 bg-accent-bg px-3 py-2.5">
              <div className="text-[11px] uppercase tracking-wide text-ink-faint">
                Produção necessária
              </div>
              <div className="text-[20px] font-bold leading-tight text-ink">
                {Math.round(d.producao.kgHoraNecessaria).toLocaleString('pt-BR')} kg/h
              </div>
              <div className="text-[11.5px] text-ink-muted">
                {kg(necessidadeMesKg)}/mês em {Math.round(d.producao.horasPorMes)} h de trabalho
                {margemPct > 0 && ` · com ${margemPct}% de folga sobre ${Math.round(d.producao.kgHoraBase)} kg/h`}
              </div>
              <div className="mt-1.5 border-t border-accent/20 pt-1.5 text-[12.5px]">
                {carregandoCatalogo ? (
                  <span className="text-ink-faint">Carregando catálogo…</span>
                ) : d.moinho ? (
                  <>
                    <b className="text-ink">{d.moinho.modelo}</b>
                    <span className="text-ink-muted">
                      {' '}— {d.moinho.capacidade}
                      {d.moinho.motorCv ? ` · ${d.moinho.motorCv} CV` : ''}
                    </span>
                  </>
                ) : (
                  <span className="text-danger">Nenhum moinho do catálogo atende. Levar à engenharia.</span>
                )}
              </div>
            </div>
          )}

          {/* ── 3. formulação ──────────────────────────────────────────── */}
          {opcoesFormula.length > 0 && (
            <div>
              <div className="mb-1.5 text-[11.5px] font-semibold text-ink">Formulação de referência</div>
              <select
                value={formula?.chave ?? ''}
                onChange={e => setFormula(e.target.value)}
                className="h-9 w-full rounded-md border border-border bg-surface px-2 text-[12.5px] text-ink outline-none focus:border-accent"
              >
                {opcoesFormula.map(f => (
                  <option key={f.chave} value={f.chave}>{f.nome}</option>
                ))}
              </select>
              {formula && (
                <div className="mt-1 text-[11px] text-ink-faint">Fonte: {formula.fonte}</div>
              )}
              {formula?.nota && (
                <div className="mt-1 flex gap-1.5 text-[11.5px] text-warning">
                  <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                  <span>{formula.nota}</span>
                </div>
              )}
            </div>
          )}

          {/* ── 4. silos ───────────────────────────────────────────────── */}
          {d.materias.length > 0 && (
            <div>
              <div className="mb-1.5 flex items-center gap-1.5 text-[11.5px] font-semibold text-ink">
                <Warehouse className="h-3.5 w-3.5" />
                Recebimento e armazenagem
                <label className="ml-auto flex items-center gap-1 font-normal text-ink-faint">
                  guardar
                  <input type="number" min={1} max={365} value={diasEstoque}
                         onChange={e => setDiasEstoque(Math.max(1, Math.min(365, Number(e.target.value) || 1)))}
                         className="h-7 w-14 rounded border border-border bg-surface px-1.5 text-[12px] text-ink" />
                  dias
                </label>
              </div>
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
                            m.recebimento === r
                              ? 'border-accent bg-accent text-white'
                              : 'border-border bg-surface text-ink-faint hover:text-ink',
                          )}
                        >
                          {r === 'granel' ? 'a granel' : 'ensacado'}
                        </button>
                      ))}
                      {m.silo && (
                        <span className="text-[11.5px] text-ink-muted">
                          {m.quantidadeSilos > 1 ? `${m.quantidadeSilos}× ` : ''}
                          silo {m.silo.capacidade}
                          {m.silo.funilTipo ? ` · funil ${m.silo.funilTipo}°` : ''}
                        </span>
                      )}
                      {/* O catálogo tem degraus enormes: pra 45 t de milho o menor
                          que cabe sozinho é o de 196,5 t. A combinação fica ao lado
                          pra o vendedor escolher — a conta não decide por ele. */}
                      {m.alternativa && (
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

          {/* ── 5. ração pronta ────────────────────────────────────────── */}
          <div>
            <div className="mb-1.5 flex items-center gap-2 text-[11.5px] font-semibold text-ink">
              Ração pronta guardada
              <input type="number" min={0} step={500} value={kgRacaoPronta}
                     onChange={e => setKgPronta(Math.max(0, Number(e.target.value) || 0))}
                     className="h-7 w-24 rounded border border-border bg-surface px-1.5 text-[12px] text-ink" />
              <span className="font-normal text-ink-faint">kg</span>
            </div>
            <div className="text-[12.5px] text-ink-muted">
              {d.racaoPronta.item
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

          {/* ── 6. expedição ───────────────────────────────────────────── */}
          <div>
            <div className="mb-1.5 flex items-center gap-1.5 text-[11.5px] font-semibold text-ink">
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
                    'rounded-full border px-2.5 py-1 text-[12.5px] transition-colors',
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
              <div key={e} className="mt-1 text-[11.5px] text-ink-faint">
                {EXPEDICAO_INFO[e].rotulo}: {EXPEDICAO_INFO[e].precisa}
              </div>
            ))}
          </div>

          {/* ── o que impede de fechar ─────────────────────────────────── */}
          {d.pendencias.length > 0 && (
            <div className="rounded-md border-l-2 border-warning bg-warning/5 px-2.5 py-2">
              <div className="mb-1 text-[11px] font-bold uppercase tracking-wide text-warning">
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
