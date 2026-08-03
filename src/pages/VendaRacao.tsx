/**
 * /venda-racao — módulo de precificação e proposta de ração.
 *
 * NÃO substitui a /viabilidade (que é outro estudo, em iframe, sobre o cliente
 * montar a própria fábrica). Aqui a Branorte VENDE a ração pronta: o vendedor
 * monta a fórmula, soma custos, define margem e fecha o preço.
 *
 * Quatro abas:
 *   Simulação  — formulário (esquerda) + resultado interno (direita)
 *   Proposta   — o que o cliente vê, sem nenhum número interno
 *   Histórico  — propostas salvas, com filtro e status
 *   Configurações — defaults da empresa
 *
 * O rascunho fica em localStorage a cada mudança: fechar a aba sem querer não
 * pode custar 20 minutos de digitação do vendedor.
 */
import { useEffect, useMemo, useState } from 'react'
import { Calculator, Copy, FilePlus2, FileText, History, Save, Settings } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { useCan } from '@/hooks/usePermissions'
import {
  useAtualizarStatus, useConfigVendaRacao, useFormulasSalvas, useIngredientesCatalogo,
  useRemoverIngrediente, useRemoverSimulacao, useSalvarConfig, useSalvarFormula,
  useSalvarIngrediente, useSalvarSimulacao, useSimulacoes,
  type FiltrosSimulacao,
} from '@/hooks/usePrecificacaoRacao'
import { calcularSimulacao } from '@/lib/precificacao-racao/calculo'
import { novaSimulacao, normalizarInput, trocarEspecie } from '@/lib/precificacao-racao/estado'
import { dadosProposta } from '@/lib/precificacao-racao/proposta'
import { brl, hojeISO } from '@/lib/precificacao-racao/formato'
import { supabase } from '@/lib/supabase'
import type { Especie, SimulacaoInput, SimulacaoRow, StatusProposta } from '@/lib/precificacao-racao/tipos'
import { CONFIG_PADRAO, STATUS_PROPOSTA } from '@/lib/precificacao-racao/catalogo'
import { FormularioVendaRacao } from '@/components/precificacao-racao/FormularioVendaRacao'
import { PainelResultados } from '@/components/precificacao-racao/PainelResultados'
import { PropostaCliente } from '@/components/precificacao-racao/PropostaCliente'
import { HistoricoSimulacoes } from '@/components/precificacao-racao/HistoricoSimulacoes'
import { ConfiguracoesVendaRacao } from '@/components/precificacao-racao/ConfiguracoesVendaRacao'
import { Selecao } from '@/components/precificacao-racao/campos'
import '@/styles/venda-racao.css'

type Aba = 'simulacao' | 'proposta' | 'historico' | 'config'

/**
 * Chave PRÓPRIA. Não usar 'venda-racao:rascunho': a /producao-propria trata
 * aquela como rascunho legado DELA — lê e apaga (ProducaoPropria.tsx). Como o
 * `dados` aqui é SimulacaoInput e lá é EstudoInput, o vendedor que preenchesse
 * a venda e navegasse pro estudo perderia o rascunho e ainda veria um estudo
 * montado com lixo. Bug real, criado quando esta tela foi restaurada.
 */
const CHAVE_RASCUNHO = 'precificacao-racao:rascunho'

/** Código provisório enquanto a proposta não foi salva (o banco gera o oficial). */
function codigoProvisorio(): string {
  return `VR-${Date.now().toString(36).toUpperCase().slice(-6)}`
}

