/**
 * /producao-propria — Estudo de Viabilidade da Produção Própria.
 *
 * A Branorte NÃO vende ração. Esta tela prova ao produtor rural que produzir a
 * própria ração numa fábrica Branorte sai mais barato que comprar pronta, e em
 * quanto tempo o equipamento se paga.
 *
 * Substitui dois módulos que faziam a mesma conta de jeitos diferentes: o antigo
 * /venda-racao (precificação de ração, aposentado) e o iframe da calculadora
 * externa em /viabilidade — que agora aponta pra cá. Motor único em
 * lib/venda-racao/calculo.ts.
 *
 * Quatro abas:
 *   Simulação             — formulário (esquerda) + resultado (direita)
 *   Apresentação do estudo — o material do cliente, pronto pra imprimir
 *   Histórico             — estudos salvos, com filtro, comparação e status
 *   Configurações         — defaults da empresa
 *
 * O rascunho fica em localStorage a cada mudança: fechar a aba sem querer não
 * pode custar 20 minutos de digitação do vendedor.
 */
import { useEffect, useMemo, useState } from 'react'
import { useLocation } from 'react-router-dom'
import {
  Calculator, ChevronLeft, ChevronRight, Copy, FilePlus2, FileText, History, ListChecks,
  MessageCircle, Presentation, Printer, Save, Settings,
} from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { useCan } from '@/hooks/usePermissions'
import {
  useArquivarEstudo, useAtualizarStatus, useConfigEstudo, useEstudos, useFormulasSalvas,
  useIngredientesCatalogo, useRemoverEstudo, useRemoverFormula, useRemoverIngrediente,
  useSalvarConfig, useSalvarEstudo, useSalvarFormula, useSalvarIngrediente,
  type FiltrosEstudo,
} from '@/hooks/useVendaRacao'
import { calcularEstudo } from '@/lib/venda-racao/calculo'
import { consumoSugerido, novoEstudo, normalizarInput, trocarEspecie } from '@/lib/venda-racao/estado'
import { dadosEstudo } from '@/lib/venda-racao/estudo'
import { brl, hojeISO, meses, pct } from '@/lib/venda-racao/formato'
import { supabase } from '@/lib/supabase'
import type { Especie, EstudoInput, EstudoRow, StatusEstudo } from '@/lib/venda-racao/tipos'
import { CONFIG_PADRAO, STATUS_ESTUDO } from '@/lib/venda-racao/catalogo'
import { FormularioEstudo } from '@/components/venda-racao/FormularioEstudo'
import { PainelEstudo } from '@/components/venda-racao/PainelEstudo'
import { ApresentacaoEstudo, imprimirEstudo } from '@/components/venda-racao/ApresentacaoEstudo'
import { HistoricoEstudos } from '@/components/venda-racao/HistoricoEstudos'
import { ConfiguracoesEstudo } from '@/components/venda-racao/ConfiguracoesEstudo'
import { BarraAcoes } from '@/components/venda-racao/BarraAcoes'
import { ResumoAntesDeCalcular } from '@/components/venda-racao/ResumoAntesDeCalcular'
import { Selecao } from '@/components/venda-racao/campos'
import '@/styles/venda-racao.css'

type Aba = 'simulacao' | 'apresentacao' | 'historico' | 'config'

const CHAVE_RASCUNHO = 'producao-propria:rascunho'
/*
 * NÃO tocar em 'venda-racao:rascunho'. Esta tela chegou a lê-la como "rascunho
 * legado" e a apagar em seguida — nunca foi legado: aquela chave só guardou
 * `SimulacaoInput` (venda), e aqui o formato é `EstudoInput`. Normalizar um
 * como o outro monta um estudo com lixo, e o removeItem destruía o rascunho de
 * quem estava preenchendo a /venda-racao. Aquela tela hoje grava em
 * 'precificacao-racao:rascunho'; a chave velha fica parada e é inofensiva.
 */

/** Código provisório enquanto o estudo não foi salvo (o banco gera o oficial). */
function codigoProvisorio(): string {
  return `VR-${Date.now().toString(36).toUpperCase().slice(-6)}`
}

