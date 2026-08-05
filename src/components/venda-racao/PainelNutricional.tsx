import { useMemo, useState } from 'react'
import type { Especie, FormulaCalculada, IngredienteFormula } from '@/lib/venda-racao/tipos'
import {
  analisarFormula, linhasComConteudo, resumo,
  type LinhaNutriente, type StatusNutriente,
} from '@/lib/nutricao/analise'
import type { AlertaSeguranca } from '@/lib/nutricao/seguranca'

/**
 * PAINEL NUTRICIONAL — o que esta fórmula entrega, em tempo real.
 *
 * Até aqui a etapa 5 mostrava só dinheiro: kg/t, R$/kg e custo por tonelada. Dava
 * pra montar uma ração de terminação com 9% de proteína e a tela aplaudia a
 * economia — porque economia é subtração de preço, e preço não sabe de proteína.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * AS DUAS DECISÕES DE DESENHO QUE IMPORTAM
 *
 * 1) CINZA NÃO É VERDE. Sem meta cadastrada (aves e bovinos hoje) ou sem
 *    composição de parte da fórmula, o nutriente sai CINZA com o motivo escrito
 *    — nunca verde. Verde sem base de comparação é pior que informação nenhuma:
 *    o vendedor lê como aprovado.
 *
 * 2) A COBERTURA ANDA JUNTO DO NÚMERO. "13,48% de PB" é uma frase incompleta
 *    quando 3% da fórmula não tem composição. O painel escreve o percentual
 *    analisado ao lado, sempre — não num rodapé que ninguém lê.
 *
 * Isto NÃO é um formulador: não rebalanceia nem sugere correção. Mostra o que
 * tem e o que falta. O rebalanceamento é a fase seguinte.
 */

const COR: Record<StatusNutriente, string> = {
  ok: 'ok', limite: 'lim', fora: 'fora', incompleto: 'inc', sem_meta: 'inc',
}

const NOME_GRUPO: Record<string, string> = {
  energia: 'Energia',
  proteina: 'Proteína e gordura',
  fibra: 'Fibra',
  mineral: 'Minerais',
  aminoacido: 'Aminoácidos (totais)',
}

function fmt(v: number | null, casas: number): string {
  if (v == null) return '—'
  return v.toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas })
}

/** "18,00 a 21,00", "mín. 0,600", "máx. 4,00" ou "—". */
function textoMeta(l: LinhaNutriente): string {
  if (!l.meta) return '—'
  const { min, max } = l.meta
  if (min != null && max != null) return `${fmt(min, l.casas)} a ${fmt(max, l.casas)}`
  if (min != null) return `mín. ${fmt(min, l.casas)}`
  if (max != null) return `máx. ${fmt(max, l.casas)}`
  return '—'
}

