/**
 * Gráficos da /venda-racao — SVG puro, sem biblioteca.
 *
 * Por que não recharts (que já existe no projeto): são três gráficos simples e
 * o módulo carrega lazy. Puxar a lib inteira pro chunk pra desenhar uma barra
 * empilhada e cinco retângulos não se paga, e o traço fica igual ao do estudo
 * de viabilidade, que também desenha na mão.
 */
import { brl, brlKg, numero, pct as fpct, toneladas } from '@/lib/venda-racao/formato'
import { lucroPorVolume } from '@/lib/venda-racao/calculo'
import type { CustosCalculados, PrecosCalculados, ResultadoNegociado } from '@/lib/venda-racao/tipos'

const CORES = {
  ingredientes: '#2f8f4e',
  producao: '#5aa870',
  embalagem: '#8ec49f',
  logistica: '#c98a2b',
  impostos: '#b06a5a',
  comissao: '#d09a8c',
  margem: '#1f6d3a',
}

interface FatiaCusto { chave: keyof typeof CORES; rotulo: string; valor: number }

/** GRÁFICO 1 — quanto cada grupo pesa dentro do preço de venda. */
export function GraficoComposicao({
  custos, negociado,
}: { custos: CustosCalculados; negociado: ResultadoNegociado }) {
  const fatias: FatiaCusto[] = [
    { chave: 'ingredientes', rotulo: 'Ingredientes', valor: custos.grupos.materiaPrima },
    { chave: 'producao', rotulo: 'Produção', valor: custos.grupos.producao + custos.grupos.fixos },
    { chave: 'embalagem', rotulo: 'Embalagem', valor: custos.grupos.embalagem },
    { chave: 'logistica', rotulo: 'Frete e carregamento', valor: custos.grupos.logistica },
    { chave: 'impostos', rotulo: 'Impostos', valor: negociado.impostosPorKg },
    { chave: 'comissao', rotulo: 'Comissão e taxas', valor: negociado.comissaoPorKg + negociado.taxasPorKg },
    { chave: 'margem', rotulo: 'Margem', valor: Math.max(0, negociado.lucroPorKg) },
  ]
  const total = fatias.reduce((a, f) => a + f.valor, 0)

  if (total <= 0) {
    return (
      <div className="vr-grupos">
        <div className="gt">Composição do custo</div>
        <div className="vr-hint">Preencha a fórmula e os custos pra ver a composição.</div>
      </div>
    )
  }

  return (
    <div className="vr-grupos" data-no-break>
      <div className="gt">Composição do preço de venda</div>
      <div className="vr-barra" role="img" aria-label="Composição do preço de venda por grupo">
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
      </div>
      {negociado.lucroPorKg < 0 && (
        <div className="vr-erro" style={{ marginTop: 10 }}>
          O preço negociado está abaixo do custo somado aos impostos: a venda dá prejuízo de{' '}
          {brl(Math.abs(negociado.lucroPorKg), 4)} por kg.
        </div>
      )}
    </div>
  )
}

/** GRÁFICO 2 — lucro estimado conforme o volume vendido. */
export function GraficoVolume({
  lucroPorKg, toneladasAtual,
}: { lucroPorKg: number; toneladasAtual: number }) {
  const base = [1, 5, 10, 20]
  const personalizado = toneladasAtual > 0 && !base.includes(Math.round(toneladasAtual))
    ? [Math.round(toneladasAtual * 100) / 100]
    : []
  const pontos = lucroPorVolume(lucroPorKg, [...base, ...personalizado])
  const maior = Math.max(...pontos.map(p => Math.abs(p.lucro)), 1)

  const L = 44, A = 150, larguraBarra = 100 / pontos.length

  return (
    <div className="vr-chart" data-no-break>
      <h3>Resultado por volume</h3>
      <p>Lucro estimado no preço negociado, conforme o volume vendido.</p>
      <svg viewBox={`0 0 320 ${A + 28}`} preserveAspectRatio="none" role="img" aria-label="Lucro por volume vendido">
        <line x1="0" y1={A} x2="320" y2={A} stroke="var(--vr-hair)" strokeWidth="1" />
        {pontos.map((p, i) => {
          const h = Math.max(2, (Math.abs(p.lucro) / maior) * (A - L))
          const x = (i * larguraBarra + larguraBarra * 0.18) * 3.2
          const w = larguraBarra * 0.64 * 3.2
          const ehAtual = personalizado.length > 0 && i === pontos.length - 1
          return (
            <g key={`${p.toneladas}-${i}`}>
              <rect
                x={x} y={A - h} width={w} height={h} rx="3"
                fill={p.lucro >= 0 ? (ehAtual ? '#1f6d3a' : '#2f8f4e') : '#c0492f'}
              />
              <text x={x + w / 2} y={A - h - 6} textAnchor="middle" fontSize="9" fill="var(--vr-ink60)">
                {brl(p.lucro, 0)}
              </text>
              <text x={x + w / 2} y={A + 16} textAnchor="middle" fontSize="9.5" fill="var(--vr-ink40)">
                {numero(p.toneladas, p.toneladas % 1 === 0 ? 0 : 1)} t{ehAtual ? ' ←' : ''}
              </text>
            </g>
          )
        })}
      </svg>
    </div>
  )
}

