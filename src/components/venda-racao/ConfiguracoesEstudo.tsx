/**
 * Configurações do módulo — os defaults da empresa.
 *
 * Nada aqui está travado no código: custos operacionais, regime de produção,
 * capacidades da linha, textos e avisos vivem em venda_racao_config (JSONB) e
 * entram num estudo novo como PONTO DE PARTIDA. O vendedor continua podendo
 * editar tudo dentro do próprio estudo.
 *
 * Não existe mais margem comercial por produto: a Branorte não vende ração.
 *
 * Escrita é gateada pela RLS (`venda_racao.ver_todas` / admin). Sem permissão,
 * a tela abre em modo leitura.
 */
import { useEffect, useState } from 'react'
import { Plus, Save, Trash2 } from 'lucide-react'
import {
  CATEGORIAS, CONFIG_PADRAO, ESPECIES, INGREDIENTES_PADRAO, ORIGEM_CUSTOS, PESOS_SACO,
} from '@/lib/venda-racao/catalogo'
import { brl, kgHora, numero } from '@/lib/venda-racao/formato'
import type {
  AjusteCenario, ConfigEstudo, Especie, FormulaSalvaRow, IngredienteCatalogoRow, UnidadePreco,
} from '@/lib/venda-racao/tipos'
import { Campo, CampoNumero, CampoTexto, CustoLinha, Selecao } from './campos'

interface Props {
  config: ConfigEstudo
  onSalvar: (c: ConfigEstudo) => void
  salvando: boolean
  podeEditar: boolean
  ingredientes: IngredienteCatalogoRow[]
  onSalvarIngrediente: (i: Partial<IngredienteCatalogoRow> & { nome: string }) => void
  onRemoverIngrediente: (id: string) => void
  formulas: FormulaSalvaRow[]
  onRemoverFormula: (id: string) => void
}

const CAMPOS_CENARIO: Array<{ chave: keyof AjusteCenario; rotulo: string }> = [
  { chave: 'ingredientesPct', rotulo: 'Ingredientes' },
  { chave: 'perdaPct', rotulo: 'Perda' },
  { chave: 'operacionaisPct', rotulo: 'Operacionais' },
  { chave: 'racaoCompradaPct', rotulo: 'Ração comprada' },
  { chave: 'consumoPct', rotulo: 'Consumo' },
  { chave: 'investimentoPct', rotulo: 'Investimento' },
]

