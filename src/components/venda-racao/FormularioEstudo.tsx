/**
 * Coluna esquerda do estudo: o formulário em 7 etapas.
 *
 * O componente é "burro" de propósito — recebe o input e devolve o input novo.
 * Todo cálculo vive em lib/venda-racao/calculo.ts, então dá pra mexer no layout
 * sem risco de mudar economia ou payback.
 */
import { useState } from 'react'
import { Save, Scale, Undo2 } from 'lucide-react'
import {
  CATEGORIAS, ehIngredienteRestrito, ESPECIES, INGREDIENTES_PADRAO, novoIdIngrediente,
  ORIGEM_CUSTOS, PESOS_SACO,
} from '@/lib/venda-racao/catalogo'
import { consumoSugerido } from '@/lib/venda-racao/estado'
import { brl, brlKg, kg, kgHora, numero, pct, toneladas } from '@/lib/venda-racao/formato'
import { temSubstituto, type Substituto } from '@/lib/substituicoes-racao'
import { SubstituirIngrediente } from './SubstituirIngrediente'
import { PainelNutricional } from './PainelNutricional'
import { RebalancearFormula } from './RebalancearFormula'
import type {
  ConfigEstudo, Especie, EstudoInput, FormulaSalvaRow, IngredienteCatalogoRow,
  IngredienteFormula, ResultadoEstudo, UnidadePreco,
} from '@/lib/venda-racao/tipos'
import { Alternador, Campo, CampoNumero, CampoTexto, CustoLinha, Etapa, Selecao } from './campos'

interface Props {
  /** Fase de preencher: layout de questionário (coluna única). */
  largo?: boolean
  /**
   * Modo assistente: renderiza SÓ a etapa pedida (1–8). `undefined` mostra
   * todas, que é como as duas telas se comportavam antes — o fallback existe
   * pra nenhuma outra chamada quebrar.
   *
   * Trocar de etapa DESMONTA os campos da anterior. Isso é seguro porque o
   * valor mora em `input` (estado da página), não no DOM. O que NÃO pode é
   * desmontar a cada tecla: o CampoNumero guarda a string local enquanto está
   * focado, e remontar no meio da digitação comeria o que foi digitado.
   */
  etapa?: number
  input: EstudoInput
  onChange: (fn: (s: EstudoInput) => EstudoInput) => void
  onTrocarEspecie: (e: Especie) => void
  resultado: ResultadoEstudo
  config: ConfigEstudo
  ingredientesCatalogo: IngredienteCatalogoRow[]
  formulasSalvas: FormulaSalvaRow[]
  onSalvarFormula: () => void
  salvandoFormula: boolean
}

const UNIDADES_PARTICIPACAO = [
  { v: 'pct' as const, label: '%' },
  { v: 'kg_t' as const, label: 'kg/t' },
  { v: 'g_t' as const, label: 'g/t' },
]

const UNIDADES_PRECO = [
  { v: 'kg' as const, label: 'R$/kg' },
  { v: 'saco' as const, label: 'R$/saco' },
  { v: 't' as const, label: 'R$/t' },
]

