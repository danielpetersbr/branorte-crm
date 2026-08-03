/**
 * Histórico de estudos.
 *
 * A RLS já decide o alcance: vendedor enxerga só os próprios, admin (ou quem
 * tem `venda_racao.ver_todas`) enxerga todos. O filtro de vendedor aqui é
 * conveniência de quem vê tudo — pra quem só vê os seus, ele não muda nada.
 */
import { useState } from 'react'
import { Archive, ArchiveRestore, Copy, FilePenLine, FileText, Trash2 } from 'lucide-react'
import { ESPECIES, STATUS_ESTUDO, normalizarStatus } from '@/lib/venda-racao/catalogo'
import { brl, dataBR, kgHora, meses, numero, pct } from '@/lib/venda-racao/formato'
import type { Especie, EstudoRow, StatusEstudo } from '@/lib/venda-racao/tipos'
import type { FiltrosEstudo } from '@/hooks/useVendaRacao'
import { CampoTexto, Selecao } from './campos'

interface Props {
  linhas: EstudoRow[]
  carregando: boolean
  filtros: FiltrosEstudo
  onFiltros: (f: FiltrosEstudo) => void
  onAbrir: (id: string) => void
  onApresentar: (id: string) => void
  onDuplicar: (id: string) => void
  onArquivar: (id: string, arquivado: boolean) => void
  onRemover: (id: string) => void
  onStatus: (id: string, s: StatusEstudo) => void
  podeVerTodas: boolean
}

function corStatus(s: string): string {
  return STATUS_ESTUDO.find(x => x.chave === normalizarStatus(s))?.cor ?? 'cinza'
}
function nomeEspecieCurto(e: Especie): string {
  return ESPECIES.find(x => x.chave === e)?.nome.replace('Ração farelada para ', '') ?? e
}

