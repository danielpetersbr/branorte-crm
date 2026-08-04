import { useMemo, useState } from 'react'
import type { Especie, IngredienteFormula } from '@/lib/venda-racao/tipos'
import {
  maximoSubstituivel, substitutosDe, textoLimite, type Substituto,
} from '@/lib/substituicoes-racao'

/**
 * "O cliente não tem milho — o que entra no lugar?"
 *
 * Abre a partir do próprio card do ingrediente. Não é formulador: mostra o que a
 * literatura permite pôr no lugar, ATÉ QUANTO, e o que pode dar errado. O ajuste
 * de proteína/energia continua sendo do zootecnista.
 *
 * A troca pode ser PARCIAL — é o caso normal. Ninguém tira 69,8% de milho e põe
 * 69,8% de DDG; põe um pedaço e mantém o resto. Por isso o resultado pode ser
 * DOIS ingredientes, e a soma da fórmula não se mexe.
 */
export function SubstituirIngrediente({
  item, especie, onAplicar, onFechar,
}: {
  item: IngredienteFormula
  especie: Especie
  /** Troca `pct` pontos do item pelo substituto. pct >= participação = troca tudo. */
  onAplicar: (s: Substituto, pct: number) => void
  onFechar: () => void
}) {
  const opcoes = useMemo(() => substitutosDe(item.nome, especie), [item.nome, especie])
  const [aberto, setAberto] = useState<string | null>(opcoes.length === 1 ? opcoes[0].nome : null)
  const [pct, setPct] = useState<Record<string, number>>({})

  if (!opcoes.length) return null
  const atual = item.unidadeParticipacao === 'pct' ? item.participacao : item.participacao / 10

  return (
    <div className="vr-subst">
      <div className="cab">
        <b>No lugar de {item.nome || 'este ingrediente'}</b>
        <button type="button" onClick={onFechar} aria-label="Fechar substituições">×</button>
      </div>

      {item.unidadeParticipacao !== 'pct' && (
        <p className="obs">
          Este ingrediente está em kg/t. Os limites abaixo são em % — {atual.toFixed(1)}% equivalem
          aos {item.participacao} kg/t de hoje.
        </p>
      )}

      <ul>
        {opcoes.map(s => {
          const max = maximoSubstituivel(s, atual)
          const escolhido = pct[s.nome] ?? (max ?? Math.min(atual, s.limite.max))
          const estaAberto = aberto === s.nome
          return (
            <li key={s.nome}>
              <button type="button" className="tit" onClick={() => setAberto(estaAberto ? null : s.nome)}>
                <span className="nm">{s.nome}</span>
                <span className="lim">{textoLimite(s)}</span>
                <span className="ch">{estaAberto ? '▲' : '▼'}</span>
              </button>

              {estaAberto && (
                <div className="corpo">
                  <p className="ganho">{s.ganho}</p>
                  {s.risco && <p className="risco"><b>Risco:</b> {s.risco}</p>}

                  {s.equivalencia != null && (
                    <p className="obs">
                      Vale <b>{Math.round(s.equivalencia * 100)}%</b> da energia do que sai. Trocar quilo por
                      quilo derruba a energia da fórmula na mesma proporção — e o preço só compensa se
                      acompanhar essa conta.
                    </p>
                  )}

                  {max == null ? (
                    <p className="obs alerta">
                      O teto deste ingrediente é sobre a <b>dieta total em matéria seca</b>, e esta tela monta
                      só o concentrado — ela não sabe quanto de volumoso o animal come. Não dá pra converter
                      em % da fórmula sem inventar. Use o número como aviso e confirme com o zootecnista.
                    </p>
                  ) : max < atual ? (
                    <p className="obs alerta">
                      Há {atual.toFixed(1)}% de {item.nome} na fórmula, mas este substituto vai até{' '}
                      <b>{s.limite.max}%</b>. Dá pra trocar <b>uma parte</b>; o resto continua como está.
                    </p>
                  ) : null}

                  <div className="acao">
                    <label>
                      Trocar
                      <input
                        type="number" min={0} max={atual} step={0.1}
                        value={Number.isFinite(escolhido) ? Number(escolhido.toFixed(2)) : 0}
                        onChange={e => setPct(p => ({
                          ...p,
                          [s.nome]: Math.max(0, Math.min(atual, Number(e.target.value) || 0)),
                        }))}
                        aria-label={`Pontos percentuais a trocar por ${s.nome}`}
                      />
                      <span>de {atual.toFixed(1)}%</span>
                    </label>
                    <button
                      type="button" className="ok"
                      disabled={!(escolhido > 0)}
                      onClick={() => onAplicar(s, escolhido)}
                    >
                      {escolhido >= atual ? 'Trocar tudo' : 'Trocar parte'}
                    </button>
                  </div>

                  <p className="fonte">{s.fonte}</p>
                </div>
              )}
            </li>
          )
        })}
      </ul>

      <p className="rodape">
        Limite e ressalva vêm da literatura citada em cada opção. Nada aqui balanceia proteína, energia,
        aminoácido ou mineral — a formulação continua sendo do profissional habilitado.
      </p>
    </div>
  )
}