export function FormularioEstudo({
  largo,
  etapa,
  input, onChange, onTrocarEspecie, resultado, config,
  ingredientesCatalogo, formulasSalvas, onSalvarFormula, salvandoFormula,
}: Props) {
  const {
    identificacao: ident, produto, necessidade: nec, atual, formula,
    custos, dimensionamento: dim, investimento: inv,
  } = input

  /** No modo assistente só a etapa atual aparece; sem ele, tudo. */
  const ver = (n: number) => etapa === undefined || etapa === n

  const ehMilho = produto.especie === 'milho'
  const categorias = CATEGORIAS[produto.especie] ?? []
  const categoriaAtual = categorias.find(c => c.chave === produto.categoria)
  const especieMeta = ESPECIES.find(e => e.chave === produto.especie)

  const setIdent = (p: Partial<typeof ident>) =>
    onChange(s => ({ ...s, identificacao: { ...s.identificacao, ...p } }))
  const setNec = (p: Partial<typeof nec>) =>
    onChange(s => ({ ...s, necessidade: { ...s.necessidade, ...p } }))
  const setAtual = (p: Partial<typeof atual>) =>
    onChange(s => ({ ...s, atual: { ...s.atual, ...p } }))
  const setFormula = (p: Partial<typeof formula>) =>
    onChange(s => ({ ...s, formula: { ...s.formula, ...p } }))
  const setCustos = (p: Partial<typeof custos>) =>
    onChange(s => ({ ...s, custos: { ...s.custos, ...p } }))
  const setDim = (p: Partial<typeof dim>) =>
    onChange(s => ({ ...s, dimensionamento: { ...s.dimensionamento, ...p } }))
  const setInv = (p: Partial<typeof inv>) =>
    onChange(s => ({ ...s, investimento: { ...s.investimento, ...p } }))

  const trocarCategoria = (chave: string) => {
    onChange(s => {
      // Consumo CONFIRMADO é dado que veio da boca do cliente — trocar de fase
      // não pode apagá-lo. Antes daqui, quem confirmava 340 kg/mês e depois
      // corrigia a categoria via o número virar 297 sem aviso nenhum.
      if (s.necessidade.consumoConfirmado) {
        return { ...s, produto: { ...s.produto, categoria: chave } }
      }
      return {
        ...s,
        produto: { ...s.produto, categoria: chave },
        necessidade: {
          ...s.necessidade,
          // ainda não confirmado = é referência de catálogo, pode acompanhar a fase
          consumoPorAnimal: consumoSugerido(s.produto.especie, chave) || s.necessidade.consumoPorAnimal,
          consumoConfirmado: false,
        },
      }
    })
  }

  const alterarItem = (id: string, p: Partial<IngredienteFormula>) =>
    setFormula({ itens: formula.itens.map(i => (i.id === id ? { ...i, ...p } : i)) })

  const removerItem = (id: string) =>
    setFormula({ itens: formula.itens.filter(i => i.id !== id), formulaId: null })

  // Qual card está com o painel de substituição aberto.
  const [substituindo, setSubstituindo] = useState<string | null>(null)

  // Rebalanceamento: painel aberto e a fórmula de antes, pra desfazer.
  // Guardo os ITENS inteiros e não só os percentuais — o rebalanceamento pode
  // ter entrado em cima de uma fórmula que o vendedor levou 10 minutos montando.
  const [rebalanceando, setRebalanceando] = useState(false)
  const [antesDoRebal, setAntesDoRebal] = useState<IngredienteFormula[] | null>(null)

  const aplicarRebalanceamento = (novos: Array<{ id: string; participacao: number }>) => {
    const mapa = new Map(novos.map(n => [n.id, n.participacao]))
    setAntesDoRebal(formula.itens)
    setFormula({
      formulaId: null, // deixou de ser a de referência — o motor mexeu nela
      itens: formula.itens.map(i => {
        const p = mapa.get(i.id)
        if (p == null) return i
        // O otimizador raciocina em %, mas o vendedor pode ter digitado kg/t.
        // Devolvo na unidade DELE — trocar a unidade por baixo é o tipo de
        // "ajuda" que faz a pessoa desconfiar da tela.
        const conv = i.unidadeParticipacao === 'pct' ? p
          : i.unidadeParticipacao === 'kg_t' ? p * 10
          : p * 10000
        return { ...i, participacao: Number(conv.toFixed(4)) }
      }),
    })
    setRebalanceando(false)
  }

  const desfazerRebalanceamento = () => {
    if (!antesDoRebal) return
    setFormula({ itens: antesDoRebal })
    setAntesDoRebal(null)
  }

  /**
   * Troca `pct` pontos do ingrediente pelo substituto. Se sobrar original, vira
   * DOIS itens — é o caso normal: ninguém troca 69,8% de milho por 69,8% de DDG.
   * A soma da fórmula não se mexe, porque o que entra é exatamente o que saiu.
   */
  const aplicarSubstituicao = (id: string, s: Substituto, pct: number) => {
    const alvo = formula.itens.find(x => x.id === id)
    if (!alvo) return
    const emPct = alvo.unidadeParticipacao === 'pct'
    const atual = emPct ? alvo.participacao : alvo.participacao / 10
    const trocar = Math.max(0, Math.min(pct, atual))
    if (trocar <= 0) return
    const resto = atual - trocar
    const conv = (v: number) => (emPct ? v : v * 10)

    setFormula({
      // deixou de ser a fórmula de referência carregada — o vendedor mexeu nela
      formulaId: null,
      itens: formula.itens.flatMap(x => {
        if (x.id !== id) return [x]
        const entrando = {
          id: novoIdIngrediente(),
          nome: s.nome,
          participacao: Number(conv(trocar).toFixed(4)),
          unidadeParticipacao: x.unidadeParticipacao,
          preco: s.preco,
          unidadePreco: 'kg' as const,
          pesoSacoIngrediente: 60,
        }
        return resto > 0.0001
          ? [{ ...x, participacao: Number(conv(resto).toFixed(4)) }, entrando]
          : [entrando]
      }),
    })
    setSubstituindo(null)
  }

  const adicionarItem = (nome: string, preco: number, unidade: UnidadePreco, pesoSaco: number) =>
    setFormula({
      formulaId: null,
      itens: [...formula.itens, {
        id: novoIdIngrediente(), nome, participacao: 0, unidadeParticipacao: 'pct',
        preco, unidadePreco: unidade, pesoSacoIngrediente: pesoSaco || 60,
      }],
    })

  const carregarFormulaSalva = (id: string) => {
    const f = formulasSalvas.find(x => x.id === id)
    if (!f) { setFormula({ formulaId: null }); return }
    setFormula({
      formulaId: f.id,
      nome: f.nome,
      itens: (f.itens ?? []).map(i => ({ ...i, id: i.id || novoIdIngrediente() })),
    })
  }

  // Catálogo do banco quando existir; senão a lista local de referência.
  // Silagem, volumoso e líquidos só entram quando a configuração declara que o
  // equipamento e o processo são compatíveis — a Compacta é farelada.
  const opcoesIngrediente = (ingredientesCatalogo.length > 0
    ? ingredientesCatalogo.map(i => ({
        nome: i.nome, preco: Number(i.preco) || 0,
        unidade: i.unidade_preco as UnidadePreco, pesoSaco: Number(i.peso_saco) || 60,
      }))
    : INGREDIENTES_PADRAO.map(i => ({ nome: i.nome, preco: i.preco, unidade: i.unidade, pesoSaco: 60 }))
  ).filter(o => config.permiteIngredientesUmidos || !ehIngredienteRestrito(o.nome))

  const restritosNaFormula = formula.itens.filter(i => ehIngredienteRestrito(i.nome))
  const f = resultado.formula
  const somaOk = f.fechada
  const d = resultado.demanda

  return (
    <div className={`vr-card${largo ? ' vr-form-largo' : ''}`}>
      <h2>Dados do estudo</h2>

      {/* ---------------------------------------------------- identificação
          Nada aqui é obrigatório — o estudo calcula sem preencher um campo só
          desta etapa. O que está aqui é o que sai impresso no cabeçalho da
          apresentação e do PDF.

          SAÍRAM DOIS CAMPOS (04/08/2026, pedido do Daniel): "Telefone" e
          "Observações internas". O telefone servia pra montar o link
          wa.me/NUMERO; sem ele o botão de WhatsApp abre o seletor de contato do
          próprio app, que é o que o vendedor faz na prática — ele já está na
          conversa. O campo continua no tipo e no banco, então estudo antigo que
          tem telefone gravado segue abrindo a conversa direto. */}
      {ver(1) && (
      <Etapa numero={1} titulo="Dados do cliente e do estudo" descricao="Saem no cabeçalho da apresentação e do PDF. Nenhum é obrigatório.">
        <div className="vr-detbody">
          <Campo label="Nome do cliente">
            <CampoTexto valor={ident.clienteNome} onChange={v => setIdent({ clienteNome: v })} placeholder="Ex.: João da Silva" />
          </Campo>
          <Campo label="Propriedade ou empresa">
            <CampoTexto valor={ident.clienteEmpresa} onChange={v => setIdent({ clienteEmpresa: v })} placeholder="Ex.: Fazenda Boa Vista" />
          </Campo>
          <div className="vr-row2">
            <Campo label="Cidade">
              <CampoTexto valor={ident.clienteCidade} onChange={v => setIdent({ clienteCidade: v })} />
            </Campo>
            <Campo label="Estado">
              <CampoTexto valor={ident.clienteUf} onChange={v => setIdent({ clienteUf: v.toUpperCase().slice(0, 2) })} placeholder="UF" />
            </Campo>
          </div>
          <Campo label="Vendedor responsável">
            <CampoTexto valor={ident.vendedorNome} onChange={v => setIdent({ vendedorNome: v })} />
          </Campo>
          <div className="vr-row2">
            <Campo label="Data do estudo">
              <CampoTexto tipo="date" valor={ident.data} onChange={v => setIdent({ data: v })} />
            </Campo>
            <Campo label="Validade dos preços">
              <CampoTexto tipo="date" valor={ident.validade} onChange={v => setIdent({ validade: v })} />
            </Campo>
          </div>
        </div>
      </Etapa>
      )}

      {/* ------------------------------------------------------------ 3 */}
      {ver(2) && (
      <Etapa numero={2} titulo="Qual produto o cliente precisa produzir?">
        <div className="vr-species">
          {ESPECIES.map(e => (
            <div
              key={e.chave}
              role="button"
              tabIndex={0}
              className={`vr-sp${produto.especie === e.chave ? ' on' : ''}`}
              onClick={() => onTrocarEspecie(e.chave)}
              onKeyDown={ev => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); onTrocarEspecie(e.chave) } }}
            >
              <div className="ic">{e.icone}</div>
              <div className="nm">{e.nome}</div>
            </div>
          ))}
        </div>

        <div style={{ marginTop: 10 }}>
          <Campo label="Categoria / fase">
            <Selecao
              valor={produto.categoria}
              opcoes={categorias.map(c => ({ v: c.chave, label: c.nome }))}
              onChange={trocarCategoria}
            />
          </Campo>
          {produto.categoria === 'outro' && (
            <div style={{ marginTop: 8 }}>
              <CampoTexto
                valor={produto.categoriaLivre}
                onChange={v => onChange(s => ({ ...s, produto: { ...s.produto, categoriaLivre: v } }))}
                placeholder="Descreva a categoria"
              />
            </div>
          )}
          {categoriaAtual?.nota && <div className="vr-hint">{categoriaAtual.nota}</div>}
        </div>
      </Etapa>
      )}

      {/* ------------------------------------------------------------ 2 */}
      {ver(3) && (
      <Etapa
        numero={3}
        titulo="Qual é a necessidade de produção do cliente?"
        descricao="Pelo plantel ou pela quantidade que ele já sabe que consome."
      >
        <Alternador
          valor={nec.modo}
          opcoes={[
            { v: 'animais' as const, label: 'Pelo nº de animais' },
            { v: 'direto' as const, label: 'Quantidade direta' },
          ]}
          onChange={v => setNec({ modo: v })}
        />

        {nec.modo === 'animais' ? (
          <div style={{ marginTop: 10, display: 'grid', gap: 9 }}>
            <div className="vr-row2">
              <Campo label={`Nº de ${especieMeta?.animal ?? 'animais'}`}>
                <CampoNumero valor={nec.numeroAnimais} casas={0} onChange={v => setNec({ numeroAnimais: v })} />
              </Campo>
              <Campo
                label="Consumo por animal"
                unidade={nec.baseConsumo === 'dia' ? 'kg/dia' : nec.baseConsumo === 'mes' ? 'kg/mês' : 'kg/ciclo'}
              >
                <CampoNumero
                  valor={nec.consumoPorAnimal} casas={3}
                  onChange={v => setNec({ consumoPorAnimal: v, consumoConfirmado: true })}
                />
              </Campo>
            </div>
            <div className="vr-row2">
              <Campo label="Unidade do consumo">
                <Selecao
                  valor={nec.baseConsumo}
                  opcoes={[
                    { v: 'mes' as const, label: 'kg por mês' },
                    { v: 'dia' as const, label: 'kg por dia' },
                    { v: 'ciclo' as const, label: 'kg por ciclo' },
                  ]}
                  onChange={v => setNec({ baseConsumo: v })}
                />
              </Campo>
              <Campo
                label={nec.baseConsumo === 'ciclo' ? 'Dias do ciclo' : 'Nº de dias'}
                unidade={nec.baseConsumo === 'mes' ? 'não usado' : 'dias'}
              >
                <CampoNumero
                  valor={nec.dias} casas={0} disabled={nec.baseConsumo === 'mes'}
                  onChange={v => setNec({ dias: v })}
                />
              </Campo>
            </div>
            <Campo label="Margem de segurança" unidade="%">
              <CampoNumero valor={nec.margemSegurancaPct} casas={2} onChange={v => setNec({ margemSegurancaPct: v })} />
            </Campo>

            <label className={`vr-check${nec.consumoConfirmado ? ' on' : ''}`}>
              <input
                type="checkbox"
                checked={nec.consumoConfirmado}
                onChange={e => setNec({ consumoConfirmado: e.target.checked })}
              />
              <span>
                <b>Confirmei o consumo com o cliente.</b>{' '}
                {nec.consumoConfirmado
                  ? 'O estudo usa o número confirmado.'
                  : `O valor de ${numero(nec.consumoPorAnimal, 3)} kg é REFERÊNCIA de catálogo — `
                    + 'o consumo varia com peso, genética, fase, manejo, formulação e objetivo produtivo.'}
              </span>
            </label>
          </div>
        ) : (
          <div style={{ marginTop: 10, display: 'grid', gap: 9 }}>
            <div className="vr-row3">
              <Campo label="Quantidade">
                <CampoNumero valor={nec.quantidadeInformada} casas={3} onChange={v => setNec({ quantidadeInformada: v })} />
              </Campo>
              <Campo label="Unidade">
                <Selecao
                  valor={nec.unidadeQuantidade}
                  opcoes={[
                    { v: 'kg' as const, label: 'kg' },
                    { v: 't' as const, label: 'toneladas' },
                    { v: 'sacos' as const, label: 'sacos' },
                  ]}
                  onChange={v => setNec({ unidadeQuantidade: v })}
                />
              </Campo>
              <Campo label="Período">
                <Selecao
                  valor={nec.periodoQuantidade}
                  opcoes={[
                    { v: 'dia' as const, label: 'por dia' },
                    { v: 'mes' as const, label: 'por mês' },
                    { v: 'ano' as const, label: 'por ano' },
                  ]}
                  onChange={v => setNec({ periodoQuantidade: v })}
                />
              </Campo>
            </div>
            <Campo label="Margem de segurança" unidade="%">
              <CampoNumero valor={nec.margemSegurancaPct} casas={2} onChange={v => setNec({ margemSegurancaPct: v })} />
            </Campo>
          </div>
        )}

        <details className="vr-det">
          <summary>Conversão em sacos (opcional)</summary>
          <div className="vr-detbody">
            <Campo label="Peso do saco" unidade="kg" dica="Só pra converter — o estudo trabalha em kg e toneladas.">
              <div className="vr-row2">
                <Selecao
                  valor={PESOS_SACO.includes(nec.pesoSaco) ? String(nec.pesoSaco) : 'custom'}
                  opcoes={[
                    ...PESOS_SACO.map(p => ({ v: String(p), label: `${p} kg` })),
                    { v: 'custom', label: 'Personalizado' },
                  ]}
                  onChange={v => { if (v !== 'custom') setNec({ pesoSaco: Number(v) }) }}
                />
                <CampoNumero valor={nec.pesoSaco} casas={2} onChange={v => setNec({ pesoSaco: v })} />
              </div>
            </Campo>
            <div className="vr-hint">Equivale a {numero(Math.round(d.sacosMes))} sacos por mês.</div>
          </div>
        </details>

        <div className="vr-live">
          <b>{kg(d.diariaKg)}</b>/dia · <b>{kg(d.mensalKg)}</b>/mês ·{' '}
          <b>{toneladas(d.toneladasMes)}</b>/mês · <b>{toneladas(d.toneladasAno)}</b>/ano
        </div>
      </Etapa>
      )}

      {/* ------------------------------------------------------------ 4 */}
      {ver(4) && (
      <Etapa
        numero={4}
        titulo="Quanto o cliente gasta atualmente?"
        descricao="É este número que a produção própria vai tentar reduzir."
      >
        <Alternador
          valor={atual.modo}
          opcoes={[
            { v: 'compra' as const, label: 'Compra ração pronta' },
            { v: 'proprio' as const, label: 'Já produz de outro jeito' },
          ]}
          onChange={v => setAtual({ modo: v })}
        />

        {atual.modo === 'compra' ? (
          <div style={{ marginTop: 10, display: 'grid', gap: 9 }}>
            <div className="vr-row2">
              <Campo label="Preço da ração pronta">
                <CampoNumero valor={atual.preco} casas={4} onChange={v => setAtual({ preco: v })} />
              </Campo>
              <Campo label="Unidade">
                <Selecao
                  valor={atual.unidadePreco}
                  opcoes={UNIDADES_PRECO.map(u => ({ v: u.v, label: u.label }))}
                  onChange={v => setAtual({ unidadePreco: v })}
                />
              </Campo>
            </div>
            {atual.unidadePreco === 'saco' && (
              <Campo label="Peso do saco comprado" unidade="kg">
                <CampoNumero valor={atual.pesoSacoCompra} casas={2} onChange={v => setAtual({ pesoSacoCompra: v })} />
              </Campo>
            )}

            <details className="vr-det">
              <summary>Frete, descarga, perdas e outros custos da compra</summary>
              <div style={{ marginTop: 10 }}>
                <CustoLinha label="Frete pago na compra" unidade="R$/kg" casas={4} custo={atual.frete} onChange={c => setAtual({ frete: c })} />
                <CustoLinha label="Descarga" unidade="R$/kg" casas={4} custo={atual.descarga} onChange={c => setAtual({ descarga: c })} />
                <CustoLinha label="Outros custos" unidade="R$/kg" casas={4} custo={atual.outros} onChange={c => setAtual({ outros: c })} />
                <div style={{ marginTop: 10 }}>
                  <Campo label="Perdas (armazenagem, manuseio)" unidade="%">
                    <CampoNumero valor={atual.perdasPct} casas={2} onChange={v => setAtual({ perdasPct: v })} />
                  </Campo>
                </div>
              </div>
            </details>
          </div>
        ) : (
          <div style={{ marginTop: 10, display: 'grid', gap: 9 }}>
            <Campo
              label="Custo atual da operação" unidade="R$/kg"
              dica="O que o cliente apura hoje por kg produzido, do jeito que ele faz."
            >
              <CampoNumero valor={atual.custoManualPorKg} casas={4} onChange={v => setAtual({ custoManualPorKg: v })} />
            </Campo>
          </div>
        )}

        <Campo label="Observações">
          <textarea
            className="vr-inp txt" style={{ minHeight: 56, resize: 'vertical' }}
            value={atual.observacoes}
            onChange={e => setAtual({ observacoes: e.target.value })}
            placeholder="Ex.: compra de 3 em 3 meses, sempre da mesma revenda."
          />
        </Campo>

        <div className="vr-live">
          Custo atual: <b>{brlKg(resultado.atual.custoPorKg)}</b> ·{' '}
          <b>{brl(resultado.atual.custoMensal)}</b>/mês ·{' '}
          <b>{brl(resultado.atual.custoAnual)}</b>/ano
        </div>
      </Etapa>
      )}

      {/* ------------------------------------------------------------ 5 */}
      {ver(5) && (
      <Etapa
        numero={5}
        titulo={ehMilho ? 'Preço do milho a triturar' : 'O que ele vai usar na fórmula'}
        descricao={ehMilho ? undefined : 'Ingredientes que o cliente consegue comprar ou já tem na propriedade.'}
      >
        {ehMilho ? (
          <div style={{ display: 'grid', gap: 9 }}>
            <div className="vr-row2">
              <Campo label="Preço do milho">
                <CampoNumero valor={formula.milhoPreco} casas={4} onChange={v => setFormula({ milhoPreco: v })} />
              </Campo>
              <Campo label="Unidade">
                <Selecao
                  valor={formula.milhoUnidadePreco}
                  opcoes={UNIDADES_PRECO.map(u => ({ v: u.v, label: u.label }))}
                  onChange={v => setFormula({ milhoUnidadePreco: v })}
                />
              </Campo>
            </div>
            {formula.milhoUnidadePreco === 'saco' && (
              <Campo label="Peso da saca" unidade="kg">
                <CampoNumero valor={formula.milhoPesoSaca} casas={2} onChange={v => setFormula({ milhoPesoSaca: v })} />
              </Campo>
            )}
            <Campo label="Perda de limpeza e moagem" unidade="%">
              <CampoNumero valor={custos.perdaPct} casas={2} onChange={v => setCustos({ perdaPct: v })} />
            </Campo>
            <div className="vr-live">
              Matéria-prima: <b>{brlKg(f.custoIngredientesPorKg)}</b> · com perda{' '}
              <b>{brlKg(resultado.producao.custoIngredientesAjustadoPorKg)}</b>
            </div>
          </div>
        ) : (
          <>
            {formulasSalvas.length > 0 && (
              <div style={{ marginBottom: 10 }}>
                <Campo label="Fórmula cadastrada">
                  <Selecao
                    valor={formula.formulaId ?? ''}
                    opcoes={[{ v: '', label: '— montar manualmente —' }, ...formulasSalvas.map(x => ({ v: x.id, label: x.nome }))]}
                    onChange={carregarFormulaSalva}
                  />
                </Campo>
              </div>
            )}

            {formula.itens.map(i => {
              const linha = f.linhas.find(l => l.id === i.id)
              const comSaca = i.unidadePreco === 'saco'
              return (
                <div key={i.id} className="vr-ing">
                  <div className="l1">
                    <input
                      value={i.nome}
                      aria-label="Nome do ingrediente"
                      onChange={e => alterarItem(i.id, { nome: e.target.value })}
                      placeholder="Ingrediente"
                    />
                    {temSubstituto(i.nome, produto.especie) && (
                      <button
                        type="button"
                        className={`frm sub${substituindo === i.id ? ' on' : ''}`}
                        title={`O cliente não tem ${i.nome}? Ver o que entra no lugar`}
                        aria-label={`Substituir ${i.nome}`}
                        onClick={() => setSubstituindo(v => (v === i.id ? null : i.id))}
                      >⇄</button>
                    )}
                    <button type="button" className="frm" title="Remover ingrediente" onClick={() => removerItem(i.id)}>×</button>
                  </div>
                  <div className={`l2${comSaca ? ' comsaca' : ''}`}>
                    <CampoNumero
                      valor={i.participacao} casas={3} className="" aria-label="Participação"
                      onChange={v => alterarItem(i.id, { participacao: v })}
                    />
                    <select
                      value={i.unidadeParticipacao} aria-label="Unidade da participação"
                      onChange={e => alterarItem(i.id, { unidadeParticipacao: e.target.value as IngredienteFormula['unidadeParticipacao'] })}
                    >
                      {UNIDADES_PARTICIPACAO.map(u => <option key={u.v} value={u.v}>{u.label}</option>)}
                    </select>
                    <CampoNumero
                      valor={i.preco} casas={4} className="" aria-label="Preço de compra"
                      onChange={v => alterarItem(i.id, { preco: v })}
                    />
                    <select
                      value={i.unidadePreco} aria-label="Unidade do preço"
                      onChange={e => alterarItem(i.id, { unidadePreco: e.target.value as UnidadePreco })}
                    >
                      {UNIDADES_PRECO.map(u => <option key={u.v} value={u.v}>{u.label}</option>)}
                    </select>
                    {comSaca && (
                      <CampoNumero
                        valor={i.pesoSacoIngrediente} casas={2} className="" aria-label="Peso do saco do ingrediente"
                        onChange={v => alterarItem(i.id, { pesoSacoIngrediente: v })}
                      />
                    )}
                  </div>
                  {linha && (
                    <div className="custo">
                      {numero(linha.kgPorTonelada, 1)} kg/t · {brl(linha.precoPorKg, 4)}/kg ·{' '}
                      {brl(linha.custoPorKgRacao, 4)}/kg de ração
                    </div>
                  )}
                  {substituindo === i.id && (
                    <SubstituirIngrediente
                      item={i}
                      especie={produto.especie}
                      onFechar={() => setSubstituindo(null)}
                      onAplicar={(s, pct) => aplicarSubstituicao(i.id, s, pct)}
                    />
                  )}
                </div>
              )
            })}

            <div style={{ marginTop: 8 }}>
              <select
                className="vr-inp"
                value=""
                aria-label="Adicionar ingrediente"
                onChange={e => {
                  const o = opcoesIngrediente.find(x => x.nome === e.target.value)
                  if (o) adicionarItem(o.nome, o.preco, o.unidade, o.pesoSaco)
                  else if (e.target.value === '__novo') adicionarItem('', 0, 'kg', 60)
                  e.currentTarget.value = ''
                }}
              >
                <option value="">+ Adicionar ingrediente…</option>
                {opcoesIngrediente.map(o => <option key={o.nome} value={o.nome}>{o.nome}</option>)}
                <option value="__novo">➕ Ingrediente novo (em branco)</option>
              </select>
            </div>

            <div className="vr-fsum">
              <span className={somaOk ? 'ok' : 'bad'}>
                {numero(f.totalKgPorTonelada, 1)} kg/t ({numero(f.totalParticipacaoPct, 1)}%)
                {somaOk ? ' ✓' : f.diferencaKgPorTonelada > 0
                  ? ` · faltam ${numero(f.diferencaKgPorTonelada, 1)} kg`
                  : ` · passou ${numero(Math.abs(f.diferencaKgPorTonelada), 1)} kg`}
              </span>
              <span>{brlKg(f.custoIngredientesPorKg)}</span>
            </div>

            {restritosNaFormula.length > 0 && (
              <div className="vr-alerta">
                A fórmula tem ingrediente úmido ou líquido
                ({restritosNaFormula.map(i => i.nome).join(', ')}). A linha farelada só processa
                material seco — confirme que o equipamento e o processo do cliente são compatíveis.
              </div>
            )}

            {/* Rebalancear: acha a composição que atende a fase. Fica ANTES do
                painel porque a ordem de uso é essa — o vendedor olha o que está
                errado, manda arrumar, e confere de novo logo abaixo. */}
            <div className="vr-rebal-acoes vr-no-print">
              <button
                type="button"
                className={`vr-btn ghost${rebalanceando ? ' on' : ''}`}
                onClick={() => setRebalanceando(v => !v)}
                disabled={formula.itens.length < 2}
              >
                <Scale className="h-4 w-4" /> Rebalancear fórmula
              </button>
              {antesDoRebal && (
                <button type="button" className="vr-btn ghost" onClick={desfazerRebalanceamento}>
                  <Undo2 className="h-4 w-4" /> Desfazer
                </button>
              )}
            </div>

            {rebalanceando && (
              <RebalancearFormula
                itens={formula.itens}
                especie={produto.especie}
                categoria={produto.categoria}
                demandaMensalKg={d.mensalKg}
                onAplicar={aplicarRebalanceamento}
                onFechar={() => setRebalanceando(false)}
              />
            )}

            {/* O que esta fórmula ENTREGA ao animal. Fica logo abaixo da soma
                porque as duas respondem à mesma pergunta — "a fórmula está de
                pé?" — e até agora só a metade do dinheiro estava respondida. */}
            <PainelNutricional
              itens={formula.itens}
              especie={produto.especie}
              categoria={produto.categoria}
              formula={f}
            />

            <div className="vr-row2" style={{ marginTop: 9 }}>
              <Campo label="Nome da fórmula" unidade="pra salvar">
                <CampoTexto valor={formula.nome} onChange={v => setFormula({ nome: v })} placeholder="Ex.: Terminação 18%" />
              </Campo>
              <div style={{ display: 'flex', alignItems: 'flex-end' }}>
                <button
                  type="button"
                  className="vr-btn ghost"
                  style={{ width: '100%', justifyContent: 'center' }}
                  disabled={!formula.nome.trim() || formula.itens.length === 0 || salvandoFormula}
                  onClick={onSalvarFormula}
                >
                  <Save className="h-4 w-4" /> {salvandoFormula ? 'Salvando…' : 'Salvar fórmula'}
                </button>
              </div>
            </div>

            <div className="vr-hint" style={{ marginTop: 8 }}>{config.avisoNutricional}</div>
          </>
        )}
      </Etapa>
      )}

      {/* ------------------------------------------------------------ 6 */}
      {ver(6) && (
      <Etapa
        numero={6}
        titulo="Custos de produzir na propriedade"
        descricao="Todo valor abaixo é ESTIMATIVA. Confirme com o cliente, ajuste ou desligue o que não existe lá."
      >
        {!ehMilho && (
          <Campo label="Perda na produção" unidade="%" dica={ORIGEM_CUSTOS.perdaPct}>
            <CampoNumero valor={custos.perdaPct} casas={2} onChange={v => setCustos({ perdaPct: v })} />
          </Campo>
        )}

        <details className="vr-det" open>
          <summary>Custos operacionais por kg</summary>
          <div style={{ marginTop: 10 }}>
            <CustoLinha label="Energia" unidade="R$/kg" custo={custos.energia} origem={ORIGEM_CUSTOS.energia} onChange={c => setCustos({ energia: c })} />
            <CustoLinha label="Mão de obra" unidade="R$/kg" custo={custos.maoDeObra} origem={ORIGEM_CUSTOS.maoDeObra} onChange={c => setCustos({ maoDeObra: c })} />
            <CustoLinha label="Moagem" unidade="R$/kg" custo={custos.moagem} origem={ORIGEM_CUSTOS.moagem} onChange={c => setCustos({ moagem: c })} />
            <CustoLinha label="Mistura" unidade="R$/kg" custo={custos.mistura} origem={ORIGEM_CUSTOS.mistura} onChange={c => setCustos({ mistura: c })} />
            <CustoLinha label="Manutenção" unidade="R$/kg" custo={custos.manutencao} origem={ORIGEM_CUSTOS.manutencao} onChange={c => setCustos({ manutencao: c })} />
            <CustoLinha label="Depreciação" unidade="R$/kg" custo={custos.depreciacao} origem={ORIGEM_CUSTOS.depreciacao} onChange={c => setCustos({ depreciacao: c })} />
            <CustoLinha label="Administrativo" unidade="R$/kg" custo={custos.administrativo} origem={ORIGEM_CUSTOS.administrativo} onChange={c => setCustos({ administrativo: c })} />
            <CustoLinha label="Carregamento" unidade="R$/kg" custo={custos.carregamento} origem={ORIGEM_CUSTOS.carregamento} onChange={c => setCustos({ carregamento: c })} />
            <CustoLinha label="Outros custos variáveis" unidade="R$/kg" custo={custos.outrosVariaveis} origem={ORIGEM_CUSTOS.outrosVariaveis} onChange={c => setCustos({ outrosVariaveis: c })} />
          </div>
        </details>

        <details className="vr-det">
          <summary>Ensacamento e custos fixos</summary>
          <div style={{ marginTop: 10 }}>
            <CustoLinha label="Embalagem" unidade="R$/saco" casas={2} custo={custos.embalagem} origem={ORIGEM_CUSTOS.embalagem} onChange={c => setCustos({ embalagem: c })} />
            <CustoLinha label="Etiqueta" unidade="R$/saco" casas={2} custo={custos.etiqueta} origem={ORIGEM_CUSTOS.etiqueta} onChange={c => setCustos({ etiqueta: c })} />
            <CustoLinha
              label="Custos fixos rateados" unidade="R$/mês" casas={2}
              custo={custos.custosFixosMensais} origem={ORIGEM_CUSTOS.custosFixosMensais}
              onChange={c => setCustos({ custosFixosMensais: c })}
            />
            {custos.custosFixosMensais.ativo && (
              <div className="vr-hint">
                Diluído no volume do mês: {brlKg(resultado.producao.fixosPorKg)} ·{' '}
                {brl(custos.custosFixosMensais.valor)} ÷ {kg(d.mensalKg)}
              </div>
            )}
          </div>
        </details>

        <div className="vr-live">
          Produção própria: <b>{brlKg(resultado.producao.custoTotalPorKg)}</b> ·{' '}
          <b>{brl(resultado.producao.custoPorTonelada)}</b>/t ·{' '}
          <b>{brl(resultado.producao.custoMensal)}</b>/mês
        </div>
      </Etapa>
      )}

      {/* ------------------------------------------------------------ 7 */}
      {ver(7) && (
      <Etapa
        numero={7}
        titulo="Capacidade de produção necessária"
        descricao="Como o cliente pretende produzir define o tamanho da fábrica."
      >
        <div className="vr-row2">
          <Campo label="Dias de produção por mês">
            <CampoNumero valor={dim.diasPorMes} casas={0} onChange={v => setDim({ diasPorMes: v })} />
          </Campo>
          <Campo label="Horas disponíveis por dia">
            <CampoNumero valor={dim.horasPorDia} casas={1} onChange={v => setDim({ horasPorDia: v })} />
          </Campo>
        </div>
        <div className="vr-row2" style={{ marginTop: 9 }}>
          <Campo label="Lotes por dia" unidade="opcional">
            <CampoNumero valor={dim.lotesPorDia} casas={0} onChange={v => setDim({ lotesPorDia: v })} />
          </Campo>
          <Campo label="Ritmo pretendido">
            <Selecao
              valor={dim.frequencia}
              opcoes={[
                { v: 'diaria' as const, label: 'Diariamente' },
                { v: 'semanal' as const, label: 'Semanalmente' },
                { v: 'periodica' as const, label: 'Por períodos' },
              ]}
              onChange={v => setDim({ frequencia: v })}
            />
          </Campo>
        </div>
        <div style={{ marginTop: 9 }}>
          <Campo
            label="Margem operacional" unidade="%"
            dica="Folga sobre a capacidade mínima — parada, limpeza, troca de fórmula e crescimento do plantel."
          >
            <CampoNumero valor={dim.margemOperacionalPct} casas={0} onChange={v => setDim({ margemOperacionalPct: v })} />
          </Campo>
        </div>

        <div className="vr-live">
          {resultado.dimensionamento.aplicavel ? (
            <>
              <b>{kg(resultado.dimensionamento.producaoPorDiaKg)}</b> por dia de trabalho · mínimo{' '}
              <b>{kgHora(resultado.dimensionamento.capacidadeMinimaKgHora)}</b> · recomendado{' '}
              <b>{kgHora(resultado.dimensionamento.capacidadeRecomendadaKgHora)}</b>
            </>
          ) : 'Informe dias e horas pra dimensionar.'}
        </div>
      </Etapa>
      )}

      {/* ------------------------------------------------------------ 8 */}
      {ver(8) && (
      <Etapa
        numero={8}
        titulo="Investimento estimado na fábrica"
        descricao="Sem investimento informado o estudo mostra só a economia, sem prazo de retorno."
      >
        <div className="vr-row2">
          <Campo label="Equipamentos" unidade="R$">
            <CampoNumero valor={inv.equipamentos} casas={2} onChange={v => setInv({ equipamentos: v })} />
          </Campo>
          <Campo label="Frete" unidade="R$">
            <CampoNumero valor={inv.frete} casas={2} onChange={v => setInv({ frete: v })} />
          </Campo>
        </div>
        <div className="vr-row2" style={{ marginTop: 9 }}>
          <Campo label="Montagem" unidade="R$">
            <CampoNumero valor={inv.montagem} casas={2} onChange={v => setInv({ montagem: v })} />
          </Campo>
          <Campo label="Instalação elétrica" unidade="R$">
            <CampoNumero valor={inv.instalacaoEletrica} casas={2} onChange={v => setInv({ instalacaoEletrica: v })} />
          </Campo>
        </div>
        <div className="vr-row2" style={{ marginTop: 9 }}>
          <Campo label="Obra civil" unidade="R$">
            <CampoNumero valor={inv.obraCivil} casas={2} onChange={v => setInv({ obraCivil: v })} />
          </Campo>
          <Campo label="Outros investimentos" unidade="R$">
            <CampoNumero valor={inv.outros} casas={2} onChange={v => setInv({ outros: v })} />
          </Campo>
        </div>

        <div style={{ marginTop: 12 }}>
          <Campo label="Como o cliente pretende pagar">
            <Alternador
              valor={inv.modoFinanciamento}
              opcoes={[
                { v: 'sem' as const, label: 'Sem financiamento' },
                { v: 'informado' as const, label: 'Com custo financeiro' },
              ]}
              onChange={v => setInv({ modoFinanciamento: v })}
            />
          </Campo>
          {inv.modoFinanciamento === 'informado' && (
            <div style={{ marginTop: 9 }}>
              <Campo
                label="Custo financeiro total" unidade="R$"
                dica="Some os juros do contrato que o cliente apresentar. O sistema não estima taxa."
              >
                <CampoNumero valor={inv.custoFinanceiroInformado} casas={2} onChange={v => setInv({ custoFinanceiroInformado: v })} />
              </Campo>
            </div>
          )}
        </div>

        <div className="vr-live">
          Investimento total: <b>{brl(resultado.retorno.investimentoConsiderado)}</b>
          {resultado.retorno.aplicavel && (
            <> · retorno em <b>{numero(resultado.retorno.paybackMeses, 1)} meses</b></>
          )}
        </div>
      </Etapa>
      )}

      <div className="vr-hint" style={{ marginTop: 14 }}>
        Cenários em uso: conservador com ingredientes {pct(input.cenarios.conservador.ingredientesPct, 0)} e
        ração comprada {pct(input.cenarios.conservador.racaoCompradaPct, 0)}; otimista com ingredientes{' '}
        {pct(input.cenarios.otimista.ingredientesPct, 0)}. Editável em Configurações.
      </div>
    </div>
  )
}
