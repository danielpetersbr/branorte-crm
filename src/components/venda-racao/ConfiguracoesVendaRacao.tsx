/**
 * Configurações do módulo — os defaults da empresa.
 *
 * Nada aqui está travado no código: margem por espécie, impostos, custos
 * padrão, prazos e textos vivem em venda_racao_config (JSONB) e entram numa
 * simulação nova como PONTO DE PARTIDA. O vendedor continua podendo editar
 * tudo dentro da própria simulação.
 *
 * Escrita é gateada pela RLS (`venda_racao.ver_todas` / admin). Sem permissão,
 * a tela abre em modo leitura.
 */
import { useEffect, useState } from 'react'
import { Plus, Save, Trash2 } from 'lucide-react'
import { CONFIG_PADRAO, ESPECIES, INGREDIENTES_PADRAO, PESOS_SACO } from '@/lib/venda-racao/catalogo'
import { brl } from '@/lib/venda-racao/formato'
import type {
  ConfigVendaRacao, Especie, IngredienteCatalogoRow, UnidadePreco,
} from '@/lib/venda-racao/tipos'
import { Campo, CampoNumero, CampoTexto, CustoLinha, Selecao } from './campos'

interface Props {
  config: ConfigVendaRacao
  onSalvar: (c: ConfigVendaRacao) => void
  salvando: boolean
  podeEditar: boolean
  ingredientes: IngredienteCatalogoRow[]
  onSalvarIngrediente: (i: Partial<IngredienteCatalogoRow> & { nome: string }) => void
  onRemoverIngrediente: (id: string) => void
}