export function PainelNutricional({
  itens, especie, categoria, formula,
}: {
  itens: IngredienteFormula[]
  especie: Especie
  categoria: string
  /** Resultado do motor de custo — só pra mostrar o fechamento da soma. */
  formula: FormulaCalculada
}) {
  const [aberto, setAberto] = useState(true)
  const [detalhe, setDetalhe] = useState<string | null>(null)

  const a = useMemo(
    () => analisarFormula(itens, especie, categoria),
    [itens, especie, categoria],
  )
  const linhas = useMemo(() => linhasComConteudo(a), [a])
  const cont = useMemo(() => resumo(a), [a])

  // Milho triturado não é fórmula — é um produto só. Nada a analisar.
  if (especie === 'milho' || !a.aplicavel) return null

  const grupos = [...new Set(linhas.map(l => l.grupo))]
  const bloqueios = a.alertas.filter(x => x.nivel === 'bloqueio')
  const atencoes = a.alertas.filter(x => x.nivel === 'atencao')
  const lacunas = a.alertas.filter(x => x.nivel === 'lacuna')

  // §11: a divergência da soma aparece com precisão, nunca escondida por
  // arredondamento. O motor de custo tolera 0,5 kg/t pra dar o "fechada";
  // aqui o número exato fica visível de qualquer jeito.
  const dif = formula.diferencaKgPorTonelada

  return (
    <div className="vr-nutri">
      <button
        type="button" className="cab" onClick={() => setAberto(v => !v)}
        aria-expanded={aberto}
      >
        <span className="tt">Análise nutricional</span>
        <span className="pins">
          {cont.fora > 0 && <span className="pin fora">{cont.fora} fora</span>}
          {cont.limite > 0 && <span className="pin lim">{cont.limite} no limite</span>}
          {cont.ok > 0 && <span className="pin ok">{cont.ok} ok</span>}
          {cont.incompleto > 0 && <span className="pin inc">{cont.incompleto} sem conclusão</span>}
        </span>
        <span className="ch">{aberto ? '▲' : '▼'}</span>
      </button>

      {aberto && (
        <div className="corpo">
          {/* ── o que o sistema conseguiu enxergar ─────────────────────────── */}
          <div className="cobertura">
            <div className="barra" role="img"
              aria-label={`${a.coberturaGeralPct.toFixed(0)}% da fórmula com composição cadastrada`}>
              <span style={{ width: `${Math.min(100, a.coberturaGeralPct)}%` }} />
            </div>
            <p>
              <b>{a.coberturaGeralPct.toFixed(1)}%</b> da fórmula tem composição cadastrada
              {a.semComposicao.length > 0 && (
                <> · sem composição: <b>{a.semComposicao.join(', ')}</b></>
              )}
              {a.materiaSecaPct != null && a.coberturaMateriaSecaPct >= 99.99 && (
                <> · matéria seca <b>{fmt(a.materiaSecaPct, 1)}%</b></>
              )}
              {Math.abs(dif) > 0.005 && (
                <> · soma {dif > 0 ? 'falta' : 'passa'} <b>{fmt(Math.abs(dif), 2)} kg/t</b></>
              )}
            </p>
          </div>

          {/* ── bloqueios: o que não pode, e por quê ───────────────────────── */}
          {bloqueios.length > 0 && (
            <ul className="avisos bloq">
              {bloqueios.map((x, i) => <ItemAviso key={i} x={x} />)}
            </ul>
          )}

          {/* ── a tabela ───────────────────────────────────────────────────── */}
          {!a.exigencia && (
            <p className="semmeta">
              Não há exigência nutricional cadastrada para <b>{nomeEspecie(especie)}</b> nesta fase.
              Os valores abaixo são o que a fórmula ENTREGA — calculados normalmente — mas sem meta
              pra comparar. Por isso nenhum aparece em verde.
            </p>
          )}

          {grupos.map(g => (
            <div key={g} className="grupo">
              <h4>{NOME_GRUPO[g] ?? g}</h4>
              <table>
                <thead>
                  <tr>
                    <th>Nutriente</th><th className="n">Fórmula</th>
                    <th className="n">Meta</th><th className="st"><span className="sr">Status</span></th>
                  </tr>
                </thead>
                <tbody>
                  {linhas.filter(l => l.grupo === g).map(l => {
                    const parcial = l.valor != null && l.coberturaPct < 99.99
                    const temNota = !!l.observacao || l.faltando.length > 0
                    return (
                      <tr
                        key={l.chave}
                        className={detalhe === l.chave ? 'on' : ''}
                        onClick={() => temNota && setDetalhe(v => (v === l.chave ? null : l.chave))}
                        style={{ cursor: temNota ? 'pointer' : 'default' }}
                      >
                        <td>
                          {l.rotulo}
                          {temNota && <span className="q" aria-hidden>?</span>}
                          {detalhe === l.chave && (
                            <div className="nota">
                              {l.observacao && <p>{l.observacao}</p>}
                              {l.faltando.length > 0 && (
                                <p className="falt">
                                  Sem este dado: {l.faltando.join(', ')}.
                                </p>
                              )}
                            </div>
                          )}
                        </td>
                        <td className="n">
                          <b>{fmt(l.valor, l.casas)}</b>
                          {l.valor != null && <i>{l.unidade === '%' ? '%' : ' kcal/kg'}</i>}
                          {parcial && (
                            <em title={`Calculado sobre ${l.coberturaPct.toFixed(1)}% da fórmula`}>
                              {l.coberturaPct.toFixed(0)}%
                            </em>
                          )}
                        </td>
                        <td className="n meta">{textoMeta(l)}</td>
                        <td className="st"><span className={`dot ${COR[l.status]}`} /></td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          ))}

          {/* ── atenção e lacunas ──────────────────────────────────────────── */}
          {atencoes.length > 0 && (
            <ul className="avisos aten">{atencoes.map((x, i) => <ItemAviso key={i} x={x} />)}</ul>
          )}
          {lacunas.length > 0 && (
            <ul className="avisos lac">{lacunas.map((x, i) => <ItemAviso key={i} x={x} />)}</ul>
          )}

          <p className="rodape">
            {a.exigencia
              ? <>Metas: {a.exigencia.fonte}.{a.exigencia.nota ? ` ${a.exigencia.nota}` : ''} </>
              : null}
            Composição: Embrapa Suínos e Aves (BIPERS 12) e CQBAL/UFV. Esta análise é apoio técnico —
            não substitui formulação por profissional habilitado, que precisa considerar análise das
            matérias-primas, manejo e categoria animal.
          </p>
        </div>
      )}
    </div>
  )
}

function ItemAviso({ x }: { x: AlertaSeguranca }) {
  return (
    <li>
      <b>{x.titulo}</b>
      <p>{x.detalhe}</p>
      {x.fonte && <span className="fnt">{x.fonte}</span>}
    </li>
  )
}

function nomeEspecie(e: Especie): string {
  return e === 'bovinos' ? 'bovinos' : e === 'suinos' ? 'suínos' : e === 'aves' ? 'aves' : String(e)
}
