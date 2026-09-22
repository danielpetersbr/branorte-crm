// CONTRATOS FEITOS — histórico dos contratos gerados, com andamento.
//
// Mais do que uma lista: é aqui que se vê quais contratos ainda NÃO foram
// registrados no cartório. Enquanto o registro não sai, a reserva de domínio não
// vale contra terceiro nenhum (penhora, revenda, recuperação judicial) — então
// um contrato parado em "gerado" ou "assinado" é uma garantia que ainda não existe.

import { useState, useMemo } from 'react'
import { Link } from 'react-router-dom'
import {
  FileSignature, Search, FileText, Calendar, User, DollarSign,
  Edit3, AlertTriangle, CheckCircle2, Loader2, Landmark,
} from 'lucide-react'
import {
  useContratos, useAtualizarStatusContrato,
  STATUS_CONTRATO, type ContratoLinha, type StatusContrato,
} from '@/hooks/useContratos'
import { PageLoading } from '@/components/ui/LoadingSpinner'
import { formatBRL } from '@/lib/contrato/extenso'

function dataBR(iso: string | null): string {
  if (!iso) return '—'
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso)
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso
}

function hojeIso(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** Dias corridos desde a assinatura — o art. 130 da Lei 6.015/73 dá 20. */
function diasDesde(iso: string | null): number | null {
  if (!iso) return null
  const t = Date.parse(iso + 'T12:00:00')
  if (Number.isNaN(t)) return null
  return Math.floor((Date.now() - t) / 86400000)
}

function Linha({ c }: { c: ContratoLinha }) {
  const st = STATUS_CONTRATO[c.status] ?? STATUS_CONTRATO.rascunho
  const mutar = useAtualizarStatusContrato()
  const [aberto, setAberto] = useState(false)

  const dias = diasDesde(c.assinado_em)
  const atrasado = c.status === 'assinado' && dias != null && dias > 20

  return (
    <>
      <tr className="border-b border-border/60 hover:bg-surface-2/40">
        <td className="px-3 py-2 font-mono font-bold text-accent whitespace-nowrap">{c.orcamento_numero}</td>
        <td className="px-3 py-2 text-ink-muted whitespace-nowrap">
          <span className="flex items-center gap-1.5">
            <Calendar className="h-3.5 w-3.5 text-ink-faint" />
            {dataBR(c.data_contrato || c.created_at.slice(0, 10))}
          </span>
        </td>
        <td className="px-3 py-2 font-medium">
          <span className="flex items-center gap-1.5">
            <User className="h-3.5 w-3.5 text-ink-faint shrink-0" />
            {c.cliente_nome || <span className="italic text-ink-faint">[sem nome]</span>}
          </span>
        </td>
        <td className="px-3 py-2 text-ink-muted">{c.vendedor_nome}</td>
        <td className="px-3 py-2 text-right font-bold tabular-nums text-success">
          <span className="flex items-center justify-end gap-1.5">
            <DollarSign className="h-3.5 w-3.5 text-ink-faint" />
            {formatBRL(c.valor_total)}
          </span>
        </td>
        <td className="px-3 py-2">
          <span className={`inline-flex px-2 py-0.5 rounded text-[11px] font-bold border ${st.classe}`}>
            {st.label}
          </span>
          {atrasado && (
            <span
              className="ml-1.5 inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-red-100 text-red-700 border border-red-300"
              title={`Assinado há ${dias} dias e ainda sem registro. O art. 130 da Lei 6.015/73 dá 20 dias, e o registro feito depois não retroage.`}
            >
              <AlertTriangle className="h-3 w-3" />
              {dias}d sem registro
            </span>
          )}
        </td>
        <td className="px-3 py-2 text-center whitespace-nowrap">
          <span className="inline-flex items-center gap-1.5">
            <Link
              to={`/orcamentos/contrato?contrato=${c.id}`}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-accent/15 text-accent border border-accent/30 hover:bg-accent/25 text-[12px] font-bold transition"
              title="Abrir e editar este contrato"
            >
              <Edit3 className="h-3.5 w-3.5" />
              Abrir
            </Link>
            <button
              onClick={() => setAberto(v => !v)}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-surface-2 text-ink-muted border border-border hover:bg-surface-3 hover:text-ink text-[12px] font-bold transition"
              title="Marcar assinatura e registro"
            >
              <Landmark className="h-3.5 w-3.5" />
              Andamento
            </button>
          </span>
        </td>
      </tr>

      {aberto && (
        <tr className="border-b border-border/60 bg-surface-2/30">
          <td colSpan={7} className="px-4 py-3">
            <div className="flex flex-wrap items-end gap-4 text-[12px]">
              <label className="block">
                <span className="block text-[11px] font-semibold text-ink-muted mb-1">Assinado em</span>
                <input
                  type="date"
                  defaultValue={c.assinado_em ?? ''}
                  onChange={e => mutar.mutate({
                    id: c.id,
                    status: c.status === 'registrado' ? 'registrado' : 'assinado',
                    assinado_em: e.target.value || null,
                  })}
                  className="px-2 py-1 border border-border rounded bg-surface focus:border-accent outline-none"
                />
              </label>
              <label className="block">
                <span className="block text-[11px] font-semibold text-ink-muted mb-1">
                  Registrado no RTD em {c.comarca ? `(${c.comarca})` : ''}
                </span>
                <input
                  type="date"
                  defaultValue={c.registrado_em ?? ''}
                  onChange={e => mutar.mutate({
                    id: c.id,
                    status: e.target.value ? 'registrado' : (c.assinado_em ? 'assinado' : 'gerado'),
                    registrado_em: e.target.value || null,
                  })}
                  className="px-2 py-1 border border-border rounded bg-surface focus:border-accent outline-none"
                />
              </label>
              <label className="block flex-1 min-w-[220px]">
                <span className="block text-[11px] font-semibold text-ink-muted mb-1">
                  Protocolo / observação do cartório
                </span>
                <input
                  defaultValue={c.registro_obs ?? ''}
                  placeholder="nº do protocolo, cartório, custo…"
                  onBlur={e => mutar.mutate({ id: c.id, status: c.status, registro_obs: e.target.value || null })}
                  className="w-full px-2 py-1 border border-border rounded bg-surface focus:border-accent outline-none"
                />
              </label>
              <button
                onClick={() => mutar.mutate({ id: c.id, status: 'cancelado' })}
                className="px-2.5 py-1 rounded-md border border-border text-ink-muted hover:text-danger hover:border-danger/40 text-[12px]"
              >
                Cancelar contrato
              </button>
              {mutar.isPending && <Loader2 className="h-4 w-4 animate-spin text-ink-faint" />}
              {mutar.isSuccess && !mutar.isPending && (
                <span className="inline-flex items-center gap-1 text-success text-[12px] font-semibold">
                  <CheckCircle2 className="h-4 w-4" /> salvo
                </span>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  )
}

export function ContratosFeitos() {
  const { data, isLoading } = useContratos()
  const [busca, setBusca] = useState('')
  const [filtro, setFiltro] = useState<StatusContrato | 'pendente_registro' | ''>('')

  const lista = useMemo(() => {
    const termo = busca.trim().toLowerCase()
    return (data ?? []).filter(c => {
      if (filtro === 'pendente_registro') {
        if (c.status === 'registrado' || c.status === 'cancelado') return false
      } else if (filtro && c.status !== filtro) return false
      if (termo) {
        const palheiro = `${c.orcamento_numero} ${c.cliente_nome} ${c.vendedor_nome}`.toLowerCase()
        if (!palheiro.includes(termo)) return false
      }
      return true
    })
  }, [data, busca, filtro])

  const semRegistro = useMemo(
    () => (data ?? []).filter(c => c.status !== 'registrado' && c.status !== 'cancelado').length,
    [data],
  )

  if (isLoading) return <PageLoading />

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto">
      <header className="mb-5">
        <h1 className="text-xl font-bold flex items-center gap-2">
          <FileSignature className="h-5 w-5 text-accent" />
          Contratos Feitos
        </h1>
        <p className="text-[13px] text-ink-muted mt-1">
          {data?.length ?? 0} contrato(s) — clique em <b>Abrir</b> pra editar e gerar de novo.
          {' '}
          <Link to="/orcamentos/contrato" className="text-accent hover:underline">montar um novo</Link>
        </p>
      </header>

      {semRegistro > 0 && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 mb-4">
          <div className="flex items-center gap-2 text-[13px] font-bold text-amber-800 mb-1">
            <AlertTriangle className="h-4 w-4" />
            {semRegistro} contrato(s) ainda sem registro no cartório
          </div>
          <p className="text-[12px] text-amber-800/90">
            Enquanto o registro não sai, a reserva de domínio não vale contra terceiros: numa penhora de
            outro credor, numa revenda ou numa recuperação judicial, o equipamento se perde. O prazo legal
            é de 20 dias da assinatura, e registro feito depois <b>não retroage</b>.
          </p>
          <button
            onClick={() => setFiltro('pendente_registro')}
            className="mt-1.5 text-[12px] font-semibold text-amber-800 underline hover:no-underline"
          >
            ver só esses
          </button>
        </div>
      )}

      <div className="flex flex-wrap gap-2 mb-4">
        <div className="relative flex-1 min-w-[240px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-ink-faint" />
          <input
            value={busca}
            onChange={e => setBusca(e.target.value)}
            placeholder="Buscar por número, cliente ou vendedor…"
            className="w-full pl-9 pr-3 py-2 text-sm border border-border rounded-md bg-surface-2 focus:border-accent outline-none"
          />
        </div>
        <select
          value={filtro}
          onChange={e => setFiltro(e.target.value as typeof filtro)}
          className="px-3 py-2 text-sm border border-border rounded-md bg-surface-2 focus:border-accent outline-none"
        >
          <option value="">Todos os status</option>
          <option value="pendente_registro">⚠️ Falta registrar no cartório</option>
          <option value="rascunho">Rascunho</option>
          <option value="gerado">Gerado</option>
          <option value="assinado">Assinado</option>
          <option value="registrado">Registrado</option>
          <option value="cancelado">Cancelado</option>
        </select>
      </div>

      {lista.length === 0 ? (
        <div className="text-center py-12 text-ink-faint">
          <FileText className="h-10 w-10 mx-auto mb-2 opacity-40" />
          <p>Nenhum contrato encontrado</p>
        </div>
      ) : (
        <div className="overflow-x-auto border border-border rounded-md">
          <table className="w-full text-[13px]">
            <thead className="bg-surface-2 border-b border-border">
              <tr>
                <th className="text-left px-3 py-2 font-semibold text-ink-muted">Orçamento</th>
                <th className="text-left px-3 py-2 font-semibold text-ink-muted">Data</th>
                <th className="text-left px-3 py-2 font-semibold text-ink-muted">Cliente</th>
                <th className="text-left px-3 py-2 font-semibold text-ink-muted">Vendedor</th>
                <th className="text-right px-3 py-2 font-semibold text-ink-muted">Valor</th>
                <th className="text-left px-3 py-2 font-semibold text-ink-muted">Status</th>
                <th className="text-center px-3 py-2 font-semibold text-ink-muted">Ação</th>
              </tr>
            </thead>
            <tbody>
              {lista.map(c => <Linha key={c.id} c={c} />)}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

export default ContratosFeitos
