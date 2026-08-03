/**
 * Histórico de propostas.
 *
 * A RLS já decide o alcance: vendedor enxerga só as próprias, admin (ou quem
 * tem `venda_racao.ver_todas`) enxerga todas. O filtro de vendedor aqui é
 * conveniência de quem vê tudo — pra quem só vê as suas, ele não muda nada.
 */
import { useState } from 'react'
import { Copy, FilePenLine, Trash2 } from 'lucide-react'
import { ESPECIES, STATUS_PROPOSTA } from '@/lib/venda-racao/catalogo'
import { brl, dataBR, numero, pct } from '@/lib/venda-racao/formato'
import type { Especie, SimulacaoRow, StatusProposta } from '@/lib/venda-racao/tipos'
import type { FiltrosSimulacao } from '@/hooks/useVendaRacao'
import { CampoTexto, Selecao } from './campos'

interface Props {
  linhas: SimulacaoRow[]
  carregando: boolean
  filtros: FiltrosSimulacao
  onFiltros: (f: FiltrosSimulacao) => void
  onAbrir: (id: string) => void
  onDuplicar: (id: string) => void
  onRemover: (id: string) => void
  onStatus: (id: string, s: StatusProposta) => void
  podeVerTodas: boolean
}

function corStatus(s: string): string {
  return STATUS_PROPOSTA.find(x => x.chave === s)?.cor ?? 'cinza'
}
function nomeStatus(s: string): string {
  return STATUS_PROPOSTA.find(x => x.chave === s)?.nome ?? s
}
function nomeEspecieCurto(e: Especie): string {
  return ESPECIES.find(x => x.chave === e)?.nome.replace('Ração para ', '') ?? e
}

export function HistoricoSimulacoes({
  linhas, carregando, filtros, onFiltros, onAbrir, onDuplicar, onRemover, onStatus, podeVerTodas,
}: Props) {
  const [confirmando, setConfirmando] = useState<string | null>(null)

  const totalValor = linhas.reduce((a, l) => a + Number(l.valor_total || 0), 0)
  const totalLucro = linhas.reduce((a, l) => a + Number(l.lucro_total || 0), 0)

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
              placeholder="Cliente, empresa ou código"
            />
          </div>
          <div className="vr-field">
            <div className="vr-label"><span>Status</span></div>
            <Selecao
              valor={filtros.status ?? ''}
              opcoes={[{ v: '', label: 'Todos' }, ...STATUS_PROPOSTA.map(s => ({ v: s.chave, label: s.nome }))]}
              onChange={v => onFiltros({ ...filtros, status: v as StatusProposta | '' })}
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
        </div>
      </div>

      <div className="vr-metrics" style={{ marginTop: 14 }}>
        <div className="vr-mt"><div className="l">Propostas</div><div className="val">{numero(linhas.length)}</div></div>
        <div className="vr-mt"><div className="l">Valor somado</div><div className="val">{brl(totalValor)}</div></div>
        <div className="vr-mt"><div className="l">Lucro estimado</div><div className="val pos">{brl(totalLucro)}</div></div>
      </div>

      <div className="vr-card" style={{ marginTop: 14, padding: 0, overflow: 'hidden' }}>
        <div className="vr-scroll">
          <table className="vr-tabela">
            <thead>
              <tr>
                <th>Código / data</th>
                <th>Cliente</th>
                <th>Produto</th>
                {podeVerTodas && <th>Vendedor</th>}
                <th style={{ textAlign: 'right' }}>Quantidade</th>
                <th style={{ textAlign: 'right' }}>R$/kg</th>
                <th style={{ textAlign: 'right' }}>Total</th>
                <th style={{ textAlign: 'right' }}>Margem</th>
                <th>Status</th>
                <th>Validade</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {carregando && (
                <tr><td colSpan={11} style={{ textAlign: 'center', padding: 28, color: 'var(--vr-ink40)' }}>Carregando…</td></tr>
              )}
              {!carregando && linhas.length === 0 && (
                <tr>
                  <td colSpan={11} style={{ textAlign: 'center', padding: 28, color: 'var(--vr-ink40)' }}>
                    Nenhuma proposta encontrada com esses filtros.
                  </td>
                </tr>
              )}
              {linhas.map(l => (
                <tr key={l.id}>
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
                  <td className="num">{numero(Number(l.quantidade_kg))} kg</td>
                  <td className="num">{brl(Number(l.preco_negociado_kg), 2)}</td>
                  <td className="num">{brl(Number(l.valor_total))}</td>
                  <td className="num" style={{ color: Number(l.margem_real_pct) >= Number(l.margem_minima_pct ?? 0) ? 'var(--vr-green-d)' : 'var(--vr-red)' }}>
                    {pct(Number(l.margem_real_pct), 1)}
                  </td>
                  <td>
                    <select
                      className={`vr-tag ${corStatus(l.status)}`}
                      style={{ border: 0, cursor: 'pointer', appearance: 'none', WebkitAppearance: 'none' }}
                      value={l.status}
                      aria-label={`Status de ${l.codigo}`}
                      onChange={e => onStatus(l.id, e.target.value as StatusProposta)}
                    >
                      {STATUS_PROPOSTA.map(s => <option key={s.chave} value={s.chave}>{s.nome}</option>)}
                    </select>
                  </td>
                  <td style={{ whiteSpace: 'nowrap', color: 'var(--vr-ink60)' }}>{dataBR(l.validade)}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <div style={{ display: 'flex', gap: 4 }}>
                      <button type="button" className="vr-btn ghost" style={{ padding: '6px 8px' }} title="Abrir" onClick={() => onAbrir(l.id)}>
                        <FilePenLine className="h-3.5 w-3.5" />
                      </button>
                      <button type="button" className="vr-btn ghost" style={{ padding: '6px 8px' }} title="Duplicar" onClick={() => onDuplicar(l.id)}>
                        <Copy className="h-3.5 w-3.5" />
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
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="vr-hint" style={{ marginTop: 10 }}>
        {podeVerTodas
          ? 'Você enxerga as propostas de todos os vendedores.'
          : 'Você enxerga as propostas que você criou.'}
        {' '}Mostrando no máximo 300 propostas por consulta — use os filtros pra afunilar.
      </div>
    </div>
  )
}
