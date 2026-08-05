import { useMemo, useState } from 'react'
import type { Especie, IngredienteFormula } from '@/lib/venda-racao/tipos'
import {
  otimizar, prepararIngredientes, type Objetivo, type ResultadoOtimizacao,
} from '@/lib/nutricao/otimizador'
import { analisarFormula } from '@/lib/nutricao/analise'

/**
 * REBALANCEAR — acha a composição que atende a fase, e MOSTRA ANTES DE APLICAR.
 *
 * O §9 do pedido é explícito e está certo: nada muda na fórmula sem o vendedor
 * ver o que vai mudar. Um botão que reescreve a fórmula sozinho é um botão que
 * ninguém aperta duas vezes — na primeira o vendedor perde o trabalho dele e
 * desconfia da tela pra sempre.
 *
 * A prévia responde três perguntas, nesta ordem:
 *   1. O que entra, o que sai, o que sobe e o que desce
 *   2. O que isso faz com os nutrientes
 *   3. O que isso faz com o custo — por kg, por tonelada e por mês
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * O BOTÃO NÃO PROMETE O QUE NÃO PODE ENTREGAR
 *
 * Quando o solver não consegue atender alguma exigência, a prévia diz isso em
 * vermelho e o botão de aplicar muda de texto: "Aplicar mesmo assim". Aplicar
 * continua sendo possível — às vezes a fórmula incompleta é melhor que a atual
 * — mas ninguém aplica achando que ficou pronta.
 */

const OBJETIVOS: Array<{ v: Objetivo; rotulo: string; dica: string }> = [
  { v: 'menor_custo', rotulo: 'Menor custo', dica: 'A ração mais barata que atende a fase, respeitando os limites de cada ingrediente.' },
  { v: 'menor_mudanca', rotulo: 'Menor mudança', dica: 'Atende a fase mexendo o mínimo possível na fórmula que já está aí.' },
]

function fmt(v: number, casas = 2): string {
  return v.toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas })
}
const brl = (v: number, casas = 2) => `R$ ${fmt(v, casas)}`

/** Participação em % da fórmula, seja qual for a unidade digitada. */
function pctDe(i: IngredienteFormula): number {
  if (i.unidadeParticipacao === 'pct') return i.participacao
  if (i.unidadeParticipacao === 'kg_t') return i.participacao / 10
  return i.participacao / 10000
}

