/**
 * Resumo antes de calcular — o último cartão do questionário.
 *
 * Depois de descer 8 etapas em coluna única, o vendedor não lembra o que
 * respondeu lá em cima. Este cartão fecha a prova: repete as respostas que
 * importam, diz o que ainda falta e só então oferece o botão.
 *
 * NÃO CALCULA NADA. Todo número aqui já veio pronto de `calcularEstudo` (que
 * roda no useMemo da página a cada tecla). Este arquivo só lê `resultado`,
 * escolhe entre mostrar ou não mostrar, e formata. Se algum dia um número
 * daqui divergir do painel, o bug está no motor — não aqui.
 *
 * REGRA DO TRAVESSÃO: quando o dado não foi informado, o valor é "—". Nunca
 * "R$ 0,00". Zero é uma resposta ("não custa nada"), ausência é outra ("ele
 * ainda não me disse"), e confundir as duas faz o vendedor apresentar economia
 * inventada pro cliente.
 */
import { Calculator } from 'lucide-react'
import { nomeCategoria, nomeEspecie } from '@/lib/venda-racao/catalogo'
import { brl, brlKg, kg, kgHora, meses, numero, pct, toneladas } from '@/lib/venda-racao/formato'
import type { EstudoInput, ResultadoEstudo } from '@/lib/venda-racao/tipos'

/** Em dash — o mesmo que `formato.ts` já usa em `meses()` e `dataBR()`. */
const TRACO = '—'

/** Quantas etapas o questionário tem. Igual à barra de progresso da página. */
const TOTAL_ETAPAS = 8

interface Props {
  input: EstudoInput
  resultado: ResultadoEstudo
  /** Fecha a conta e troca a tela pra fase de resultado. */
  onCalcular: () => void
}

/** Uma linha do resumo: rótulo, valor (ou travessão) e um detalhe secundário. */
interface LinhaResumo {
  rotulo: string
  valor: string
  detalhe: string
  /** Só a economia usa cor — é o único número que pode ser bom ou ruim. */
  tom?: 'pos' | 'neg'
}

interface Falta {
  etapa: number
  rotulo: string
  /** O que responder. Vem do motor quando ele tem uma frase pro caso. */
  oQueFalta: string
}

/**
 * De qual etapa do formulário é cada `campo` que o validador emite.
 *
 * Não dá pra derivar isso do motor: `ProblemaValidacao.campo` é uma string
 * solta, sem noção de etapa (e `calculo.ts` não pode ser tocado). Então o mapa
 * mora aqui, na UI, que é quem tem opinião sobre layout.
 *
 * Duas armadilhas conhecidas:
 *  - `pesoSaco` mora na etapa 3, mas uma das causas do erro está na 4 (preço
 *    por saco). Fica na 3, que é onde está o campo pra corrigir.
 *  - `perdaPct` TROCA DE ETAPA: no ramo milho o campo é renderizado dentro da
 *    Fórmula; nas demais espécies ele vive em Custos.
 */
function etapaDoCampo(campo: string, ehMilho: boolean): number {
  switch (campo) {
    case 'clienteNome':
      return 1
    case 'necessidade':
    case 'margemSegurancaPct':
    case 'consumoPorAnimal':
    case 'pesoSaco':
      return 3
    case 'atual':
    case 'perdasAtuaisPct':
      return 4
    case 'formula':
    case 'milhoPreco':
      return 5
    case 'perdaPct':
      return ehMilho ? 5 : 6
    case 'dimensionamento':
    case 'diasPorMes':
    case 'horasPorDia':
    case 'margemOperacionalPct':
      return 7
    default:
      return 0 // campo novo no motor: cai na lista de ajustes, sem etapa
  }
}

