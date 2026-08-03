/**
 * Gráficos do estudo — SVG puro, sem biblioteca.
 *
 * Por que não recharts (que já existe no projeto): são três gráficos simples e
 * o módulo carrega lazy. Puxar a lib inteira pro chunk pra desenhar duas barras
 * e cinco retângulos não se paga, e o traço fica igual ao do estudo antigo, que
 * também desenha na mão.
 */
import { brl, brlKg, numero, pct as fpct } from '@/lib/venda-racao/formato'
import type {
  ComparacaoEconomia, CustoAtualCalculado, CustosProducaoCalculados, RetornoCalculado,
} from '@/lib/venda-racao/tipos'

const CORES = {
  atual: '#c0492f',
  ingredientes: '#2f8f4e',
  producao: '#5aa870',
  embalagem: '#8ec49f',
  fixos: '#c98a2b',
  economia: '#1f6d3a',
}

/** GRÁFICO 1 — comprar pronta × produzir, lado a lado, por kg. */
export function GraficoComparacao({
  atual, producao, comparacao,
}: {
  atual: CustoAtualCalculado
  producao: CustosProducaoCalculados
  comparacao: ComparacaoEconomia
}) {
  const maior = Math.max(atual.custoPorKg, producao.custoTotalPorKg, 0.0001)
  const larguraAtual = (atual.custoPorKg / maior) * 100
  const larguraPropria = (producao.custoTotalPorKg / maior) * 100

  if (maior <= 0.0001) {
    return (
      <div className="vr-grupos">
        <div className="gt">Comparação por kg</div>
        <div className="vr-hint">Informe o custo atual e a fórmula pra ver a comparação.</div>
      </div>
    )
  }

  return (
    <div className="vr-grupos" data-no-break>
      <div className="gt">Custo por kg — comprar × produzir</div>

      <div className="vr-vs">
        <div className="rot">Comprando pronta</div>
        <div className="trilha">
          <span style={{ width: `${larguraAtual}%`, background: CORES.atual }} />
        </div>
        <div className="val">{brlKg(atual.custoPorKg, 2)}</div>
      </div>

      <div className="vr-vs">
        <div className="rot">Produzindo na propriedade</div>
        <div className="trilha">
          <span style={{ width: `${larguraPropria}%`, background: CORES.economia }} />
        </div>
        <div className="val">{brlKg(producao.custoTotalPorKg, 2)}</div>
      </div>

      <div className="vr-hint" style={{ marginTop: 8 }}>
        {comparacao.vantajoso
          ? `Diferença de ${brlKg(comparacao.economiaPorKg, 4)} — ${fpct(comparacao.reducaoPct, 1)} mais barato.`
          : 'Com os dados atuais produzir sai igual ou mais caro que comprar.'}
      </div>
    </div>
  )
}

/** GRÁFICO 2 — de que é feito o custo de produzir. */
export function GraficoComposicao({ producao }: { producao: CustosProducaoCalculados }) {
  const fatias = [
    { chave: 'ingredientes' as const, rotulo: 'Ingredientes (com perda)', valor: producao.grupos.materiaPrima },
    { chave: 'producao' as const, rotulo: 'Operação', valor: producao.grupos.producao },
    { chave: 'embalagem' as const, rotulo: 'Embalagem', valor: producao.grupos.embalagem },
    { chave: 'fixos' as const, rotulo: 'Custos fixos rateados', valor: producao.grupos.fixos },
  ]
  const total = fatias.reduce((a, f) => a + f.valor, 0)

  if (total <= 0) {
    return (
      <div className="vr-grupos">
        <div className="gt">Composição do custo de produzir</div>
        <div className="vr-hint">Preencha a fórmula e os custos pra ver a composição.</div>
      </div>
    )
  }

  return (
    <div className="vr-grupos" data-no-break>
      <div className="gt">Composição do custo de produzir</div>
      <div className="vr-barra" role="img" aria-label="Composição do custo de produção por grupo">
        {fatias.filter(f => f.valor > 0).map(f => (
          <span
            key={f.chave}
            style={{ width: `${(f.valor / total) * 100}%`, background: CORES[f.chave] }}
            title={`${f.rotulo}: ${brlKg(f.valor)}`}
          />
        ))}
      </div>
      <div className="vr-legenda">
        {fatias.map(f => (
          <div className="li" key={f.chave}>
            <span className="dot" style={{ background: CORES[f.chave] }} />
            <span>{f.rotulo}</span>
            <span className="vl">{fpct((f.valor / total) * 100, 1)} · {brl(f.valor, 4)}</span>
          </div>
        ))}
        <div className="li" style={{ borderTop: '1px solid var(--vr-hair)', paddingTop: 6, marginTop: 2 }}>
          <span style={{ fontWeight: 700 }}>Custo total por kg</span>
          <span className="vl">{brl(producao.custoTotalPorKg, 4)}</span>
        </div>
      </div>
    </div>
  )
}

/**
 * GRÁFICO 3 — economia acumulada descontando o investimento. Onde a barra vira
 * verde é o ponto em que a fábrica se pagou.
 */
export function GraficoAcumulado({ retorno }: { retorno: RetornoCalculado }) {
  const pontos = retorno.acumulado
  const valores = pontos.map(p => p.liquido)
  const maiorAbs = Math.max(...valores.map(Math.abs), 1)

  const A = 150, larguraBarra = 100 / Math.max(1, pontos.length)
  // Linha do zero no meio quando há valor negativo; no rodapé quando tudo positivo.
  const temNegativo = valores.some(v => v < 0)
  const zeroY = temNegativo ? A * 0.55 : A

  return (
    <div className="vr-chart" data-no-break>
      <h3>Resultado acumulado</h3>
      <p>Economia somada menos o investimento. Verde = a fábrica já se pagou.</p>
      <svg viewBox={`0 0 320 ${A + 30}`} role="img" aria-label="Resultado acumulado por ano">
        <line x1="0" y1={zeroY} x2="320" y2={zeroY} stroke="var(--vr-hair)" strokeWidth="1" />
        {pontos.map((p, i) => {
          const altura = (Math.abs(p.liquido) / maiorAbs) * (temNegativo ? A * 0.42 : A - 30)
          const h = Math.max(2, altura)
          const x = (i * larguraBarra + larguraBarra * 0.2) * 3.2
          const w = larguraBarra * 0.6 * 3.2
          const positivo = p.liquido >= 0
          return (
            <g key={p.ano}>
              <rect
                x={x} y={positivo ? zeroY - h : zeroY} width={w} height={h} rx="3"
                fill={positivo ? CORES.economia : CORES.atual}
              />
              <text
                x={x + w / 2} y={positivo ? zeroY - h - 5 : zeroY + h + 11}
                textAnchor="middle" fontSize="9" fill="var(--vr-ink60)"
              >
                {brl(p.liquido, 0)}
              </text>
              <text x={x + w / 2} y={A + 24} textAnchor="middle" fontSize="9.5" fill="var(--vr-ink40)">
                {p.ano} {p.ano === 1 ? 'ano' : 'anos'}
              </text>
            </g>
          )
        })}
      </svg>
      <div className="vr-hint">
        Investimento considerado: {brl(retorno.investimentoConsiderado)}
        {retorno.aplicavel ? ` · retorno em ${numero(retorno.paybackMeses, 1)} meses.` : '.'}
      </div>
    </div>
  )
}