export function ConfiguracoesVendaRacao({
  config, onSalvar, salvando, podeEditar,
  ingredientes, onSalvarIngrediente, onRemoverIngrediente,
}: Props) {
  const [c, setC] = useState<ConfigVendaRacao>(config)
  const [novo, setNovo] = useState({ nome: '', preco: 0, unidade: 'kg' as UnidadePreco, pesoSaco: 60 })

  useEffect(() => { setC(config) }, [config])

  const set = (p: Partial<ConfigVendaRacao>) => setC(prev => ({ ...prev, ...p }))
  const setCusto = (p: Partial<ConfigVendaRacao['custosPadrao']>) =>
    setC(prev => ({ ...prev, custosPadrao: { ...prev.custosPadrao, ...p } }))

  const margemDe = (e: Especie, v: number) =>
    setC(prev => ({ ...prev, margemPorEspecie: { ...prev.margemPorEspecie, [e]: v } }))
  const minimaDe = (e: Especie, v: number) =>
    setC(prev => ({ ...prev, margemMinimaPorEspecie: { ...prev.margemMinimaPorEspecie, [e]: v } }))

  const semear = () => {
    for (const i of INGREDIENTES_PADRAO) {
      if (ingredientes.some(x => x.nome.toLowerCase() === i.nome.toLowerCase())) continue
      onSalvarIngrediente({ nome: i.nome, preco: i.preco, unidade_preco: i.unidade, peso_saco: null })
    }
  }

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      {!podeEditar && (
        <div className="vr-alerta" style={{ marginTop: 0 }}>
          Você está vendo as configurações em modo leitura. Alterar os padrões da empresa exige
          permissão de administrador.
        </div>
      )}

      {/* ------------------------------------------------- margens */}
      <div className="vr-card">
        <h2>Margem por produto</h2>
        <div className="vr-hint" style={{ marginBottom: 12 }}>
          Valores iniciais de cada simulação nova. A margem mínima é o que define o desconto
          máximo que o vendedor pode conceder.
        </div>
        <div className="vr-fhdr" style={{ gridTemplateColumns: 'minmax(0,1fr) 100px 100px' }}>
          <span style={{ textAlign: 'left' }}>Produto</span>
          <span>Desejada %</span>
          <span>Mínima %</span>
        </div>
        {ESPECIES.map(e => (
          <div key={e.chave} className="vr-frow" style={{ gridTemplateColumns: 'minmax(0,1fr) 100px 100px' }}>
            <span className="fn">{e.icone} {e.nome}</span>
            <CampoNumero
              valor={c.margemPorEspecie[e.chave] ?? 0} casas={2} className="" disabled={!podeEditar}
              aria-label={`Margem desejada ${e.nome}`} onChange={v => margemDe(e.chave, v)}
            />
            <CampoNumero
              valor={c.margemMinimaPorEspecie[e.chave] ?? 0} casas={2} className="" disabled={!podeEditar}
              aria-label={`Margem mínima ${e.nome}`} onChange={v => minimaDe(e.chave, v)}
            />
          </div>
        ))}
      </div>

      {/* ---------------------------------------- impostos e embalagem */}
      <div className="vr-card">
        <h2>Impostos, taxas e embalagem</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10, marginTop: 10 }}>
          <Campo label="Impostos" unidade="%">
            <CampoNumero valor={c.impostosPct} casas={2} disabled={!podeEditar} onChange={v => set({ impostosPct: v })} />
          </Campo>
          <Campo label="Comissão" unidade="%">
            <CampoNumero valor={c.comissaoPct} casas={2} disabled={!podeEditar} onChange={v => set({ comissaoPct: v })} />
          </Campo>
          <Campo label="Taxa financeira" unidade="%">
            <CampoNumero valor={c.taxaFinanceiraPct} casas={2} disabled={!podeEditar} onChange={v => set({ taxaFinanceiraPct: v })} />
          </Campo>
          <Campo label="Cartão / antecipação" unidade="%">
            <CampoNumero valor={c.taxaCartaoPct} casas={2} disabled={!podeEditar} onChange={v => set({ taxaCartaoPct: v })} />
          </Campo>
          <Campo label="Peso padrão do saco" unidade="kg">
            <Selecao
              valor={String(c.pesoSacoPadrao)}
              opcoes={PESOS_SACO.map(p => ({ v: String(p), label: `${p} kg` }))}
              onChange={v => podeEditar && set({ pesoSacoPadrao: Number(v) })}
            />
          </Campo>
          <Campo label="Validade da proposta" unidade="dias">
            <CampoNumero valor={c.validadeDias} casas={0} disabled={!podeEditar} onChange={v => set({ validadeDias: v })} />
          </Campo>
        </div>
      </div>

      {/* ------------------------------------------- custos padrão */}
      <div className="vr-card">
        <h2>Custos de produção padrão</h2>
        <div className="vr-hint" style={{ marginBottom: 12 }}>
          Ponto de partida, não verdade absoluta — cada simulação ajusta por cima.
        </div>
        <Campo label="Perda na produção" unidade="%">
          <CampoNumero valor={c.custosPadrao.perdaPct} casas={2} disabled={!podeEditar} onChange={v => setCusto({ perdaPct: v })} />
        </Campo>
        <div style={{ marginTop: 12 }}>
          <CustoLinha label="Energia" unidade="R$/kg" custo={c.custosPadrao.energia} onChange={x => setCusto({ energia: x })} />
          <CustoLinha label="Mão de obra" unidade="R$/kg" custo={c.custosPadrao.maoDeObra} onChange={x => setCusto({ maoDeObra: x })} />
          <CustoLinha label="Moagem" unidade="R$/kg" custo={c.custosPadrao.moagem} onChange={x => setCusto({ moagem: x })} />
          <CustoLinha label="Mistura" unidade="R$/kg" custo={c.custosPadrao.mistura} onChange={x => setCusto({ mistura: x })} />
          <CustoLinha label="Manutenção" unidade="R$/kg" custo={c.custosPadrao.manutencao} onChange={x => setCusto({ manutencao: x })} />
          <CustoLinha label="Depreciação" unidade="R$/kg" custo={c.custosPadrao.depreciacao} onChange={x => setCusto({ depreciacao: x })} />
          <CustoLinha label="Administrativo" unidade="R$/kg" custo={c.custosPadrao.administrativo} onChange={x => setCusto({ administrativo: x })} />
          <CustoLinha label="Carregamento" unidade="R$/kg" custo={c.custosPadrao.carregamento} onChange={x => setCusto({ carregamento: x })} />
          <CustoLinha label="Outros variáveis" unidade="R$/kg" custo={c.custosPadrao.outrosVariaveis} onChange={x => setCusto({ outrosVariaveis: x })} />
          <CustoLinha label="Embalagem" unidade="R$/saco" casas={2} custo={c.custosPadrao.embalagem} onChange={x => setCusto({ embalagem: x })} />
          <CustoLinha label="Etiqueta" unidade="R$/saco" casas={2} custo={c.custosPadrao.etiqueta} onChange={x => setCusto({ etiqueta: x })} />
        </div>
      </div>

      {/* -------------------------------------------------- cenários */}
      <div className="vr-card">
        <h2>Cenários de negociação</h2>
        <div className="vr-hint" style={{ marginBottom: 12 }}>
          Variação aplicada em cima dos números informados. Negativo reduz.
        </div>
        <div className="vr-fhdr" style={{ gridTemplateColumns: 'minmax(0,1fr) 78px 78px 78px' }}>
          <span style={{ textAlign: 'left' }}>Cenário</span>
          <span>Mat.-prima %</span>
          <span>Frete %</span>
          <span>Perda %</span>
        </div>
        {(['conservador', 'provavel', 'otimista'] as const).map(k => (
          <div key={k} className="vr-frow" style={{ gridTemplateColumns: 'minmax(0,1fr) 78px 78px 78px' }}>
            <span className="fn" style={{ textTransform: 'capitalize' }}>{k}</span>
            {(['materiaPrimaPct', 'fretePct', 'perdaPct'] as const).map(campo => (
              <CampoNumero
                key={campo}
                valor={c.cenarios[k][campo]} casas={2} className="" disabled={!podeEditar}
                aria-label={`${k} ${campo}`}
                onChange={v => setC(prev => ({
                  ...prev,
                  cenarios: { ...prev.cenarios, [k]: { ...prev.cenarios[k], [campo]: v } },
                }))}
              />
            ))}
          </div>
        ))}
        <div className="vr-hint" style={{ marginTop: 8 }}>
          O conservador usa sempre a margem mínima; provável e otimista usam a desejada.
        </div>
      </div>

      {/* ------------------------------------- textos e condições */}
      <div className="vr-card">
        <h2>Condições e textos comerciais</h2>
        <div style={{ display: 'grid', gap: 10, marginTop: 10 }}>
          <Campo label="Prazo padrão">
            <CampoTexto valor={c.prazoPadrao} onChange={v => podeEditar && set({ prazoPadrao: v })} />
          </Campo>
          <Campo label="Forma de pagamento padrão">
            <CampoTexto valor={c.formaPagamentoPadrao} onChange={v => podeEditar && set({ formaPagamentoPadrao: v })} />
          </Campo>
          <Campo label="Condição de entrega padrão">
            <CampoTexto valor={c.condicaoEntregaPadrao} onChange={v => podeEditar && set({ condicaoEntregaPadrao: v })} />
          </Campo>
          <Campo label="Texto comercial" dica="Aparece no bloco Observações da proposta do cliente.">
            <textarea
              className="vr-inp txt" style={{ minHeight: 70, resize: 'vertical' }}
              value={c.textoComercial} disabled={!podeEditar}
              onChange={e => set({ textoComercial: e.target.value })}
            />
          </Campo>
          <Campo label="Aviso legal / nutricional" dica="Aparece no rodapé da proposta.">
            <textarea
              className="vr-inp txt" style={{ minHeight: 80, resize: 'vertical' }}
              value={c.avisoNutricional} disabled={!podeEditar}
              onChange={e => set({ avisoNutricional: e.target.value })}
            />
          </Campo>
        </div>
      </div>

      {podeEditar && (
        <div className="vr-cta" style={{ marginTop: 0 }}>
          <button type="button" className="vr-btn primary" disabled={salvando} onClick={() => onSalvar(c)}>
            <Save className="h-4 w-4" /> {salvando ? 'Salvando…' : 'Salvar configurações'}
          </button>
          <button type="button" className="vr-btn ghost" onClick={() => setC(CONFIG_PADRAO)}>
            Restaurar padrões de fábrica
          </button>
        </div>
      )}

      {/* --------------------------------------- catálogo de ingredientes */}
      <div className="vr-card">
        <h2>Catálogo de ingredientes</h2>
        <div className="vr-hint" style={{ marginBottom: 12 }}>
          Matérias-primas que aparecem no “+ adicionar ingrediente” do formulário.
          Enquanto o catálogo estiver vazio, o sistema usa a lista de referência interna.
        </div>

        {ingredientes.length === 0 && podeEditar && (
          <button type="button" className="vr-btn ghost" onClick={semear}>
            <Plus className="h-4 w-4" /> Carregar lista de referência ({INGREDIENTES_PADRAO.length} itens)
          </button>
        )}

        {ingredientes.length > 0 && (
          <div className="vr-scroll">
            <table className="vr-tabela">
              <thead>
                <tr>
                  <th>Ingrediente</th>
                  <th style={{ textAlign: 'right' }}>Preço</th>
                  <th>Unidade</th>
                  <th style={{ textAlign: 'right' }}>Saco (kg)</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {ingredientes.map(i => (
                  <tr key={i.id}>
                    <td>{i.nome}</td>
                    <td className="num">{brl(Number(i.preco), 4)}</td>
                    <td>{i.unidade_preco === 'kg' ? 'R$/kg' : i.unidade_preco === 't' ? 'R$/t' : 'R$/saco'}</td>
                    <td className="num">{i.peso_saco ? Number(i.peso_saco) : '—'}</td>
                    <td>
                      {podeEditar && (
                        <button
                          type="button" className="vr-btn ghost" style={{ padding: '6px 8px' }}
                          title="Remover" onClick={() => onRemoverIngrediente(i.id)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {podeEditar && (
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 100px 110px 90px auto', gap: 8, marginTop: 12, alignItems: 'end' }}>
            <Campo label="Novo ingrediente">
              <CampoTexto valor={novo.nome} onChange={v => setNovo({ ...novo, nome: v })} placeholder="Nome" />
            </Campo>
            <Campo label="Preço">
              <CampoNumero valor={novo.preco} casas={4} onChange={v => setNovo({ ...novo, preco: v })} />
            </Campo>
            <Campo label="Unidade">
              <Selecao
                valor={novo.unidade}
                opcoes={[
                  { v: 'kg' as const, label: 'R$/kg' },
                  { v: 'saco' as const, label: 'R$/saco' },
                  { v: 't' as const, label: 'R$/t' },
                ]}
                onChange={v => setNovo({ ...novo, unidade: v })}
              />
            </Campo>
            <Campo label="Saco (kg)">
              <CampoNumero valor={novo.pesoSaco} casas={2} onChange={v => setNovo({ ...novo, pesoSaco: v })} />
            </Campo>
            <button
              type="button" className="vr-btn primary" disabled={!novo.nome.trim()}
              onClick={() => {
                onSalvarIngrediente({
                  nome: novo.nome, preco: novo.preco, unidade_preco: novo.unidade,
                  peso_saco: novo.unidade === 'saco' ? novo.pesoSaco : null,
                })
                setNovo({ nome: '', preco: 0, unidade: 'kg', pesoSaco: 60 })
              }}
            >
              <Plus className="h-4 w-4" /> Adicionar
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
