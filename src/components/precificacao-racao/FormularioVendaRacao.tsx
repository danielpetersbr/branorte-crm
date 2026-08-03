/**
 * Coluna esquerda da /venda-racao: o formulário em 6 etapas.
 *
 * O componente é "burro" de propósito — recebe o input e devolve o input novo.
 * Todo cálculo vive em lib/venda-racao/calculo.ts, então dá pra mexer no layout
 * sem risco de mudar preço.
 */
import { Save } from 'lucide-react'
import {
  CATEGORIAS, ESPECIES, INGREDIENTES_PADRAO, novoIdIngrediente, PESOS_SACO,
} from '@/lib/precificacao-racao/catalogo'
import { consumoSugerido } from '@/lib/precificacao-racao/estado'
import { brl, brlKg, kg, numero, toneladas } from '@/lib/precificacao-racao/formato'
import type {
  ConfigVendaRacao, Especie, FormulaSalvaRow, IngredienteCatalogoRow,
  IngredienteFormula, ResultadoSimulacao, SimulacaoInput, UnidadePreco,
} from '@/lib/precificacao-racao/tipos'
import { Alternador, Campo, CampoNumero, CampoTexto, CustoLinha, Etapa, Selecao } from './campos'

interface Props {
  input: SimulacaoInput
  onChange: (fn: (s: SimulacaoInput) => SimulacaoInput) => void
  onTrocarEspecie: (e: Especie) => void
  resultado: ResultadoSimulacao
  config: ConfigVendaRacao
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

export function FormularioVendaRacao({
  input, onChange, onTrocarEspecie, resultado, config,
  ingredientesCatalogo, formulasSalvas, onSalvarFormula, salvandoFormula,
}: Props) {
  const { identificacao: ident, produto, quantidade: qtd, formula, custos, venda } = input
  const ehMilho = produto.especie === 'milho'
  const categorias = CATEGORIAS[produto.especie] ?? []
  const categoriaAtual = categorias.find(c => c.chave === produto.categoria)
  const especieMeta = ESPECIES.find(e => e.chave === produto.especie)

  const setIdent = (p: Partial<typeof ident>) =>
    onChange(s => ({ ...s, identificacao: { ...s.identificacao, ...p } }))
  const setQtd = (p: Partial<typeof qtd>) =>
    onChange(s => ({ ...s, quantidade: { ...s.quantidade, ...p } }))
  const setFormula = (p: Partial<typeof formula>) =>
    onChange(s => ({ ...s, formula: { ...s.formula, ...p } }))
  const setCustos = (p: Partial<typeof custos>) =>
    onChange(s => ({ ...s, custos: { ...s.custos, ...p } }))
  const setVenda = (p: Partial<typeof venda>) =>
    onChange(s => ({ ...s, venda: { ...s.venda, ...p } }))

  const trocarCategoria = (chave: string) => {
    onChange(s => ({
      ...s,
      produto: { ...s.produto, categoria: chave },
      quantidade: {
        ...s.quantidade,
        // consumo acompanha a fase escolhida — o vendedor edita por cima se souber o real
        consumoPorAnimal: consumoSugerido(s.produto.especie, chave) || s.quantidade.consumoPorAnimal,
      },
    }))
  }

  const alterarItem = (id: string, p: Partial<IngredienteFormula>) =>
    setFormula({ itens: formula.itens.map(i => (i.id === id ? { ...i, ...p } : i)) })

  const removerItem = (id: string) =>
    setFormula({ itens: formula.itens.filter(i => i.id !== id), formulaId: null })

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
  const opcoesIngrediente = ingredientesCatalogo.length > 0
    ? ingredientesCatalogo.map(i => ({
        nome: i.nome, preco: Number(i.preco) || 0,
        unidade: i.unidade_preco as UnidadePreco, pesoSaco: Number(i.peso_saco) || 60,
      }))
    : INGREDIENTES_PADRAO.map(i => ({ nome: i.nome, preco: i.preco, unidade: i.unidade, pesoSaco: 60 }))

  const f = resultado.formula
  const somaOk = f.fechada

  return (
    <div className="vr-card">
      <h2>Seus dados</h2>

      {/* ---------------------------------------------------------------- 1 */}
      <details className="vr-det" style={{ marginTop: 10, borderTop: 0, paddingTop: 0 }}>
        <summary>Identificação (cliente, vendedor, validade)</summary>
        <div className="vr-detbody">
          <Campo label="Nome do cliente">
            <CampoTexto valor={ident.clienteNome} onChange={v => setIdent({ clienteNome: v })} placeholder="Ex.: João da Silva" />
          </Campo>
          <Campo label="Empresa ou propriedade">
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
          <Campo label="Telefone" unidade="pro WhatsApp">
            <CampoTexto tipo="tel" valor={ident.clienteTelefone} onChange={v => setIdent({ clienteTelefone: v })} placeholder="(00) 00000-0000" />
          </Campo>
          <Campo label="Vendedor">
            <CampoTexto valor={ident.vendedorNome} onChange={v => setIdent({ vendedorNome: v })} />
          </Campo>
          <div className="vr-row2">
            <Campo label="Data">
              <CampoTexto tipo="date" valor={ident.data} onChange={v => setIdent({ data: v })} />
            </Campo>
            <Campo label="Validade">
              <CampoTexto tipo="date" valor={ident.validade} onChange={v => setIdent({ validade: v })} />
            </Campo>
          </div>
          <Campo label="Observações internas" dica="Não aparece na proposta do cliente.">
            <textarea
              className="vr-inp txt"
              style={{ minHeight: 70, resize: 'vertical' }}
              value={ident.observacoesInternas}
              onChange={e => setIdent({ observacoesInternas: e.target.value })}
            />
          </Campo>
        </div>
      </details>

      {/* ---------------------------------------------------------------- 2 */}
      <Etapa numero={1} titulo="O que você vai vender?">
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

      {/* ---------------------------------------------------------------- 3 */}
      <Etapa numero={2} titulo="Quanto o cliente precisa?">
        <Alternador
          valor={qtd.modo}
          opcoes={[
            { v: 'animais' as const, label: 'Pelo nº de animais' },
            { v: 'direto' as const, label: 'Quantidade direta' },
          ]}
          onChange={v => setQtd({ modo: v })}
        />

        {qtd.modo === 'animais' ? (
          <div style={{ marginTop: 10, display: 'grid', gap: 9 }}>
            <div className="vr-row2">
              <Campo label={`Nº de ${especieMeta?.animal ?? 'animais'}`}>
                <CampoNumero valor={qtd.numeroAnimais} casas={0} onChange={v => setQtd({ numeroAnimais: v })} />
              </Campo>
              <Campo label="Consumo / animal" unidade={qtd.baseConsumo === 'dia' ? 'kg/dia' : qtd.baseConsumo === 'mes' ? 'kg/mês' : 'kg/ciclo'}>
                <CampoNumero valor={qtd.consumoPorAnimal} casas={3} onChange={v => setQtd({ consumoPorAnimal: v })} />
              </Campo>
            </div>
            <div className="vr-row2">
              <Campo label="Base do consumo">
                <Selecao
                  valor={qtd.baseConsumo}
                  opcoes={[
                    { v: 'mes' as const, label: 'kg por mês' },
                    { v: 'dia' as const, label: 'kg por dia' },
                    { v: 'ciclo' as const, label: 'kg por ciclo' },
                  ]}
                  onChange={v => setQtd({ baseConsumo: v })}
                />
              </Campo>
              <Campo
                label={qtd.baseConsumo === 'ciclo' ? 'Dias do ciclo' : 'Nº de dias'}
                unidade={qtd.baseConsumo === 'mes' ? 'não usado' : 'dias'}
              >
                <CampoNumero valor={qtd.dias} casas={0} onChange={v => setQtd({ dias: v })} disabled={qtd.baseConsumo === 'mes'} />
              </Campo>
            </div>
            <Campo label="Sobra / segurança" unidade="%">
              <CampoNumero valor={qtd.sobraPct} casas={2} onChange={v => setQtd({ sobraPct: v })} />
            </Campo>
            <div className="vr-hint">
              O consumo pode variar conforme peso, genética, fase, manejo e objetivo produtivo.
              Confirme os dados reais do cliente.
            </div>
          </div>
        ) : (
          <div style={{ marginTop: 10, display: 'grid', gap: 9 }}>
            <div className="vr-row2">
              <Campo label="Quantidade">
                <CampoNumero valor={qtd.quantidadeInformada} casas={3} onChange={v => setQtd({ quantidadeInformada: v })} />
              </Campo>
              <Campo label="Unidade">
                <Selecao
                  valor={qtd.unidadeQuantidade}
                  opcoes={[
                    { v: 'kg' as const, label: 'kg' },
                    { v: 't' as const, label: 'toneladas' },
                    { v: 'sacos' as const, label: 'sacos' },
                  ]}
                  onChange={v => setQtd({ unidadeQuantidade: v })}
                />
              </Campo>
            </div>
            <Campo label="Pedidos por mês" unidade="pra projetar o mensal" dica="1 = pedido único no mês.">
              <CampoNumero valor={qtd.pedidosPorMes} casas={2} onChange={v => setQtd({ pedidosPorMes: v })} />
            </Campo>
          </div>
        )}

        <div style={{ marginTop: 9 }}>
          <Campo label="Peso do saco" unidade="kg">
            <div className="vr-row2">
              <Selecao
                valor={PESOS_SACO.includes(qtd.pesoSaco) ? String(qtd.pesoSaco) : 'custom'}
                opcoes={[
                  ...PESOS_SACO.map(p => ({ v: String(p), label: `${p} kg` })),
                  { v: 'custom', label: 'Personalizado' },
                ]}
                onChange={v => { if (v !== 'custom') setQtd({ pesoSaco: Number(v) }) }}
              />
              <CampoNumero valor={qtd.pesoSaco} casas={2} onChange={v => setQtd({ pesoSaco: v })} />
            </div>
          </Campo>
        </div>

        <div className="vr-live">
          <b>{kg(resultado.demanda.quantidadeKg)}</b> no pedido ·{' '}
          <b>{numero(Math.round(resultado.demanda.sacos))}</b> sacos ·{' '}
          <b>{toneladas(resultado.demanda.toneladas)}</b>
          {resultado.demanda.quantidadeMensalKg !== resultado.demanda.quantidadeKg && (
            <> · <b>{kg(resultado.demanda.quantidadeMensalKg)}</b>/mês</>
          )}
        </div>
      </Etapa>

      {/* ---------------------------------------------------------------- 4 */}
      <Etapa numero={3} titulo={ehMilho ? 'Preço do milho' : 'Fórmula e ingredientes'}>
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
              <b>{brlKg(resultado.custos.custoIngredientesAjustadoPorKg)}</b>
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

      {/* ---------------------------------------------------------------- 5 */}
      <Etapa numero={4} titulo="Custos de produção">
        {!ehMilho && (
          <Campo label="Perda na produção" unidade="%">
            <CampoNumero valor={custos.perdaPct} casas={2} onChange={v => setCustos({ perdaPct: v })} />
          </Campo>
        )}

        <details className="vr-det" open>
          <summary>Custos por kg</summary>
          <div style={{ marginTop: 10 }}>
            <CustoLinha label="Energia" unidade="R$/kg" custo={custos.energia} onChange={c => setCustos({ energia: c })} />
            <CustoLinha label="Mão de obra" unidade="R$/kg" custo={custos.maoDeObra} onChange={c => setCustos({ maoDeObra: c })} />
            <CustoLinha label="Moagem" unidade="R$/kg" custo={custos.moagem} onChange={c => setCustos({ moagem: c })} />
            <CustoLinha label="Mistura" unidade="R$/kg" custo={custos.mistura} onChange={c => setCustos({ mistura: c })} />
            <CustoLinha label="Manutenção" unidade="R$/kg" custo={custos.manutencao} onChange={c => setCustos({ manutencao: c })} />
            <CustoLinha label="Depreciação" unidade="R$/kg" custo={custos.depreciacao} onChange={c => setCustos({ depreciacao: c })} />
            <CustoLinha label="Administrativo" unidade="R$/kg" custo={custos.administrativo} onChange={c => setCustos({ administrativo: c })} />
            <CustoLinha label="Carregamento" unidade="R$/kg" custo={custos.carregamento} onChange={c => setCustos({ carregamento: c })} />
            <CustoLinha label="Outros variáveis" unidade="R$/kg" custo={custos.outrosVariaveis} onChange={c => setCustos({ outrosVariaveis: c })} />
          </div>
        </details>

        <details className="vr-det">
          <summary>Embalagem, frete e custos fixos</summary>
          <div style={{ marginTop: 10 }}>
            <CustoLinha label="Embalagem" unidade="R$/saco" custo={custos.embalagem} onChange={c => setCustos({ embalagem: c })} casas={2} />
            <CustoLinha label="Etiqueta" unidade="R$/saco" custo={custos.etiqueta} onChange={c => setCustos({ etiqueta: c })} casas={2} />

            <div style={{ marginTop: 10 }}>
              <Campo label="Frete" unidade={custos.freteModo === 'total' ? 'R$ total do pedido' : 'R$/kg'}>
                <div className="vr-row2">
                  <Alternador
                    valor={custos.freteModo}
                    opcoes={[{ v: 'total' as const, label: 'Total' }, { v: 'kg' as const, label: 'Por kg' }]}
                    onChange={v => setCustos({ freteModo: v })}
                  />
                  <CampoNumero
                    valor={custos.frete.valor}
                    casas={custos.freteModo === 'total' ? 2 : 4}
                    onChange={v => setCustos({ frete: { ativo: v > 0, valor: v } })}
                  />
                </div>
              </Campo>
              {custos.freteModo === 'total' && custos.frete.ativo && (
                <div className="vr-hint">
                  Rateado: {brlKg(resultado.custos.fretePorKg)} · {brl(custos.frete.valor)} ÷ {kg(resultado.demanda.quantidadeKg)}
                </div>
              )}
            </div>

            <div style={{ marginTop: 10 }}>
              <Campo label="Outros custos fixos do pedido" unidade="R$">
                <CampoNumero
                  valor={custos.outrosFixosPedido.valor} casas={2}
                  onChange={v => setCustos({ outrosFixosPedido: { ativo: v > 0, valor: v } })}
                />
              </Campo>
            </div>

            <div style={{ marginTop: 10 }}>
              <Campo
                label="Custos fixos mensais da operação" unidade="R$/mês"
                dica="Usado só no ponto de equilíbrio — não entra no custo do pedido."
              >
                <CampoNumero valor={custos.custosFixosMensais} casas={2} onChange={v => setCustos({ custosFixosMensais: v })} />
              </Campo>
            </div>
          </div>
        </details>

        <div className="vr-live">
          Custo total: <b>{brlKg(resultado.custos.custoBasePorKg)}</b> ·{' '}
          <b>{brl(resultado.custos.custoPorSaco)}</b>/saco ·{' '}
          <b>{brl(resultado.custos.custoPorTonelada)}</b>/t
        </div>
      </Etapa>

      {/* ---------------------------------------------------------------- 6 */}
      <Etapa numero={5} titulo="Margem, impostos e condições">
        <Campo label="Como calcular o preço">
          <Alternador
            valor={venda.modoPreco}
            opcoes={[
              { v: 'margem' as const, label: 'Margem sobre a venda' },
              { v: 'markup' as const, label: 'Markup sobre o custo' },
            ]}
            onChange={v => setVenda({ modoPreco: v })}
          />
          <div className="vr-hint" style={{ marginTop: 6 }}>
            Margem é o percentual que sobra sobre a venda. Markup é o percentual acrescentado sobre o custo.
          </div>
        </Campo>

        <div className="vr-row2" style={{ marginTop: 10 }}>
          <Campo label={venda.modoPreco === 'markup' ? 'Markup desejado' : 'Margem desejada'} unidade="%">
            <CampoNumero valor={venda.margemDesejadaPct} casas={2} onChange={v => setVenda({ margemDesejadaPct: v })} />
          </Campo>
          <Campo label={venda.modoPreco === 'markup' ? 'Markup mínimo' : 'Margem mínima'} unidade="%">
            <CampoNumero valor={venda.margemMinimaPct} casas={2} onChange={v => setVenda({ margemMinimaPct: v })} />
          </Campo>
        </div>

        <div className="vr-row2" style={{ marginTop: 9 }}>
          <Campo label="Impostos" unidade="%">
            <CampoNumero valor={venda.impostosPct} casas={2} onChange={v => setVenda({ impostosPct: v })} />
          </Campo>
          <Campo label="Comissão" unidade="%">
            <CampoNumero valor={venda.comissaoPct} casas={2} onChange={v => setVenda({ comissaoPct: v })} />
          </Campo>
        </div>

        <div className="vr-row2" style={{ marginTop: 9 }}>
          <Campo label="Taxa financeira" unidade="%">
            <CampoNumero valor={venda.taxaFinanceiraPct} casas={2} onChange={v => setVenda({ taxaFinanceiraPct: v })} />
          </Campo>
          <Campo label="Cartão / antecipação" unidade="%">
            <CampoNumero valor={venda.taxaCartaoPct} casas={2} onChange={v => setVenda({ taxaCartaoPct: v })} />
          </Campo>
        </div>

        <details className="vr-det">
          <summary>Comparação e condições comerciais</summary>
          <div className="vr-detbody">
            <div className="vr-row2">
              <Campo label="Preço que o cliente paga hoje" unidade="R$/kg">
                <CampoNumero valor={venda.precoAtualClientePorKg} casas={4} onChange={v => setVenda({ precoAtualClientePorKg: v })} />
              </Campo>
              <Campo label="Preço de mercado" unidade="R$/kg">
                <CampoNumero valor={venda.precoMercadoPorKg} casas={4} onChange={v => setVenda({ precoMercadoPorKg: v })} />
              </Campo>
            </div>
            <Campo label="Forma de pagamento">
              <CampoTexto valor={venda.formaPagamento} onChange={v => setVenda({ formaPagamento: v })} placeholder="Ex.: Boleto" />
            </Campo>
            <Campo label="Prazo de pagamento">
              <CampoTexto valor={venda.prazoPagamento} onChange={v => setVenda({ prazoPagamento: v })} placeholder="Ex.: 28 dias" />
            </Campo>
            <Campo label="Condição de entrega">
              <CampoTexto valor={venda.condicaoEntrega} onChange={v => setVenda({ condicaoEntrega: v })} placeholder="Ex.: CIF — entrega inclusa" />
            </Campo>
          </div>
        </details>
      </Etapa>
    </div>
  )
}
