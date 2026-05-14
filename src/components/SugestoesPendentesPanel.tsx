import { useState } from 'react'
import { Check, X, Loader2, User, Mail, Calendar, Package, Zap, AlertCircle } from 'lucide-react'
import {
  useSugestoesPendentes, useAprovarSugestao, useRejeitarSugestao,
  type SugestaoPendente,
} from '@/hooks/useSugestoesPendentes'

function formatBRL(v: number): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v)
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('pt-BR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

export function SugestoesPendentesPanel() {
  const [incluirRevisadas, setIncluirRevisadas] = useState(false)
  const { data: sugestoes, isLoading } = useSugestoesPendentes(incluirRevisadas)
  const aprovar = useAprovarSugestao()
  const rejeitar = useRejeitarSugestao()
  const [rejeitando, setRejeitando] = useState<{ id: number; motivo: string } | null>(null)

  async function handleAprovar(s: SugestaoPendente) {
    if (!confirm(`Aprovar "${s.nome_curto}" e adicionar ao catálogo?`)) return
    try {
      await aprovar.mutateAsync(s.id)
    } catch (err: any) {
      alert('Erro ao aprovar: ' + (err?.message ?? 'desconhecido'))
    }
  }

  async function handleConfirmarRejeicao() {
    if (!rejeitando) return
    try {
      await rejeitar.mutateAsync({ id: rejeitando.id, motivo: rejeitando.motivo })
      setRejeitando(null)
    } catch (err: any) {
      alert('Erro ao rejeitar: ' + (err?.message ?? 'desconhecido'))
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12 text-ink-faint">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    )
  }

  const lista = sugestoes ?? []

  return (
    <div className="space-y-3">
      <div className="bg-surface border border-border rounded-lg p-3 flex items-center justify-between flex-wrap gap-2">
        <div className="text-[12px] text-ink-muted">
          {lista.filter(s => s.status === 'pending').length} aguardando revisão
          {incluirRevisadas && ` (+${lista.filter(s => s.status !== 'pending').length} revisadas)`}
        </div>
        <label className="flex items-center gap-1.5 text-[12px] text-ink-muted cursor-pointer">
          <input
            type="checkbox"
            checked={incluirRevisadas}
            onChange={e => setIncluirRevisadas(e.target.checked)}
            className="rounded border-border accent-accent"
          />
          Mostrar revisadas (histórico)
        </label>
      </div>

      {lista.length === 0 ? (
        <div className="bg-surface border border-border rounded-lg p-8 text-center text-ink-faint">
          <Package className="h-8 w-8 mx-auto mb-2 opacity-40" />
          <p className="text-[13px]">Nenhuma sugestão pendente.</p>
          <p className="text-[11px] mt-1">Quando um vendedor adicionar produto personalizado ad-hoc com a opção "Sugerir cadastro oficial", aparece aqui.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {lista.map(s => (
            <div
              key={s.id}
              className={`border rounded-lg p-4 flex flex-col sm:flex-row gap-4 ${
                s.status === 'pending'
                  ? 'bg-surface border-warning/30'
                  : s.status === 'approved'
                    ? 'bg-success/5 border-success/20 opacity-80'
                    : 'bg-danger/5 border-danger/20 opacity-70'
              }`}
            >
              {/* Info principal */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-[10px] uppercase tracking-wider font-bold text-accent">
                    {s.categoria}
                  </span>
                  {s.status === 'pending' && (
                    <span className="text-[10px] uppercase font-bold px-1.5 py-0.5 rounded bg-warning/20 text-warning">
                      Pendente
                    </span>
                  )}
                  {s.status === 'approved' && (
                    <span className="text-[10px] uppercase font-bold px-1.5 py-0.5 rounded bg-success/20 text-success">
                      ✓ Aprovado (item #{s.catalogo_item_id})
                    </span>
                  )}
                  {s.status === 'rejected' && (
                    <span className="text-[10px] uppercase font-bold px-1.5 py-0.5 rounded bg-danger/20 text-danger">
                      ✗ Rejeitado
                    </span>
                  )}
                </div>
                <div className="text-[14px] font-bold text-ink leading-snug">{s.nome_curto}</div>
                <div className="text-[13px] font-semibold text-accent mt-1">{formatBRL(Number(s.valor))}</div>

                {(s.motor_padrao_cv || s.descricao) && (
                  <div className="mt-2 space-y-1">
                    {s.motor_padrao_cv && (
                      <div className="text-[11px] text-ink-muted flex items-center gap-1">
                        <Zap className="h-3 w-3" /> {s.motor_padrao_cv} CV {s.motor_padrao_polos ?? '-'} polos
                      </div>
                    )}
                    {s.descricao && (
                      <div className="text-[11px] text-ink-muted whitespace-pre-wrap">
                        {s.descricao}
                      </div>
                    )}
                  </div>
                )}

                <div className="mt-2 pt-2 border-t border-border/50 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[10px] text-ink-faint">
                  <span className="flex items-center gap-1">
                    <User className="h-3 w-3" />
                    {s.criado_por_email || s.criado_por || 'desconhecido'}
                  </span>
                  <span className="flex items-center gap-1">
                    <Calendar className="h-3 w-3" />
                    {formatDateTime(s.created_at)}
                  </span>
                  {s.motivo_rejeicao && (
                    <span className="flex items-center gap-1 text-danger w-full mt-1">
                      <AlertCircle className="h-3 w-3" />
                      Motivo: {s.motivo_rejeicao}
                    </span>
                  )}
                </div>
              </div>

              {/* Ações */}
              {s.status === 'pending' && (
                <div className="flex sm:flex-col gap-2 shrink-0">
                  <button
                    onClick={() => handleAprovar(s)}
                    disabled={aprovar.isPending}
                    className="flex-1 sm:flex-none text-[11px] font-semibold px-3 py-2 rounded bg-success hover:bg-success/90 text-white disabled:opacity-50 flex items-center justify-center gap-1.5"
                  >
                    <Check className="h-3.5 w-3.5" />
                    Aprovar
                  </button>
                  <button
                    onClick={() => setRejeitando({ id: s.id, motivo: '' })}
                    disabled={rejeitar.isPending}
                    className="flex-1 sm:flex-none text-[11px] font-semibold px-3 py-2 rounded border border-danger/40 text-danger hover:bg-danger/10 disabled:opacity-50 flex items-center justify-center gap-1.5"
                  >
                    <X className="h-3.5 w-3.5" />
                    Rejeitar
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Modal de rejeição: pede motivo */}
      {rejeitando && (
        <div
          className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4"
          onClick={() => setRejeitando(null)}
        >
          <div
            className="bg-bg border border-border rounded-xl max-w-md w-full p-4 shadow-2xl"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center gap-2 mb-3">
              <X className="h-5 w-5 text-danger" />
              <h2 className="text-[15px] font-bold text-ink">Rejeitar sugestão</h2>
            </div>
            <p className="text-[12px] text-ink-muted mb-3">
              Informe o motivo pra o vendedor saber por que não foi aprovado.
            </p>
            <textarea
              value={rejeitando.motivo}
              onChange={e => setRejeitando({ ...rejeitando, motivo: e.target.value })}
              placeholder="Ex: item duplicado / preço fora da realidade / falta especificação técnica..."
              className="w-full bg-surface-2 border border-border rounded p-2 text-[12px] text-ink min-h-[80px]"
              autoFocus
            />
            <div className="flex gap-2 mt-3">
              <button
                onClick={handleConfirmarRejeicao}
                disabled={!rejeitando.motivo.trim() || rejeitar.isPending}
                className="flex-1 bg-danger hover:bg-danger/90 text-white text-[12px] font-semibold py-2 rounded disabled:opacity-50 flex items-center justify-center gap-1.5"
              >
                {rejeitar.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <X className="h-3.5 w-3.5" />}
                Confirmar rejeição
              </button>
              <button
                onClick={() => setRejeitando(null)}
                className="px-3 py-2 text-[12px] text-ink-muted hover:bg-surface-2 rounded"
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