/**
 * De qual ETAPA é cada problema de validação.
 *
 * O `campo` do ProblemaValidacao é string estável, emitida por `validar()` em
 * lib/venda-racao/calculo.ts — é o único elo entre o erro e o lugar onde ele se
 * conserta. Sem este mapa o vendedor lê "informe a perda" e não sabe em qual das
 * 8 etapas isso mora.
 *
 * Dois campos mudam de etapa conforme a espécie, e isso não é descuido:
 *  - `perdaPct`  mora em Custos (6), MAS no ramo do milho o campo é renderizado
 *                dentro da Fórmula (5).
 *  - `pesaSaco`  vive no <details> "Conversão em sacos" da Necessidade (3), e a
 *                condição também dispara por unidade de preço da etapa 4.
 * Nos dois casos aponto pro lugar onde o campo é EDITADO, que é o que serve pro
 * vendedor. Se um dia a validação ganhar campo novo e ele não estiver aqui, cai
 * no fallback: sem etapa, e o erro segue aparecendo no painel como hoje.
 */
function etapaDoProblema(campo: string, ehMilho: boolean): number | null {
  if (campo === 'perdaPct') return ehMilho ? 5 : 6
  const mapa: Record<string, number> = {
    clienteNome: 1,
    necessidade: 3,
    margemSegurancaPct: 3,
    pesoSaco: 3,
    consumoPorAnimal: 3,
    atual: 4,
    perdasAtuaisPct: 4,
    formula: 5,
    milhoPreco: 5,
    dimensionamento: 7,
    diasPorMes: 7,
    horasPorDia: 7,
    margemOperacionalPct: 7,
  }
  return mapa[campo] ?? null
}

/** Quais etapas já têm dado suficiente — alimenta a barra de progresso. */
function etapasConcluidas(input: EstudoInput, r: ReturnType<typeof calcularEstudo>) {
  return [
    { rotulo: 'Cliente', ok: input.identificacao.clienteNome.trim().length > 0 },
    { rotulo: 'Produto', ok: true },
    { rotulo: 'Necessidade', ok: r.demanda.mensalKg > 0 },
    { rotulo: 'Cenário atual', ok: r.atual.informado },
    { rotulo: 'Fórmula', ok: r.formula.fechada && (input.produto.especie === 'milho' || r.formula.linhas.length > 0) },
    { rotulo: 'Custos', ok: r.producao.custoTotalPorKg > 0 },
    { rotulo: 'Capacidade', ok: r.dimensionamento.aplicavel },
    { rotulo: 'Investimento', ok: r.retorno.investimentoConsiderado > 0 },
  ]
}

/** Dados que o Guia do Vendedor manda quando o vendedor clica "usar no estudo". */
interface SementeGuia {
  especie: Especie
  categoria: string
  numeroAnimais: number
  consumoPorAnimal: number | null
  /**
   * Quem VENDE ração não tem rebanho: informou a tonelagem no Guia. Vem em kg/mês
   * e cai no modo `direto` do estudo, que já existe. Sem isto o botão "usar no
   * estudo" ficava desabilitado pra sempre nesse caso — beco sem saída.
   */
  volumeMesKg?: number | null
}

