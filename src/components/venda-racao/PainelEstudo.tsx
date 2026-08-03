/**
 * Coluna direita do estudo — a visão do vendedor enquanto monta.
 *
 * O que o cliente vê é outra aba (ApresentacaoEstudo), alimentada só por
 * `dadosEstudo`. Aqui entram também os avisos de premissa não confirmada, que
 * são conversa interna e não vão pro material do cliente.
 */
import { AlertTriangle, TrendingDown, TrendingUp } from 'lucide-react'
import { anos, brl, brlKg, kg, kgHora, meses, numero, pct, toneladas } from '@/lib/venda-racao/formato'
import type { EstudoInput, ResultadoEstudo } from '@/lib/venda-racao/tipos'
import { GraficoAcumulado, GraficoComparacao, GraficoComposicao } from './Graficos'

interface Props {
  input: EstudoInput
  resultado: ResultadoEstudo
}

export function PainelEstudo({ input, resultado }: Props) {
  const { demanda, atual, producao, comparacao, dimensionamento, retorno, cenarios, problemas } = resultado
  const bloqueios = problemas.filter(p => p.nivel === 'bloqueio')
  const avisos = problemas.filter(p => p.nivel === 'aviso')
  const sug = dimensionamento.sugerido

  return (
    <div>
      {bloqueios.length > 0 && (
        <div className="vr-erro" style={{ marginTop: 0, marginBottom: 14 }}>
          <strong>Falta ajustar antes de concluir o estudo:</strong>
          <ul>{bloqueios.map((p, i) => <li key={`${p.campo}-${i}`}>{p.mensagem}</li>)}</ul>
        </div>
      )}

      {/* ------------------------------------------------------------ herói */}
      {comparacao.vantajoso ? (
        <div className="vr-hero">
          <div className="lab">Economia estimada por mês</div>
          <div className="big">{brl(comparacao.economiaMensal)}</div>
          <div className="sub">
            {brl(comparacao.economiaAnual)} por ano · {brlKg(comparacao.economiaPorKg, 2)} ·{' '}
            {pct(comparacao.reducaoPct, 1)} de redução
          </div>
        </div>
      ) : (
        <div className="vr-hero alerta">
          <div className="lab">Sem economia com os dados atuais</div>
          <div className="big">{brl(comparacao.economiaMensal)}</div>
          <div className="sub">
            Com os dados atuais, a produção própria não apresenta economia.
            Revise os preços, a fórmula e os custos operacionais.
          </div>
        </div>
      )}

      <div className="vr-kpirow">
        <div className="vr-kpi">
          <div className="lab">Economia por kg</div>
          <div className={`v ${comparacao.economiaPorKg >= 0 ? 'pos' : 'neg'}`}>
            {brl(comparacao.economiaPorKg, 4)}
          </div>
          <div className="s">{brl(comparacao.economiaPorTonelada)} por tonelada</div>
        </div>
        <div className="vr-kpi">
          <div className="lab">Redução do custo</div>
          <div className={`v ${comparacao.reducaoPct >= 0 ? 'pos' : 'neg'}`}>{pct(comparacao.reducaoPct, 1)}</div>
          <div className="s">de {brl(atual.custoPorKg, 2)} para {brl(producao.custoTotalPorKg, 2)} por kg</div>
        </div>
        <div className="vr-kpi">
          <div className="lab">Retorno do investimento</div>
          <div className="v">{retorno.aplicavel ? meses(retorno.paybackMeses, 1) : '—'}</div>
          <div className="s">
            {retorno.investimentoConsiderado > 0
              ? `${brl(retorno.investimentoConsiderado)} investidos`
              : 'informe o investimento na etapa 7'}
          </div>
        </div>
      </div>

      {/* ------------------------------------------- comparação lado a lado */}
      <div className="vr-lado" data-no-break>
        <div className="col atual">
          <div className="ct">Cenário atual — compra de ração</div>
          <div className="cm">{brl(atual.custoPorKg, 2)}<span>/kg</span></div>
          <dl>
            <div><dt>Por tonelada</dt><dd>{brl(atual.custoPorTonelada)}</dd></div>
            <div><dt>Por mês</dt><dd>{brl(atual.custoMensal)}</dd></div>
            <div><dt>Por ano</dt><dd>{brl(atual.custoAnual)}</dd></div>
          </dl>
        </div>
        <div className="col propria">
          <div className="ct">Cenário projetado — produção própria</div>
          <div className="cm">{brl(producao.custoTotalPorKg, 2)}<span>/kg</span></div>
          <dl>
            <div><dt>Ingredientes</dt><dd>{brl(producao.grupos.materiaPrima, 4)}/kg</dd></div>
            <div><dt>Custos operacionais</dt><dd>{brl(producao.operacionaisPorKg, 4)}/kg</dd></div>
            <div><dt>Por tonelada</dt><dd>{brl(producao.custoPorTonelada)}</dd></div>
            <div><dt>Por mês</dt><dd>{brl(producao.custoMensal)}</dd></div>
            <div><dt>Por ano</dt><dd>{brl(producao.custoAnual)}</dd></div>
          </dl>
        </div>
      </div>

      <div className="vr-resultado" data-no-break>
        <div className="rt">
          {comparacao.vantajoso
            ? <TrendingDown className="h-4 w-4" style={{ color: 'var(--vr-green)' }} />
            : <TrendingUp className="h-4 w-4" style={{ color: 'var(--vr-red)' }} />}
          Resultado
        </div>
        <div className="vr-metrics">
          <div className="vr-mt"><div className="l">Por kg</div><div className={`val ${comparacao.vantajoso ? 'pos' : 'neg'}`}>{brl(comparacao.economiaPorKg, 4)}</div></div>
          <div className="vr-mt"><div className="l">Por tonelada</div><div className={`val ${comparacao.vantajoso ? 'pos' : 'neg'}`}>{brl(comparacao.economiaPorTonelada)}</div></div>
          <div className="vr-mt"><div className="l">Por mês</div><div className={`val ${comparacao.vantajoso ? 'pos' : 'neg'}`}>{brl(comparacao.economiaMensal)}</div></div>
          <div className="vr-mt"><div className="l">Por ano</div><div className={`val ${comparacao.vantajoso ? 'pos' : 'neg'}`}>{brl(comparacao.economiaAnual)}</div></div>
          <div className="vr-mt"><div className="l">Redução</div><div className={`val ${comparacao.vantajoso ? 'pos' : 'neg'}`}>{pct(comparacao.reducaoPct, 1)}</div></div>
          {comparacao.economiaPorAnimalMes !== 0 && (
            <div className="vr-mt">
              <div className="l">Por animal / mês</div>
              <div className={`val ${comparacao.vantajoso ? 'pos' : 'neg'}`}>{brl(comparacao.economiaPorAnimalMes)}</div>
            </div>
          )}
        </div>
      </div>

      <div className="vr-charts">
        <GraficoComparacao atual={atual} producao={producao} comparacao={comparacao} />
        <GraficoComposicao producao={producao} />
      </div>

      {/* -------------------------------------------------- dimensionamento */}
      <div className="vr-grupos" data-no-break>
        <div className="gt">Capacidade de produção necessária</div>
        {dimensionamento.aplicavel ? (
          <>
            <div className="vr-metrics">
              <div className="vr-mt"><div className="l">Demanda mensal</div><div className="val">{toneladas(demanda.toneladasMes)}</div></div>
              <div className="vr-mt"><div className="l">Por dia de trabalho</div><div className="val">{kg(dimensionamento.producaoPorDiaKg)}</div></div>
              <div className="vr-mt"><div className="l">Capacidade mínima</div><div className="val">{kgHora(dimensionamento.capacidadeMinimaKgHora)}</div></div>
              <div className="vr-mt"><div className="l">Capacidade recomendada</div><div className="val">{kgHora(dimensionamento.capacidadeRecomendadaKgHora)}</div></div>
              {dimensionamento.kgPorLote > 0 && (
                <div className="vr-mt"><div className="l">Por lote</div><div className="val">{kg(dimensionamento.kgPorLote)}</div></div>
              )}
              {sug && (
                <>
                  <div className="vr-mt"><div className="l">Horas estimadas / dia</div><div className="val">{numero(sug.horasPorDia, 1)} h</div></div>
                  <div className="vr-mt">
                    <div className="l">Utilização da fábrica</div>
                    <div className={`val ${sug.utilizacaoPct > 90 ? 'neg' : ''}`}>{pct(sug.utilizacaoPct, 0)}</div>
                  </div>
                </>
              )}
            </div>

            {sug && (
              <div className="vr-sugestao">
                <div className="st">Capacidade sugerida para análise comercial</div>
                <div className="sv">aproximadamente {kgHora(sug.capacidade)}</div>
                <div className="sd">
                  {dimensionamento.rotinaSugerida}
                  {sug.utilizacaoPct > 90 && ' A fábrica ficaria perto do limite do tempo disponível — considere a capacidade seguinte.'}
                </div>
                {sug.acimaDaLinha && (
                  <div className="vr-alerta" style={{ marginTop: 8 }}>
                    A necessidade passa da maior capacidade da linha. Trate como projeto especial
                    (mais de uma linha ou equipamento sob medida) com a engenharia.
                  </div>
                )}
                <div className="vr-hint" style={{ marginTop: 8 }}>
                  Sugestão de porte para análise — o modelo final depende do tipo de ração, do
                  processo e da validação do vendedor com a engenharia.
                </div>
              </div>
            )}
          </>
        ) : (
          <div className="vr-hint">
            Informe dias por mês e horas por dia na etapa 6 para calcular a capacidade necessária.
          </div>
        )}
      </div>

      {/* ---------------------------------------------- investimento/retorno */}
      <div className="vr-grupos" data-no-break>
        <div className="gt">Investimento e retorno</div>
        {retorno.investimentoConsiderado > 0 ? (
          <>
            <div className="vr-metrics">
              <div className="vr-mt"><div className="l">Investimento total</div><div className="val">{brl(retorno.investimentoTotal)}</div></div>
              {retorno.custoFinanceiro > 0 && (
                <div className="vr-mt"><div className="l">Custo financeiro</div><div className="val">{brl(retorno.custoFinanceiro)}</div></div>
              )}
              <div className="vr-mt"><div className="l">Economia mensal</div><div className={`val ${comparacao.vantajoso ? 'pos' : 'neg'}`}>{brl(comparacao.economiaMensal)}</div></div>
              <div className="vr-mt"><div className="l">Economia anual</div><div className={`val ${comparacao.vantajoso ? 'pos' : 'neg'}`}>{brl(comparacao.economiaAnual)}</div></div>
              <div className="vr-mt"><div className="l">Retorno em meses</div><div className="val">{retorno.aplicavel ? numero(retorno.paybackMeses, 1) : '—'}</div></div>
              <div className="vr-mt"><div className="l">Retorno em anos</div><div className="val">{retorno.aplicavel ? anos(retorno.paybackAnos) : '—'}</div></div>
            </div>

            {!retorno.aplicavel && (
              <div className="vr-alerta">
                <AlertTriangle className="h-4 w-4" style={{ display: 'inline', verticalAlign: '-3px', marginRight: 6 }} />
                Sem economia projetada não existe prazo de retorno. O investimento não se paga com
                os números atuais.
              </div>
            )}

            <div className="vr-scroll" style={{ marginTop: 10 }}>
              <table className="vr-tabela">
                <thead>
                  <tr>
                    <th>Período</th>
                    <th style={{ textAlign: 'right' }}>Economia acumulada</th>
                    <th style={{ textAlign: 'right' }}>Descontando o investimento</th>
                  </tr>
                </thead>
                <tbody>
                  {retorno.acumulado.map(a => (
                    <tr key={a.ano}>
                      <td>{a.ano} {a.ano === 1 ? 'ano' : 'anos'}</td>
                      <td className="num">{brl(a.economia)}</td>
                      <td className="num" style={{ color: a.liquido >= 0 ? 'var(--vr-green-d)' : 'var(--vr-red)' }}>
                        {brl(a.liquido)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div style={{ marginTop: 12 }}>
              <GraficoAcumulado retorno={retorno} />
            </div>
          </>
        ) : (
          <div className="vr-hint">
            Informe o investimento estimado na etapa 7 para calcular o prazo de retorno.
          </div>
        )}
      </div>

      {/* ---------------------------------------------------------- cenários */}
      <div className="vr-scen">
        {cenarios.map(c => (
          <div key={c.chave} className={`vr-sc ${c.chave === 'conservador' ? 'cons' : c.chave === 'provavel' ? 'prov' : 'otim'}`}>
            <div className="st">{c.rotulo}</div>
            <div className="se">{brl(c.economiaMensal)}<span style={{ fontSize: '0.6em', fontWeight: 500 }}>/mês</span></div>
            <div className="sp">custo próprio {brl(c.custoProprioPorKg, 2)}/kg · comprada {brl(c.custoAtualPorKg, 2)}/kg</div>
            <div className="sp">
              economia {brl(c.economiaPorKg, 4)}/kg · {brl(c.economiaAnual)}/ano
            </div>
            <div className="sp">
              payback {c.paybackAplicavel ? meses(c.paybackMeses, 1) : '—'}
            </div>
          </div>
        ))}
      </div>
      <div className="vr-hint" style={{ marginTop: 6 }}>
        Conservador: ingredientes {pct(input.cenarios.conservador.ingredientesPct, 0)}, perda{' '}
        {pct(input.cenarios.conservador.perdaPct, 0)}, operacionais{' '}
        {pct(input.cenarios.conservador.operacionaisPct, 0)} e ração comprada{' '}
        {pct(input.cenarios.conservador.racaoCompradaPct, 0)}. Percentuais editáveis em Configurações.
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
          Valores por kg de ração. Necessidade considerada: {kg(demanda.mensalKg)} por mês.
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
