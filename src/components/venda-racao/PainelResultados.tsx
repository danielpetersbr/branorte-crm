/**
 * Coluna direita da /venda-racao — a visão INTERNA do vendedor.
 *
 * Aqui pode tudo: custo, margem, comissão, imposto, preço mínimo e desconto
 * máximo. O que o cliente vê é outra aba (PropostaCliente), alimentada só pelo
 * `dadosProposta`, que não carrega nenhum desses números.
 */
import { AlertTriangle, TrendingDown, TrendingUp } from 'lucide-react'
import { brl, brlKg, kg, numero, pct, toneladas } from '@/lib/venda-racao/formato'
import type { ResultadoSimulacao, SimulacaoInput } from '@/lib/venda-racao/tipos'
import { CampoNumero } from './campos'
import { GraficoComposicao, GraficoPrecos, GraficoVolume } from './Graficos'

interface Props {
  input: SimulacaoInput
  resultado: ResultadoSimulacao
  onPrecoNegociado: (v: number | null) => void
}

export function PainelResultados({ input, resultado, onPrecoNegociado }: Props) {
  const { demanda, custos, precos, negociado, comparacao, cenarios, equilibrio, problemas } = resultado
  const bloqueios = problemas.filter(p => p.nivel === 'bloqueio')
  const avisos = problemas.filter(p => p.nivel === 'aviso')
  const abaixo = negociado.abaixoDoMinimo
  const semDesconto = precos.descontoMaximoReaisPorKg <= 0

  return (
    <div>
      {bloqueios.length > 0 && (
        <div className="vr-erro" style={{ marginTop: 0, marginBottom: 14 }}>
          <strong>Falta ajustar antes de fechar o preço:</strong>
          <ul>{bloqueios.map((p, i) => <li key={`${p.campo}-${i}`}>{p.mensagem}</li>)}</ul>
        </div>
      )}

      {/* ------------------------------------------------------------ herói */}
      <div className={`vr-hero${abaixo ? ' alerta' : ''}`}>
        <div className="lab">Preço sugerido de venda</div>
        <div className="big">{brl(negociado.precoPorKg, 2)}<span style={{ fontSize: '0.42em', opacity: 0.85 }}> /kg</span></div>
        <div className="sub">
          {brl(negociado.precoPorSaco)} por saco de {numero(input.quantidade.pesoSaco)} kg ·{' '}
          {brl(negociado.precoPorTonelada)} por tonelada
        </div>
      </div>

      <div className="vr-kpirow">
        <div className="vr-kpi">
          <div className="lab">Valor total do pedido</div>
          <div className="v">{brl(negociado.valorTotalPedido)}</div>
          <div className="s">{kg(demanda.quantidadeKg)} · {numero(Math.round(demanda.sacos))} sacos</div>
        </div>
        <div className="vr-kpi">
          <div className="lab">Margem real</div>
          <div className={`v ${negociado.margemRealPct >= input.venda.margemMinimaPct ? 'pos' : 'neg'}`}>
            {pct(negociado.margemRealPct, 1)}
          </div>
          <div className="s">
            mínima autorizada: {pct(input.venda.margemMinimaPct, 1)}
          </div>
        </div>
        <div className="vr-kpi">
          <div className="lab">Lucro do pedido</div>
          <div className={`v ${negociado.lucroTotalPedido >= 0 ? 'pos' : 'neg'}`}>
            {brl(negociado.lucroTotalPedido)}
          </div>
          <div className="s">{brl(negociado.lucroPorKg, 4)}/kg · {brl(negociado.lucroPorSaco)}/saco</div>
        </div>
      </div>

      <div className="vr-compare">
        <div className="a">
          <div className="t">Custo total</div>
          <div className="m">{brl(custos.custoBasePorKg, 2)}</div>
          <div className="s">por kg · {brl(custos.custoTotalPedido)} no pedido</div>
        </div>
        <div className="b">
          <div className="t">Preço de venda</div>
          <div className="m">{brl(negociado.precoPorKg, 2)}</div>
          <div className="s">por kg · {brl(negociado.valorTotalPedido)} no pedido</div>
        </div>
      </div>

      {/* -------------------------------------------------- desconto máximo */}
      <div className="vr-desconto" data-no-break>
        <div className="dt">Desconto máximo permitido</div>
        <div className="dv">{pct(Math.max(0, precos.descontoMaximoPct), 1)}</div>
        <div className="ds">
          {semDesconto
            ? 'A margem mínima está igual ou acima da desejada — não há folga pra desconto.'
            : <>Você pode conceder até {pct(precos.descontoMaximoPct, 1)} de desconto
                ({brl(precos.descontoMaximoReaisPorKg, 4)}/kg) sem ficar abaixo da margem mínima.</>}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginTop: 12 }}>
          <div>
            <div className="dt">Equilíbrio</div>
            <div style={{ fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>{brl(precos.precoEquilibrioPorKg, 2)}</div>
          </div>
          <div>
            <div className="dt">Mínimo</div>
            <div style={{ fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>{brl(precos.precoMinimoPorKg, 2)}</div>
          </div>
          <div>
            <div className="dt">Sugerido</div>
            <div style={{ fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>{brl(precos.precoSugeridoPorKg, 2)}</div>
          </div>
        </div>
      </div>

      {/* ------------------------------------------------- preço negociado */}
      <div className="vr-grupos" data-no-break>
        <div className="gt">Preço negociado com o cliente</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 10, alignItems: 'end' }}>
          <div className="vr-field">
            <div className="vr-label"><span>R$ por kg</span><span className="u">recalcula na hora</span></div>
            <CampoNumero
              valor={negociado.precoPorKg}
              casas={4}
              aria-label="Preço negociado por kg"
              onChange={v => onPrecoNegociado(v)}
            />
          </div>
          <button
            type="button"
            className="vr-btn ghost"
            onClick={() => onPrecoNegociado(null)}
            title="Voltar ao preço sugerido"
          >
            Usar sugerido
          </button>
        </div>

        {abaixo && (
          <div className="vr-erro">
            <AlertTriangle className="h-4 w-4" style={{ display: 'inline', verticalAlign: '-3px', marginRight: 6 }} />
            Esta negociação está abaixo da margem mínima autorizada
            ({pct(input.venda.margemMinimaPct, 1)}). Preço mínimo: {brl(precos.precoMinimoPorKg, 2)}/kg.
          </div>
        )}
        {!abaixo && negociado.descontoAplicadoPct > 0.01 && (
          <div className="vr-nota">
            Desconto aplicado: {pct(negociado.descontoAplicadoPct, 1)} — ainda dentro da margem mínima.
          </div>
        )}

        <div className="vr-metrics" style={{ marginTop: 12 }}>
          <div className="vr-mt"><div className="l">Impostos</div><div className="val">{brl(negociado.impostosTotalPedido)}</div></div>
          <div className="vr-mt"><div className="l">Comissão</div><div className="val">{brl(negociado.comissaoTotalPedido)}</div></div>
          <div className="vr-mt"><div className="l">Lucro por tonelada</div><div className="val">{brl(negociado.lucroPorTonelada)}</div></div>
        </div>
      </div>

      {/* --------------------------------------------------------- métricas */}
      <div className="vr-metrics">
        <div className="vr-mt"><div className="l">Preço / saco</div><div className="val">{brl(negociado.precoPorSaco)}</div></div>
        <div className="vr-mt"><div className="l">Preço / tonelada</div><div className="val">{brl(negociado.precoPorTonelada)}</div></div>
        <div className="vr-mt"><div className="l">Custo / saco</div><div className="val">{brl(custos.custoPorSaco)}</div></div>
        <div className="vr-mt"><div className="l">Quantidade mensal</div><div className="val">{kg(demanda.quantidadeMensalKg)}</div></div>
        <div className="vr-mt"><div className="l">Sacos / mês</div><div className="val">{numero(Math.round(demanda.sacosMes))}</div></div>
        <div className="vr-mt"><div className="l">Toneladas / mês</div><div className="val">{toneladas(demanda.toneladasMes)}</div></div>
        <div className="vr-mt">
          <div className="l">Receita mensal</div>
          <div className="val">{brl(negociado.receitaMensal)}</div>
        </div>
        <div className="vr-mt">
          <div className="l">Lucro mensal</div>
          <div className={`val ${negociado.lucroMensal >= 0 ? 'pos' : 'neg'}`}>{brl(negociado.lucroMensal)}</div>
        </div>
        <div className="vr-mt">
          <div className="l">Lucro / saco</div>
          <div className={`val ${negociado.lucroPorSaco >= 0 ? 'pos' : 'neg'}`}>{brl(negociado.lucroPorSaco)}</div>
        </div>
      </div>

      {/* ---------------------------------------------- custo por grupo */}
      <GraficoComposicao custos={custos} negociado={negociado} />

      <div className="vr-grupos" data-no-break>
        <div className="gt">Custo aberto por grupo</div>
        <div className="vr-legenda">
          <div className="li"><span>Matéria-prima (com perda)</span><span className="vl">{brl(custos.grupos.materiaPrima, 4)}</span></div>
          <div className="li"><span>Produção</span><span className="vl">{brl(custos.grupos.producao, 4)}</span></div>
          <div className="li"><span>Embalagem</span><span className="vl">{brl(custos.grupos.embalagem, 4)}</span></div>
          <div className="li"><span>Logística</span><span className="vl">{brl(custos.grupos.logistica, 4)}</span></div>
          <div className="li"><span>Custos fixos rateados</span><span className="vl">{brl(custos.grupos.fixos, 4)}</span></div>
          <div className="li" style={{ borderTop: '1px solid var(--vr-hair)', paddingTop: 6, marginTop: 2 }}>
            <span style={{ fontWeight: 700 }}>Custo total por kg</span>
            <span className="vl">{brl(custos.custoBasePorKg, 4)}</span>
          </div>
        </div>
        <div className="vr-metrics" style={{ marginTop: 10 }}>
          <div className="vr-mt"><div className="l">Custo / saco</div><div className="val">{brl(custos.custoPorSaco)}</div></div>
          <div className="vr-mt"><div className="l">Custo / tonelada</div><div className="val">{brl(custos.custoPorTonelada)}</div></div>
          <div className="vr-mt"><div className="l">Custo do pedido</div><div className="val">{brl(custos.custoTotalPedido)}</div></div>
        </div>
      </div>

      {/* --------------------------------------------- comparação mercado */}
      {comparacao.informado && (
        <div className="vr-grupos" data-no-break>
          <div className="gt">Comparação com o que o cliente paga hoje</div>
          <div style={{ fontSize: 13, color: 'var(--vr-ink)', fontWeight: 600, display: 'flex', gap: 7, alignItems: 'flex-start' }}>
            {comparacao.maisBarato
              ? <TrendingDown className="h-4 w-4" style={{ color: 'var(--vr-green)', flex: 'none', marginTop: 2 }} />
              : <TrendingUp className="h-4 w-4" style={{ color: 'var(--vr-gold)', flex: 'none', marginTop: 2 }} />}
            <span>
              {comparacao.maisBarato
                ? <>Seu preço está {brl(Math.abs(comparacao.diferencaPorKg), 4)}/kg abaixo do valor informado pelo cliente.</>
                : <>Seu preço está {pct(Math.abs(comparacao.diferencaPct), 1)} acima do valor informado.
                    Destaque diferenciais de qualidade, atendimento, entrega ou formulação.</>}
            </span>
          </div>
          <div className="vr-metrics" style={{ marginTop: 10 }}>
            <div className="vr-mt"><div className="l">Por kg</div><div className={`val ${comparacao.maisBarato ? 'pos' : 'neg'}`}>{brl(comparacao.diferencaPorKg, 4)}</div></div>
            <div className="vr-mt"><div className="l">Por saco</div><div className={`val ${comparacao.maisBarato ? 'pos' : 'neg'}`}>{brl(comparacao.diferencaPorSaco)}</div></div>
            <div className="vr-mt"><div className="l">Diferença %</div><div className={`val ${comparacao.maisBarato ? 'pos' : 'neg'}`}>{pct(comparacao.diferencaPct, 1)}</div></div>
            <div className="vr-mt"><div className="l">Por mês</div><div className={`val ${comparacao.maisBarato ? 'pos' : 'neg'}`}>{brl(comparacao.diferencaMensal)}</div></div>
            <div className="vr-mt"><div className="l">Por ano</div><div className={`val ${comparacao.maisBarato ? 'pos' : 'neg'}`}>{brl(comparacao.diferencaAnual)}</div></div>
            <div className="vr-mt"><div className="l">Preço de hoje</div><div className="val">{brl(input.venda.precoAtualClientePorKg, 2)}</div></div>
          </div>
        </div>
      )}

      {/* ----------------------------------------------------- cenários */}
      <div className="vr-scen">
        {cenarios.map(c => (
          <div key={c.chave} className={`vr-sc ${c.chave === 'conservador' ? 'cons' : c.chave === 'provavel' ? 'prov' : 'otim'}`}>
            <div className="st">{c.rotulo}</div>
            <div className="se">{brl(c.precoPorKg, 2)}/kg</div>
            <div className="sp">
              custo {brl(c.custoBasePorKg, 2)}/kg · margem {pct(c.margemPct, 1)}
            </div>
            <div className="sp">
              lucro/mês {brl(c.lucroMensal)} · desconto {pct(Math.max(0, c.descontoDisponivelPct), 1)}
            </div>
          </div>
        ))}
      </div>
      <div className="vr-hint" style={{ marginTop: 6 }}>
        Conservador: matéria-prima {pct(input.cenarios.conservador.materiaPrimaPct, 0)} e frete{' '}
        {pct(input.cenarios.conservador.fretePct, 0)}, na margem mínima. Otimista: matéria-prima{' '}
        {pct(input.cenarios.otimista.materiaPrimaPct, 0)} e perda {pct(input.cenarios.otimista.perdaPct, 0)}.
        Percentuais editáveis em Configurações.
      </div>

      {/* --------------------------------------------- ponto de equilíbrio */}
      {equilibrio.aplicavel ? (
        <div className="vr-grupos" data-no-break>
          <div className="gt">Ponto de equilíbrio</div>
          <div style={{ fontSize: 13, color: 'var(--vr-ink)' }}>
            Com esta margem, é necessário vender <strong>{toneladas(equilibrio.toneladasPorMes)} por mês</strong>{' '}
            para cobrir os custos fixos informados.
          </div>
          <div className="vr-metrics" style={{ marginTop: 10 }}>
            <div className="vr-mt"><div className="l">kg / mês</div><div className="val">{numero(equilibrio.kgPorMes)}</div></div>
            <div className="vr-mt"><div className="l">Sacos / mês</div><div className="val">{numero(Math.ceil(equilibrio.sacosPorMes))}</div></div>
            <div className="vr-mt"><div className="l">Toneladas / mês</div><div className="val">{numero(equilibrio.toneladasPorMes, 1)}</div></div>
            <div className="vr-mt">
              <div className="l">Clientes desse porte</div>
              <div className="val">{equilibrio.clientesDesseTamanho || '—'}</div>
            </div>
            <div className="vr-mt">
              <div className="l">Margem de contribuição</div>
              <div className="val">{brl(equilibrio.margemContribuicaoPorKg, 4)}</div>
            </div>
            <div className="vr-mt">
              <div className="l">Custos fixos</div>
              <div className="val">{brl(input.custos.custosFixosMensais)}</div>
            </div>
          </div>
        </div>
      ) : input.custos.custosFixosMensais > 0 ? (
        <div className="vr-alerta">
          Com este preço a margem de contribuição é zero ou negativa — não existe volume que cubra
          os custos fixos. Reveja preço ou custo variável.
        </div>
      ) : null}

      {/* --------------------------------------------------------- gráficos
          Os dois vão dentro de .vr-charts: lado a lado quando o painel é largo,
          empilhados quando não é. Só embrulho — os gráficos não mudaram. */}
      <div className="vr-charts">
        <GraficoVolume lucroPorKg={negociado.lucroPorKg} toneladasAtual={demanda.toneladas} />
        <GraficoPrecos
          precos={precos}
          negociado={negociado}
          precoAtualCliente={input.venda.precoAtualClientePorKg}
        />
      </div>

      {/* ------------------------------------------------ memória de cálculo */}
      <details className="vr-memo">
        <summary>Como chegamos a esse número (memória de cálculo)</summary>
        <table>
          <tbody>
            {resultado.memoria.map((l, i) => (
              <tr key={`${l.rotulo}-${i}`} className={l.destaque ? 'sum' : ''}>
                <td>{l.rotulo}{l.nota ? <div className="vr-hint">{l.nota}</div> : null}</td>
                <td>{brl(l.valor, 4)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="vr-hint" style={{ padding: '8px 16px 12px' }}>
          Valores por kg de ração. Total do pedido: {brl(negociado.valorTotalPedido)} em{' '}
          {kg(demanda.quantidadeKg)}.
        </div>
      </details>

      {avisos.length > 0 && (
        <div className="vr-alerta">
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {avisos.map((p, i) => <li key={`${p.campo}-${i}`}>{p.mensagem}</li>)}
          </ul>
        </div>
      )}
    </div>
  )
}