export function ProducaoPropria() {
  const { profile } = useAuth()
  const can = useCan()
  const loc = useLocation()
  const podeVerTodas = profile?.role === 'admin' || can('venda_racao.ver_todas')

  // Se a config da empresa não carregar (rede caiu, RLS negou), o módulo NÃO
  // trava: cai nos defaults locais e o vendedor segue estudando. O erro continua
  // aparecendo no console pelo QueryCache global do App.
  const { data: configSalva, isLoading: carregandoConfig } = useConfigEstudo()
  const config = configSalva ?? (carregandoConfig ? null : CONFIG_PADRAO)
  const { data: ingredientes = [] } = useIngredientesCatalogo()

  const [aba, setAba] = useState<Aba>('simulacao')
  /** 'preencher' = questionário; 'resultado' = painel na tela toda. */
  const [fase, setFase] = useState<'preencher' | 'resultado'>('preencher')
  /** Assistente: 1..8, uma etapa por vez. Bate com a barra de progresso. */
  const [etapaAtual, setEtapaAtual] = useState(1)
  const [input, setInput] = useState<EstudoInput | null>(null)
  const [estudoId, setEstudoId] = useState<string | null>(null)
  const [codigo, setCodigo] = useState<string>(codigoProvisorio)
  const [filtros, setFiltros] = useState<FiltrosEstudo>({})
  const [aviso, setAviso] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null)

  const { data: formulasSalvas = [] } = useFormulasSalvas(input?.produto.especie)
  const { data: formulasTodas = [] } = useFormulasSalvas()
  const { data: estudos = [], isLoading: carregandoLista } = useEstudos(filtros)

  const salvarEstudo = useSalvarEstudo()
  const salvarConfig = useSalvarConfig()
  const salvarFormula = useSalvarFormula()
  const removerFormula = useRemoverFormula()
  const salvarIngrediente = useSalvarIngrediente()
  const removerIngrediente = useRemoverIngrediente()
  const removerEstudo = useRemoverEstudo()
  const arquivarEstudo = useArquivarEstudo()
  const atualizarStatus = useAtualizarStatus()

  // --- inicialização: rascunho local > estudo novo com os defaults -----------
  useEffect(() => {
    if (input || !config) return
    const vendedor = profile?.display_name ?? ''
    try {
      const bruto = localStorage.getItem(CHAVE_RASCUNHO)
      if (bruto) {
        const salvo = JSON.parse(bruto) as { input: unknown; id: string | null; codigo?: string }
        // O rascunho e do NAVEGADOR, nao da conta. Se quem esta logado agora e
        // outra pessoa, o estudo passa a ser dela — em computador compartilhado o
        // vendedor herdava o nome de quem mexeu antes e mandava a proposta
        // assinada com o nome errado. Estudo SALVO (do historico) nao passa por
        // aqui: la o autor gravado continua valendo.
        const restaurado = normalizarInput(salvo.input, config)
        setInput(vendedor && restaurado.identificacao.vendedorNome !== vendedor
          ? { ...restaurado, identificacao: { ...restaurado.identificacao, vendedorNome: vendedor } }
          : restaurado)
        setEstudoId(salvo.id ?? null)
        if (salvo.codigo) setCodigo(salvo.codigo)
        return
      }
    } catch { /* rascunho corrompido: começa limpo */ }
    setInput(novoEstudo(config, 'bovinos', vendedor))
  }, [config, input, profile?.display_name])

  // --- semente vinda do Guia do Vendedor ------------------------------------
  // O vendedor levantou espécie/fase/quantidade no /guia e clicou "usar no
  // estudo". A semente sobrescreve produto e necessidade, e mantém o resto do
  // rascunho (identificação do cliente, custos já ajustados). `consumoConfirmado`
  // volta a false de propósito: consumo trazido de catálogo ainda é referência.
  useEffect(() => {
    const s = (loc.state as { guiaSemente?: SementeGuia } | null)?.guiaSemente
    if (!s || !input || !config) return
    setInput(atual => {
      if (!atual) return atual
      const base = atual.produto.especie === s.especie ? atual : trocarEspecie(atual, s.especie, config)
      return {
        ...base,
        produto: { ...base.produto, especie: s.especie, categoria: s.categoria, categoriaLivre: '' },
        necessidade: s.volumeMesKg
          ? {
              ...base.necessidade,
              modo: 'direto',
              quantidadeInformada: s.volumeMesKg,
              unidadeQuantidade: 'kg',
              periodoQuantidade: 'mes',
            }
          : {
          ...base.necessidade,
          modo: 'animais',
          numeroAnimais: s.numeroAnimais || base.necessidade.numeroAnimais,
          consumoPorAnimal: s.consumoPorAnimal ?? consumoSugerido(s.especie, s.categoria),
          baseConsumo: 'mes',
          consumoConfirmado: false,
        },
      }
    })
    setAviso({ tipo: 'ok', texto: 'Dados trazidos do Guia do Vendedor. Confirme o consumo com o cliente antes de dimensionar.' })
    // Limpa o state pra um F5 não reaplicar a semente por cima do que o vendedor já editou.
    window.history.replaceState({}, '')
  }, [loc.state, input, config])

  // --- rascunho automático ---------------------------------------------------
  useEffect(() => {
    if (!input) return
    const t = setTimeout(() => {
      try {
        localStorage.setItem(CHAVE_RASCUNHO, JSON.stringify({ input, id: estudoId, codigo }))
      } catch { /* quota cheia: seguir sem rascunho é melhor que quebrar a tela */ }
    }, 600)
    return () => clearTimeout(t)
  }, [input, estudoId, codigo])

  useEffect(() => {
    if (!aviso) return
    const t = setTimeout(() => setAviso(null), 5000)
    return () => clearTimeout(t)
  }, [aviso])

  const resultado = useMemo(
    () => (input && config ? calcularEstudo(input, config.capacidades) : null),
    [input, config],
  )

  if (!input || !config || !resultado) {
    return (
      <div className="vr">
        <div className="vr-wrap"><div className="vr-card">Carregando o módulo…</div></div>
      </div>
    )
  }

  const estudo = dadosEstudo(input, resultado, {
    codigo,
    textoApresentacao: config.textoApresentacao,
    avisoNutricional: config.avisoNutricional,
    avisoEstimativa: config.avisoEstimativa,
  })

  // Bloqueios agrupados por etapa: pinta a barra e mostra o erro DENTRO da
  // etapa culpada, em vez de um toast genérico longe do campo.
  const bloqueiosPorEtapa = new Map<number, string[]>()
  for (const p of resultado.problemas) {
    if (p.nivel !== 'bloqueio') continue
    const n = etapaDoProblema(p.campo, input.produto.especie === 'milho')
    if (n === null) continue
    bloqueiosPorEtapa.set(n, [...(bloqueiosPorEtapa.get(n) ?? []), p.mensagem])
  }

  const etapas = etapasConcluidas(input, resultado)
  const concluidas = etapas.filter(e => e.ok).length

  // --- ações -----------------------------------------------------------------
  const irPara = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const novo = () => {
    setInput(novoEstudo(config, input.produto.especie, profile?.display_name ?? ''))
    setEstudoId(null)
    setCodigo(codigoProvisorio())
    setAba('simulacao')
    setFase('preencher')  // senão cai no resultado do estudo anterior
    setEtapaAtual(1)
    setAviso({ tipo: 'ok', texto: 'Estudo novo aberto.' })
  }

  const duplicarAtual = () => {
    setEstudoId(null)
    setCodigo(codigoProvisorio())
    setInput(s => (s ? { ...s, status: 'rascunho' } : s))
    setAba('simulacao')
    setFase('preencher')  // senão cai no resultado do estudo anterior
    setEtapaAtual(1)
    setAviso({ tipo: 'ok', texto: 'Cópia criada — salve pra gerar um código novo.' })
  }

  const salvar = () => {
    salvarEstudo.mutate({
      id: estudoId ?? undefined,
      input,
      resumo: {
        consumoMensalKg: resultado.demanda.mensalKg,
        custoAtualPorKg: resultado.atual.custoPorKg,
        custoProprioPorKg: resultado.producao.custoTotalPorKg,
        economiaPorKg: resultado.comparacao.economiaPorKg,
        economiaMensal: resultado.comparacao.economiaMensal,
        economiaAnual: resultado.comparacao.economiaAnual,
        reducaoPct: resultado.comparacao.reducaoPct,
        capacidadeKgHora: resultado.dimensionamento.sugerido?.capacidade ?? 0,
        investimentoTotal: resultado.retorno.investimentoConsiderado,
        paybackMeses: resultado.retorno.aplicavel ? resultado.retorno.paybackMeses : null,
      },
    }, {
      onSuccess: linha => {
        setEstudoId(linha.id)
        setCodigo(linha.codigo)
        setAviso({ tipo: 'ok', texto: `Estudo ${linha.codigo} salvo.` })
      },
      onError: e => setAviso({ tipo: 'erro', texto: (e as Error).message || 'Não consegui salvar.' }),
    })
  }

  /**
   * O cálculo é reativo (roda a cada tecla); este botão é quem FECHA a conta e
   * troca a tela de preencher pra resultado.
   *
   * SEMPRE avança de vista, inclusive bloqueado. Parece contraintuitivo, mas era
   * o comportamento de antes: o PainelEstudo já nasceu sabendo se mostrar
   * incompleto — lista os bloqueios numa caixa vermelha em cima e segue exibindo
   * o que dá pra calcular. E em campo o estudo nasce bloqueado (o produtor não
   * sabe de cabeça o preço do saco, dita a fórmula por alto). Trancar o botão até
   * estar tudo preenchido esconderia o número justo na hora em que ele serve.
   *
   * O aviso diz o que falta porque o painel está fora da tela na hora do clique.
   */
  const calcular = () => {
    setFase('resultado')
    window.scrollTo({ top: 0, behavior: 'smooth' })
    if (resultado.bloqueado) {
      const faltas = resultado.problemas
        .filter(p => p.nivel === 'bloqueio')
        .map(p => p.mensagem)
      setAviso({
        tipo: 'erro',
        texto: faltas.length
          ? `Ainda falta: ${faltas.join(' · ')}`
          : 'Ainda faltam dados pra fechar o estudo.',
      })
    } else if (!resultado.comparacao.vantajoso) {
      setAviso({
        tipo: 'erro',
        texto: 'Com os dados atuais, a produção própria não apresenta economia. '
          + 'Revise os preços, a fórmula e os custos operacionais.',
      })
    } else {
      setAviso({
        tipo: 'ok',
        texto: `Economia estimada de ${brl(resultado.comparacao.economiaMensal)} por mês `
          + `(${pct(resultado.comparacao.reducaoPct, 1)})`
          + (resultado.retorno.aplicavel ? ` · retorno em ${meses(resultado.retorno.paybackMeses, 1)}.` : '.'),
      })
    }
  }

  const carregarLinha = async (id: string): Promise<EstudoRow | null> => {
    const { data, error } = await supabase
      .from('venda_racao_simulacoes')
      .select('*')
      .eq('id', id)
      .maybeSingle()
    if (error || !data) return null
    return data as EstudoRow
  }

  const abrirDoHistorico = async (id: string, irParaApresentacao = false) => {
    const linha = await carregarLinha(id)
    if (!linha) {
      setAviso({ tipo: 'erro', texto: 'Não consegui abrir esse estudo.' })
      return
    }
    setInput(normalizarInput(linha.dados, config))
    setEstudoId(linha.id)
    setCodigo(linha.codigo)
    setAba(irParaApresentacao ? 'apresentacao' : 'simulacao')
  }

  const duplicarDoHistorico = async (id: string) => {
    const linha = await carregarLinha(id)
    if (!linha) {
      setAviso({ tipo: 'erro', texto: 'Não consegui duplicar esse estudo.' })
      return
    }
    const base = normalizarInput(linha.dados, config)
    setInput({
      ...base,
      status: 'rascunho',
      identificacao: { ...base.identificacao, data: hojeISO() },
    })
    setEstudoId(null)
    setCodigo(codigoProvisorio())
    setAba('simulacao')
    setFase('preencher')  // senão cai no resultado do estudo anterior
    setEtapaAtual(1)
    setAviso({ tipo: 'ok', texto: 'Cópia aberta — salve pra gerar um código novo.' })
  }

  const abas: Array<{ id: Aba; label: string; icone: typeof Calculator }> = [
    { id: 'simulacao', label: 'Simulação', icone: Calculator },
    { id: 'apresentacao', label: 'Apresentação', icone: FileText },
    { id: 'historico', label: 'Histórico', icone: History },
    { id: 'config', label: 'Configurações', icone: Settings },
  ]

  return (
    <div className="vr">
      <div className="vr-wrap">
        {/* Cabeçalho ENXUTO. O vendedor preenche 7 etapas nesta tela e cada
            linha aqui em cima é rolagem que ele faz o dia inteiro. Saíram o
            "eyebrow" (dizia "Estudo de viabilidade", o mesmo que o h1) e o
            parágrafo de apresentação — quem abre esta tela já sabe o que ela é.
            Nada disto ia pro PDF: a impressão só mostra #vr-print-area. */}
        <div className="vr-cab">
          <span className="vr-brand">BRA<b>NORTE</b> · Fábricas de Ração</span>
          <h1 className="vr-h1">Estudo de Viabilidade da Produção Própria</h1>
        </div>

        {/* ------------------------------------------- abas + ações (1 linha)
            Eram duas fileiras empilhadas: abas em cima, seis botões embaixo.
            Somando com marca, título, barra de progresso e passos, o vendedor
            rolava a tela antes de chegar no primeiro campo. Agora dividem a
            MESMA linha — abas à esquerda, ações à direita — e os secundários
            viraram ícone com tooltip (continuam a um clique).
            A classe é `vr-topo`: `vr-barra` já é a barra empilhada dos gráficos.
            A borda de baixo saiu de `.vr-tabs` e veio pra cá, senão ela
            terminaria no meio da linha, embaixo só das abas. */}
        <div className="vr-topo vr-no-print">
          <div className="vr-tabs">
            {abas.map(t => (
              <button
                key={t.id}
                type="button"
                className={`vr-tab${aba === t.id ? ' on' : ''}`}
                onClick={() => {
                  setAba(t.id)
                  // Herdado do botão "Apresentar ao cliente", que foi removido por
                  // fazer exatamente o que esta aba faz. A checagem não podia ir
                  // junto: sem ela o vendedor abre a apresentação com pendência e
                  // só descobre na frente do cliente.
                  if (t.id === 'apresentacao') {
                    setAviso(resultado.bloqueado
                      ? { tipo: 'erro', texto: 'O estudo ainda tem pendências — confira antes de mostrar ao cliente.' }
                      : null)
                  }
                }}
              >
                <t.icone className="h-4 w-4" /> {t.label}
              </button>
            ))}
          </div>

          {(aba === 'simulacao' || aba === 'apresentacao') && (
            <BarraAcoes
              onCalcular={calcular}
              onSalvar={salvar}
              onGerarPdf={() => { setAba('apresentacao'); setTimeout(imprimirEstudo, 120) }}
              onWhatsApp={() => { setAba('apresentacao'); setTimeout(() => irPara('vr-whats'), 60) }}
              onRevisarPremissas={() => { setAba('apresentacao'); setTimeout(() => irPara('vr-premissas'), 60) }}
              onDuplicar={duplicarAtual}
              onNovoEstudo={novo}
              salvando={salvarEstudo.isPending}
              salvoEm={salvarEstudo.isSuccess ? new Date(salvarEstudo.submittedAt) : null}
              estudoSalvo={!!estudoId}
              extra={
                <>
                  <span style={{ fontSize: 12, color: 'var(--vr-ink40)', fontFamily: 'var(--vr-mono)' }}>
                    {codigo}
                  </span>
                  <Selecao
                    valor={input.status}
                    opcoes={STATUS_ESTUDO.map(s => ({ v: s.chave as StatusEstudo, label: s.nome }))}
                    onChange={v => {
                      setInput(s => (s ? { ...s, status: v } : s))
                      if (estudoId) atualizarStatus.mutate({ id: estudoId, status: v })
                    }}
                  />
                </>
              }
            />
          )}
        </div>

        {(aba === 'simulacao' || aba === 'apresentacao') && (
          <>
            {/* ----------------------------------------- progresso */}
            <div className="vr-progress vr-no-print">
              <div className="trilho">
                <span style={{ width: `${(concluidas / etapas.length) * 100}%` }} />
              </div>
              <div className="passos">
                {etapas.map((e, i) => {
                  const n = i + 1
                  // A barra é a navegação: clicar pula direto pra etapa, sem
                  // travar. Nada de gate — se travasse por etapa, mudaria regra
                  // (só 3 dos 8 blocos bloqueiam) e prenderia o vendedor.
                  const temErro = bloqueiosPorEtapa.has(n)
                  const classe = [
                    temErro ? 'erro' : (e.ok ? 'ok' : ''),
                    n === etapaAtual ? 'atual' : '',
                  ].filter(Boolean).join(' ')
                  return (
                    <button
                      key={e.rotulo}
                      type="button"
                      className={classe}
                      aria-current={n === etapaAtual ? 'step' : undefined}
                      onClick={() => { setEtapaAtual(n); window.scrollTo({ top: 0, behavior: 'smooth' }) }}
                    >
                      {e.rotulo}
                    </button>
                  )
                })}
              </div>
            </div>
          </>
        )}

        {aviso && (
          <div className={aviso.tipo === 'ok' ? 'vr-nota' : 'vr-erro'}>{aviso.texto}</div>
        )}

        {/* ---------------------------------------------------- conteúdo
            DUAS FASES. Preencher usa a tela inteira (formulário em colunas);
            o resultado só aparece quando o vendedor manda calcular, e aí ele
            é que fica com a largura toda. O cálculo NÃO congela entre as duas:
            segue no useMemo, alimentando os blocos .vr-live dentro do próprio
            formulário e a barra de progresso. O que muda é só o que se vê. */}
        {aba === 'simulacao' && fase === 'resultado' && (
          <>
            <div className="vr-voltar vr-no-print">
              <button type="button" className="vr-btn ghost" onClick={() => setFase('preencher')}>
                <ChevronLeft className="h-4 w-4" /> Voltar e editar
              </button>
              <span style={{ fontSize: 12.5, color: 'var(--vr-ink40)' }}>
                Resultado de {input.identificacao.clienteNome || 'estudo sem nome'}
              </span>
            </div>
            <div id="vr-topo-resultado">
              <PainelEstudo input={input} resultado={resultado} />
            </div>
          </>
        )}

        {aba === 'simulacao' && fase === 'preencher' && (
          <div>
            {bloqueiosPorEtapa.has(etapaAtual) && (
              <div className="vr-erro vr-no-print" style={{ maxWidth: 760, margin: '14px auto 0' }}>
                <strong>Falta preencher nesta etapa:</strong>
                <ul>
                  {bloqueiosPorEtapa.get(etapaAtual)!.map((m, i) => <li key={i}>{m}</li>)}
                </ul>
              </div>
            )}

            <FormularioEstudo
              largo
              etapa={etapaAtual}
              input={input}
              onChange={fn => setInput(s => (s ? fn(s) : s))}
              onTrocarEspecie={(e: Especie) => setInput(s => (s ? trocarEspecie(s, e, config) : s))}
              resultado={resultado}
              config={config}
              ingredientesCatalogo={ingredientes}
              formulasSalvas={formulasSalvas}
              salvandoFormula={salvarFormula.isPending}
              onSalvarFormula={() => {
                salvarFormula.mutate({
                  id: input.formula.formulaId ?? undefined,
                  nome: input.formula.nome,
                  especie: input.produto.especie,
                  categoria: input.produto.categoria,
                  itens: input.formula.itens,
                }, {
                  onSuccess: id => {
                    setInput(s => (s ? { ...s, formula: { ...s.formula, formulaId: id as string } } : s))
                    setAviso({ tipo: 'ok', texto: 'Fórmula salva no catálogo.' })
                  },
                  onError: () => setAviso({ tipo: 'erro', texto: 'Não consegui salvar a fórmula.' }),
                })
              }}
            />

            {/* Fecha a prova: na última etapa repete as respostas que importam e
                diz o que ainda falta, antes de oferecer o botão. */}
            {etapaAtual === etapas.length && (
              <ResumoAntesDeCalcular input={input} resultado={resultado} onCalcular={calcular} />
            )}

            {/* Um bloco por vez: preenche, avança. Na última, gera o resultado. */}
            <div className="vr-passos vr-no-print">
              <button
                type="button"
                className="vr-btn ghost"
                disabled={etapaAtual === 1}
                onClick={() => { setEtapaAtual(n => Math.max(1, n - 1)); window.scrollTo({ top: 0, behavior: 'smooth' }) }}
              >
                <ChevronLeft className="h-4 w-4" /> Voltar
              </button>

              <span className="conta">
                Etapa {etapaAtual} de {etapas.length} · {etapas[etapaAtual - 1]?.rotulo}
              </span>

              {etapaAtual < etapas.length ? (
                <button
                  type="button"
                  className="vr-btn primary"
                  onClick={() => { setEtapaAtual(n => Math.min(etapas.length, n + 1)); window.scrollTo({ top: 0, behavior: 'smooth' }) }}
                >
                  Próximo <ChevronRight className="h-4 w-4" />
                </button>
              ) : (
                <button type="button" className="vr-btn primary" onClick={calcular}>
                  <Calculator className="h-4 w-4" /> Gerar resultado
                </button>
              )}
            </div>
          </div>
        )}

        {aba === 'apresentacao' && (
          <div style={{ marginTop: 18 }}>
            <ApresentacaoEstudo dados={estudo} />
          </div>
        )}

        {aba === 'historico' && (
          <div style={{ marginTop: 18 }}>
            <HistoricoEstudos
              linhas={estudos}
              carregando={carregandoLista}
              filtros={filtros}
              onFiltros={setFiltros}
              onAbrir={id => { void abrirDoHistorico(id) }}
              onApresentar={id => { void abrirDoHistorico(id, true) }}
              onDuplicar={id => { void duplicarDoHistorico(id) }}
              onArquivar={(id, arquivado) => arquivarEstudo.mutate({ id, arquivado }, {
                onSuccess: () => setAviso({ tipo: 'ok', texto: arquivado ? 'Estudo arquivado.' : 'Estudo desarquivado.' }),
                onError: () => setAviso({ tipo: 'erro', texto: 'Não consegui arquivar.' }),
              })}
              onRemover={id => removerEstudo.mutate(id, {
                onSuccess: () => {
                  setAviso({ tipo: 'ok', texto: 'Estudo apagado.' })
                  if (id === estudoId) { setEstudoId(null); setCodigo(codigoProvisorio()) }
                },
                onError: () => setAviso({ tipo: 'erro', texto: 'Não consegui apagar.' }),
              })}
              onStatus={(id, s) => atualizarStatus.mutate({ id, status: s })}
              podeVerTodas={podeVerTodas}
            />
          </div>
        )}

        {aba === 'config' && (
          <div style={{ marginTop: 18 }}>
            <ConfiguracoesEstudo
              config={config}
              podeEditar={podeVerTodas}
              salvando={salvarConfig.isPending}
              onSalvar={c => salvarConfig.mutate(c, {
                onSuccess: () => setAviso({ tipo: 'ok', texto: 'Configurações salvas.' }),
                onError: () => setAviso({ tipo: 'erro', texto: 'Não consegui salvar (precisa de permissão de admin).' }),
              })}
              ingredientes={ingredientes}
              onSalvarIngrediente={i => salvarIngrediente.mutate(i, {
                onError: () => setAviso({ tipo: 'erro', texto: 'Não consegui salvar o ingrediente.' }),
              })}
              onRemoverIngrediente={id => removerIngrediente.mutate(id)}
              formulas={formulasTodas}
              onRemoverFormula={id => removerFormula.mutate(id)}
            />
          </div>
        )}

        {/* --------------------------------- resumo fixo (celular) */}
        {aba === 'simulacao' && (
          <button type="button" className="vr-resumofixo vr-no-print" onClick={calcular}>
            <span className="l">
              {resultado.comparacao.vantajoso ? 'Economia estimada' : 'Sem economia ainda'}
            </span>
            <span className="v">{brl(resultado.comparacao.economiaMensal)}<i>/mês</i></span>
            <span className="a">ver resultado</span>
          </button>
        )}

        <footer style={{ marginTop: 28, fontSize: 11.5, color: 'var(--vr-ink40)', borderTop: '1px solid var(--vr-hair)', paddingTop: 16, lineHeight: 1.6 }}>
          Estudo {codigo} · valores ESTIMADOS a partir dos dados informados.
          Custo próprio apurado: {brl(resultado.producao.custoTotalPorKg, 4)}/kg ·
          custo atual informado: {brl(resultado.atual.custoPorKg, 4)}/kg.
          {' '}{config.avisoEstimativa}
        </footer>
      </div>
    </div>
  )
}

export default ProducaoPropria
