import { useMemo, useState } from 'react'
import type { Especie, IngredienteFormula } from '@/lib/venda-racao/tipos'
import { novoIdIngrediente } from '@/lib/venda-racao/catalogo'
import {
  alternativasPara, aplicarTroca, ROTULO_COMPAT,
  type Alternativa, type Compatibilidade,
} from '@/lib/nutricao/substituicao'
import { analisarFormula } from '@/lib/nutricao/analise'
import { otimizar, prepararIngredientes } from '@/lib/nutricao/otimizador'

/**
 * "O cliente não tem milho — o que entra no lugar?"
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * O QUE MUDOU (§1, §8, §9 do pedido)
 *
 * ANTES: lista curada de 1 a 3 opções, cada uma com nome e limite, e a troca era
 * ponto-a-ponto — tirava X% de A, punha X% de B, e não mexia em mais nada.
 *
 * AGORA:
 *   • as alternativas saem do BANCO NUTRICIONAL, ordenadas por mérito
 *     técnico-econômico, com classificação e motivo;
 *   • dá pra ver ANTES de aplicar o que a troca faz com cada nutriente e com o
 *     custo;
 *   • e "Aplicar e rebalancear" refaz a fórmula inteira com o solver — que é a
 *     resposta ao §10: pôr DDGS no lugar do milho não é trocar energia por
 *     energia, e quem ajusta o farelo de soja depois é o motor, não a cabeça do
 *     vendedor.
 *
 * "Aplicar sem rebalancear" continua existindo porque o §9 pede, e porque às
 * vezes o vendedor sabe algo que o modelo não sabe. Mas não é o padrão.
 */

const CLASSE: Record<Compatibilidade, string> = {
  excelente: 'exc', boa: 'boa', parcial: 'par', nao_recomendada: 'nao',
}

const fmt = (v: number, casas = 2) =>
  v.toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas })

/** Participação em % da fórmula, seja qual for a unidade digitada. */
function pctDe(i: IngredienteFormula): number {
  if (i.unidadeParticipacao === 'pct') return i.participacao
  if (i.unidadeParticipacao === 'kg_t') return i.participacao / 10
  return i.participacao / 10000
}

export function SubstituirIngrediente({
  item, itens, especie, categoria, onAplicar, onFechar,
}: {
  item: IngredienteFormula
  /** A fórmula inteira — necessária pra prévia e pro rebalanceamento. */
  itens: IngredienteFormula[]
  especie: Especie
  categoria: string
  onAplicar: (novos: IngredienteFormula[]) => void
  onFechar: () => void
}) {
  const atual = pctDe(item)
  const alternativas = useMemo(
    () => alternativasPara(item.nome, atual, especie),
    [item.nome, atual, especie],
  )
  /**
   * A MELHOR OPÇÃO JÁ ABRE.
   *
   * Enquanto eram 1 a 3 alternativas, só abria sozinha quando havia exatamente
   * uma — nos outros casos a lista era curta e o vendedor achava o caminho. Com
   * 16 opções o resultado foi uma parede de 16 linhas fechadas e NENHUM botão de
   * aplicar em lugar nenhum da tela: o Daniel abriu, olhou e perguntou se não
   * dava mais pra substituir. Dava — só não havia nada dizendo que era preciso
   * clicar na linha.
   *
   * Abrir a primeira resolve as duas coisas de uma vez: mostra a ação (o campo
   * "Trocar", a prévia, o botão) e ensina que as outras linhas abrem igual.
   */
  const [aberta, setAberta] = useState<string | null>(
    alternativas[0]?.ingrediente.id ?? null,
  )
  const [pontos, setPontos] = useState<Record<string, number>>({})

  if (!alternativas.length) return null

  const escolhida = alternativas.find(a => a.ingrediente.id === aberta) ?? null
  const quanto = escolhida
    ? pontos[escolhida.ingrediente.id] ?? (escolhida.maximoSubstituivel ?? atual)
    : 0

  return (
    <div className="vr-subst">
      <div className="cab">
        <b>No lugar de {item.nome || 'este ingrediente'}</b>
        <button type="button" onClick={onFechar} aria-label="Fechar substituições">×</button>
      </div>

      {item.unidadeParticipacao !== 'pct' && (
        <p className="obs">
          Este ingrediente está em {item.unidadeParticipacao === 'kg_t' ? 'kg/t' : 'g/t'}. Os limites
          abaixo são em % — {fmt(atual, 1)}% equivalem ao que há hoje.
        </p>
      )}

      <p className="ajuda">
        {alternativas.length} {alternativas.length === 1 ? 'opção' : 'opções'}, da mais compatível
        para a menos. Clique em qualquer uma para ver o que ela muda e aplicar.
      </p>

      <ul>
        {alternativas.map(a => (
          <Opcao
            key={a.ingrediente.id}
            a={a} atual={atual} aberta={aberta === a.ingrediente.id}
            onAbrir={() => setAberta(v => (v === a.ingrediente.id ? null : a.ingrediente.id))}
            quanto={pontos[a.ingrediente.id] ?? (a.maximoSubstituivel ?? atual)}
            onQuanto={v => setPontos(p => ({ ...p, [a.ingrediente.id]: v }))}
            item={item} itens={itens} especie={especie} categoria={categoria}
            onAplicar={onAplicar}
          />
        ))}
      </ul>

      <p className="rodape">
        Limite e ressalva vêm da literatura citada em cada opção. O rebalanceamento é feito por um
        motor de otimização, não por estimativa — mas a formulação final continua sendo do
        profissional habilitado.
      </p>
    </div>
  )
}