export function HistoricoEstudos({
  linhas, carregando, filtros, onFiltros, onAbrir, onApresentar, onDuplicar,
  onArquivar, onRemover, onStatus, podeVerTodas,
}: Props) {
  const [confirmando, setConfirmando] = useState<string | null>(null)
  const [comparar, setComparar] = useState<string[]>([])

  const alternarComparar = (id: string) =>
    setComparar(c => (c.includes(id) ? c.filter(x => x !== id) : [...c, id].slice(-2)))

  const selecionados = comparar
    .map(id => linhas.find(l => l.id === id))
    .filter((l): l is EstudoRow => !!l)

  const economiaTotal = linhas.reduce((a, l) => a + Number(l.economia_mensal || 0), 0)
  const investimentoTotal = linhas.reduce((a, l) => a + Number(l.investimento_total || 0), 0)

  return (
    <div>
      <div className="vr-card">
        <h2>Filtros</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10, marginTop: 10 }}>
          <div className="vr-field">
            <div className="vr-label"><span>Buscar</span></div>
            <CampoTexto
              valor={filtros.busca ?? ''}
              onChange={v => onFiltros({ ...filtros, busca: v })}
              placeholder="Cliente, propriedade ou código"
            />
          </div>
          <div className="vr-field">
            <div className="vr-label"><span>Status</span></div>
            <Selecao
              valor={filtros.status ?? ''}
              opcoes={[{ v: '', label: 'Todos' }, ...STATUS_ESTUDO.map(s => ({ v: s.chave, label: s.nome }))]}
              onChange={v => onFiltros({ ...filtros, status: v as StatusEstudo | '' })}
            />
          </div>
          <div className="vr-field">
            <div className="vr-label"><span>Produto</span></div>
            <Selecao
              valor={filtros.especie ?? ''}
              opcoes={[{ v: '', label: 'Todos' }, ...ESPECIES.map(e => ({ v: e.chave, label: e.nome }))]}
              onChange={v => onFiltros({ ...filtros, especie: v as Especie | '' })}
            />
          </div>
          {podeVerTodas && (
            <div className="vr-field">
              <div className="vr-label"><span>Vendedor</span></div>
              <CampoTexto
                valor={filtros.vendedor ?? ''}
                onChange={v => onFiltros({ ...filtros, vendedor: v })}
                placeholder="Nome do vendedor"
              />
            </div>
          )}
          <div className="vr-field">
            <div className="vr-label"><span>De</span></div>
            <CampoTexto tipo="date" valor={filtros.de ?? ''} onChange={v => onFiltros({ ...filtros, de: v })} />
          </div>
          <div className="vr-field">
            <div className="vr-label"><span>Até</span></div>
            <CampoTexto tipo="date" valor={filtros.ate ?? ''} onChange={v => onFiltros({ ...filtros, ate: v })} />
          </div>
          <div className="vr-field">
            <div className="vr-label"><span>Arquivados</span></div>
            <Selecao
              valor={filtros.arquivados ?? 'nao'}
              opcoes={[
                { v: 'nao', label: 'Esconder arquivados' },
                { v: 'sim', label: 'Só arquivados' },
                { v: 'todos', label: 'Mostrar todos' },
              ]}
              onChange={v => onFiltros({ ...filtros, arquivados: v as FiltrosEstudo['arquivados'] })}
            />
          </div>
        </div>
      </div>

      <div className="vr-metrics" style={{ marginTop: 14 }}>
        <div className="vr-mt"><div className="l">Estudos</div><div className="val">{numero(linhas.length)}</div></div>
        <div className="vr-mt"><div className="l">Economia mensal somada</div><div className="val pos">{brl(economiaTotal)}</div></div>
        <div className="vr-mt"><div className="l">Investimento em análise</div><div className="val">{brl(investimentoTotal)}</div></div>
      </div>

      {selecionados.length === 2 && (
        <div className="vr-card" style={{ marginTop: 14 }}>
          <h2>Comparação</h2>
          <div className="vr-scroll">
            <table className="vr-tabela">
              <thead>
                <tr>
                  <th>Indicador</th>
                  {selecionados.map(l => <th key={l.id} style={{ textAlign: 'right' }}>{l.codigo}</th>)}
                </tr>
              </thead>
              <tbody>
                {([
                  ['Cliente', (l: EstudoRow) => l.cliente_nome],
                  ['Data', (l: EstudoRow) => dataBR(l.created_at)],
                  ['Consumo mensal', (l: EstudoRow) => `${numero(Number(l.quantidade_mensal_kg))} kg`],
                  ['Custo atual', (l: EstudoRow) => `${brl(Number(l.custo_atual_kg), 4)}/kg`],
                  ['Custo próprio', (l: EstudoRow) => `${brl(Number(l.custo_proprio_kg), 4)}/kg`],
                  ['Economia mensal', (l: EstudoRow) => brl(Number(l.economia_mensal))],
                  ['Economia anual', (l: EstudoRow) => brl(Number(l.economia_anual))],
                  ['Redução', (l: EstudoRow) => pct(Number(l.reducao_pct), 1)],
                  ['Capacidade', (l: EstudoRow) => (Number(l.capacidade_kg_hora) > 0 ? kgHora(Number(l.capacidade_kg_hora)) : '—')],
                  ['Investimento', (l: EstudoRow) => brl(Number(l.investimento_total))],
                  ['Retorno', (l: EstudoRow) => (l.payback_meses ? meses(Number(l.payback_meses), 1) : '—')],
                ] as Array<[string, (l: EstudoRow) => string]>).map(([rot, fn]) => (
                  <tr key={rot}>
                    <td>{rot}</td>
                    {selecionados.map(l => <td key={l.id} className="num">{fn(l)}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="vr-cta">
            <button type="button" className="vr-btn ghost" onClick={() => setComparar([])}>Limpar comparação</button>
          </div>
        </div>
      )}

      <div className="vr-card" style={{ marginTop: 14, padding: 0, overflow: 'hidden' }}>
        <div className="vr-scroll">
          <table className="vr-tabela">
            <thead>
              <tr>
                <th title="Marque dois estudos pra comparar">⇄</th>
                <th>Código / data</th>
                <th>Cliente / propriedade</th>
                <th>Produto</th>
                {podeVerTodas && <th>Vendedor</th>}
                <th style={{ textAlign: 'right' }}>Consumo/mês</th>
                <th style={{ textAlign: 'right' }}>Custo atual</th>
                <th style={{ textAlign: 'right' }}>Custo próprio</th>
                <th style={{ textAlign: 'right' }}>Economia/mês</th>
                <th style={{ textAlign: 'right' }}>Capacidade</th>
                <th style={{ textAlign: 'right' }}>Investimento</th>
                <th style={{ textAlign: 'right' }}>Retorno</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {carregando && (
                <tr><td colSpan={14} style={{ textAlign: 'center', padding: 28, color: 'var(--vr-ink40)' }}>Carregando…</td></tr>
              )}
              {!carregando && linhas.length === 0 && (
                <tr>
                  <td colSpan={14} style={{ textAlign: 'center', padding: 28, color: 'var(--vr-ink40)' }}>
                    Nenhum estudo encontrado com esses filtros.
                  </td>
                </tr>
              )}
              {linhas.map(l => {
                const economia = Number(l.economia_mensal || 0)
                return (
                  <tr key={l.id} style={l.arquivado ? { opacity: 0.55 } : undefined}>
                    <td>
                      <input
                        type="checkbox"
                        checked={comparar.includes(l.id)}
                        aria-label={`Comparar ${l.codigo}`}
                        style={{ width: 15, height: 15, accentColor: 'var(--vr-green)' }}
                        onChange={() => alternarComparar(l.id)}
                      />
                    </td>
                    <td>
                      <div style={{ fontWeight: 700 }}>{l.codigo}</div>
                      <div style={{ color: 'var(--vr-ink40)', fontSize: 11 }}>{dataBR(l.created_at)}</div>
                    </td>
                    <td>
                      <div style={{ fontWeight: 600 }}>{l.cliente_nome}</div>
                      {l.cliente_empresa && <div style={{ color: 'var(--vr-ink40)', fontSize: 11 }}>{l.cliente_empresa}</div>}
                    </td>
                    <td>
                      <div>{nomeEspecieCurto(l.especie)}</div>
                      {l.categoria && <div style={{ color: 'var(--vr-ink40)', fontSize: 11 }}>{l.categoria}</div>}
                    </td>
                    {podeVerTodas && <td>{l.vendedor_nome || '—'}</td>}
                    <td className="num">{numero(Number(l.quantidade_mensal_kg))} kg</td>
                    <td className="num">{brl(Number(l.custo_atual_kg), 2)}</td>
                    <td className="num">{brl(Number(l.custo_proprio_kg), 2)}</td>
                    <td className="num" style={{ color: economia > 0 ? 'var(--vr-green-d)' : 'var(--vr-red)' }}>
                      {brl(economia)}
                    </td>
                    <td className="num">{Number(l.capacidade_kg_hora) > 0 ? kgHora(Number(l.capacidade_kg_hora)) : '—'}</td>
                    <td className="num">{brl(Number(l.investimento_total))}</td>
                    <td className="num">{l.payback_meses ? meses(Number(l.payback_meses), 1) : '—'}</td>
                    <td>
                      <select
                        className={`vr-tag ${corStatus(l.status)}`}
                        style={{ border: 0, cursor: 'pointer', appearance: 'none', WebkitAppearance: 'none' }}
                        value={normalizarStatus(l.status)}
                        aria-label={`Status de ${l.codigo}`}
                        onChange={e => onStatus(l.id, e.target.value as StatusEstudo)}
                      >
                        {STATUS_ESTUDO.map(s => <option key={s.chave} value={s.chave}>{s.nome}</option>)}
                      </select>
                    </td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      <div style={{ display: 'flex', gap: 4 }}>
                        <button type="button" className="vr-btn ghost" style={{ padding: '6px 8px' }} title="Abrir" onClick={() => onAbrir(l.id)}>
                          <FilePenLine className="h-3.5 w-3.5" />
                        </button>
                        <button type="button" className="vr-btn ghost" style={{ padding: '6px 8px' }} title="Apresentar / gerar PDF" onClick={() => onApresentar(l.id)}>
                          <FileText className="h-3.5 w-3.5" />
                        </button>
                        <button type="button" className="vr-btn ghost" style={{ padding: '6px 8px' }} title="Duplicar" onClick={() => onDuplicar(l.id)}>
                          <Copy className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button" className="vr-btn ghost" style={{ padding: '6px 8px' }}
                          title={l.arquivado ? 'Desarquivar' : 'Arquivar'}
                          onClick={() => onArquivar(l.id, !l.arquivado)}
                        >
                          {l.arquivado ? <ArchiveRestore className="h-3.5 w-3.5" /> : <Archive className="h-3.5 w-3.5" />}
                        </button>
                        {confirmando === l.id ? (
                          <>
                            <button
                              type="button" className="vr-btn perigo" style={{ padding: '6px 8px', fontSize: 11 }}
                              onClick={() => { onRemover(l.id); setConfirmando(null) }}
                            >
                              Apagar
                            </button>
                            <button type="button" className="vr-btn ghost" style={{ padding: '6px 8px', fontSize: 11 }} onClick={() => setConfirmando(null)}>
                              Não
                            </button>
                          </>
                        ) : (
                          <button
                            type="button" className="vr-btn ghost" style={{ padding: '6px 8px' }}
                            title="Apagar" onClick={() => setConfirmando(l.id)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="vr-hint" style={{ marginTop: 10 }}>
        {podeVerTodas
          ? 'Você enxerga os estudos de todos os vendedores.'
          : 'Você enxerga os estudos que você criou.'}
        {' '}Mostrando no máximo 300 estudos por consulta — use os filtros pra afunilar.
        Marque dois na primeira coluna pra comparar.
      </div>
    </div>
  )
}