export function ConfiguracoesEstudo({
  config, onSalvar, salvando, podeEditar,
  ingredientes, onSalvarIngrediente, onRemoverIngrediente,
  formulas, onRemoverFormula,
}: Props) {
  const [c, setC] = useState<ConfigEstudo>(config)
  const [novo, setNovo] = useState({ nome: '', preco: 0, unidade: 'kg' as UnidadePreco, pesoSaco: 60 })
  const [especieRef, setEspecieRef] = useState<Especie>('bovinos')

  useEffect(() => { setC(config) }, [config])

  const set = (p: Partial<ConfigEstudo>) => setC(prev => ({ ...prev, ...p }))
  const setCusto = (p: Partial<ConfigEstudo['custosPadrao']>) =>
    setC(prev => ({ ...prev, custosPadrao: { ...prev.custosPadrao, ...p } }))
  const setDim = (p: Partial<ConfigEstudo['dimensionamentoPadrao']>) =>
    setC(prev => ({ ...prev, dimensionamentoPadrao: { ...prev.dimensionamentoPadrao, ...p } }))

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

      {/* ------------------------------------------- custos padrão */}
      <div className="vr-card">
        <h2>Custos operacionais padrão</h2>
        <div className="vr-hint" style={{ marginBottom: 12 }}>
          Todo valor aqui é ESTIMATIVA e entra no estudo novo como ponto de partida. O vendedor
          confirma, ajusta ou desliga dentro de cada estudo.
        </div>
        <Campo label="Perda na produção" unidade="%" dica={ORIGEM_CUSTOS.perdaPct}>
          <CampoNumero valor={c.custosPadrao.perdaPct} casas={2} disabled={!podeEditar} onChange={v => setCusto({ perdaPct: v })} />
        </Campo>
        <div style={{ marginTop: 12 }}>
          <CustoLinha label="Energia" unidade="R$/kg" disabled={!podeEditar} origem={ORIGEM_CUSTOS.energia} custo={c.custosPadrao.energia} onChange={x => setCusto({ energia: x })} />
          <CustoLinha label="Mão de obra" unidade="R$/kg" disabled={!podeEditar} origem={ORIGEM_CUSTOS.maoDeObra} custo={c.custosPadrao.maoDeObra} onChange={x => setCusto({ maoDeObra: x })} />
          <CustoLinha label="Moagem" unidade="R$/kg" disabled={!podeEditar} origem={ORIGEM_CUSTOS.moagem} custo={c.custosPadrao.moagem} onChange={x => setCusto({ moagem: x })} />
          <CustoLinha label="Mistura" unidade="R$/kg" disabled={!podeEditar} origem={ORIGEM_CUSTOS.mistura} custo={c.custosPadrao.mistura} onChange={x => setCusto({ mistura: x })} />
          <CustoLinha label="Manutenção" unidade="R$/kg" disabled={!podeEditar} origem={ORIGEM_CUSTOS.manutencao} custo={c.custosPadrao.manutencao} onChange={x => setCusto({ manutencao: x })} />
          <CustoLinha label="Depreciação" unidade="R$/kg" disabled={!podeEditar} origem={ORIGEM_CUSTOS.depreciacao} custo={c.custosPadrao.depreciacao} onChange={x => setCusto({ depreciacao: x })} />
          <CustoLinha label="Administrativo" unidade="R$/kg" disabled={!podeEditar} origem={ORIGEM_CUSTOS.administrativo} custo={c.custosPadrao.administrativo} onChange={x => setCusto({ administrativo: x })} />
          <CustoLinha label="Carregamento" unidade="R$/kg" disabled={!podeEditar} origem={ORIGEM_CUSTOS.carregamento} custo={c.custosPadrao.carregamento} onChange={x => setCusto({ carregamento: x })} />
          <CustoLinha label="Outros variáveis" unidade="R$/kg" disabled={!podeEditar} origem={ORIGEM_CUSTOS.outrosVariaveis} custo={c.custosPadrao.outrosVariaveis} onChange={x => setCusto({ outrosVariaveis: x })} />
          <CustoLinha label="Embalagem" unidade="R$/saco" casas={2} disabled={!podeEditar} origem={ORIGEM_CUSTOS.embalagem} custo={c.custosPadrao.embalagem} onChange={x => setCusto({ embalagem: x })} />
          <CustoLinha label="Etiqueta" unidade="R$/saco" casas={2} disabled={!podeEditar} origem={ORIGEM_CUSTOS.etiqueta} custo={c.custosPadrao.etiqueta} onChange={x => setCusto({ etiqueta: x })} />
        </div>
      </div>

      {/* --------------------------------- dimensionamento e capacidades */}
      <div className="vr-card">
        <h2>Dimensionamento</h2>
        <div className="vr-hint" style={{ marginBottom: 12 }}>
          Regime de produção assumido quando o vendedor abre um estudo novo, e a margem
          operacional aplicada sobre a capacidade mínima calculada.
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 }}>
          <Campo label="Dias de produção por mês">
            <CampoNumero valor={c.dimensionamentoPadrao.diasPorMes} casas={0} disabled={!podeEditar} onChange={v => setDim({ diasPorMes: v })} />
          </Campo>
          <Campo label="Horas por dia">
            <CampoNumero valor={c.dimensionamentoPadrao.horasPorDia} casas={1} disabled={!podeEditar} onChange={v => setDim({ horasPorDia: v })} />
          </Campo>
          <Campo label="Margem operacional" unidade="%">
            <CampoNumero valor={c.dimensionamentoPadrao.margemOperacionalPct} casas={0} disabled={!podeEditar} onChange={v => setDim({ margemOperacionalPct: v })} />
          </Campo>
          <Campo label="Peso padrão do saco" unidade="kg">
            <Selecao
              valor={String(c.pesoSacoPadrao)}
              opcoes={PESOS_SACO.map(p => ({ v: String(p), label: `${p} kg` }))}
              onChange={v => podeEditar && set({ pesoSacoPadrao: Number(v) })}
            />
          </Campo>
          <Campo label="Validade dos preços" unidade="dias">
            <CampoNumero valor={c.validadeDias} casas={0} disabled={!podeEditar} onChange={v => set({ validadeDias: v })} />
          </Campo>
        </div>

        <div style={{ marginTop: 14 }}>
          <Campo
            label="Capacidades da linha Branorte" unidade="kg/h"
            dica="Separadas por vírgula. É nessa lista que o estudo procura a capacidade sugerida."
          >
            <CampoTexto
              valor={c.capacidades.join(', ')}
              disabled={!podeEditar}
              onChange={v => set({
                capacidades: v.split(',')
                  .map(x => Number(x.replace(/[^\d.]/g, '')))
                  .filter(x => Number.isFinite(x) && x > 0),
              })}
            />
          </Campo>
          <div className="vr-hint">
            {c.capacidades.length > 0
              ? c.capacidades.slice().sort((a, b) => a - b).map(x => kgHora(x)).join(' · ')
              : 'Lista vazia — o estudo cai nas capacidades padrão.'}
          </div>
        </div>
      </div>

      {/* -------------------------------------------------- cenários */}
      <div className="vr-card">
        <h2>Cenários</h2>
        <div className="vr-hint" style={{ marginBottom: 12 }}>
          Variação aplicada em cima dos números informados. Negativo reduz. Só entram fatores
          coerentes com um estudo de viabilidade — não existe margem comercial aqui.
        </div>
        <div className="vr-scroll">
          <table className="vr-tabela">
            <thead>
              <tr>
                <th>Cenário</th>
                {CAMPOS_CENARIO.map(f => <th key={f.chave} style={{ textAlign: 'right' }}>{f.rotulo} %</th>)}
              </tr>
            </thead>
            <tbody>
              {(['conservador', 'provavel', 'otimista'] as const).map(k => (
                <tr key={k}>
                  <td style={{ textTransform: 'capitalize', fontWeight: 600 }}>{k}</td>
                  {CAMPOS_CENARIO.map(f => (
                    <td key={f.chave} style={{ width: 90 }}>
                      <CampoNumero
                        valor={c.cenarios[k][f.chave]} casas={2} className="vr-inp" disabled={!podeEditar}
                        aria-label={`${k} ${f.rotulo}`}
                        onChange={v => setC(prev => ({
                          ...prev,
                          cenarios: { ...prev.cenarios, [k]: { ...prev.cenarios[k], [f.chave]: v } },
                        }))}
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ------------------------------------- textos e avisos */}
      <div className="vr-card">
        <h2>Textos e avisos do estudo</h2>
        <div style={{ display: 'grid', gap: 10, marginTop: 10 }}>
          <label className={`vr-check${c.permiteIngredientesUmidos ? ' on' : ''}`}>
            <input
              type="checkbox"
              checked={c.permiteIngredientesUmidos}
              disabled={!podeEditar}
              onChange={e => set({ permiteIngredientesUmidos: e.target.checked })}
            />
            <span>
              <b>Permitir silagem, volumoso úmido e líquidos nas fórmulas.</b> Só marque quando o
              equipamento e o processo do cliente forem compatíveis — a linha farelada processa
              material seco.
            </span>
          </label>
          <Campo label="Objetivo do estudo" dica="Abre a apresentação do cliente.">
            <textarea
              className="vr-inp txt" style={{ minHeight: 70, resize: 'vertical' }}
              value={c.textoApresentacao} disabled={!podeEditar}
              onChange={e => set({ textoApresentacao: e.target.value })}
            />
          </Campo>
          <Campo label="Aviso nutricional" dica="Aparece no rodapé da apresentação.">
            <textarea
              className="vr-inp txt" style={{ minHeight: 70, resize: 'vertical' }}
              value={c.avisoNutricional} disabled={!podeEditar}
              onChange={e => set({ avisoNutricional: e.target.value })}
            />
          </Campo>
          <Campo label="Aviso de estimativa" dica="Deixa claro que os números são projeção.">
            <textarea
              className="vr-inp txt" style={{ minHeight: 80, resize: 'vertical' }}
              value={c.avisoEstimativa} disabled={!podeEditar}
              onChange={e => set({ avisoEstimativa: e.target.value })}
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

      {/* ------------------------------------------------ fórmulas salvas */}
      <div className="vr-card">
        <h2>Fórmulas salvas</h2>
        <div className="vr-hint" style={{ marginBottom: 12 }}>
          Composições reutilizáveis. Não são recomendação nutricional da Branorte — são o que o
          time cadastrou a partir da orientação do nutricionista do cliente.
        </div>
        {formulas.length === 0 ? (
          <div className="vr-hint">Nenhuma fórmula salva ainda.</div>
        ) : (
          <div className="vr-scroll">
            <table className="vr-tabela">
              <thead>
                <tr><th>Nome</th><th>Produto</th><th style={{ textAlign: 'right' }}>Ingredientes</th><th /></tr>
              </thead>
              <tbody>
                {formulas.map(f => (
                  <tr key={f.id}>
                    <td>{f.nome}</td>
                    <td>{f.especie ? ESPECIES.find(e => e.chave === f.especie)?.nome ?? f.especie : '—'}</td>
                    <td className="num">{(f.itens ?? []).length}</td>
                    <td>
                      {podeEditar && (
                        <button
                          type="button" className="vr-btn ghost" style={{ padding: '6px 8px' }}
                          title="Remover" onClick={() => onRemoverFormula(f.id)}
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
      </div>

      {/* --------------------------- consumo de referência (só leitura) */}
      <div className="vr-card">
        <h2>Categorias e consumo de referência</h2>
        <div className="vr-hint" style={{ marginBottom: 12 }}>
          Valores de PARTIDA por fase, em kg por animal por mês. São referência de catálogo — o
          consumo real varia com peso, genética, fase, manejo, formulação e objetivo produtivo, e
          o vendedor confirma dentro de cada estudo.
        </div>
        <Campo label="Produto">
          <Selecao
            valor={especieRef}
            opcoes={ESPECIES.map(e => ({ v: e.chave, label: e.nome }))}
            onChange={v => setEspecieRef(v)}
          />
        </Campo>
        <div className="vr-scroll" style={{ marginTop: 10 }}>
          <table className="vr-tabela">
            <thead>
              <tr><th>Fase</th><th style={{ textAlign: 'right' }}>kg / animal / mês</th><th>Observação</th></tr>
            </thead>
            <tbody>
              {(CATEGORIAS[especieRef] ?? []).map(cat => (
                <tr key={cat.chave}>
                  <td>{cat.nome}</td>
                  <td className="num">{cat.consumoMes > 0 ? numero(cat.consumoMes, 3) : '—'}</td>
                  <td style={{ color: 'var(--vr-ink40)', fontSize: 11.5 }}>{cat.nota ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
