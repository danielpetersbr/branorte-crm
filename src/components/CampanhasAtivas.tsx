import { Pause, Play, X, Send, Loader2 } from 'lucide-react'
import { useVendedorAtual, useCampanhas, useMudarStatusCampanha, type CampanhaProgresso } from '@/hooks/useCampanhas'

/**
 * Painel de acompanhamento das campanhas em andamento. Só aparece quando há
 * alguma viva — campanha concluída não fica ocupando espaço da tela.
 * Fica na própria /atendimentos de propósito: é onde o vendedor criou, então é
 * onde ele procura pra saber se está andando.
 */
export function CampanhasAtivas() {
  const { data: vendedor } = useVendedorAtual()
  const { data: campanhas = [], isLoading } = useCampanhas(vendedor)
  const mudarStatus = useMudarStatusCampanha()

  const vivas = campanhas.filter(c => c.status === 'ativa' || c.status === 'pausada')
  if (isLoading || vivas.length === 0) return null

  return (
    <div className="flex flex-col gap-2">
      {vivas.map(c => (
        <LinhaCampanha
          key={c.id}
          campanha={c}
          onPausar={() => mudarStatus.mutate({ id: c.id, status: 'pausada' })}
          onRetomar={() => mudarStatus.mutate({ id: c.id, status: 'ativa' })}
          onCancelar={() => {
            if (confirm(`Cancelar "${c.titulo}"? Quem já recebeu não é desfeito, mas o resto da fila não sai.`)) {
              mudarStatus.mutate({ id: c.id, status: 'cancelada' })
            }
          }}
          pendente={mudarStatus.isPending}
        />
      ))}
    </div>
  )
}

function LinhaCampanha({
  campanha: c, onPausar, onRetomar, onCancelar, pendente,
}: {
  campanha: CampanhaProgresso
  onPausar: () => void
  onRetomar: () => void
  onCancelar: () => void
  pendente: boolean
}) {
  const feitos = c.enviados + c.falhas
  const pct = c.total_alvos > 0 ? Math.round((feitos / c.total_alvos) * 100) : 0
  const ativa = c.status === 'ativa'

  return (
    <div className="rounded-lg border border-border bg-surface px-3 py-2.5">
      <div className="flex items-center gap-2.5">
        {ativa
          ? <Send className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
          : <Pause className="h-3.5 w-3.5 text-amber-600 shrink-0" />}

        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span className="text-[13px] font-medium text-ink truncate">{c.titulo}</span>
            <span className="text-[11px] text-ink-faint tabular-nums shrink-0">
              {c.enviados}/{c.total_alvos}
              {c.falhas > 0 && <span className="text-danger"> · {c.falhas} falhou</span>}
            </span>
          </div>
          <div className="mt-1 h-1 w-full rounded-full bg-surface-2 overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${ativa ? 'bg-emerald-500' : 'bg-amber-500'}`}
              style={{ width: `${pct}%` }}
            />
          </div>
          <span className="mt-0.5 block text-[10.5px] text-ink-faint">
            {c.sequencia_titulo ? `${c.sequencia_titulo} · ` : ''}
            {ativa ? 'enviando aos poucos' : 'pausada'}
            {c.pendentes > 0 && ` · faltam ${c.pendentes}`}
          </span>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          {pendente && <Loader2 className="h-3 w-3 animate-spin text-ink-faint" />}
          <button
            onClick={ativa ? onPausar : onRetomar}
            disabled={pendente}
            title={ativa ? 'Pausar' : 'Retomar'}
            className="p-1.5 rounded hover:bg-surface-2 text-ink-muted hover:text-ink transition disabled:opacity-50"
          >
            {ativa ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
          </button>
          <button
            onClick={onCancelar}
            disabled={pendente}
            title="Cancelar"
            className="p-1.5 rounded hover:bg-danger-bg text-ink-muted hover:text-danger transition disabled:opacity-50"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  )
}
