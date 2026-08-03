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
import {
  Calculator, Copy, FilePlus2, FileText, History, ListChecks, MessageCircle,
  Presentation, Printer, Save, Settings,
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
import { novoEstudo, normalizarInput, trocarEspecie } from '@/lib/venda-racao/estado'
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

export function ProducaoPropria() {
  const { profile } = useAuth()
  const can = useCan()
  const podeVerTodas = profile?.role === 'admin' || can('venda_racao.ver_todas')

  // Se a config da empresa não carregar (rede caiu, RLS negou), o módulo NÃO
  // trava: cai nos defaults locais e o vendedor segue estudando. O erro continua
  // aparecendo no console pelo QueryCache global do App.
  const { data: configSalva, isLoading: carregandoConfig } = useConfigEstudo()
  const config = configSalva ?? (carregandoConfig ? null : CONFIG_PADRAO)
  const { data: ingredientes = [] } = useIngredientesCatalogo()

  const [aba, setAba] = useState<Aba>('simulacao')
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
        setInput(normalizarInput(salvo.input, config))
        setEstudoId(salvo.id ?? null)
        if (salvo.codigo) setCodigo(salvo.codigo)
        return
      }
    } catch { /* rascunho corrompido: começa limpo */ }
    setInput(novoEstudo(config, 'bovinos', vendedor))
  }, [config, input, profile?.display_name])

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
    setAviso({ tipo: 'ok', texto: 'Estudo novo aberto.' })
  }

  const duplicarAtual = () => {
    setEstudoId(null)
    setCodigo(codigoProvisorio())
    setInput(s => (s ? { ...s, status: 'rascunho' } : s))
    setAba('simulacao')
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
   * O cálculo é reativo (roda a cada tecla). O botão existe pra fechar a conta:
   * confere os bloqueios e leva o vendedor até o resultado — no celular o painel
   * fica embaixo do formulário inteiro.
   */
  const calcular = () => {
    if (resultado.bloqueado) {
      setAviso({ tipo: 'erro', texto: 'Ainda faltam dados — veja o que está marcado no resultado.' })
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
    irPara('vr-topo-resultado')
  }

  const apresentar = () => {
    setAba('apresentacao')
    setAviso(resultado.bloqueado
      ? { tipo: 'erro', texto: 'O estudo ainda tem pendências — confira antes de mostrar ao cliente.' }
      : null)
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
    setAviso({ tipo: 'ok', texto: 'Cópia aberta — salve pra gerar um código novo.' })
  }

  const abas: Array<{ id: Aba; label: string; icone: typeof Calculator }> = [
    { id: 'simulacao', label: 'Simulação', icone: Calculator },
    { id: 'apresentacao', label: 'Apresentação do estudo', icone: FileText },
    { id: 'historico', label: 'Histórico', icone: History },
    { id: 'config', label: 'Configurações', icone: Settings },
  ]

  return (
    <div className="vr">
      <div className="vr-wrap">
        <div className="vr-brand">BRA<b>NORTE</b> · Fábricas de Ração</div>
        <div className="vr-eyebrow">Estudo de viabilidade</div>
        <h1 className="vr-h1">Estudo de Viabilidade da Produção Própria</h1>
        <p className="vr-lede">
          Compare o custo da ração comprada com a produção própria e estime a economia e o retorno
          do investimento. Ração farelada para bovinos, suínos e aves — e milho triturado.
        </p>

        {/* -------------------------------------------------------- abas */}
        <div className="vr-tabs vr-no-print">
          {abas.map(t => (
            <button
              key={t.id}
              type="button"
              className={`vr-tab${aba === t.id ? ' on' : ''}`}
              onClick={() => setAba(t.id)}
            >
              <t.icone className="h-4 w-4" /> {t.label}
            </button>
          ))}
        </div>

        {/* --------------------------------------------- barra de ações */}
        {(aba === 'simulacao' || aba === 'apresentacao') && (
          <>
            <div className="vr-acoes vr-no-print">
              <div className="vr-cta" style={{ marginTop: 0 }}>
                <button type="button" className="vr-btn ghost" disabled={salvarEstudo.isPending} onClick={salvar}>
                  <Save className="h-4 w-4" />
                  {salvarEstudo.isPending ? 'Salvando…' : estudoId ? 'Salvar alterações' : 'Salvar rascunho'}
                </button>
                <button type="button" className="vr-btn primary" onClick={calcular}>
                  <Calculator className="h-4 w-4" /> Calcular viabilidade
                </button>
                <button type="button" className="vr-btn ghost" onClick={() => { setAba('apresentacao'); setTimeout(() => irPara('vr-premissas'), 60) }}>
                  <ListChecks className="h-4 w-4" /> Revisar premissas
                </button>
                <button type="button" className="vr-btn ghost" onClick={apresentar}>
                  <Presentation className="h-4 w-4" /> Apresentar ao cliente
                </button>
                <button type="button" className="vr-btn ghost" onClick={() => { setAba('apresentacao'); setTimeout(imprimirEstudo, 120) }}>
                  <Printer className="h-4 w-4" /> Gerar PDF
                </button>
                <button type="button" className="vr-btn ghost" onClick={() => { setAba('apresentacao'); setTimeout(() => irPara('vr-whats'), 60) }}>
                  <MessageCircle className="h-4 w-4" /> Preparar mensagem do WhatsApp
                </button>
                <button type="button" className="vr-btn ghost" onClick={duplicarAtual}>
                  <Copy className="h-4 w-4" /> Duplicar
                </button>
                <button type="button" className="vr-btn ghost" onClick={novo}>
                  <FilePlus2 className="h-4 w-4" /> Novo estudo
                </button>
              </div>

              <div className="vr-acoes-status">
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
              </div>
            </div>

            {/* ----------------------------------------- progresso */}
            <div className="vr-progress vr-no-print">
              <div className="trilho">
                <span style={{ width: `${(concluidas / etapas.length) * 100}%` }} />
              </div>
              <div className="passos">
                {etapas.map(e => (
                  <span key={e.rotulo} className={e.ok ? 'ok' : ''}>{e.rotulo}</span>
                ))}
              </div>
            </div>
          </>
        )}

        {aviso && (
          <div className={aviso.tipo === 'ok' ? 'vr-nota' : 'vr-erro'}>{aviso.texto}</div>
        )}

        {/* ---------------------------------------------------- conteúdo */}
        {aba === 'simulacao' && (
          <div className="vr-grid">
            <FormularioEstudo
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
            <div id="vr-topo-resultado">
              <PainelEstudo input={input} resultado={resultado} />
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