function Opcao({
  a, atual, aberta, onAbrir, quanto, onQuanto,
  item, itens, especie, categoria, onAplicar,
}: {
  a: Alternativa; atual: number; aberta: boolean; onAbrir: () => void
  quanto: number; onQuanto: (v: number) => void
  item: IngredienteFormula; itens: IngredienteFormula[]
  especie: Especie; categoria: string
  onAplicar: (novos: IngredienteFormula[]) => void
}) {
  const teto = a.maximoSubstituivel ?? atual
  return (
    <li>
      <button type="button" className="tit" onClick={onAbrir}>
        <span className="nm">{a.ingrediente.nome}</span>
        <span className={`compat ${CLASSE[a.compatibilidade]}`}>
          {ROTULO_COMPAT[a.compatibilidade]}
        </span>
        <span className="ch">{aberta ? '▲' : '▼'}</span>
      </button>

      {aberta && (
        <div className="corpo">
          {/* `ganho` (lista curada) e `funcao` (banco) dizem quase a mesma coisa
              pros ingredientes que estão nos dois — o sorgo aparecia com dois
              parágrafos quase idênticos. O curado é mais completo, então ganha. */}
          <p className="funcao">{a.ganho || a.ingrediente.funcao}</p>

          <div className="tags">
            {a.motivos.map(m => <span key={m}>{m}</span>)}
          </div>
          {a.risco && <p className="risco"><b>Risco:</b> {a.risco}</p>}
          {a.ingrediente.alerta && !a.risco && <p className="obs alerta">{a.ingrediente.alerta}</p>}

          {a.muda.length > 0 && (
            <>
              <p className="obs"><b>O que muda, quilo por quilo:</b></p>
              <table className="muda">
                <tbody>
                  {a.muda.map(m => (
                    <tr key={m.chave}>
                      <td>{m.rotulo}</td>
                      <td className="n">{fmt(m.de ?? 0, 2)}</td>
                      <td className="n seta">→</td>
                      <td className={`n ${m.sinal > 0 ? 'up' : 'down'}`}>{fmt(m.para ?? 0, 2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}

          {a.maximoSubstituivel == null ? (
            <p className="obs alerta">
              O teto deste ingrediente é sobre a <b>dieta total em matéria seca</b>, e esta tela monta
              só o concentrado — ela não sabe quanto de volumoso o animal come. Não dá pra converter em
              % da fórmula sem inventar. Use o número como aviso e confirme com o zootecnista.
            </p>
          ) : a.maximoSubstituivel < atual - 0.01 ? (
            <p className="obs alerta">
              Há {fmt(atual, 1)}% de {a.ingrediente.nome === '' ? 'ingrediente' : 'material'} na
              fórmula, mas este substituto vai até <b>{a.limite?.max}%</b>. Dá pra trocar{' '}
              <b>uma parte</b>; o resto continua como está.
            </p>
          ) : null}

          <div className="acao">
            <label>
              Trocar
              <input
                type="number" min={0} max={teto} step={0.1}
                value={Number.isFinite(quanto) ? Number(quanto.toFixed(2)) : 0}
                onChange={e => onQuanto(Math.max(0, Math.min(teto, Number(e.target.value) || 0)))}
                aria-label={`Pontos percentuais a trocar por ${a.ingrediente.nome}`}
              />
              <span>de {fmt(atual, 1)}%</span>
            </label>
            {a.precoReferencia > 0 && (
              <span className="preco">ref. R$ {fmt(a.precoReferencia, 2)}/kg</span>
            )}
          </div>

          <p className="fonte">{a.fonte}</p>

          {/* A PRÉVIA FICA AQUI DENTRO, e não depois da lista.
              Estava renderizada abaixo do <ul> inteiro: com 16 opções, quem
              abria a quarta tinha o botão de aplicar doze linhas mais embaixo,
              fora da tela. Meu teste conferiu que o botão EXISTIA e passou —
              existir não é o mesmo que estar à vista. */}
          {quanto > 0 && (
            <Previa
              item={item} itens={itens} alternativa={a} pontos={quanto}
              especie={especie} categoria={categoria} onAplicar={onAplicar}
            />
          )}
        </div>
      )}
    </li>
  )
}

/**
 * A PRÉVIA do §9 — o que a troca faz, antes de fazer.
 *
 * Calcula os dois caminhos: só a troca, e a troca com rebalanceamento. Mostrar
 * os dois lado a lado é o que deixa o vendedor entender POR QUE o rebalanceamento
 * existe: ele vê a proteína desandar na coluna do meio e voltar na da direita.
 */
function Previa({
  item, itens, alternativa, pontos, especie, categoria, onAplicar,
}: {
  item: IngredienteFormula
  itens: IngredienteFormula[]
  alternativa: Alternativa
  pontos: number
  especie: Especie
  categoria: string
  onAplicar: (novos: IngredienteFormula[]) => void
}) {
  const preco = alternativa.precoReferencia > 0 ? alternativa.precoReferencia : item.preco

  const trocado = useMemo(
    () => aplicarTroca(itens, item.id, alternativa.ingrediente.nome, pontos, preco, novoIdIngrediente),
    [itens, item.id, alternativa.ingrediente.nome, pontos, preco],
  )

  // O rebalanceamento roda EM CIMA da fórmula já trocada — o solver aceita o
  // ingrediente novo como dado e reajusta os outros. É o §10: quem baixa o
  // farelo de soja depois do DDGS é o motor.
  const rebal = useMemo(() => {
    const r = otimizar(prepararIngredientes(trocado, especie), especie, categoria, 'menor_mudanca')
    if (r.status === 'impossivel' || r.status === 'erro') return null
    const mapa = new Map(r.itens.map(x => [x.id, x.participacao]))
    return {
      resultado: r,
      itens: trocado.map(i => {
        const p = mapa.get(i.id)
        if (p == null) return i
        const div = i.unidadeParticipacao === 'pct' ? 1 : i.unidadeParticipacao === 'kg_t' ? 10 : 10000
        return { ...i, participacao: Number((p * div).toFixed(4)) }
      }),
    }
  }, [trocado, especie, categoria])

  const linhas = useMemo(() => {
    const a0 = analisarFormula(itens, especie, categoria)
    const a1 = analisarFormula(trocado, especie, categoria)
    const a2 = rebal ? analisarFormula(rebal.itens, especie, categoria) : null
    return a0.linhas.map((l, k) => ({
      rotulo: l.rotulo, casas: l.casas,
      antes: l.valor, so: a1.linhas[k]?.valor ?? null, com: a2?.linhas[k]?.valor ?? null,
      statusSo: a1.linhas[k]?.status, statusCom: a2?.linhas[k]?.status,
    })).filter(x => x.antes != null || x.so != null)
  }, [itens, trocado, rebal, especie, categoria])

  const custo = (lista: IngredienteFormula[]) =>
    lista.reduce((s, i) => s + (pctDe(i) / 100) * i.preco, 0)
  const c0 = custo(itens)
  const c1 = custo(trocado)
  const c2 = rebal ? custo(rebal.itens) : null

  return (
    <div className="previa">
      <h5>Prévia — {fmt(pontos, 1)}% de {item.nome} por {alternativa.ingrediente.nome}</h5>

      <table className="cmp">
        <thead>
          <tr>
            <th>Nutriente</th>
            <th className="n">Hoje</th>
            <th className="n">Só a troca</th>
            <th className="n">Com rebalanceamento</th>
          </tr>
        </thead>
        <tbody>
          {linhas.map(l => (
            <tr key={l.rotulo}>
              <td>{l.rotulo}</td>
              <td className="n">{l.antes == null ? '—' : fmt(l.antes, l.casas)}</td>
              <td className={`n ${l.statusSo === 'fora' ? 'ruim' : ''}`}>
                {l.so == null ? '—' : fmt(l.so, l.casas)}
              </td>
              <td className={`n ${l.statusCom === 'fora' ? 'ruim' : l.statusCom === 'ok' ? 'bom' : ''}`}>
                {l.com == null ? '—' : <b>{fmt(l.com, l.casas)}</b>}
              </td>
            </tr>
          ))}
          <tr className="custo">
            <td>Custo por kg</td>
            <td className="n">R$ {fmt(c0, 4)}</td>
            <td className="n">R$ {fmt(c1, 4)}</td>
            <td className="n">{c2 == null ? '—' : <b>R$ {fmt(c2, 4)}</b>}</td>
          </tr>
        </tbody>
      </table>

      {rebal && rebal.resultado.naoAtendidas.length > 0 && (
        <p className="obs alerta">
          Mesmo rebalanceando, {rebal.resultado.naoAtendidas.length} exigência(s) não fecham:{' '}
          {rebal.resultado.naoAtendidas.map(x => x.rotulo).join(', ')}.
        </p>
      )}

      {/* Sem exigência cadastrada pra esta espécie/fase não existe rebalanceamento
          — não há meta pra atender. Botão desabilitado e mudo deixaria o vendedor
          achando que a tela travou; aqui ele fica escondido e o motivo aparece. */}
      {!rebal && (
        <p className="obs alerta">
          Não há exigência nutricional cadastrada para esta espécie e fase, então não há o que
          rebalancear — sem meta, "otimizar" seria só encher do ingrediente mais barato. A troca
          simples continua disponível e a coluna do meio mostra o que ela faz.
        </p>
      )}

      <div className="botoes">
        {rebal && (
          <button type="button" className="ok" onClick={() => onAplicar(rebal.itens)}>
            Aplicar e rebalancear
          </button>
        )}
        <button
          type="button" className={rebal ? 'sec' : 'ok'}
          title={rebal
            ? 'Troca só este ingrediente e não mexe no resto. Para quem sabe o que está fazendo.'
            : 'Troca este ingrediente e mantém a soma em 100%.'}
          onClick={() => onAplicar(trocado)}
        >{rebal ? 'Aplicar sem rebalancear' : 'Aplicar a troca'}</button>
      </div>
    </div>
  )
}