export function ResumoAntesDeCalcular({ input, resultado, onCalcular }: Props) {
  const { demanda, atual, producao, comparacao, dimensionamento, retorno, formula, problemas } = resultado
  const ident = input.identificacao
  const ehMilho = input.produto.especie === 'milho'
  const sug = dimensionamento.sugerido

  const cliente = ident.clienteNome.trim()

  /*
   * O custo próprio só é "custo de PRODUZIR" quando tem matéria-prima na conta.
   * Sem fórmula (ou sem preço do milho) o motor ainda devolve custoTotalPorKg
   * maior que zero, porque os custos operacionais nascem ligados por padrão —
   * e aí a tela mostraria "R$ 0,17/kg" como se fosse o custo da ração. É o
   * mesmo tipo de mentira que o travessão existe pra evitar, só que disfarçada
   * de número plausível.
   */
  const temCustoProprio = producao.custoTotalPorKg > 0 && producao.grupos.materiaPrima > 0
  /* Comparar exige os DOIS lados: sem custo atual a "economia" é o custo
     próprio negativado, um número enorme e falso. */
  const podeComparar = atual.informado && temCustoProprio

  const local = [ident.clienteCidade.trim(), ident.clienteUf.trim()].filter(Boolean).join('/')

  const linhas: LinhaResumo[] = [
    {
      rotulo: 'Cliente',
      valor: cliente || TRACO,
      detalhe: [ident.clienteEmpresa.trim(), local].filter(Boolean).join(' · ')
        || 'sem propriedade e cidade informadas',
    },
    {
      // Espécie e categoria nascem escolhidas, então esta linha nunca dá traço.
      rotulo: 'Produto',
      valor: nomeEspecie(input.produto.especie),
      detalhe: nomeCategoria(input.produto.especie, input.produto.categoria, input.produto.categoriaLivre),
    },
    {
      rotulo: 'Necessidade mensal',
      valor: demanda.mensalKg > 0 ? kg(demanda.mensalKg) : TRACO,
      detalhe: demanda.mensalKg > 0
        ? `${toneladas(demanda.toneladasMes)} por mês · ${toneladas(demanda.toneladasAno)} por ano`
        : 'informe o plantel ou a quantidade que ele já consome',
    },
    {
      rotulo: 'Custo atual',
      valor: atual.informado ? brlKg(atual.custoPorKg, 2) : TRACO,
      detalhe: atual.informado
        ? `${brl(atual.custoMensal)} por mês`
        : input.atual.modo === 'proprio'
          ? 'informe o custo da operação de hoje'
          : 'informe quanto ele paga pela ração pronta',
    },
    {
      rotulo: 'Custo de produção',
      valor: temCustoProprio ? brlKg(producao.custoTotalPorKg, 2) : TRACO,
      detalhe: temCustoProprio
        ? `${brl(producao.custoMensal)} por mês · ingredientes ${brl(producao.grupos.materiaPrima, 4)}/kg`
        : ehMilho
          ? 'falta o preço do milho'
          : 'falta a fórmula — sem ingredientes não há custo de produzir',
    },
    {
      rotulo: 'Economia estimada',
      valor: podeComparar ? `${brl(comparacao.economiaMensal)}/mês` : TRACO,
      detalhe: podeComparar
        ? `${brl(comparacao.economiaAnual)} por ano · ${pct(comparacao.reducaoPct, 1)} de redução`
        : 'precisa do custo atual e do custo de produção',
      // Sem os dois lados não há tom: número ausente não é bom nem ruim.
      tom: podeComparar ? (comparacao.vantajoso ? 'pos' : 'neg') : undefined,
    },
    {
      rotulo: 'Capacidade recomendada',
      valor: dimensionamento.aplicavel ? kgHora(dimensionamento.capacidadeRecomendadaKgHora) : TRACO,
      detalhe: dimensionamento.aplicavel
        ? sug
          ? `linha sugerida ${kgHora(sug.capacidade)} · ${pct(sug.utilizacaoPct, 0)} de utilização`
          : dimensionamento.rotinaSugerida || 'sem equipamento sugerido para esse volume'
        : 'informe dias por mês e horas por dia',
    },
    {
      rotulo: 'Investimento informado',
      valor: retorno.investimentoConsiderado > 0 ? brl(retorno.investimentoConsiderado) : TRACO,
      detalhe: retorno.investimentoConsiderado > 0
        ? retorno.aplicavel
          ? `retorno em ${meses(retorno.paybackMeses, 1)}`
          : 'sem economia projetada não existe prazo de retorno'
        : 'sem investimento o estudo mostra só a economia, sem payback',
    },
  ]

  /*
   * As frases do que falta vêm do PRÓPRIO motor sempre que ele tem uma.
   * Reescrever "Monte a fórmula ou selecione uma cadastrada." aqui criaria duas
   * versões da mesma verdade, que divergem no primeiro ajuste de validação.
   */
  const mensagensPorEtapa = new Map<number, string[]>()
  for (const p of problemas) {
    const etapa = etapaDoCampo(p.campo, ehMilho)
    if (etapa === 0) continue
    const atuais = mensagensPorEtapa.get(etapa) ?? []
    atuais.push(p.mensagem)
    mensagensPorEtapa.set(etapa, atuais)
  }

  const explicar = (etapa: number, padrao: string): string =>
    mensagensPorEtapa.get(etapa)?.join(' ') ?? padrao

  /*
   * ESPELHO de `etapasConcluidas` (ProducaoPropria.tsx). Aquela função é local
   * da página e não é exportada; os critérios estão repetidos aqui de propósito
   * — e têm que ser mudados JUNTOS, senão a barra de progresso diz "8 de 8" e o
   * resumo diz que falta coisa. A etapa 2 (Produto) não entra: lá a barra é
   * `ok: true` fixo, porque espécie e categoria já nascem preenchidas.
   */
  const faltas: Falta[] = []
  if (!cliente) {
    faltas.push({ etapa: 1, rotulo: 'Cliente', oQueFalta: explicar(1, 'Informe o nome do cliente.') })
  }
  if (demanda.mensalKg <= 0) {
    faltas.push({ etapa: 3, rotulo: 'Necessidade', oQueFalta: explicar(3, 'Informe a necessidade de produção.') })
  }
  if (!atual.informado) {
    faltas.push({ etapa: 4, rotulo: 'Cenário atual', oQueFalta: explicar(4, 'Informe o custo de hoje.') })
  }
  if (!(formula.fechada && (ehMilho || formula.linhas.length > 0))) {
    faltas.push({
      etapa: 5,
      rotulo: ehMilho ? 'Preço do milho' : 'Fórmula',
      oQueFalta: explicar(5, ehMilho
        ? 'Informe o preço do milho.'
        : formula.linhas.length === 0
          ? 'Monte a fórmula ou selecione uma cadastrada.'
          : 'Feche a fórmula em 1.000 kg.'),
    })
  }
  if (producao.custoTotalPorKg <= 0) {
    faltas.push({ etapa: 6, rotulo: 'Custos', oQueFalta: explicar(6, 'Ligue ao menos um custo de produção.') })
  }
  if (!dimensionamento.aplicavel) {
    faltas.push({ etapa: 7, rotulo: 'Capacidade', oQueFalta: explicar(7, 'Informe dias por mês e horas por dia.') })
  }
  if (retorno.investimentoConsiderado <= 0) {
    faltas.push({
      etapa: 8,
      rotulo: 'Investimento',
      oQueFalta: 'Sem investimento o estudo calcula a economia, mas não o prazo de retorno.',
    })
  }

  /*
   * Bloqueios que NÃO são ausência de resposta — margem negativa, mês com 40
   * dias, fórmula que passou de 1.000 kg. Só entram os de etapa que já não está
   * na lista acima, senão o vendedor lê a mesma frase duas vezes.
   */
  const etapasFaltando = new Set(faltas.map(f => f.etapa))
  const ajustes = problemas
    .filter(p => p.nivel === 'bloqueio' && !etapasFaltando.has(etapaDoCampo(p.campo, ehMilho)))
    .map(p => p.mensagem)

  const preenchidas = TOTAL_ETAPAS - faltas.length

  return (
    <div className="vr-card vr-no-print" style={{ maxWidth: 760, margin: '0 auto' }}>
      <h2>Resumo antes de calcular</h2>
      <div className="vr-stepdesc">
        Confira o que o estudo vai usar. O que estiver com {TRACO} ainda não foi respondido.
      </div>

      <div className="vr-metrics">
        {linhas.map(l => (
          <div className="vr-mt" key={l.rotulo}>
            <div className="l">{l.rotulo}</div>
            <div className={`val${l.tom ? ` ${l.tom}` : ''}`}>{l.valor}</div>
            <div className="vr-hint">{l.detalhe}</div>
          </div>
        ))}
      </div>

      {faltas.length > 0 && (
        <div className="vr-alerta">
          <strong>Ainda falta responder:</strong>
          <ul>
            {faltas.map(f => (
              <li key={f.etapa}>
                <strong>Etapa {f.etapa} · {f.rotulo}</strong> — {f.oQueFalta}
              </li>
            ))}
          </ul>
        </div>
      )}

      {ajustes.length > 0 && (
        <div className="vr-erro">
          <strong>Falta ajustar:</strong>
          <ul>{ajustes.map((m, i) => <li key={`${m}-${i}`}>{m}</li>)}</ul>
        </div>
      )}

      {faltas.length === 0 && ajustes.length === 0 && (
        <div className="vr-nota">
          Todas as {TOTAL_ETAPAS} etapas respondidas. Pode fechar o estudo.
        </div>
      )}

      {/*
        O botão NUNCA fica desabilitado, mesmo com pendência. É o comportamento
        que a página já tinha, e é proposital: em campo o estudo nasce
        incompleto (o produtor não sabe de cabeça o preço do saco), e o painel
        de resultado já sabe se mostrar pela metade, listando os bloqueios em
        cima. Trancar o botão esconderia o número justo na hora em que ele serve
        pra puxar a conversa.
      */}
      <div className="vr-gerar">
        <button type="button" className="vr-btn primary" onClick={onCalcular}>
          <Calculator className="h-4 w-4" /> Calcular viabilidade
        </button>
        <span className="aviso">
          {faltas.length > 0
            ? `${preenchidas} de ${TOTAL_ETAPAS} etapas respondidas`
            : 'Todas as etapas respondidas'}
        </span>
      </div>
    </div>
  )
}

export default ResumoAntesDeCalcular
