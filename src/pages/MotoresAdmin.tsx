import { useMemo, useState } from 'react'
import { Zap, Search, Save, Check, Loader2, Settings2 } from 'lucide-react'
import { Input } from '@/components/ui/Input'
import { PageLoading } from '@/components/ui/LoadingSpinner'
import {
  useMotoresAdmin, useMotoresRedutorAdmin, useAlcanceMotores,
  useUpdateMotor, useUpdateMotorRedutor,
  type MotorAdmin,
} from '@/hooks/useMotoresAdmin'

// catalogo_motores.ocorrencias e a contagem congelada da importacao de mai/2026
// (quantas linhas da planilha viraram esta linha do catalogo). Nada no sistema
// incrementa esse campo - nao e uso em orcamento.
const TITULO_IMPORT = 'Contagem da importacao de mai/2026: quantas linhas da planilha original viraram este motor. Nao e uso em orcamento.'

function formatBRL(v: number): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v)
}

function cvLabel(cv: number): string {
  return Number.isInteger(cv) ? `${cv} CV` : `${String(cv).replace('.', ',')} CV`
}

// Editor de valor inline para uma cell.
function ValorEditor({ motor }: { motor: MotorAdmin }) {
  const [editando, setEditando] = useState(false)
  const [valor, setValor] = useState<number | ''>(Number(motor.valor))
  const upd = useUpdateMotor()

  if (!editando) {
    return (
      <button
        onClick={() => { setValor(Number(motor.valor)); setEditando(true) }}
        className="w-full text-right tabular-nums font-semibold text-ink hover:text-accent hover:bg-surface-2 px-2 py-1 rounded transition-all"
        title="Clique pra editar"
      >
        {formatBRL(Number(motor.valor))}
      </button>
    )
  }

  async function salvar() {
    if (typeof valor !== 'number' || valor < 0) { setEditando(false); return }
    if (Math.abs(valor - Number(motor.valor)) < 0.001) { setEditando(false); return }
    try {
      await upd.mutateAsync({ id: motor.id, patch: { valor } })
      setEditando(false)
    } catch (err: any) {
      alert('Erro: ' + (err?.message ?? 'desconhecido'))
    }
  }

  return (
    <div className="flex items-center gap-1">
      <Input
        type="number"
        value={valor}
        onChange={e => setValor(e.target.value ? Number(e.target.value) : '')}
        onKeyDown={e => {
          if (e.key === 'Enter') salvar()
          if (e.key === 'Escape') setEditando(false)
        }}
        autoFocus
        className="w-28 text-right text-[12px]"
        min="0"
        step="0.01"
      />
      <button
        onClick={salvar}
        disabled={upd.isPending}
        className="p-1 rounded bg-success hover:bg-success/90 text-white disabled:opacity-40"
        title="Salvar (Enter)"
      >
        {upd.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
      </button>
    </div>
  )
}

// Tabela de motores filtrada por (voltagem, polos)
function TabelaMotores({
  motores, voltagem, polos, label,
}: {
  motores: MotorAdmin[]
  voltagem: 'monofasico' | 'trifasico'
  polos: number
  label: string
}) {
  const filtrados = motores.filter(m => m.voltagem === voltagem && m.polos === polos && m.ativo)
  if (filtrados.length === 0) return null

  const total = filtrados.reduce((s, m) => s + Number(m.valor), 0)

  return (
    <div className="bg-surface border border-border rounded-lg overflow-hidden">
      <div className="px-3 py-2 bg-accent/15 border-b border-accent/30 flex items-center justify-between">
        <h3 className="text-[11px] font-bold uppercase tracking-wider text-accent">
          {label}
        </h3>
        <span className="text-[10px] text-ink-muted">
          {filtrados.length} motores · soma {formatBRL(total)}
        </span>
      </div>
      <table className="w-full text-[12px]">
        <thead className="bg-surface-2/50 text-ink-muted">
          <tr>
            <th className="text-left px-3 py-1.5 font-semibold uppercase text-[10px] tracking-wider">Potência</th>
            <th className="text-left px-3 py-1.5 font-semibold uppercase text-[10px] tracking-wider">Modelo</th>
            <th className="text-right px-3 py-1.5 font-semibold uppercase text-[10px] tracking-wider">Valor (R$)</th>
            <th className="text-right px-3 py-1.5 font-semibold uppercase text-[10px] tracking-wider" title={TITULO_IMPORT}>Importação</th>
          </tr>
        </thead>
        <tbody>
          {filtrados.map(m => (
            <tr key={m.id} className="border-t border-border/40 hover:bg-surface-2/30">
              <td className="px-3 py-1.5 font-semibold text-ink">{cvLabel(Number(m.cv))}</td>
              <td className="px-3 py-1.5 text-ink-muted font-mono text-[11px]">
                {m.modelo ?? <span className="italic text-ink-faint">—</span>}
              </td>
              <td className="px-3 py-1.5">
                <ValorEditor motor={m} />
              </td>
              <td className="px-3 py-1.5 text-right text-[10px] text-ink-faint tabular-nums" title={TITULO_IMPORT}>
                {m.ocorrencias > 0 ? `${m.ocorrencias}×` : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function TabelaMotorRedutor() {
  const { data: redutores } = useMotoresRedutorAdmin()
  const upd = useUpdateMotorRedutor()
  const [editando, setEditando] = useState<{ id: number; valor: number } | null>(null)

  if (!redutores || redutores.length === 0) return null

  async function salvar() {
    if (!editando) return
    try {
      await upd.mutateAsync({ id: editando.id, patch: { valor: editando.valor } })
      setEditando(null)
    } catch (err: any) {
      alert('Erro: ' + (err?.message ?? 'desconhecido'))
    }
  }

  return (
    <div className="bg-surface border border-border rounded-lg overflow-hidden">
      <div className="px-3 py-2 bg-warning/15 border-b border-warning/30">
        <h3 className="text-[11px] font-bold uppercase tracking-wider text-warning">
          Motor-Redutor (Q-sizes)
        </h3>
      </div>
      <table className="w-full text-[12px]">
        <thead className="bg-surface-2/50 text-ink-muted">
          <tr>
            <th className="text-left px-3 py-1.5 font-semibold uppercase text-[10px] tracking-wider">Modelo</th>
            <th className="text-left px-3 py-1.5 font-semibold uppercase text-[10px] tracking-wider">CV compatíveis</th>
            <th className="text-right px-3 py-1.5 font-semibold uppercase text-[10px] tracking-wider">Valor (R$)</th>
          </tr>
        </thead>
        <tbody>
          {redutores.map(r => (
            <tr key={r.id} className="border-t border-border/40 hover:bg-surface-2/30">
              <td className="px-3 py-1.5 font-semibold text-ink font-mono">{r.modelo}</td>
              <td className="px-3 py-1.5 text-ink-muted">
                {r.cv_compativel.map(cv => (
                  <span key={cv} className="inline-block px-1.5 py-0.5 mr-1 rounded bg-surface-2 border border-border text-[10px] font-semibold">
                    {cv} CV
                  </span>
                ))}
              </td>
              <td className="px-3 py-1.5">
                {editando?.id === r.id ? (
                  <div className="flex items-center gap-1 justify-end">
                    <Input
                      type="number"
                      value={editando.valor}
                      onChange={e => setEditando({ ...editando, valor: Number(e.target.value) })}
                      onKeyDown={e => {
                        if (e.key === 'Enter') salvar()
                        if (e.key === 'Escape') setEditando(null)
                      }}
                      autoFocus
                      className="w-28 text-right text-[12px]"
                      min="0"
                      step="0.01"
                    />
                    <button
                      onClick={salvar}
                      disabled={upd.isPending}
                      className="p-1 rounded bg-success hover:bg-success/90 text-white disabled:opacity-40"
                    >
                      {upd.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setEditando({ id: r.id, valor: Number(r.valor) })}
                    className="w-full text-right tabular-nums font-semibold text-ink hover:text-accent hover:bg-surface-2 px-2 py-1 rounded"
                  >
                    {formatBRL(Number(r.valor))}
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function MotoresAdmin() {
  const { data: motores, isLoading } = useMotoresAdmin()
  const { data: alcance, isError: alcanceErro } = useAlcanceMotores()
  const [busca, setBusca] = useState('')

  const filtrados = useMemo(() => {
    if (!motores) return []
    const q = busca.trim().toLowerCase()
    if (!q) return motores
    return motores.filter(m =>
      cvLabel(Number(m.cv)).toLowerCase().includes(q)
      || (m.modelo ?? '').toLowerCase().includes(q)
      || `${m.polos} polos`.includes(q)
    )
  }, [motores, busca])

  const totalAtivos = motores?.filter(m => m.ativo).length ?? 0

  // Motores ativos que nenhum equipamento consegue selecionar: o numero de polos
  // nao aparece em nenhuma fonte de selecao e ninguem aponta pra eles por motor_id.
  // polos = 0 fica de fora: e sentinela dos motorredutores, que sao escolhidos
  // por CV (catalogo_motorredutor), nao por polos.
  const orfaos = useMemo(() => {
    if (!motores || !alcance) return null
    const polosOk = new Set(alcance.polos)
    const idsOk = new Set(alcance.motorIds)
    return motores.filter(m =>
      m.ativo && m.polos > 0 && !polosOk.has(m.polos) && !idsOk.has(m.id)
    )
  }, [motores, alcance])

  const polosOrfaos = orfaos
    ? [...new Set(orfaos.map(m => m.polos))].sort((a, b) => a - b)
    : []

  if (isLoading) return <PageLoading />

  return (
    <div className="min-h-screen bg-bg">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6">
        {/* Header */}
        <div className="mb-5">
          <div className="flex items-center gap-2 mb-1">
            <Zap className="w-5 h-5 text-accent" />
            <h1 className="text-[18px] font-semibold text-ink">Catálogo de Motores</h1>
          </div>
          <p className="text-[12px] text-ink-muted">
            Banco oficial de preços de motores Branorte (PDF 2026). Quando o motor de um item de orçamento
            apontar pra aqui, o preço é puxado automaticamente.
          </p>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-5">
          <div className="bg-surface border border-border rounded-md px-3 py-2.5">
            <div className="text-[10px] text-ink-faint uppercase tracking-wide flex items-center gap-1">
              <Zap className="w-3 h-3" /> Total ativos
            </div>
            <div className="text-[18px] font-semibold text-ink">{totalAtivos}</div>
          </div>
          <div className="bg-surface border border-border rounded-md px-3 py-2.5">
            <div className="text-[10px] text-ink-faint uppercase tracking-wide">Trifásicos</div>
            <div className="text-[18px] font-semibold text-info">
              {motores?.filter(m => m.ativo && m.voltagem === 'trifasico').length ?? 0}
            </div>
          </div>
          <div className="bg-surface border border-border rounded-md px-3 py-2.5">
            <div className="text-[10px] text-ink-faint uppercase tracking-wide">Monofásicos</div>
            <div className="text-[18px] font-semibold text-warning">
              {motores?.filter(m => m.ativo && m.voltagem === 'monofasico').length ?? 0}
            </div>
          </div>
          <div
            className="bg-surface border border-border rounded-md px-3 py-2.5"
            title="Motor ativo cujo numero de polos nenhuma fonte de selecao pede (precos_branorte, transportador_funcoes, catalogo_items) e que ninguem aponta por motor_id. Motorredutores (polos = 0) nao entram: sao escolhidos por CV."
          >
            <div className="text-[10px] text-ink-faint uppercase tracking-wide">
              Sem equipamento que use
            </div>
            {alcanceErro ? (
              <>
                <div className="text-[18px] font-semibold text-ink-faint">—</div>
                <div className="text-[9px] text-ink-faint">não deu pra conferir</div>
              </>
            ) : orfaos === null ? (
              <div className="text-[18px] font-semibold text-ink-faint">…</div>
            ) : (
              <>
                <div className={`text-[18px] font-semibold ${orfaos.length > 0 ? 'text-warning' : 'text-ink'}`}>
                  {orfaos.length}
                </div>
                <div className="text-[9px] text-ink-faint">
                  {orfaos.length > 0
                    ? `de ${totalAtivos} ativos · ${polosOrfaos.join(' e ')} polos`
                    : `de ${totalAtivos} ativos`}
                </div>
              </>
            )}
          </div>
        </div>

        {/* Busca */}
        <div className="mb-4">
          <div className="relative max-w-md">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-ink-faint" />
            <Input
              value={busca}
              onChange={e => setBusca(e.target.value)}
              placeholder="Buscar por CV, modelo (ex: 132S2) ou polos..."
              className="pl-7"
            />
          </div>
        </div>

        {/* Grid de tabelas: trifasico esquerda, monofasico direita */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 mb-5">
          {/* Trifásico */}
          <div className="space-y-3">
            <TabelaMotores motores={filtrados} voltagem="trifasico" polos={2} label="Trifásico · 2 polos" />
            <TabelaMotores motores={filtrados} voltagem="trifasico" polos={4} label="Trifásico · 4 polos" />
            <TabelaMotores motores={filtrados} voltagem="trifasico" polos={6} label="Trifásico · 6 polos" />
            <TabelaMotores motores={filtrados} voltagem="trifasico" polos={8} label="Trifásico · 8 polos" />
          </div>

          {/* Monofásico + Motor-redutor */}
          <div className="space-y-3">
            <TabelaMotores motores={filtrados} voltagem="monofasico" polos={2} label="Monofásico · 2 polos" />
            <TabelaMotores motores={filtrados} voltagem="monofasico" polos={4} label="Monofásico · 4 polos" />
            <TabelaMotorRedutor />
          </div>
        </div>

        {/* Help */}
        <div className="bg-info/10 border border-info/30 rounded-lg p-3 text-[11px] text-ink-muted flex items-start gap-2">
          <Settings2 className="h-4 w-4 text-info shrink-0 mt-0.5" />
          <div>
            <strong className="text-ink">Como funciona:</strong> Clique em qualquer valor pra editar. Enter pra salvar, Esc pra cancelar.
            Os preços daqui são puxados automaticamente quando um item do catálogo aponta pro motor (via <code className="px-1 py-0.5 bg-surface-2 rounded text-[10px]">motor_id</code>).
            Quando trocar o motor de um item no preview do orçamento, o sistema busca aqui o valor.
          </div>
        </div>
      </div>
    </div>
  )
}