export function VendaRacao() {
  const { profile } = useAuth()
  const can = useCan()
  const podeVerTodas = profile?.role === 'admin' || can('venda_racao.ver_todas')

  // Se a config da empresa não carregar (rede caiu, RLS negou), o módulo NÃO trava:
  // cai nos defaults locais e o vendedor segue precificando. O erro continua
  // aparecendo no console pelo QueryCache global do App.
  const { data: configSalva, isLoading: carregandoConfig } = useConfigVendaRacao()
  const config = configSalva ?? (carregandoConfig ? null : CONFIG_PADRAO)
  const { data: ingredientes = [] } = useIngredientesCatalogo()

  const [aba, setAba] = useState<Aba>('simulacao')
  const [input, setInput] = useState<SimulacaoInput | null>(null)
  const [simulacaoId, setSimulacaoId] = useState<string | null>(null)
  const [codigo, setCodigo] = useState<string>(codigoProvisorio)
  const [filtros, setFiltros] = useState<FiltrosSimulacao>({})
  const [aviso, setAviso] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null)

  const { data: formulasSalvas = [] } = useFormulasSalvas(input?.produto.especie)
  const { data: simulacoes = [], isLoading: carregandoLista } = useSimulacoes(filtros)

  const salvarSimulacao = useSalvarSimulacao()
  const salvarConfig = useSalvarConfig()
  const salvarFormula = useSalvarFormula()
  const salvarIngrediente = useSalvarIngrediente()
  const removerIngrediente = useRemoverIngrediente()
  const removerSimulacao = useRemoverSimulacao()
  const atualizarStatus = useAtualizarStatus()

  // --- inicialização: rascunho local > simulação nova com os defaults --------
  useEffect(() => {
    if (input || !config) return
    const vendedor = profile?.display_name ?? ''
    try {
      const bruto = localStorage.getItem(CHAVE_RASCUNHO)
      if (bruto) {
        const salvo = JSON.parse(bruto) as { input: unknown; id: string | null; codigo?: string }
        setInput(normalizarInput(salvo.input, config))
        setSimulacaoId(salvo.id ?? null)
        if (salvo.codigo) setCodigo(salvo.codigo)
        return
      }
    } catch { /* rascunho corrompido: começa limpo */ }
    setInput(novaSimulacao(config, 'bovinos', vendedor))
  }, [config, input, profile?.display_name])

  // --- rascunho automático ---------------------------------------------------
  useEffect(() => {
    if (!input) return
    const t = setTimeout(() => {
      try {
        localStorage.setItem(CHAVE_RASCUNHO, JSON.stringify({ input, id: simulacaoId, codigo }))
      } catch { /* quota cheia: seguir sem rascunho é melhor que quebrar a tela */ }
    }, 600)
    return () => clearTimeout(t)
  }, [input, simulacaoId, codigo])

  useEffect(() => {
    if (!aviso) return
    const t = setTimeout(() => setAviso(null), 4000)
    return () => clearTimeout(t)
  }, [aviso])

  const resultado = useMemo(
    () => (input ? calcularSimulacao(input) : null),
    [input],
  )

  if (!input || !config || !resultado) {
    return (
      <div className="vr">
        <div className="vr-wrap"><div className="vr-card">Carregando o módulo…</div></div>
      </div>
    )
  }

  const proposta = dadosProposta(input, resultado, {
    codigo,
    textoComercial: config.textoComercial,
    avisoNutricional: config.avisoNutricional,
  })

  // --- ações -----------------------------------------------------------------
  const novaProposta = () => {
    setInput(novaSimulacao(config, input.produto.especie, profile?.display_name ?? ''))
    setSimulacaoId(null)
    setCodigo(codigoProvisorio())
    setAba('simulacao')
    setAviso({ tipo: 'ok', texto: 'Simulação nova aberta.' })
  }

  const duplicarAtual = () => {
    setSimulacaoId(null)
    setCodigo(codigoProvisorio())
    setInput(s => (s ? { ...s, status: 'rascunho' } : s))
    setAba('simulacao')
    setAviso({ tipo: 'ok', texto: 'Cópia criada — salve pra gerar um código novo.' })
  }

  const salvar = () => {
    salvarSimulacao.mutate({
      id: simulacaoId ?? undefined,
      input,
      resumo: {
        quantidadeKg: resultado.demanda.quantidadeKg,
        quantidadeMensalKg: resultado.demanda.quantidadeMensalKg,
        custoBasePorKg: resultado.custos.custoBasePorKg,
        precoSugeridoPorKg: resultado.precos.precoSugeridoPorKg,
        precoMinimoPorKg: resultado.precos.precoMinimoPorKg,
        precoNegociadoPorKg: resultado.negociado.precoPorKg,
        margemRealPct: resultado.negociado.margemRealPct,
        valorTotal: resultado.negociado.valorTotalPedido,
        lucroTotal: resultado.negociado.lucroTotalPedido,
        lucroMensal: resultado.negociado.lucroMensal,
      },
    }, {
      onSuccess: linha => {
        setSimulacaoId(linha.id)
        setCodigo(linha.codigo)
        setAviso({ tipo: 'ok', texto: `Proposta ${linha.codigo} salva.` })
      },
      onError: e => setAviso({ tipo: 'erro', texto: (e as Error).message || 'Não consegui salvar.' }),
    })
  }

  /** Abre uma proposta do histórico. Busca a linha inteira (a lista vem sem `dados`). */
  const abrirDoHistorico = async (id: string) => {
    const { data, error } = await supabase
      .from('venda_racao_simulacoes')
      .select('*')
      .eq('id', id)
      .maybeSingle()
    if (error || !data) {
      setAviso({ tipo: 'erro', texto: 'Não consegui abrir essa proposta.' })
      return
    }
    const linha = data as SimulacaoRow
    setInput(normalizarInput(linha.dados, config))
    setSimulacaoId(linha.id)
    setCodigo(linha.codigo)
    setAba('simulacao')
  }

  const duplicarDoHistorico = async (id: string) => {
    const { data, error } = await supabase
      .from('venda_racao_simulacoes')
      .select('*')
      .eq('id', id)
      .maybeSingle()
    if (error || !data) {
      setAviso({ tipo: 'erro', texto: 'Não consegui duplicar essa proposta.' })
      return
    }
    const linha = data as SimulacaoRow
    const base = normalizarInput(linha.dados, config)
    setInput({
      ...base,
      status: 'rascunho',
      identificacao: { ...base.identificacao, data: hojeISO() },
    })
    setSimulacaoId(null)
    setCodigo(codigoProvisorio())
    setAba('simulacao')
    setAviso({ tipo: 'ok', texto: 'Cópia aberta — salve pra gerar um código novo.' })
  }

  const abas: Array<{ id: Aba; label: string; icone: typeof Calculator }> = [
    { id: 'simulacao', label: 'Simulação', icone: Calculator },
    { id: 'proposta', label: 'Proposta do cliente', icone: FileText },
    { id: 'historico', label: 'Histórico', icone: History },
    { id: 'config', label: 'Configurações', icone: Settings },
  ]

  return (
    <div className="vr">
      <div className="vr-wrap">
        <div className="vr-brand">BRA<b>NORTE</b> · Fábricas de Ração</div>
        <div className="vr-eyebrow">Proposta comercial</div>
        <h1 className="vr-h1">Venda de Ração</h1>
        <p className="vr-lede">
          Calcule o custo, o preço ideal de venda, a margem e o resultado de cada negociação.
          Ração farelada para bovinos, suínos e aves — e milho triturado.
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
        {(aba === 'simulacao' || aba === 'proposta') && (
          <div
            className="vr-cta vr-no-print"
            style={{ marginTop: 14, alignItems: 'center', justifyContent: 'space-between' }}
          >
            <div className="vr-cta" style={{ marginTop: 0 }}>
              <button type="button" className="vr-btn primary" disabled={salvarSimulacao.isPending} onClick={salvar}>
                <Save className="h-4 w-4" />
                {salvarSimulacao.isPending ? 'Salvando…' : simulacaoId ? 'Salvar alterações' : 'Salvar simulação'}
              </button>
              <button type="button" className="vr-btn ghost" onClick={duplicarAtual}>
                <Copy className="h-4 w-4" /> Duplicar
              </button>
              <button type="button" className="vr-btn ghost" onClick={novaProposta}>
                <FilePlus2 className="h-4 w-4" /> Nova simulação
              </button>
            </div>

            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <span style={{ fontSize: 12, color: 'var(--vr-ink40)', fontFamily: 'var(--vr-mono)' }}>
                {codigo}
              </span>
              <Selecao
                valor={input.status}
                opcoes={STATUS_PROPOSTA.map(s => ({ v: s.chave as StatusProposta, label: s.nome }))}
                onChange={v => {
                  setInput(s => (s ? { ...s, status: v } : s))
                  if (simulacaoId) atualizarStatus.mutate({ id: simulacaoId, status: v })
                }}
              />
            </div>
          </div>
        )}

        {aviso && (
          <div className={aviso.tipo === 'ok' ? 'vr-nota' : 'vr-erro'}>{aviso.texto}</div>
        )}

        {/* ---------------------------------------------------- conteúdo */}
        {aba === 'simulacao' && (
          <div className="vr-grid">
            <FormularioVendaRacao
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
            <PainelResultados
              input={input}
              resultado={resultado}
              onPrecoNegociado={v => setInput(s => (s ? { ...s, venda: { ...s.venda, precoNegociadoPorKg: v } } : s))}
            />
          </div>
        )}

        {aba === 'proposta' && (
          <div style={{ marginTop: 18 }}>
            <PropostaCliente dados={proposta} />
          </div>
        )}

        {aba === 'historico' && (
          <div style={{ marginTop: 18 }}>
            <HistoricoSimulacoes
              linhas={simulacoes}
              carregando={carregandoLista}
              filtros={filtros}
              onFiltros={setFiltros}
              onAbrir={abrirDoHistorico}
              onDuplicar={duplicarDoHistorico}
              onRemover={id => removerSimulacao.mutate(id, {
                onSuccess: () => {
                  setAviso({ tipo: 'ok', texto: 'Proposta apagada.' })
                  if (id === simulacaoId) { setSimulacaoId(null); setCodigo(codigoProvisorio()) }
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
            <ConfiguracoesVendaRacao
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
            />
          </div>
        )}

        <footer style={{ marginTop: 28, fontSize: 11.5, color: 'var(--vr-ink40)', borderTop: '1px solid var(--vr-hair)', paddingTop: 16, lineHeight: 1.6 }}>
          Simulação {codigo} · valores estimados a partir dos custos informados.
          Custo total apurado: {brl(resultado.custos.custoBasePorKg, 4)}/kg.
          {' '}{config.avisoNutricional}
        </footer>
      </div>
    </div>
  )
}

export default VendaRacao