export function RebalancearFormula({
  itens, especie, categoria, demandaMensalKg, onAplicar, onFechar,
}: {
  itens: IngredienteFormula[]
  especie: Especie
  categoria: string
  /** Pra traduzir a economia por kg em economia por mês. 0 = ainda não informada. */
  demandaMensalKg: number
  onAplicar: (novos: Array<{ id: string; participacao: number }>) => void
  onFechar: () => void
}) {
  const [objetivo, setObjetivo] = useState<Objetivo>('menor_custo')

  const r: ResultadoOtimizacao = useMemo(
    () => otimizar(prepararIngredientes(itens, especie), especie, categoria, objetivo),
    [itens, especie, categoria, objetivo],
  )

  // Impacto nutricional: analisa as DUAS e compara. Reusa o mesmo motor do
  // painel, então não há chance de a prévia e o painel discordarem.
  const impacto = useMemo(() => {
    if (!r.itens.length) return []
    const antes = analisarFormula(itens, especie, categoria)
    const depois = analisarFormula(
      r.itens.map(i => ({
        id: i.id, nome: i.nome, participacao: i.participacao, unidadeParticipacao: 'pct' as const,
        preco: 0, unidadePreco: 'kg' as const, pesoSacoIngrediente: 60,
      })),
      especie, categoria,
    )
    return antes.linhas.map((a, k) => {
      const d = depois.linhas[k]
      return {
        rotulo: a.rotulo, unidade: a.unidade, casas: a.casas,
        antes: a.valor, depois: d?.valor ?? null,
        statusAntes: a.status, statusDepois: d?.status ?? 'incompleto',
      }
    }).filter(x => x.antes != null || x.depois != null)
  }, [itens, r.itens, especie, categoria])

  if (r.status === 'impossivel' || r.status === 'erro') {
    return (
      <div className="vr-rebal">
        <div className="cab">
          <b>Rebalancear a fórmula</b>
          <button type="button" onClick={onFechar} aria-label="Fechar">×</button>
        </div>
        <ul className="avisos bloq">
          {r.diagnostico.map((d, i) => <li key={i}><p>{d}</p></li>)}
        </ul>
      </div>
    )
  }

  const atuais = new Map(itens.map(i => [i.id, pctDe(i)]))
  const linhas = r.itens
    .map(i => ({ ...i, de: atuais.get(i.id) ?? 0 }))
    .map(i => ({ ...i, delta: i.participacao - i.de }))
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
  const mexeu = linhas.filter(l => Math.abs(l.delta) >= 0.005)

  const porTonelada = r.deltaCustoPorKg * 1000
  const porMes = r.deltaCustoPorKg * demandaMensalKg

  return (
    <div className="vr-rebal">
      <div className="cab">
        <b>Rebalancear a fórmula</b>
        <button type="button" onClick={onFechar} aria-label="Fechar rebalanceamento">×</button>
      </div>

      <div className="obj">
        {OBJETIVOS.map(o => (
          <button
            key={o.v} type="button" title={o.dica}
            className={objetivo === o.v ? 'on' : ''}
            onClick={() => setObjetivo(o.v)}
          >{o.rotulo}</button>
        ))}
      </div>

      {/* ── o que não fechou ────────────────────────────────────────────── */}
      {r.naoAtendidas.length > 0 && (
        <ul className="avisos bloq">
          {r.naoAtendidas.map(x => (
            <li key={x.chave}>
              <b>
                {x.rotulo}: {x.tipo === 'min' ? 'falta' : 'excede'}{' '}
                {fmt(x.diferenca, x.unidade === '%' ? 3 : 0)}{x.unidade === '%' ? '%' : ' kcal/kg'}
              </b>
              <p>
                {x.tipo === 'min' ? 'Mínimo' : 'Máximo'} de {fmt(x.alvo, x.unidade === '%' ? 3 : 0)}
                {x.unidade === '%' ? '%' : ' kcal/kg'}; o melhor que dá com estes ingredientes é{' '}
                {fmt(x.obtido, x.unidade === '%' ? 3 : 0)}{x.unidade === '%' ? '%' : ' kcal/kg'}.
                {x.poderiaResolver.length > 0 && (
                  <> Resolveria acrescentar: <b>{x.poderiaResolver.join(', ')}</b>.</>
                )}
              </p>
            </li>
          ))}
        </ul>
      )}

      {r.travados.length > 0 && (
        <p className="trav">
          Não mexi em: {r.travados.map(t => `${t.nome} (${t.motivo})`).join(' · ')}
        </p>
      )}

      {/* ── fórmula anterior × nova ─────────────────────────────────────── */}
      <h4>O que muda na fórmula</h4>
      {mexeu.length === 0 ? (
        <p className="obs">A fórmula que já está aí é a melhor possível com estes limites — nada a mudar.</p>
      ) : (
        <table className="dif">
          <thead>
            <tr><th>Ingrediente</th><th className="n">Antes</th><th className="n">Depois</th><th className="n">Δ</th></tr>
          </thead>
          <tbody>
            {mexeu.map(l => (
              <tr key={l.id}>
                <td>{l.nome}</td>
                <td className="n">{fmt(l.de, 2)}%</td>
                <td className="n"><b>{fmt(l.participacao, 2)}%</b></td>
                <td className={`n d ${l.delta > 0 ? 'up' : 'down'}`}>
                  {l.delta > 0 ? '+' : ''}{fmt(l.delta, 2)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {/* ── impacto nutricional ─────────────────────────────────────────── */}
      <h4>Impacto nutricional</h4>
      <table className="dif">
        <thead>
          <tr><th>Nutriente</th><th className="n">Antes</th><th className="n">Depois</th><th className="st" /></tr>
        </thead>
        <tbody>
          {impacto.map(x => (
            <tr key={x.rotulo}>
              <td>{x.rotulo}</td>
              <td className="n">{x.antes == null ? '—' : fmt(x.antes, x.casas)}</td>
              <td className="n"><b>{x.depois == null ? '—' : fmt(x.depois, x.casas)}</b></td>
              <td className="st">
                <span className={`dot ${
                  x.statusDepois === 'ok' ? 'ok'
                    : x.statusDepois === 'limite' ? 'lim'
                    : x.statusDepois === 'fora' ? 'fora' : 'inc'}`}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* ── impacto financeiro ──────────────────────────────────────────── */}
      <h4>Impacto no custo</h4>
      <div className="fin">
        <div><span>Por kg</span><b className={r.deltaCustoPorKg <= 0 ? 'bom' : 'ruim'}>
          {r.deltaCustoPorKg > 0 ? '+' : ''}{brl(r.deltaCustoPorKg, 4)}
        </b></div>
        <div><span>Por tonelada</span><b className={porTonelada <= 0 ? 'bom' : 'ruim'}>
          {porTonelada > 0 ? '+' : ''}{brl(porTonelada)}
        </b></div>
        {demandaMensalKg > 0 && (
          <div><span>Por mês</span><b className={porMes <= 0 ? 'bom' : 'ruim'}>
            {porMes > 0 ? '+' : ''}{brl(porMes)}
          </b></div>
        )}
        <div><span>Novo custo</span><b>{brl(r.custoPorKg, 4)}/kg</b></div>
      </div>

      <div className="acao">
        <button type="button" className="cancelar" onClick={onFechar}>Cancelar</button>
        <button
          type="button"
          className={r.naoAtendidas.length ? 'ok ressalva' : 'ok'}
          disabled={mexeu.length === 0}
          onClick={() => onAplicar(r.itens.map(i => ({ id: i.id, participacao: i.participacao })))}
        >
          {r.naoAtendidas.length ? 'Aplicar mesmo assim' : 'Aplicar e rebalancear'}
        </button>
      </div>

      <p className="rodape">
        {r.diagnostico.join(' ')} Esta é uma ferramenta de apoio: a fórmula final tem que ser validada
        por profissional habilitado, considerando análise das matérias-primas, manejo e categoria animal.
      </p>
    </div>
  )
}