/** GRÁFICO 3 — onde cada preço cai na régua (equilíbrio → sugerido). */
export function GraficoPrecos({
  precos, negociado, precoAtualCliente,
}: { precos: PrecosCalculados; negociado: ResultadoNegociado; precoAtualCliente: number }) {
  const marcas = [
    { rotulo: 'Equilíbrio', valor: precos.precoEquilibrioPorKg, cor: '#8a988d' },
    { rotulo: 'Mínimo', valor: precos.precoMinimoPorKg, cor: '#c98a2b' },
    { rotulo: 'Sugerido', valor: precos.precoSugeridoPorKg, cor: '#2f8f4e' },
    { rotulo: 'Negociado', valor: negociado.precoPorKg, cor: '#1f6d3a' },
    ...(precoAtualCliente > 0
      ? [{ rotulo: 'Paga hoje', valor: precoAtualCliente, cor: '#c0492f' }]
      : []),
  ].filter(m => m.valor > 0)

  if (marcas.length === 0) {
    return (
      <div className="vr-chart">
        <h3>Preço e limites</h3>
        <p className="vr-hint">Sem preço calculado ainda.</p>
      </div>
    )
  }

  const min = Math.min(...marcas.map(m => m.valor)) * 0.92
  const max = Math.max(...marcas.map(m => m.valor)) * 1.08
  const faixa = max - min || 1
  const x = (v: number) => 12 + ((v - min) / faixa) * 296

  // Alterna a altura do rótulo pra não sobrepor quando dois preços ficam juntos.
  const ordenadas = [...marcas].sort((a, b) => a.valor - b.valor)
  const alturaDe = new Map<string, number>()
  let ultimoX = -999
  let nivel = 0
  for (const m of ordenadas) {
    const px = x(m.valor)
    nivel = px - ultimoX < 62 ? (nivel + 1) % 2 : 0
    alturaDe.set(m.rotulo, nivel)
    ultimoX = px
  }

  return (
    <div className="vr-chart" data-no-break>
      <h3>Preço e limites</h3>
      <p>Onde o preço negociado cai entre o equilíbrio e o sugerido.</p>
      <svg viewBox="0 0 320 96" role="img" aria-label="Régua de preços por kg">
        <rect x="12" y="40" width="296" height="7" rx="3.5" fill="var(--vr-hair)" />
        <rect
          x={x(precos.precoMinimoPorKg)} y="40"
          width={Math.max(0, x(precos.precoSugeridoPorKg) - x(precos.precoMinimoPorKg))}
          height="7" rx="3.5" fill="#b8ddc5"
        />
        {marcas.map(m => {
          const px = x(m.valor)
          const acima = alturaDe.get(m.rotulo) === 0
          return (
            <g key={m.rotulo}>
              <line x1={px} y1={acima ? 26 : 47} x2={px} y2={acima ? 47 : 62} stroke={m.cor} strokeWidth="1.5" />
              <circle cx={px} cy="43.5" r="4.5" fill={m.cor} />
              <text x={px} y={acima ? 20 : 74} textAnchor="middle" fontSize="8.5" fill="var(--vr-ink40)">
                {m.rotulo}
              </text>
              <text x={px} y={acima ? 11 : 84} textAnchor="middle" fontSize="9.5" fontWeight="700" fill={m.cor}>
                {brl(m.valor, 2)}
              </text>
            </g>
          )
        })}
      </svg>
    </div>
  )
}

/** Faixa de volume usada no rodapé do gráfico 2. */
export function resumoVolume(toneladasAtual: number): string {
  return toneladasAtual > 0 ? `Pedido atual: ${toneladas(toneladasAtual)}` : ''
}
